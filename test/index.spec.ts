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
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import worker from '../src';

const mockedConvertHtmlToJson = vi.hoisted(() => vi.fn());

vi.mock('@adobe/da-sc-sdk', () => ({
  convertHtmlToJson: mockedConvertHtmlToJson,
}));

const MOCK_EDS_HTML = '<main>stub</main>';

async function runRequest(url: string, init?: RequestInit): Promise<Response> {
  const request = new Request(url, init);
  return worker.fetch(request);
}

describe('da-sc worker', () => {
  beforeEach(() => {
    mockedConvertHtmlToJson.mockReset();
    mockedConvertHtmlToJson.mockReturnValue({
      json: { metadata: { schemaName: 'article' }, data: { title: 'Default title' } },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 404 for favicon.ico', async () => {
    const response = await runRequest('http://example.com/favicon.ico');
    expect(response.status).toBe(404);
  });

  it('returns 204 for OPTIONS request', async () => {
    const response = await runRequest('http://example.com/preview/org/site/path', {
      method: 'OPTIONS',
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('returns 405 for POST request', async () => {
    const response = await runRequest('http://example.com/preview/org/site/path', {
      method: 'POST',
    });
    expect(response.status).toBe(405);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    const body = await response.json() as { error: string };
    expect(body.error).toBe('Method Not Allowed');
  });

  it('includes CORS headers in error response', async () => {
    const response = await runRequest('http://example.com/preview/org/site/path', {
      method: 'POST',
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('returns upstream status when EDS fetch fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));

    const response = await runRequest('http://example.com/preview/org/site/path');

    expect(fetchSpy).toHaveBeenCalledWith('https://main--site--org.aem.page/path', { cf: { scrapeShield: false } });
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    const body = await response.json() as { error: string };
    expect(body.error).toBe('404 Not Found');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(mockedConvertHtmlToJson).not.toHaveBeenCalled();
  });

  it('returns 500 when HTML conversion fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<main>stub</main>', { status: 200 }));
    mockedConvertHtmlToJson.mockReturnValue({ error: 'schema mismatch' });

    const response = await runRequest('http://example.com/preview/org/site/path');

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Failed to convert EDS HTML: schema mismatch');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(mockedConvertHtmlToJson).toHaveBeenCalledWith({ html: '<main>stub</main>' });
  });

  it('returns converted JSON for successful GET request', async () => {
    const converted = {
      metadata: { schemaName: 'article' },
      data: { title: 'Hello World' },
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<main>stub</main>', { status: 200 }));
    mockedConvertHtmlToJson.mockReturnValue({ json: converted });

    const response = await runRequest('http://example.com/preview/org/site/path');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.json()).toEqual(converted);
    expect(mockedConvertHtmlToJson).toHaveBeenCalledWith({ html: '<main>stub</main>' });
  });

  it('returns 500 when context parsing throws an Error', async () => {
    const response = await runRequest('http://example.com/preview');

    expect(response.status).toBe(500);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    const body = await response.json() as { error: string };
    expect(body.error).toBe('Usage: /tld/org/site/path');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('returns 502 with no-store when EDS is not reachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue('upstream timeout');

    const response = await runRequest('http://example.com/preview/org/site/path');

    expect(response.status).toBe(502);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json() as { error: string };
    expect(body.error).toBe('upstream timeout');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('returns private, no-store when EDS is not reachable with a token', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connect failed'));

    const response = await runRequest('http://example.com/preview/org/site/path', {
      headers: { Authorization: 'token x' },
    });

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('sets no-store on own errors', async () => {
    const methodResponse = await runRequest('http://example.com/preview/org/site/path', {
      method: 'POST',
    });
    expect(methodResponse.headers.get('Cache-Control')).toBe('no-store');

    const ctxResponse = await runRequest('http://example.com/preview');
    expect(ctxResponse.headers.get('Cache-Control')).toBe('no-store');

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, {
      status: 200,
      headers: { 'Cache-Control': 'max-age=60, must-revalidate' },
    }));
    mockedConvertHtmlToJson.mockReturnValue({ error: 'schema mismatch' });
    const convResponse = await runRequest('http://example.com/preview/org/site/path');
    expect(convResponse.status).toBe(500);
    expect(convResponse.headers.get('Cache-Control')).toBe('no-store');
  });

  it('JSON response sets private, no-store when token Authorization is present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, {
      status: 200,
      headers: { 'Cache-Control': 'max-age=7200, must-revalidate' },
    }));
    const response = await runRequest('http://example.com/live/org/site/page', {
      headers: { Authorization: 'token x' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('JSON response forwards EDS Cache-Control without Authorization', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, {
      status: 200,
      headers: { 'Cache-Control': 'max-age=7200, must-revalidate' },
    }));
    const response = await runRequest('http://example.com/live/org/site/page');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('max-age=7200, must-revalidate');
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('Cache-Control');
  });

  it('JSON response uses no-store when EDS sends no Cache-Control', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, { status: 200 }));
    const response = await runRequest('http://example.com/preview/org/site/page');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('JSON response forwards EDS Cache-Control for Bearer (only token scheme is supported)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, {
      status: 200,
      headers: { 'Cache-Control': 'max-age=60, must-revalidate' },
    }));
    const response = await runRequest('http://example.com/preview/org/site/page', {
      headers: { Authorization: 'Bearer x' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('max-age=60, must-revalidate');
  });

  it('returns JSON error with EDS body (including empty)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    const response = await runRequest('http://example.com/preview/org/site/page', {
      headers: { Authorization: 'token x' },
    });
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
    const response = await runRequest('http://example.com/preview/org/site/page');
    expect(response.status).toBe(403);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    const body = await response.json() as { error: string };
    expect(body.error).toBe('upstream-detail');
    expect(response.headers.get('X-Error')).toBe('EDS_CODE');
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('X-Error');
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('Cache-Control');
  });

  it('sets Cache-Control to no-store on EDS 5xx responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('upstream-error', {
        status: 503,
        headers: {
          'Cache-Control': 'max-age=60',
        },
      }),
    );
    const response = await runRequest('http://example.com/preview/org/site/page');
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
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
    const response = await runRequest('http://example.com/preview/org/site/missing');
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    const body = await response.json() as { error: string };
    expect(body.error).toBe('404 Not Found');
    expect(response.headers.get('X-Error')).toBe('NOT_FOUND');
    expect(response.headers.get('Cache-Control')).toBe('max-age=60');
  });

  it('uses private, no-store on EDS 404 with a token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not found', { status: 404, headers: { 'Cache-Control': 'max-age=60' } }),
    );
    const response = await runRequest('http://example.com/preview/org/site/missing', {
      headers: { Authorization: 'token x' },
    });
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('uses no-store on EDS 403 even if EDS sends Cache-Control', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('forbidden', { status: 403, headers: { 'Cache-Control': 'max-age=60' } }),
    );
    const response = await runRequest('http://example.com/preview/org/site/page');
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('forwards Authorization token scheme to EDS fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, { status: 200 }));
    await runRequest('http://example.com/preview/org/site/page', {
      headers: { Authorization: 'token secret-value' },
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://main--site--org.aem.page/page',
      expect.objectContaining({
        cf: { scrapeShield: false },
        headers: { Authorization: 'token secret-value' },
      }),
    );
  });

  describe('failure logging', () => {
    it('logs 5xx EDS errors with truncated body, without the token', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('x'.repeat(500), { status: 503, headers: { 'x-error': 'backend down' } }),
      );

      await runRequest('http://example.com/live/org/site/page', {
        headers: { Authorization: 'token secret-value' },
      });

      expect(errorSpy).toHaveBeenCalledWith({
        status: 503,
        event: 'eds_error',
        edsUrl: 'https://main--site--org.aem.live/page',
        xError: 'backend down',
        authenticated: true,
        body: 'x'.repeat(200),
      });
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret-value');
    });

    it('logs EDS 404 as a warning without the body', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>not found</html>', { status: 404 }));

      await runRequest('http://example.com/preview/org/site/missing');

      expect(warnSpy).toHaveBeenCalledWith({
        status: 404,
        event: 'eds_error',
        edsUrl: 'https://main--site--org.aem.page/missing',
        xError: null,
        authenticated: false,
      });
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('logs conversion failures as errors', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, { status: 200 }));
      mockedConvertHtmlToJson.mockReturnValue({ error: 'schema mismatch' });

      await runRequest('http://example.com/preview/org/site/path');

      expect(errorSpy).toHaveBeenCalledWith({
        status: 500, event: 'conversion_error', edsUrl: 'https://main--site--org.aem.page/path', error: 'schema mismatch',
      });
    });

    it('logs failed EDS requests as errors', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network lost'));

      await runRequest('http://example.com/preview/org/site/path');

      expect(errorSpy).toHaveBeenCalledWith({
        status: 502, event: 'fetch_error', edsUrl: 'https://main--site--org.aem.page/path', error: 'network lost',
      });
    });

    it('logs unhandled errors', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await runRequest('http://example.com/preview');

      expect(errorSpy).toHaveBeenCalledWith({
        status: 500, event: 'unhandled_error', path: '/preview', error: 'Usage: /tld/org/site/path',
      });
    });

    it('does not log successful requests', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, { status: 200 }));

      await runRequest('http://example.com/preview/org/site/path');

      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
