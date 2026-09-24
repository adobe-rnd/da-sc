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
import {
  CORS_HEADERS, errorMessage, FALLBACK_ERROR_HEADERS, HTTP_STATUS, JSON_HEADERS,
} from './http.js';
import { listPages } from './routes/list/handler.js';
import { getPage } from './routes/page.js';

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (new URL(request.url).pathname === '/favicon.ico') {
        return new Response('', { status: HTTP_STATUS.NOT_FOUND });
      }

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: HTTP_STATUS.NO_CONTENT,
          headers: CORS_HEADERS,
        });
      }

      if (request.method === 'GET' && /^\/[^/]+\/[^/]+\/[^/]+\/?$/.test(new URL(request.url).pathname)) {
        return await listPages(request);
      }

      if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
          status: HTTP_STATUS.METHOD_NOT_ALLOWED,
          headers: JSON_HEADERS,
        });
      }
      return await getPage(request);
    } catch (err: unknown) {
      return new Response(JSON.stringify({ error: errorMessage(err) }), {
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        headers: FALLBACK_ERROR_HEADERS,
      });
    }
  },
};
