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
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import { getCtx } from './context.js';
import HTMLConverter from './html2json.js';

function parseHtml(html: string) {
  return unified()
    .use(rehypeParse, { fragment: false })
    .parse(html);
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      const pathname = new URL(request.url).pathname;
      if (pathname === '/' || pathname === '/favicon.ico') {
        return new Response('', { status: 404 });
      }

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: corsHeaders,
        });
      }

      if (request.method !== 'GET') {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: corsHeaders,
        });
      }

      const ctx = getCtx(request.url);
      const edsContentUrl = `${ctx.edsDomainUrl}/${ctx.contentPath}`;
      const edsResp = await fetch(edsContentUrl, { cf: { scrapeShield: false } });
      if (!edsResp.ok) {
        return new Response(`Failed to fetch EDS page: ${edsContentUrl}`, { status: edsResp.status, headers: corsHeaders });
      }

      const html = await edsResp.text();
      const converter = new HTMLConverter(parseHtml(html));
      const json = converter.getJson();

      return new Response(JSON.stringify(json, null, 2), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    } catch (err: any) {
      return new Response(`Error: ${err.message || err}`, { status: 500, headers: {
        'Access-Control-Allow-Origin': '*',
      }});
    }
  },
};
