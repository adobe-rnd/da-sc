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
  env, createExecutionContext, waitOnExecutionContext, fetchMock,
} from 'cloudflare:test';
import {
  describe, it, expect, beforeAll, afterEach,
} from 'vitest';
import worker from '../src';

const MINIMAL_HTML = `<html><head></head><body><main><div>
  <div class="da-form">
    <div><div>x-schema-name</div><div>test</div></div>
  </div>
</div></main></body></html>`;
const ORIGIN = 'https://main--site--org.aem.page';

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => fetchMock.assertNoPendingInterceptors());

describe('da-sc worker', () => {
  it('returns 404 for favicon.ico', async () => {
    const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/favicon.ico');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(404);
  });

  it('returns 204 for OPTIONS request', async () => {
    const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/preview/org/site/path', {
      method: 'OPTIONS',
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('returns 405 for POST request', async () => {
    const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/preview/org/site/path', {
      method: 'POST',
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(405);
  });

  it('includes CORS headers in error response', async () => {
    const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/preview/org/site/path', {
      method: 'POST',
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  describe('header pass-through', () => {
    it('passes Date, Last-Modified, and Cache-Control from origin on 200', async () => {
      fetchMock.get(ORIGIN)
        .intercept({ path: '/page' })
        .reply(200, MINIMAL_HTML, {
          headers: {
            'Content-Type': 'text/html',
            Date: 'Mon, 28 Apr 2026 12:00:00 GMT',
            'Last-Modified': 'Mon, 27 Apr 2026 10:00:00 GMT',
            'Cache-Control': 'public, max-age=3600',
          },
        });

      const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/preview/org/site/page');
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      expect(response.headers.get('Date')).toBe('Mon, 28 Apr 2026 12:00:00 GMT');
      expect(response.headers.get('Last-Modified')).toBe('Mon, 27 Apr 2026 10:00:00 GMT');
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
    });

    it('returns 304 and passes headers when origin returns 304', async () => {
      fetchMock.get(ORIGIN)
        .intercept({ path: '/page', headers: { 'If-Modified-Since': 'Mon, 27 Apr 2026 10:00:00 GMT' } })
        .reply(304, '', {
          headers: {
            Date: 'Mon, 28 Apr 2026 12:00:00 GMT',
            'Last-Modified': 'Mon, 27 Apr 2026 10:00:00 GMT',
            'Cache-Control': 'public, max-age=3600',
          },
        });

      const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/preview/org/site/page', {
        headers: { 'If-Modified-Since': 'Mon, 27 Apr 2026 10:00:00 GMT' },
      });
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(304);
      expect(response.headers.get('Date')).toBe('Mon, 28 Apr 2026 12:00:00 GMT');
      expect(response.headers.get('Last-Modified')).toBe('Mon, 27 Apr 2026 10:00:00 GMT');
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
    });

    it('forwards If-Modified-Since from client to origin', async () => {
      fetchMock.get(ORIGIN)
        .intercept({ path: '/page', headers: { 'If-Modified-Since': 'Mon, 27 Apr 2026 10:00:00 GMT' } })
        .reply(200, MINIMAL_HTML, { headers: { 'Content-Type': 'text/html' } });

      const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/preview/org/site/page', {
        headers: { 'If-Modified-Since': 'Mon, 27 Apr 2026 10:00:00 GMT' },
      });
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
    });

    it('omits headers not present in origin response', async () => {
      fetchMock.get(ORIGIN)
        .intercept({ path: '/page' })
        .reply(200, MINIMAL_HTML, { headers: { 'Content-Type': 'text/html' } });

      const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/preview/org/site/page');
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      expect(response.headers.get('Last-Modified')).toBeNull();
      expect(response.headers.get('Cache-Control')).toBeNull();
    });
  });
});
