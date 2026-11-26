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
import { getContentRoute, getCtx } from './context.js';
import {
  copyEdsCacheHeaders, getEdsCacheRequest, mapEdsLocation, type CacheEnv,
} from './eds-cache.js';
import { getJsonEtag, matchesJsonEtag } from './json-etag.js';

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
 * Legacy Cache-Control outside the EDS caching routes. EDS's value is forwarded only
 * for `200` and `404`; token requests are never cacheable by shared caches.
 */
function getLegacyCacheControl(edsResp: Response, tokenAuth: string | undefined): string {
  if (tokenAuth) {
    return PRIVATE_NO_STORE;
  }
  if (edsResp.status === 200 || edsResp.status === 404) {
    return edsResp.headers.get('Cache-Control') ?? NO_STORE;
  }
  return NO_STORE;
}

const MAX_LOGGED_BODY_LENGTH = 200;

/**
 * Emits a structured log entry for Workers Logs. 5xx are logged as errors, everything else as
 * warnings, so expected client errors (e.g. 404) don't surface as failures in Workers Issues.
 * Never pass secrets (e.g. the Authorization token) in `details`.
 */
function logFailure(status: number, details: Record<string, unknown>): void {
  const entry = { status, ...details };
  if (status >= 500) {
    console.error(entry);
  } else {
    console.warn(entry);
  }
}

export default {
  async fetch(request: Request, env: CacheEnv = {}): Promise<Response> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    const tokenAuth = getAuthorizationToken(request);
    const ownErrorCacheControl = tokenAuth ? PRIVATE_NO_STORE : NO_STORE;
    try {
      const requestUrl = new URL(request.url);
      if (requestUrl.pathname === '/favicon.ico') {
        return new Response('', { status: 404 });
      }
      if (getContentRoute(requestUrl.pathname)) {
        corsHeaders['Access-Control-Allow-Headers'] += ', If-None-Match';
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
      const { contentRoute } = ctx;
      const edsCache = contentRoute && getEdsCacheRequest(request.headers, tokenAuth, env);
      let edsResp: Response;
      try {
        edsResp = await fetch(edsContentUrl, {
          cf: { scrapeShield: false },
          ...(edsCache ? { redirect: 'manual', headers: edsCache.headers } : {}),
          ...(!edsCache && tokenAuth ? { headers: { Authorization: tokenAuth } } : {}),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logFailure(502, { event: 'fetch_error', edsUrl: edsContentUrl, error: message });
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
      const responseHeaders = new Headers(corsHeaders);
      const { status } = edsResp;
      if (contentRoute && edsCache) {
        copyEdsCacheHeaders(edsResp, responseHeaders, edsCache);
        const redirect = status >= 300 && status < 400 && status !== 304;
        if (redirect || status === 204 || status === 205 || status === 304) {
          responseHeaders.set('Access-Control-Expose-Headers', 'X-Error, Cache-Control');
          const location = redirect && edsResp.headers.get('Location');
          if (location) {
            responseHeaders.set('Location', mapEdsLocation(location, edsContentUrl, requestUrl, contentRoute, status));
          }
          await edsResp.body?.cancel();
          return new Response(null, { status, headers: responseHeaders });
        }
      } else {
        responseHeaders.set('Cache-Control', getLegacyCacheControl(edsResp, tokenAuth));
      }
      responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
      if (!edsResp.ok) {
        const xError = edsResp.headers.get('x-error') ?? edsResp.headers.get('X-Error');
        const upstreamText = await edsResp.text();
        const returnedError = status === 404 ? '404 Not Found' : upstreamText;
        logFailure(status, {
          event: 'eds_error',
          edsUrl: edsContentUrl,
          xError,
          authenticated: Boolean(tokenAuth),
          ...(status === 404 ? {} : { body: upstreamText.slice(0, MAX_LOGGED_BODY_LENGTH) }),
        });
        responseHeaders.set('Access-Control-Expose-Headers', 'X-Error, Cache-Control');
        if (xError) {
          responseHeaders.set('X-Error', xError);
        }
        return new Response(JSON.stringify({ error: returnedError }), {
          status,
          headers: responseHeaders,
        });
      }

      const html = await edsResp.text();
      const conversion = convertHtmlToJson({ html });
      if ('error' in conversion) {
        logFailure(500, { event: 'conversion_error', edsUrl: edsContentUrl, error: conversion.error });
        return new Response(`Failed to convert EDS HTML: ${conversion.error}`, {
          status: 500,
          headers: {
            ...corsHeaders,
            'Cache-Control': ownErrorCacheControl,
          },
        });
      }
      const json = JSON.stringify(conversion.json, null, 2);
      responseHeaders.set('Access-Control-Expose-Headers', 'Cache-Control');
      if (contentRoute && status === 200) {
        const bytes = new TextEncoder().encode(json);
        const etag = await getJsonEtag(bytes);
        responseHeaders.set('ETag', etag);
        responseHeaders.set('Access-Control-Expose-Headers', 'Cache-Control, ETag');
        if (matchesJsonEtag(request.headers.get('If-None-Match'), etag)) {
          responseHeaders.delete('Content-Type');
          return new Response(null, { status: 304, headers: responseHeaders });
        }
        return new Response(bytes, { status, headers: responseHeaders });
      }
      return new Response(json, { status: contentRoute ? status : 200, headers: responseHeaders });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logFailure(500, { event: 'unhandled_error', path: new URL(request.url).pathname, error: message });
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
