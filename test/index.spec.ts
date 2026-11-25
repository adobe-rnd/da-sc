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

async function runRequest(
  url: string,
  init?: RequestInit,
  env?: Parameters<typeof worker.fetch>[1],
): Promise<Response> {
  const request = new Request(url, init);
  return worker.fetch(request, env);
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
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('If-None-Match');
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

    expect(fetchSpy).toHaveBeenCalledWith('https://main--site--org.aem.page/path', {
      cf: { scrapeShield: false }, headers: {}, redirect: 'manual',
    });
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

  it('preserves EDS Cache-Control on a scoped 5xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('upstream-error', {
        status: 503,
        headers: {
          'Cache-Control': 'private, no-cache',
        },
      }),
    );
    const response = await runRequest('http://example.com/preview/org/site/page');
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache');
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

  it('uses legacy no-store on EDS 403 outside recognized routes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('forbidden', { status: 403, headers: { 'Cache-Control': 'max-age=60' } }),
    );
    const response = await runRequest('http://example.com/stage/org/site/page');
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

  describe('EDS-aligned caching', () => {
    const liveUrl = 'https://worker.example/live/org/site/page';
    const fastlyHeaders = {
      'Cache-Control': 'max-age=7200, must-revalidate',
      'Surrogate-Control': 'max-age=300',
      'Surrogate-Key': 'page site_404 site_code',
      Vary: 'Accept-Encoding, X-Forwarded-Host',
      'X-Robots-Tag': 'noindex, nofollow',
    };

    it.each(['', '.json'])('maps the live URL with suffix "%s" and only forwards allowed headers', async (suffix) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, {
        headers: {
          ...fastlyHeaders,
          'Content-Type': 'text/html',
          'Content-Encoding': 'gzip',
          'Content-Length': '12345',
          ETag: '"html"',
          'Last-Modified': 'Wed, 25 Nov 2026 01:00:00 GMT',
          Age: '100',
          'Set-Cookie': 'upstream=yes',
        },
      }));
      const response = await runRequest(`${liveUrl}${suffix}?skip=1`, {
        headers: {
          'X-Forwarded-Host': 'cdn.example.com',
          'X-BYO-CDN-Type': 'fastly',
          'X-Push-Invalidation': 'enabled',
          Authorization: 'Bearer unsupported',
          Cookie: 'client=yes',
          Via: 'Akamai',
          'CDN-Loop': 'cloudflare',
          'If-Modified-Since': 'Wed, 25 Nov 2026 01:00:00 GMT',
          'If-None-Match': '"html"',
        },
      });
      expect(fetchSpy).toHaveBeenCalledWith('https://main--site--org.aem.live/page', {
        cf: { scrapeShield: false },
        redirect: 'manual',
        headers: { 'X-Forwarded-Host': 'cdn.example.com', 'X-BYO-CDN-Type': 'fastly' },
      });
      expect(response.status).toBe(200);
      Object.entries(fastlyHeaders).forEach(([header, value]) => {
        expect(response.headers.get(header)).toBe(value);
      });
      expect(response.headers.get('Content-Type')).toContain('application/json');
      expect(response.headers.get('Content-Length')).not.toBe('12345');
      ['Content-Encoding', 'Last-Modified', 'Age', 'Set-Cookie'].forEach((header) => {
        expect(response.headers.has(header)).toBe(false);
      });
    });

    it.each([
      ['akamai', { Via: '1.1 Akamai', 'CDN-Loop': 'Fastly' }, 'Edge-Control', 'Edge-Cache-Tag'],
      ['fastly', { Via: '1.1 varnish', 'CDN-Loop': 'cloudflare' }, 'Surrogate-Control', 'Surrogate-Key'],
      ['fastly', { 'CDN-Loop': 'cloudflare, Fastly' }, 'Surrogate-Control', 'Surrogate-Key'],
      ['cloudflare', { 'CDN-Loop': 'cloudflare', Via: 'CloudFront' }, 'CDN-Cache-Control', 'Cache-Tag'],
      ['cloudfront', { Via: '1.1 CloudFront' }, 'Cache-Control', 'X-Amz-Meta-Cache-Tag'],
    ] as const)('detects %s and preserves its 404 metadata only', async (cdn, chain, policy, tag) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('missing', {
        status: 404,
        headers: {
          ...fastlyHeaders,
          'Cache-Control': 'max-age=7200, s-maxage=300',
          'CDN-Cache-Control': 'max-age=300',
          'Edge-Control': 'cache-maxage=300s',
          'Edge-Cache-Tag': 'edge,site_404',
          'Cache-Tag': 'cloudflare,site_404',
          'X-Cache-Tag': 'cloudflare,site_404',
          'X-Amz-Meta-Cache-Tag': 'cloudfront,site_404',
          'X-Error': 'NOT_FOUND',
        },
      }));
      const response = await runRequest(`${liveUrl}.json`, {
        headers: { ...chain, 'X-BYO-CDN-Type': 'unknown' },
      });
      expect(fetchSpy).toHaveBeenCalledWith('https://main--site--org.aem.live/page', {
        cf: { scrapeShield: false }, redirect: 'manual', headers: { 'X-BYO-CDN-Type': cdn },
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: '404 Not Found' });
      expect(response.headers.get('X-Error')).toBe('NOT_FOUND');
      expect(response.headers.get(tag)).toContain('site_404');
      expect(response.headers.get(policy)).toContain('300');
      expect(response.headers.has('X-Cache-Tag')).toBe(cdn === 'cloudflare');
      expect(response.headers.has('Surrogate-Control')).toBe(cdn === 'fastly');
      expect(response.headers.get('Cache-Control')?.includes('s-maxage')).toBe(cdn === 'cloudfront');
      expect(response.headers.has('ETag')).toBe(false);
    });

    it('does not relay metadata for an unresolved CDN or change unknown-tier behavior', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(MOCK_EDS_HTML, {
        headers: {
          ...fastlyHeaders,
          'Cache-Control': 'max-age=7200, s-maxage=300',
          'CDN-Cache-Control': 'max-age=300',
          'X-Cache-Tag': 'from-outbound-hop',
        },
      }));
      const response = await runRequest(liveUrl);
      expect(response.headers.get('Cache-Control')).toBe('max-age=7200');
      ['Surrogate-Key', 'Surrogate-Control', 'CDN-Cache-Control', 'X-Cache-Tag'].forEach((header) => {
        expect(response.headers.has(header)).toBe(false);
      });
      expect(response.headers.get('Vary')).toBe(fastlyHeaders.Vary);
      const legacy = await runRequest(liveUrl.replace('/live/', '/stage/'), {
        headers: { 'X-BYO-CDN-Type': 'fastly', 'If-None-Match': '*' },
      });
      expect(fetchSpy).toHaveBeenLastCalledWith('https://main--site--org.aem.live/page', {
        cf: { scrapeShield: false },
      });
      expect(legacy.status).toBe(200);
      expect(legacy.headers.get('Cache-Control')).toBe('max-age=7200, s-maxage=300');
      ['Vary', 'ETag', 'Surrogate-Key', 'X-Robots-Tag'].forEach((header) => {
        expect(legacy.headers.has(header)).toBe(false);
      });
    });

    it('keeps the no-store fallback when EDS supplies no Cache-Control', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, {
        headers: { 'Surrogate-Control': 'max-age=300', 'Surrogate-Key': 'page' },
      }));
      const response = await runRequest(liveUrl, { headers: { 'X-BYO-CDN-Type': 'fastly' } });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.has('Surrogate-Control')).toBe(false);
      expect(response.headers.get('Surrogate-Key')).toBe('page');
    });

    it.each([200, 404])('uses the global switch for token caching and push on a %s', async (status) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
        const push = new Headers(options?.headers).has('X-Push-Invalidation');
        return new Response(MOCK_EDS_HTML, {
          status,
          headers: { ...fastlyHeaders, 'Surrogate-Control': push ? 'max-age=172800' : 'max-age=300' },
        });
      });
      const init = {
        headers: {
          Authorization: 'token secret',
          'X-Forwarded-Host': 'cdn.example.com',
          'X-BYO-CDN-Type': 'fastly',
          'X-Push-Invalidation': 'enabled',
        },
      };
      const env = { ENABLE_EDS_AUTH_CACHE_AND_PUSH_INVALIDATION: true };
      const short = await runRequest(liveUrl, {
        headers: { ...init.headers, 'X-Push-Invalidation': 'no' },
      }, env);
      expect(short.headers.get('Cache-Control')).toBe(fastlyHeaders['Cache-Control']);
      expect(short.headers.get('Surrogate-Control')).toBe('max-age=300');
      expect(short.headers.get('Surrogate-Key')).toBe(fastlyHeaders['Surrogate-Key']);
      expect(fetchSpy.mock.lastCall?.[1]?.headers).not.toHaveProperty('X-Push-Invalidation');

      const push = await runRequest('https://worker.example/live/other-org/other-site/page.json', {
        headers: { ...init.headers, 'X-Forwarded-Host': 'other.example' },
      }, env);
      expect(push.headers.get('Surrogate-Control')).toBe('max-age=172800');
      expect(fetchSpy.mock.lastCall?.[1]?.headers).toHaveProperty('X-Push-Invalidation', 'enabled');
    });

    it.each([undefined, false, 'false', 'yes'])('keeps token responses private with switch %s', async (flag) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, {
        headers: fastlyHeaders,
      }));
      const response = await runRequest(liveUrl, {
        headers: {
          Authorization: 'token secret',
          'X-BYO-CDN-Type': 'fastly',
          'X-Push-Invalidation': 'enabled',
        },
      }, { ENABLE_EDS_AUTH_CACHE_AND_PUSH_INVALIDATION: flag });
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response.headers.has('Surrogate-Control')).toBe(false);
      expect(fetchSpy.mock.lastCall?.[1]?.headers).not.toHaveProperty('X-Push-Invalidation');
    });

    it('allows public push requests with the string true, but never opts a legacy route in', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(MOCK_EDS_HTML, {
        headers: fastlyHeaders,
      }));
      const env = { ENABLE_EDS_AUTH_CACHE_AND_PUSH_INVALIDATION: 'true' };
      const init = { headers: { 'X-BYO-CDN-Type': 'fastly', 'X-Push-Invalidation': 'enable' } };
      await runRequest(liveUrl, init, env);
      expect(fetchSpy.mock.lastCall?.[1]?.headers).toHaveProperty('X-Push-Invalidation', 'enabled');
      const noPush = await runRequest(liveUrl, { headers: { 'X-BYO-CDN-Type': 'fastly' } }, env);
      expect(noPush.headers.get('Surrogate-Control')).toBe('max-age=300');
      expect(fetchSpy.mock.lastCall?.[1]?.headers).not.toHaveProperty('X-Push-Invalidation');
      const legacy = await runRequest(liveUrl.replace('/live/', '/stage/'), {
        headers: { ...init.headers, Authorization: 'token secret' },
      }, env);
      expect(legacy.headers.get('Cache-Control')).toBe('private, no-store');
      expect(fetchSpy.mock.lastCall?.[1]?.headers).toEqual({ Authorization: 'token secret' });
    });

    it('keeps token failures private even when the rollout switch is enabled', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('forbidden', {
        status: 401, headers: fastlyHeaders,
      }));
      const response = await runRequest(liveUrl, {
        headers: {
          Authorization: 'token invalid',
          'X-Forwarded-Host': 'cdn.example.com',
          'X-BYO-CDN-Type': 'fastly',
          'If-None-Match': '*',
        },
      }, { ENABLE_EDS_AUTH_CACHE_AND_PUSH_INVALIDATION: true });
      expect(response.status).toBe(401);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response.headers.has('Surrogate-Control')).toBe(false);
      expect(response.headers.has('ETag')).toBe(false);
    });

    it('suppresses CloudFront s-maxage and other vendor TTLs on protected responses', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, {
        headers: { ...fastlyHeaders, 'Cache-Control': 'max-age=7200, s-maxage=300' },
      }));
      const response = await runRequest(liveUrl, {
        headers: { Authorization: 'token secret', 'X-BYO-CDN-Type': 'cloudfront' },
      });
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response.headers.has('Surrogate-Control')).toBe(false);
    });

    it.each([
      [301, '', '/final?from=eds#section', 'https://worker.example/live/org/site/final?from=eds#section'],
      [302, '.json', 'next?from=eds', 'https://worker.example/live/org/site/next.json?from=eds'],
      [307, '.json', 'https://main--site--org.aem.live/', 'https://worker.example/live/org/site/.json'],
      [308, '.json', 'https://external.example/final?from=eds', 'https://external.example/final?from=eds'],
      [302, '', '//external.example/final', '//external.example/final'],
    ])('maps %s Location without following or converting it', async (status, suffix, location, expected) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('redirect', {
        status, headers: { ...fastlyHeaders, Location: location },
      }));
      const response = await runRequest(`${liveUrl}${suffix}?ignored=1`, {
        headers: { 'X-BYO-CDN-Type': 'fastly' },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(status);
      expect(response.headers.get('Location')).toBe(expected);
      expect(response.headers.get('Cache-Control')).toBe(fastlyHeaders['Cache-Control']);
      expect(response.body).toBeNull();
      expect(mockedConvertHtmlToJson).not.toHaveBeenCalled();
    });

    it.each([204, 205, 304])('returns upstream %s without converting or attaching an HTML validator', async (status) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, {
        status, headers: { ...fastlyHeaders, ETag: '"html"' },
      }));
      const response = await runRequest(liveUrl);
      expect(response.status).toBe(status);
      expect(response.body).toBeNull();
      expect(response.headers.has('ETag')).toBe(false);
      expect(mockedConvertHtmlToJson).not.toHaveBeenCalled();
    });

    it('hashes the exact JSON bytes and revalidates after conversion using weak comparison', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(MOCK_EDS_HTML, {
        headers: fastlyHeaders,
      }));
      mockedConvertHtmlToJson.mockReturnValue({ json: { title: '日本語' } });
      const first = await runRequest(liveUrl);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await first.arrayBuffer()));
      const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
      expect(first.headers.get('ETag')).toBe(`W/"${hex}"`);

      const second = await runRequest(`${liveUrl}.json`, {
        headers: { 'If-None-Match': `W/"different,tag", "${hex}"`, 'X-BYO-CDN-Type': 'fastly' },
      });
      expect(mockedConvertHtmlToJson).toHaveBeenCalledTimes(2);
      expect(second.status).toBe(304);
      expect(second.body).toBeNull();
      expect(second.headers.get('ETag')).toBe(first.headers.get('ETag'));
      expect(second.headers.get('Access-Control-Expose-Headers')).toContain('ETag');
      expect(second.headers.get('Vary')).toBe(fastlyHeaders.Vary);
      expect(second.headers.get('Cache-Control')).toBe(fastlyHeaders['Cache-Control']);
      expect(second.headers.get('Surrogate-Control')).toBe('max-age=300');
    });

    it('returns a new ETag for changed JSON even when the HTML timestamp is unchanged', async () => {
      const lastModified = 'Wed, 25 Nov 2026 01:00:00 GMT';
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(MOCK_EDS_HTML, {
        headers: { 'Last-Modified': lastModified },
      }));
      const first = await runRequest(liveUrl);
      mockedConvertHtmlToJson.mockReturnValue({ json: { title: 'new JSON' } });
      const second = await runRequest(liveUrl, {
        headers: { 'If-None-Match': first.headers.get('ETag') ?? '', 'If-Modified-Since': lastModified },
      });
      expect(second.status).toBe(200);
      expect(second.headers.get('ETag')).not.toBe(first.headers.get('ETag'));
      expect(second.headers.has('Last-Modified')).toBe(false);
      expect(await second.json()).toEqual({ title: 'new JSON' });
    });

    it.each([200, 401, 404, 500])('applies wildcard only to successful JSON after EDS responds (%s)', async (status) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, { status }));
      const response = await runRequest(liveUrl, {
        headers: { 'If-None-Match': '*', Authorization: 'token secret' },
      });
      expect(response.status).toBe(status === 200 ? 304 : status);
      expect(response.headers.has('ETag')).toBe(status === 200);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    });

    it('does not use an ETag to hide a conversion failure or forward upstream cache headers', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, { headers: fastlyHeaders }));
      mockedConvertHtmlToJson.mockReturnValue({ error: 'schema mismatch' });
      const response = await runRequest(liveUrl, {
        headers: { 'If-None-Match': '*', 'X-BYO-CDN-Type': 'fastly' },
      });
      expect(response.status).toBe(500);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.has('Surrogate-Control')).toBe(false);
      expect(response.headers.has('ETag')).toBe(false);
    });

    it('leaves HEAD unsupported without fetching EDS', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const response = await runRequest(liveUrl, { method: 'HEAD' });
      expect(response.status).toBe(405);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
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
