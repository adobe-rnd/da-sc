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
  EDS_INDEX_FILENAME, encodeCursor, InvalidListError, parseIndexPage, parseListPagination,
} from './validation.js';

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

  const { offset, limit } = pagination;
  const { edsDomainUrl } = getCtx(request.url);
  const tokenAuth = getAuthorizationToken(request);
  const indexUrl = new URL(getEdsUrl(edsDomainUrl, EDS_INDEX_FILENAME));
  indexUrl.searchParams.set('offset', String(offset));
  indexUrl.searchParams.set('limit', String(limit));

  let indexResponse: Response;
  try {
    indexResponse = await fetchEdsPage(indexUrl.toString(), tokenAuth);
  } catch (error) {
    return new Response(JSON.stringify({ error: `Failed to fetch EDS index: ${errorMessage(error)}` }), {
      status: HTTP_STATUS.BAD_GATEWAY,
      headers: getJsonHeaders(tokenAuth),
    });
  }

  if (!indexResponse.ok) {
    let message: string;
    try {
      message = indexResponse.status === HTTP_STATUS.NOT_FOUND
        ? NOT_FOUND_ERROR
        : await indexResponse.text();
    } catch (error) {
      return new Response(JSON.stringify({ error: `Failed to read EDS index: ${errorMessage(error)}` }), {
        status: HTTP_STATUS.BAD_GATEWAY,
        headers: getJsonHeaders(tokenAuth),
      });
    }

    const headers = getUpstreamErrorHeaders(tokenAuth);

    const xError = indexResponse.headers.get(HEADER_NAMES.X_ERROR);
    if (xError) headers[HEADER_NAMES.X_ERROR] = xError;
    return new Response(JSON.stringify({ error: message }), {
      status: indexResponse.status,
      headers,
    });
  }

  let indexBody: unknown;
  try {
    indexBody = await indexResponse.json();
  } catch (error) {
    return new Response(JSON.stringify({ error: `Failed to read EDS index JSON: ${errorMessage(error)}` }), {
      status: HTTP_STATUS.BAD_GATEWAY,
      headers: getJsonHeaders(tokenAuth),
    });
  }

  let indexPage;
  try {
    indexPage = parseIndexPage(indexBody, offset, limit);
  } catch (error) {
    if (!(error instanceof InvalidListError)) throw error;
    return new Response(JSON.stringify({ error: `Invalid EDS index: ${errorMessage(error)}` }), {
      status: HTTP_STATUS.BAD_GATEWAY,
      headers: getJsonHeaders(tokenAuth),
    });
  }

  const items = await convertListItems(edsDomainUrl, indexPage.paths, tokenAuth);
  const nextOffset = offset + items.length < indexPage.total ? offset + items.length : null;

  return new Response(JSON.stringify({
    items,
    count: items.length,
    total: indexPage.total,
    offset,
    limit,
    nextOffset,
    ...(nextOffset === null ? {} : { cursor: encodeCursor(nextOffset, request.url) }),
  }), { headers: getJsonHeaders(tokenAuth) });
}
