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

function runListRequest(query?: string, authorization?: string): Promise<Response> {
  return runRequest(`http://example.com/preview/org/site${query ?? ''}`, {
    headers: authorization ? { Authorization: authorization } : {},
  });
}

function mockIndexedPages(paths: string[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const requestedUrl = new URL(String(url));
    if (requestedUrl.pathname === '/structured-content-index.json') {
      const offset = Number(requestedUrl.searchParams.get('offset'));
      const limit = Number(requestedUrl.searchParams.get('limit'));
      return new Response(JSON.stringify({
        total: paths.length,
        offset,
        limit,
        data: paths.slice(offset, offset + limit).map((path) => ({ path })),
      }));
    }
    return new Response(MOCK_EDS_HTML);
  });
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

  it('returns 500 when a non-Error is thrown', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue('upstream timeout');

    const response = await runRequest('http://example.com/preview/org/site/path');

    expect(response.status).toBe(500);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    const body = await response.json() as { error: string };
    expect(body.error).toBe('upstream timeout');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('JSON response sets Cache-Control when token Authorization is present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, { status: 200 }));
    const response = await runRequest('http://example.com/preview/org/site/page', {
      headers: { Authorization: 'token x' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('JSON response omits Cache-Control without Authorization', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, { status: 200 }));
    const response = await runRequest('http://example.com/preview/org/site/page');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBeNull();
  });

  it('JSON response omits Cache-Control for Bearer (only token scheme is supported)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML, { status: 200 }));
    const response = await runRequest('http://example.com/preview/org/site/page', {
      headers: { Authorization: 'Bearer x' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBeNull();
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

  it('sets Cache-Control to private, no-store on EDS error responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('upstream-error', {
        status: 502,
        headers: {
          'Cache-Control': 'no-store',
        },
      }),
    );
    const response = await runRequest('http://example.com/preview/org/site/page');
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
    const response = await runRequest('http://example.com/preview/org/site/missing');
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    const body = await response.json() as { error: string };
    expect(body.error).toBe('404 Not Found');
    expect(response.headers.get('X-Error')).toBe('NOT_FOUND');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
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

  it('fetches the requested index page and preserves path order', async () => {
    const fetchSpy = mockIndexedPages(['/first', 'second', '/third', '/fourth']);
    mockedConvertHtmlToJson
      .mockReturnValueOnce({ json: { data: { title: 'Second' } } })
      .mockReturnValueOnce({ json: { data: { title: 'Third' } } });

    const response = await runListRequest('?offset=1&limit=2');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        { path: 'second', json: { data: { title: 'Second' } } },
        { path: '/third', json: { data: { title: 'Third' } } },
      ],
      count: 2,
      total: 4,
      offset: 1,
      limit: 2,
      nextOffset: 3,
      cursor: expect.any(String),
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      'https://main--site--org.aem.page/structured-content-index.json?offset=1&limit=2',
      'https://main--site--org.aem.page/second',
      'https://main--site--org.aem.page/third',
    ]);
  });

  it('continues browsing with the returned opaque cursor', async () => {
    const fetchSpy = mockIndexedPages(['/one', '/two', '/three', '/four']);

    const first = await runListRequest('?limit=2');
    const firstPage = await first.json() as { cursor: string; nextOffset: number };
    expect(firstPage.cursor).toEqual(expect.any(String));
    expect(firstPage.cursor).not.toBe(String(firstPage.nextOffset));

    const second = await runListRequest(`?cursor=${firstPage.cursor}&limit=2`);
    const secondPage = await second.json();

    expect(secondPage).toMatchObject({
      items: [{ path: '/three' }, { path: '/four' }],
      count: 2,
      total: 4,
      offset: 2,
      limit: 2,
      nextOffset: null,
    });
    expect(secondPage).not.toHaveProperty('cursor');
    expect(fetchSpy.mock.calls.map(([url]) => url).filter((url) => String(url).includes('structured-content-index')))
      .toEqual([
        'https://main--site--org.aem.page/structured-content-index.json?offset=0&limit=2',
        'https://main--site--org.aem.page/structured-content-index.json?offset=2&limit=2',
      ]);
  });

  it('rejects a cursor from a different site or tier', async () => {
    const fetchSpy = mockIndexedPages(['/one', '/two']);
    const first = await runListRequest('?limit=1');
    const { cursor } = await first.json() as { cursor: string };

    const wrongTier = await runRequest(`http://example.com/live/org/site?cursor=${cursor}&limit=1`);
    const wrongSite = await runRequest(`http://example.com/preview/org/another?cursor=${cursor}&limit=1`);

    expect(wrongTier.status).toBe(400);
    expect(wrongSite.status).toBe(400);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('filters indexed paths before pagination and hydrates only matching pages', async () => {
    const fetchSpy = mockIndexedPages([
      '/forms/demo/cards/one',
      'forms/demo/cards/two',
      '/forms/demo/insights/alpha',
      '/forms/demo/cards-other/not-a-card',
      '/forms/demo/cards/three',
    ]);
    const prefix = 'path=%2Fforms%2Fdemo%2Fcards%2F';

    const first = await runListRequest(`?${prefix}&limit=2`);
    const firstPage = await first.json() as { cursor: string };
    expect(firstPage).toMatchObject({
      items: [{ path: '/forms/demo/cards/one' }, { path: 'forms/demo/cards/two' }],
      count: 2,
      total: 3,
      offset: 0,
      limit: 2,
      nextOffset: 2,
      cursor: expect.any(String),
    });
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      'https://main--site--org.aem.page/structured-content-index.json?offset=0&limit=1000',
      'https://main--site--org.aem.page/forms/demo/cards/one',
      'https://main--site--org.aem.page/forms/demo/cards/two',
    ]);

    const second = await runListRequest(`?path=forms%2Fdemo%2Fcards%2F&cursor=${firstPage.cursor}&limit=2`);
    const secondPage = await second.json();
    expect(secondPage).toMatchObject({
      items: [{ path: '/forms/demo/cards/three' }],
      count: 1,
      total: 3,
      offset: 2,
      limit: 2,
      nextOffset: null,
    });
    expect(secondPage).not.toHaveProperty('cursor');
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(fetchSpy.mock.calls.map(([url]) => url)).not.toContain(
      'https://main--site--org.aem.page/forms/demo/insights/alpha',
    );
  });

  it('returns an empty filtered page when no paths match', async () => {
    const fetchSpy = mockIndexedPages(['/forms/demo/cards/one', '/forms/demo/insights/two']);

    const response = await runListRequest('?path=%2Fforms%2Fdemo%2Fbanner%2F');

    expect(await response.json()).toEqual({
      items: [], count: 0, total: 0, offset: 0, limit: 10, nextOffset: null,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns the filtered total when offset is past the matching paths', async () => {
    const fetchSpy = mockIndexedPages(['/cards/one', '/other/two']);

    const response = await runListRequest('?path=%2Fcards%2F&offset=3&limit=2');

    expect(await response.json()).toEqual({
      items: [], count: 0, total: 1, offset: 3, limit: 2, nextOffset: null,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('binds a filtered cursor to its path prefix', async () => {
    const fetchSpy = mockIndexedPages(['/cards/one', '/cards/two', '/insights/one']);
    const first = await runListRequest('?path=%2Fcards%2F&limit=1');
    const { cursor } = await first.json() as { cursor: string };

    const differentPath = await runListRequest(`?path=%2Finsights%2F&cursor=${cursor}&limit=1`);
    const missingPath = await runListRequest(`?cursor=${cursor}&limit=1`);

    expect(differentPath.status).toBe(400);
    expect(missingPath.status).toBe(400);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('scans multiple index pages to count filtered paths', async () => {
    const paths = Array.from({ length: 1002 }, (_, index) => (
      index === 0 || index === 1001 ? `/cards/${index}` : `/other/${index}`
    ));
    const fetchSpy = mockIndexedPages(paths);

    const response = await runListRequest('?path=%2Fcards%2F&limit=1');
    const firstPage = await response.json() as { cursor: string };

    expect(firstPage).toMatchObject({
      items: [{ path: '/cards/0' }], count: 1, total: 2, nextOffset: 1, cursor: expect.any(String),
    });
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      'https://main--site--org.aem.page/structured-content-index.json?offset=0&limit=1000',
      'https://main--site--org.aem.page/structured-content-index.json?offset=1000&limit=1000',
      'https://main--site--org.aem.page/cards/0',
    ]);

    const next = await runListRequest(`?path=%2Fcards%2F&cursor=${firstPage.cursor}&limit=1`);

    expect(await next.json()).toMatchObject({
      items: [{ path: '/cards/1001' }], count: 1, total: 2, offset: 1, nextOffset: null,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });

  it('scans a complete static index dump only once', async () => {
    const data = Array.from({ length: 1001 }, (_, index) => ({
      path: index === 1000 ? '/cards/last' : `/other/${index}`,
    }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => (
      String(url).includes('structured-content-index.json')
        ? new Response(JSON.stringify({ total: data.length, data }))
        : new Response(MOCK_EDS_HTML)
    ));

    const response = await runListRequest('?path=%2Fcards%2F&limit=1');

    expect(await response.json()).toMatchObject({
      items: [{ path: '/cards/last' }], count: 1, total: 1, nextOffset: null,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('rejects a filtered scan if the index total changes between pages', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const requestedOffset = Number(new URL(String(url)).searchParams.get('offset'));
      const paths = Array.from({ length: requestedOffset ? 2 : 1000 }, (_, index) => ({
        path: `/cards/${requestedOffset + index}`,
      }));
      return new Response(JSON.stringify({
        total: requestedOffset ? 1002 : 1001, offset: requestedOffset, data: paths,
      }));
    });

    const response = await runListRequest('?path=%2Fcards%2F&limit=1');

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'EDS index changed during the filtered scan' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('defaults to 10 items and stops at the end of the EDS index', async () => {
    const fetchSpy = mockIndexedPages(Array.from({ length: 12 }, (_, index) => `/page-${index}`));

    const first = await runListRequest();
    const second = await runListRequest('?offset=10');
    const beyondEnd = await runListRequest('?offset=20');

    const firstPage = await first.json() as { items: { json?: unknown }[]; cursor: string };
    const secondPage = await second.json() as { items: { json?: unknown }[] };
    expect(firstPage).toMatchObject({
      count: 10, total: 12, offset: 0, limit: 10, nextOffset: 10,
    });
    expect(secondPage).toMatchObject({
      count: 2, total: 12, offset: 10, limit: 10, nextOffset: null,
    });
    expect(firstPage.cursor).toEqual(expect.any(String));
    expect(secondPage).not.toHaveProperty('cursor');
    expect(firstPage.items.every((item) => 'json' in item)).toBe(true);
    expect(secondPage.items.every((item) => 'json' in item)).toBe(true);
    expect(await beyondEnd.json()).toEqual({
      items: [], count: 0, total: 12, offset: 20, limit: 10, nextOffset: null,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(15);
  });

  it('allows an empty index', async () => {
    const fetchSpy = mockIndexedPages([]);
    const empty = await runListRequest();

    expect(await empty.json()).toEqual({
      items: [], count: 0, total: 0, offset: 0, limit: 10, nextOffset: null,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('caps pages at 50 items', async () => {
    const fetchSpy = mockIndexedPages(Array.from({ length: 51 }, (_, index) => `/page-${index}`));

    const response = await runListRequest('?limit=50');

    expect(await response.json()).toMatchObject({
      count: 50, total: 51, nextOffset: 50, cursor: expect.any(String),
    });
    expect(fetchSpy).toHaveBeenCalledTimes(51);
  });

  it('limits concurrent EDS fetches to five', async () => {
    let active = 0;
    let maximumActive = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('structured-content-index.json')) {
        return new Response(JSON.stringify({
          total: 11,
          offset: 0,
          data: Array.from({ length: 11 }, (_, index) => ({ path: `/page-${index}` })),
        }));
      }
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1);
      });
      active -= 1;
      return new Response(MOCK_EDS_HTML);
    });

    const response = await runListRequest('?limit=11');

    expect(response.status).toBe(200);
    expect(maximumActive).toBe(5);
    expect(await response.json()).toMatchObject({ count: 11, total: 11, nextOffset: null });
  });

  it('returns per-path errors without dropping successful pages', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('structured-content-index.json')) {
        return new Response(JSON.stringify({
          total: 5,
          offset: 0,
          data: ['/missing', '/valid', '/denied', '/invalid', '/offline'].map((path) => ({ path })),
        }));
      }
      if (String(url).endsWith('/missing')) return new Response('missing', { status: 404 });
      if (String(url).endsWith('/denied')) return new Response('denied', { status: 403 });
      if (String(url).endsWith('/offline')) throw new Error('upstream unavailable');
      return new Response(String(url).endsWith('/invalid') ? 'invalid' : MOCK_EDS_HTML);
    });
    mockedConvertHtmlToJson.mockImplementation(({ html }: { html: string }) => (
      html === 'invalid' ? { error: 'schema mismatch' } : { json: { data: { title: 'Valid' } } }
    ));

    const response = await runListRequest();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        { path: '/missing', error: '404 Not Found', status: 404 },
        { path: '/valid', json: { data: { title: 'Valid' } } },
        { path: '/denied', error: 'denied', status: 403 },
        { path: '/invalid', error: 'Failed to convert EDS HTML: schema mismatch', status: 500 },
        { path: '/offline', error: 'upstream unavailable', status: 502 },
      ],
      count: 5,
      total: 5,
      offset: 0,
      limit: 10,
      nextOffset: null,
    });
  });

  it('forwards token authorization and marks authenticated list responses private', async () => {
    const fetchSpy = mockIndexedPages(['/article']);

    const response = await runListRequest('', 'token secret-value');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://main--site--org.aem.page/structured-content-index.json?offset=0&limit=10',
      expect.objectContaining({ headers: { Authorization: 'token secret-value' } }),
    );
    expect(fetchSpy).toHaveBeenCalledWith('https://main--site--org.aem.page/article', {
      cf: { scrapeShield: false },
      headers: { Authorization: 'token secret-value' },
    });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });

  it('does not forward other authorization schemes to EDS', async () => {
    const fetchSpy = mockIndexedPages(['/article']);

    const response = await runListRequest('', 'Bearer secret-value');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://main--site--org.aem.page/structured-content-index.json?offset=0&limit=10',
      { cf: { scrapeShield: false } },
    );
    expect(fetchSpy).toHaveBeenCalledWith('https://main--site--org.aem.page/article', {
      cf: { scrapeShield: false },
    });
    expect(response.headers.get('Cache-Control')).toBeNull();
  });

  it.each(['?offset=-1', '?offset=1.5', '?offset=9007199254740992', '?limit=0', '?limit=51', '?limit=abc', '?offset=1&offset=2', '?schema=article', '?paths=/page', '?cursor=', '?cursor=invalid', '?cursor=x&cursor=y', '?cursor=x&offset=0'])(
    'rejects invalid pagination or unsupported query parameters in %s',
    async (query) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const response = await runListRequest(query);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: expect.any(String) });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it.each([
    '?path=',
    '?path=https%3A%2F%2Fexample.com%2Fcards',
    '?path=%2F%2Fexample.com%2Fcards',
    '?path=..%2Fcards',
    '?path=%252e%252e%2Fcards',
    '?path=%2Fcards%3Fdraft%3Dtrue',
    '?path=%2Fcards%2F&path=%2Finsights%2F',
  ])('rejects invalid path filter in %s', async (query) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const response = await runListRequest(query);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['full URL', 'https://example.com/page'],
    ['protocol-relative URL', '//example.com/page'],
    ['traversal', '../page'],
    ['encoded traversal', '%2e%2e/page'],
    ['encoded host override', '/%2fexample.com/page'],
    ['query', '/page?draft=true'],
    ['fragment', '/page#title'],
    ['backslash', '\\example.com/page'],
    ['malformed encoding', '/bad%path'],
    ['empty path', ''],
    ['nonstring path', 42],
  ])('rejects %s in the EDS index', async (_description, path) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ total: 1, offset: 0, data: [{ path }] })),
    );

    const response = await runListRequest();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: expect.stringContaining('Invalid EDS index') });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed JSON and incomplete index pages', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('offset=0')) return new Response('{');
      return new Response(JSON.stringify({ total: 12, offset: 0, data: [{ path: '/first' }] }));
    });

    const malformed = await runListRequest();
    const incomplete = await runListRequest('?offset=10');

    expect(malformed.status).toBe(502);
    expect(incomplete.status).toBe(502);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(mockedConvertHtmlToJson).not.toHaveBeenCalled();
  });

  it('returns the upstream error status when the index is missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('missing', { status: 404, headers: { 'x-error': 'INDEX_NOT_FOUND' } }),
    );

    const response = await runListRequest();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: '404 Not Found' });
    expect(response.headers.get('X-Error')).toBe('INDEX_NOT_FOUND');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns 502 when the index cannot be fetched', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('index unavailable'));

    const response = await runListRequest();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Failed to fetch EDS index: index unavailable' });
  });

  it('paginates a complete index dump that ignores query parameters', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('structured-content-index.json')) {
        return new Response(JSON.stringify({
          total: 3, data: ['/a', '/b', '/c'].map((path) => ({ path })),
        }));
      }
      return new Response(MOCK_EDS_HTML);
    });

    const response = await runListRequest('?offset=1&limit=1');

    expect(await response.json()).toMatchObject({
      items: [{ path: '/b', json: expect.any(Object) }], count: 1, total: 3, nextOffset: 2,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('uses the selected tier for the index and its pages', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => (
      String(url).includes('structured-content-index.json')
        ? new Response(JSON.stringify({ total: 1, offset: 0, data: [{ path: '/article' }] }))
        : new Response(MOCK_EDS_HTML)
    ));

    const response = await runRequest('http://example.com/review/org/site/');

    expect(response.status).toBe(200);
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      'https://main--site--org.aem.reviews/structured-content-index.json?offset=0&limit=10',
      'https://main--site--org.aem.reviews/article',
    ]);
  });

  it('keeps GET for a page named list and rejects all POST requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(MOCK_EDS_HTML));

    const page = await runRequest('http://example.com/preview/org/site/list');
    const listPost = await runRequest('http://example.com/preview/org/site', { method: 'POST' });
    const oldListPost = await runRequest('http://example.com/preview/org/site/list', { method: 'POST' });
    const unsupported = await runRequest('http://example.com/preview/org/site/article', { method: 'POST' });

    expect(page.status).toBe(200);
    expect(await page.json()).toEqual({ metadata: { schemaName: 'article' }, data: { title: 'Default title' } });
    expect(fetchSpy).toHaveBeenCalledWith('https://main--site--org.aem.page/list', { cf: { scrapeShield: false } });
    expect(listPost.status).toBe(405);
    expect(oldListPost.status).toBe(405);
    expect(unsupported.status).toBe(405);
  });

  it('advertises GET only for CORS preflight', async () => {
    const response = await runRequest('http://example.com/preview/org/site', { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
  });
});
