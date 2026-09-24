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
import { getCtx } from '../context.js';
import { convertEdsPage, fetchEdsPage, getEdsUrl } from '../eds.js';
import {
  CORS_HEADERS, getAuthorizationToken, getJsonHeaders, getUpstreamErrorHeaders,
  HEADER_NAMES, HTTP_STATUS, JSON_INDENT, NOT_FOUND_ERROR,
} from '../http.js';

export async function getPage(request: Request): Promise<Response> {
  const ctx = getCtx(request.url);
  const edsContentUrl = getEdsUrl(ctx.edsDomainUrl, ctx.contentPath);
  const tokenAuth = getAuthorizationToken(request);

  const edsResp = await fetchEdsPage(edsContentUrl, tokenAuth);
  if (!edsResp.ok) {
    const { status } = edsResp;
    const xError = edsResp.headers.get(HEADER_NAMES.X_ERROR);
    const upstreamText = await edsResp.text();
    const returnedError = status === HTTP_STATUS.NOT_FOUND ? NOT_FOUND_ERROR : upstreamText;
    const errHeaders = getUpstreamErrorHeaders(tokenAuth);

    if (xError) {
      errHeaders[HEADER_NAMES.X_ERROR] = xError;
    }

    return new Response(JSON.stringify({ error: returnedError }), {
      status,
      headers: errHeaders,
    });
  }

  const conversion = await convertEdsPage(edsResp);
  if ('error' in conversion) {
    return new Response(`Failed to convert EDS HTML: ${conversion.error}`, {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      headers: CORS_HEADERS,
    });
  }
  const { json } = conversion;

  return new Response(JSON.stringify(json, null, JSON_INDENT), {
    headers: getJsonHeaders(tokenAuth),
  });
}
