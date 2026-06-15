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
import { htmlToContentFragment } from './cf/pipeline.js';
import { schemaToContentFragmentModel } from './cfm/pipeline.js';
import type { ReferencesMode } from './cf/convert.js';

/** Valid values for the `references` query parameter. */
const REFERENCES_MODES: ReferencesMode[] = ['none', 'direct', 'direct-hydrated', 'all', 'all-hydrated'];

/**
 * Returns `Authorization` only for the `token` scheme (`Authorization: token <secret>`).
 * Other schemes (e.g. `Bearer`, `Basic`) are not supported and yield `undefined`.
 */
function getAuthorizationToken(request: Request): string | undefined {
  const auth = request.headers.get('Authorization');
  return auth && /^token\s+/i.test(auth.trimStart()) ? auth.trim() : undefined;
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      };

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
          },
        });
      }
      const ctx = getCtx(request.url);
      const tokenAuth = getAuthorizationToken(request);

      const jsonHeaders: Record<string, string> = {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
      };
      if (tokenAuth) {
        jsonHeaders['Cache-Control'] = 'private, no-store';
      }

      // The Content Fragment Model route needs only the schema, not the EDS
      // document — handle it before fetching anything from EDS. `getCtx` has
      // decoded the model id into `{schemaName}{pointer}` (carried in contentPath).
      if (ctx.format === 'cfm') {
        const [schemaName, ...pointerSegments] = ctx.contentPath.split('/').filter(Boolean);
        const cfm = await schemaToContentFragmentModel({
          identity: { org: ctx.org, site: ctx.site },
          schemaName,
          pointer: pointerSegments.length ? `/${pointerSegments.join('/')}` : '',
          authorization: tokenAuth,
        });
        if (cfm.error) {
          return new Response(`Failed to build Content Fragment Model: ${cfm.error}`, {
            status: 500,
            headers: corsHeaders,
          });
        }
        return new Response(JSON.stringify(cfm.model, null, 2), {
          headers: jsonHeaders,
        });
      }

      const edsContentUrl = `${ctx.edsDomainUrl}/${ctx.contentPath}`;
      const edsResp = await fetch(edsContentUrl, {
        cf: { scrapeShield: false },
        ...(tokenAuth ? { headers: { Authorization: tokenAuth } } : {}),
      });
      if (!edsResp.ok) {
        const { status } = edsResp;
        const xError = edsResp.headers.get('x-error') ?? edsResp.headers.get('X-Error');
        const upstreamText = await edsResp.text();
        const returnedError = status === 404 ? '404 Not Found' : upstreamText;
        const errHeaders: Record<string, string> = {
          ...corsHeaders,
          'Access-Control-Expose-Headers': 'X-Error, Cache-Control',
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'private, no-store',
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

      if (ctx.format === 'cf') {
        const refParam = new URL(request.url).searchParams.get('references') ?? undefined;
        if (refParam && !REFERENCES_MODES.includes(refParam as ReferencesMode)) {
          return new Response(
            JSON.stringify({ error: `Invalid references value: ${refParam}` }),
            { status: 400, headers: jsonHeaders },
          );
        }
        const cf = await htmlToContentFragment({
          html,
          identity: {
            org: ctx.org, site: ctx.site, path: ctx.contentPath, tier: ctx.tier,
          },
          referencesMode: refParam as ReferencesMode | undefined,
          authorization: tokenAuth,
        });
        if (cf.error) {
          return new Response(`Failed to convert to Content Fragment: ${cf.error}`, {
            status: 500,
            headers: corsHeaders,
          });
        }
        return new Response(JSON.stringify(cf.fragment, null, 2), {
          headers: jsonHeaders,
        });
      }

      const conversion = convertHtmlToJson({ html });
      if ('error' in conversion) {
        return new Response(`Failed to convert EDS HTML: ${conversion.error}`, {
          status: 500,
          headers: corsHeaders,
        });
      }
      const { json } = conversion;

      return new Response(JSON.stringify(json, null, 2), {
        headers: jsonHeaders,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json; charset=utf-8',
        },
      });
    }
  },
};
