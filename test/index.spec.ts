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
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';
import worker from '../src';

/** Minimal valid page so HTMLConverter.getJson() succeeds after fetch */
const MOCK_EDS_HTML = '<!DOCTYPE html><html><body><main><div><div class="da-form"><div><div><p>x-schema-name</p></div><div><p>s</p></div></div></div><div class="s"></div></div></div></main></body></html>';

describe('da-sc worker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
    expect(response.headers.get('Content-Type')).toContain('application/json');
    const body = await response.json() as { error: string };
    expect(body.error).toBe('Method Not Allowed');
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

  it('JSON response sets Cache-Control when token Authorization is present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, { status: 200 }));
    const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/preview/org/site/page', {
      headers: { Authorization: 'token x' },
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('JSON response omits Cache-Control without Authorization', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, { status: 200 }));
    const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/preview/org/site/page');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBeNull();
  });

  it('JSON response omits Cache-Control for Bearer (only token scheme is supported)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, { status: 200 }));
    const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/preview/org/site/page', {
      headers: { Authorization: 'Bearer x' },
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBeNull();
  });

  it('returns JSON error with EDS body (including empty)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/preview/org/site/page', {
      headers: { Authorization: 'token x' },
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await response.json() as { error: string };
    expect(body.error).toBe('');
  });

  it('wraps EDS error body in JSON and forwards x-error header', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('upstream-detail', {
        status: 403,
        headers: {
          'Content-Type': 'text/plain',
          'x-error': 'EDS_CODE',
        },
      }),
    );
    const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/preview/org/site/page');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(403);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    const body = await response.json() as { error: string };
    expect(body.error).toBe('upstream-detail');
    expect(response.headers.get('X-Error')).toBe('EDS_CODE');
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('X-Error');
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('Cache-Control');
  });

  it('sets Cache-Control to private, no-store on EDS error responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('upstream-error', {
        status: 502,
        headers: {
          'Cache-Control': 'no-store',
        },
      }),
    );
    const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/preview/org/site/page');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await response.json() as { error: string };
    expect(body.error).toBe('upstream-error');
  });

  it('uses 404 Not Found in JSON error and still forwards x-error and Cache-Control', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>not found</html>', {
        status: 404,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'x-error': 'NOT_FOUND',
          'Cache-Control': 'max-age=60',
        },
      }),
    );
    const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/preview/org/site/missing');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    const body = await response.json() as { error: string };
    expect(body.error).toBe('404 Not Found');
    expect(response.headers.get('X-Error')).toBe('NOT_FOUND');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('forwards Authorization token scheme to EDS fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, { status: 200 }));
    const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/preview/org/site/page', {
      headers: { Authorization: 'token secret-value' },
    });
    const ctx = createExecutionContext();
    await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://main--site--org.aem.page/page',
      expect.objectContaining({
        cf: { scrapeShield: false },
        headers: { Authorization: 'token secret-value' },
      }),
    );
  });
});
