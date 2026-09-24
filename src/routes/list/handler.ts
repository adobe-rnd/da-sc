/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { getCtx } from '../../context.js';
import { convertListItems, fetchEdsPage, getEdsUrl } from '../../eds.js';
import {
  errorMessage, getAuthorizationToken, getJsonHeaders, getUpstreamErrorHeaders,
  HEADER_NAMES, HTTP_STATUS, NOT_FOUND_ERROR,
} from '../../http.js';
import {
  EDS_INDEX_FILENAME, encodeCursor, type IndexPage, InvalidListError, matchesPathPrefix,
  parseIndexPage, parseListPagination,
} from './validation.js';

const INDEX_SCAN_PAGE_SIZE = 1000;

type IndexFetchResult = { page: IndexPage } | { error: Response };

function indexError(
  message: string,
  status: number,
  headers: Record<string, string>,
): IndexFetchResult {
  return { error: new Response(JSON.stringify({ error: message }), { status, headers }) };
}

async function fetchIndexPage(
  edsDomainUrl: string,
  tokenAuth: string | undefined,
  offset: number,
  limit: number,
): Promise<IndexFetchResult> {
  const indexUrl = new URL(getEdsUrl(edsDomainUrl, EDS_INDEX_FILENAME));
  indexUrl.searchParams.set('offset', String(offset));
  indexUrl.searchParams.set('limit', String(limit));

  let indexResponse: Response;
  try {
    indexResponse = await fetchEdsPage(indexUrl.toString(), tokenAuth);
  } catch (error) {
    return indexError(
      `Failed to fetch EDS index: ${errorMessage(error)}`,
      HTTP_STATUS.BAD_GATEWAY,
      getJsonHeaders(tokenAuth),
    );
  }

  if (!indexResponse.ok) {
    let message: string;
    try {
      message = indexResponse.status === HTTP_STATUS.NOT_FOUND
        ? NOT_FOUND_ERROR
        : await indexResponse.text();
    } catch (error) {
      return indexError(
        `Failed to read EDS index: ${errorMessage(error)}`,
        HTTP_STATUS.BAD_GATEWAY,
        getJsonHeaders(tokenAuth),
      );
    }

    const headers = getUpstreamErrorHeaders(tokenAuth);

    const xError = indexResponse.headers.get(HEADER_NAMES.X_ERROR);
    if (xError) headers[HEADER_NAMES.X_ERROR] = xError;
    return indexError(message, indexResponse.status, headers);
  }

  let indexBody: unknown;
  try {
    indexBody = await indexResponse.json();
  } catch (error) {
    return indexError(
      `Failed to read EDS index JSON: ${errorMessage(error)}`,
      HTTP_STATUS.BAD_GATEWAY,
      getJsonHeaders(tokenAuth),
    );
  }

  let indexPage;
  try {
    indexPage = parseIndexPage(indexBody, offset, limit);
  } catch (error) {
    if (!(error instanceof InvalidListError)) throw error;
    return indexError(
      `Invalid EDS index: ${errorMessage(error)}`,
      HTTP_STATUS.BAD_GATEWAY,
      getJsonHeaders(tokenAuth),
    );
  }

  return { page: indexPage };
}

async function scanFilteredIndex(
  edsDomainUrl: string,
  tokenAuth: string | undefined,
  prefix: string,
  offset: number,
  limit: number,
): Promise<IndexFetchResult> {
  let filteredTotal = 0;
  let sourceTotal: number | undefined;
  const paths: string[] = [];

  async function scan(indexOffset: number): Promise<IndexFetchResult> {
    const result = await fetchIndexPage(edsDomainUrl, tokenAuth, indexOffset, INDEX_SCAN_PAGE_SIZE);
    if ('error' in result) return result;

    const { page } = result;
    if (sourceTotal !== undefined && page.total !== sourceTotal) {
      return indexError(
        'EDS index changed during the filtered scan',
        HTTP_STATUS.BAD_GATEWAY,
        getJsonHeaders(tokenAuth),
      );
    }
    sourceTotal = page.total;

    for (const path of page.allIndexPaths ?? page.paths) {
      if (matchesPathPrefix(path, prefix)) {
        if (filteredTotal >= offset && paths.length < limit) paths.push(path);
        filteredTotal += 1;
      }
    }

    if (page.allIndexPaths || indexOffset + page.paths.length >= page.total) {
      return { page: { paths, total: filteredTotal } };
    }
    return scan(indexOffset + page.paths.length);
  }

  return scan(0);
}

export async function listPages(request: Request): Promise<Response> {
  let pagination;
  try {
    pagination = parseListPagination(request.url);
  } catch (error) {
    if (!(error instanceof InvalidListError)) throw error;
    return new Response(JSON.stringify({ error: error.message }), {
      status: HTTP_STATUS.BAD_REQUEST,
      headers: getJsonHeaders(getAuthorizationToken(request)),
    });
  }

  const { offset, limit, path } = pagination;
  const { edsDomainUrl } = getCtx(request.url);
  const tokenAuth = getAuthorizationToken(request);
  const result = path
    ? await scanFilteredIndex(edsDomainUrl, tokenAuth, path, offset, limit)
    : await fetchIndexPage(edsDomainUrl, tokenAuth, offset, limit);
  if ('error' in result) return result.error;

  const { paths, total } = result.page;
  const items = await convertListItems(edsDomainUrl, paths, tokenAuth);
  const nextOffset = offset + items.length < total ? offset + items.length : null;

  return new Response(JSON.stringify({
    items,
    count: items.length,
    total,
    offset,
    limit,
    nextOffset,
    ...(nextOffset === null ? {} : { cursor: encodeCursor(nextOffset, request.url) }),
  }), { headers: getJsonHeaders(tokenAuth) });
}
