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
