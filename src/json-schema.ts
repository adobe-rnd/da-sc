/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { getSharedSchema } from '@adobe/da-sc-sdk';

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const NOT_FOUND_CACHE_CONTROL = 'public, max-age=60';
const SCHEMA_PATH = /^\/schemas\/shared\/([^/]+)\/v([^/]+)\.json$/;

const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
};

/** Returns true for the reserved `/schemas` namespace (exact or `/schemas/` prefix). */
export function isJsonSchemaPath(pathname: string): boolean {
  return pathname === '/schemas' || pathname.startsWith('/schemas/');
}

function textResponse(status: number, body: string, headers: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers },
  });
}

function respond(request: Request): Response {
  // Like the content handler, answer every preflight without a lookup.
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...BASE_HEADERS,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const [, name, version] = SCHEMA_PATH.exec(new URL(request.url).pathname) ?? [];
  if (!name || !version) {
    return textResponse(404, 'Not Found', { 'Cache-Control': NOT_FOUND_CACHE_CONTROL });
  }

  const lookup = getSharedSchema({ name, version });
  if ('error' in lookup) {
    console.warn({
      status: 404, event: 'schema_not_found', name, version,
    });
    return textResponse(404, 'Not Found', { 'Cache-Control': NOT_FOUND_CACHE_CONTROL });
  }

  if (request.method !== 'GET') {
    return textResponse(405, 'Method Not Allowed', {
      Allow: 'GET, OPTIONS',
      'Cache-Control': 'no-store',
    });
  }

  return new Response(JSON.stringify(lookup.schema, null, 2), {
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'application/schema+json',
      'Cache-Control': IMMUTABLE_CACHE_CONTROL,
    },
  });
}

/**
 * Serves the shared JSON Schemas bundled in `@adobe/da-sc-sdk`. Responses to
 * requests with an `Authorization` header are never cacheable (RFC §7).
 */
export async function handleJsonSchemaRequest(request: Request): Promise<Response> {
  let response: Response;
  try {
    response = respond(request);
  } catch {
    console.error({ status: 500, event: 'schema_error', method: request.method });
    response = textResponse(500, 'Internal Server Error', { 'Cache-Control': 'no-store' });
  }
  if (request.headers.has('Authorization')) {
    response.headers.set('Cache-Control', 'private, no-store');
  }
  return response;
}
