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

export const HTTP_STATUS = {
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
} as const;

export const HEADER_NAMES = {
  AUTHORIZATION: 'Authorization',
  CACHE_CONTROL: 'Cache-Control',
  X_ERROR: 'X-Error',
} as const;

export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
export const JSON_INDENT = 2;
export const PRIVATE_NO_STORE = 'private, no-store';
export const NOT_FOUND_ERROR = '404 Not Found';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const JSON_HEADERS = {
  ...CORS_HEADERS,
  'Content-Type': JSON_CONTENT_TYPE,
};

export const FALLBACK_ERROR_HEADERS = {
  'Access-Control-Allow-Origin': CORS_HEADERS['Access-Control-Allow-Origin'],
  'Content-Type': JSON_CONTENT_TYPE,
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getJsonHeaders(tokenAuth?: string): Record<string, string> {
  if (!tokenAuth) return { ...JSON_HEADERS };
  return { ...JSON_HEADERS, [HEADER_NAMES.CACHE_CONTROL]: PRIVATE_NO_STORE };
}

export function getUpstreamErrorHeaders(tokenAuth?: string): Record<string, string> {
  return {
    ...getJsonHeaders(tokenAuth),
    [HEADER_NAMES.CACHE_CONTROL]: PRIVATE_NO_STORE,
    'Access-Control-Expose-Headers': `${HEADER_NAMES.X_ERROR}, ${HEADER_NAMES.CACHE_CONTROL}`,
  };
}

/**
 * Returns `Authorization` only for the `token` scheme (`Authorization: token <secret>`).
 * Other schemes (e.g. `Bearer`, `Basic`) are not supported and yield `undefined`.
 */
export function getAuthorizationToken(request: Request): string | undefined {
  const auth = request.headers.get(HEADER_NAMES.AUTHORIZATION);
  return auth && /^token\s+/i.test(auth.trimStart()) ? auth.trim() : undefined;
}
