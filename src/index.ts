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
import { convertHtmlToJson } from '@adobe/da-sc-sdk';
import { getCtx } from './context.js';

const NO_STORE = 'no-store';
const PRIVATE_NO_STORE = 'private, no-store';

/**
 * Returns `Authorization` only for the `token` scheme (`Authorization: token <secret>`).
 * Other schemes (e.g. `Bearer`, `Basic`) are not supported and yield `undefined`.
 */
function getAuthorizationToken(request: Request): string | undefined {
  const auth = request.headers.get('Authorization');
  return auth && /^token\s+/i.test(auth.trimStart()) ? auth.trim() : undefined;
}

/**
 * Cache-Control for a response derived from an EDS answer. EDS's value is forwarded only
 * for `200` and `404`; token requests are never cacheable by shared caches.
 */
function getCacheControl(edsResp: Response, tokenAuth: string | undefined): string {
  if (tokenAuth) {
    return PRIVATE_NO_STORE;
  }
  if (edsResp.status === 200 || edsResp.status === 404) {
    return edsResp.headers.get('Cache-Control') ?? NO_STORE;
  }
  return NO_STORE;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    const tokenAuth = getAuthorizationToken(request);
    const ownErrorCacheControl = tokenAuth ? PRIVATE_NO_STORE : NO_STORE;
    try {
      if (new URL(request.url).pathname === '/favicon.ico') {
        return new Response('', { status: 404 });
      }

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: corsHeaders,
        });
      }

      if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
          status: 405,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': ownErrorCacheControl,
          },
        });
      }
      const ctx = getCtx(request.url);
      const edsContentUrl = `${ctx.edsDomainUrl}/${ctx.contentPath}`;
      let edsResp: Response;
      try {
        edsResp = await fetch(edsContentUrl, {
          cf: { scrapeShield: false },
          ...(tokenAuth ? { headers: { Authorization: tokenAuth } } : {}),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return new Response(JSON.stringify({ error: message }), {
          status: 502,
          headers: {
            ...corsHeaders,
            'Access-Control-Expose-Headers': 'Cache-Control',
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': ownErrorCacheControl,
          },
        });
      }
      const cacheControl = getCacheControl(edsResp, tokenAuth);
      if (!edsResp.ok) {
        const { status } = edsResp;
        const xError = edsResp.headers.get('x-error') ?? edsResp.headers.get('X-Error');
        const upstreamText = await edsResp.text();
        const returnedError = status === 404 ? '404 Not Found' : upstreamText;
        const errHeaders: Record<string, string> = {
          ...corsHeaders,
          'Access-Control-Expose-Headers': 'X-Error, Cache-Control',
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': cacheControl,
        };
        if (xError) {
          errHeaders['X-Error'] = xError;
        }
        return new Response(JSON.stringify({ error: returnedError }), {
          status,
          headers: errHeaders,
        });
      }

      const html = await edsResp.text();
      const conversion = convertHtmlToJson({ html });
      if ('error' in conversion) {
        return new Response(`Failed to convert EDS HTML: ${conversion.error}`, {
          status: 500,
          headers: {
            ...corsHeaders,
            'Cache-Control': ownErrorCacheControl,
          },
        });
      }
      const { json } = conversion;

      return new Response(JSON.stringify(json, null, 2), {
        headers: {
          ...corsHeaders,
          'Access-Control-Expose-Headers': 'Cache-Control',
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': cacheControl,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': ownErrorCacheControl,
        },
      });
    }
  },
};
