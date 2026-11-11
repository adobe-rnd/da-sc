/*
 * Copyright 2026 Adobe. All rights reserved.
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
  afterEach, beforeEach, describe, expect, it, vi, type MockInstance,
} from 'vitest';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { handleJsonSchemaRequest, parseSchemaPath } from '../src/json-schema';
import { JSON_SCHEMA_ALLOWLIST, type JsonSchemaAllowlist } from '../src/json-schema-allowlist';

const LISTED = '/schemas/shared/demo-card/v1.0.0.json';
const UNLISTED = '/schemas/shared/demo-card/v9.9.9.json';

const TEST_ENV = {
  JSON_SCHEMA_GITHUB_CONTENTS_URL: 'https://api.github.com/repos/test-owner/test-repo/contents',
  JSON_SCHEMA_GITHUB_REF: 'test-ref',
  GITHUB_TOKEN: 'test-token',
  JSON_SCHEMA_CANONICAL_ORIGIN: 'https://schemas.example.com',
};

const SCHEMA_BODY = `{
  "$id": "https://schemas.example.com${LISTED}",
  "type": "object"
}
`;

function githubResponse(body: BodyInit | null, init?: ResponseInit): Response {
  return new Response(body, init);
}

const TEST_ALLOWLIST: JsonSchemaAllowlist = [LISTED.slice(1)];

async function run(
  path: string,
  init?: RequestInit,
  env: Record<string, string | undefined> = TEST_ENV,
  allowlist: JsonSchemaAllowlist = TEST_ALLOWLIST,
): Promise<Response> {
  const executionCtx = createExecutionContext();
  const response = await handleJsonSchemaRequest(
    new Request(`https://schemas.test${path}`, init),
    env,
    executionCtx,
    allowlist,
  );
  await waitOnExecutionContext(executionCtx);
  return response;
}

function expectBaseHeaders(response: Response): void {
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('Content-Security-Policy'))
    .toBe("default-src 'none'; frame-ancestors 'none'; sandbox");
  expect(response.headers.has('Access-Control-Allow-Credentials')).toBe(false);
  expect(response.headers.has('Set-Cookie')).toBe(false);
}

describe('parseSchemaPath', () => {
  it.each([
    ['/schemas/shared/image/v1.0.0.json', 'schemas/shared/image/v1.0.0.json'],
    ['/schemas/shared/demo-card/v1.10.2.json', 'schemas/shared/demo-card/v1.10.2.json'],
    ['/schemas/shared/a1-b2/v0.0.0.json', 'schemas/shared/a1-b2/v0.0.0.json'],
    [`/schemas/shared/${'a'.repeat(64)}/v1.0.0.json`, `schemas/shared/${'a'.repeat(64)}/v1.0.0.json`],
  ])('accepts %s', (pathname, expected) => {
    expect(parseSchemaPath(pathname)).toBe(expected);
  });

  it.each([
    '/schemas',
    '/schemas/',
    '/schemas/shared/',
    '/schemas/shared/image',
    '/schemas/shared/image/',
    '/schemas/shared/image/v1.0.0.json/',
    '/schemas/shared/image/v1.0.0',
    '/schemas/shared/image/1.0.0.json',
    '/schemas/shared/image/v1.0.json',
    '/schemas/shared/image/v01.0.0.json',
    '/schemas/shared/image/v1.00.0.json',
    '/schemas/shared/image/v1.0.0-beta.json',
    '/schemas/shared/image/v1.0.0+build.json',
    '/schemas/shared/Image/v1.0.0.json',
    '/schemas/shared/demo_card/v1.0.0.json',
    '/schemas/shared/demo--card/v1.0.0.json',
    '/schemas/shared/-card/v1.0.0.json',
    '/schemas/shared/card-/v1.0.0.json',
    '/schemas/shared/1card/v1.0.0.json',
    `/schemas/shared/${'a'.repeat(65)}/v1.0.0.json`,
    '/schemas/shared/a/b/v1.0.0.json',
    '/schemas/shared//v1.0.0.json',
    '/schemas/shared/image%2Fx/v1.0.0.json',
    '/schemas/shared/%69mage/v1.0.0.json',
    '/schemas/shared/image/v1.0.0%2Ejson',
    '/schemas/other/image/v1.0.0.json',
    '//schemas/shared/image/v1.0.0.json',
  ])('rejects %s', (pathname) => {
    expect(parseSchemaPath(pathname)).toBeUndefined();
  });
});

describe('JSON_SCHEMA_ALLOWLIST', () => {
  it('contains only paths matching the path grammar', () => {
    for (const path of JSON_SCHEMA_ALLOWLIST) {
      expect(parseSchemaPath(`/${path}`)).toBe(path);
    }
  });
});

describe('handleJsonSchemaRequest', () => {
  let fetchMock: MockInstance<typeof fetch>;

  beforeEach(() => {
    fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => githubResponse(SCHEMA_BODY));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns no-store 404 for malformed paths, for every method', async () => {
    for (const method of ['GET', 'OPTIONS', 'POST']) {
      // eslint-disable-next-line no-await-in-loop
      const response = await run('/schemas/shared/Image/v1.0.0.json', { method });
      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expectBaseHeaders(response);
    }
  });

  it('checks path format before configuration', async () => {
    const response = await run('/schemas/nope', {}, { JSON_SCHEMA_GITHUB_REF: '' });
    expect(response.status).toBe(404);
  });

  it.each([
    [{ ...TEST_ENV, JSON_SCHEMA_GITHUB_CONTENTS_URL: 'https://example.com/repos/a/b/contents' }],
    [{ ...TEST_ENV, JSON_SCHEMA_GITHUB_CONTENTS_URL: '' }],
    [{ ...TEST_ENV, JSON_SCHEMA_GITHUB_CONTENTS_URL: 'https://api.github.com/repos/example/./contents' }],
    [{ ...TEST_ENV, JSON_SCHEMA_GITHUB_CONTENTS_URL: 'https://api.github.com/repos/example/../contents' }],
    [{ ...TEST_ENV, JSON_SCHEMA_GITHUB_CONTENTS_URL: 'https://api.github.com/repos/example/.../contents' }],
    [{ ...TEST_ENV, JSON_SCHEMA_GITHUB_REF: '' }],
    [{ ...TEST_ENV, JSON_SCHEMA_GITHUB_REF: 'a b' }],
    [{ ...TEST_ENV, GITHUB_TOKEN: undefined }],
    [{ ...TEST_ENV, GITHUB_TOKEN: '' }],
    [{ ...TEST_ENV, JSON_SCHEMA_CACHE_MODE: '' }],
    [{ ...TEST_ENV, JSON_SCHEMA_CACHE_MODE: 'Bypass' }],
    [{ ...TEST_ENV, JSON_SCHEMA_CACHE_MODE: 'off' }],
    [{ ...TEST_ENV, JSON_SCHEMA_CANONICAL_ORIGIN: '' }],
    [{ ...TEST_ENV, JSON_SCHEMA_CANONICAL_ORIGIN: 'schemas.example.com' }],
    [{ ...TEST_ENV, JSON_SCHEMA_CANONICAL_ORIGIN: 'https://schemas.example.com/' }],
    [{ ...TEST_ENV, JSON_SCHEMA_CANONICAL_ORIGIN: 'https://schemas.example.com/base' }],
    [{ ...TEST_ENV, JSON_SCHEMA_CANONICAL_ORIGIN: 'ftp://schemas.example.com' }],
  ])('returns uncached 503 for invalid configuration %o', async (env) => {
    const response = await run(LISTED, {}, env);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expectBaseHeaders(response);
  });

  it('accepts the defaults when only the token is set', async () => {
    const response = await run(LISTED, { method: 'OPTIONS' }, { GITHUB_TOKEN: 'test-token' });
    expect(response.status).toBe(204);
  });

  it('returns 503 without a token, also for preflight', async () => {
    const response = await run(LISTED, { method: 'OPTIONS' }, {});
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it.each([
    [{ ...TEST_ENV, JSON_SCHEMA_GITHUB_CONTENTS_URL: 'https://api.github.com/repos/example/.github/contents' }],
    [{ ...TEST_ENV, JSON_SCHEMA_GITHUB_CONTENTS_URL: 'https://api.github.com/repos/example/a.b/contents' }],
    [{ ...TEST_ENV, JSON_SCHEMA_CACHE_MODE: 'immutable' }],
    [{ ...TEST_ENV, JSON_SCHEMA_CACHE_MODE: 'bypass' }],
    [{ ...TEST_ENV, JSON_SCHEMA_CANONICAL_ORIGIN: 'https://schemas.example.com' }],
    [{ ...TEST_ENV, JSON_SCHEMA_CANONICAL_ORIGIN: 'http://localhost:8787' }],
  ])('accepts valid configuration %o', async (env) => {
    const response = await run(LISTED, { method: 'OPTIONS' }, env);
    expect(response.status).toBe(204);
  });

  it.each([
    ['malformed 404', '/schemas/nope', 'GET', 404],
    ['unlisted 404', UNLISTED, 'GET', 404],
    ['405', LISTED, 'POST', 405],
    ['listed GET 200', LISTED, 'GET', 200],
  ])('returns no-store for %s in bypass cache mode', async (_name, path, method, status) => {
    const env = { ...TEST_ENV, JSON_SCHEMA_CACHE_MODE: 'bypass' };
    const response = await run(path, { method }, env);
    expect(response.status).toBe(status);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const withAuth = await run(path, { method, headers: { Authorization: 'token x' } }, env);
    expect(withAuth.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('checks configuration before the allowlist', async () => {
    const response = await run(UNLISTED, {}, { JSON_SCHEMA_GITHUB_REF: '' });
    expect(response.status).toBe(503);
  });

  it('returns 404 for unlisted paths for every method, cacheable by clients for 60 s', async () => {
    for (const method of ['GET', 'OPTIONS', 'POST', 'DELETE']) {
      // eslint-disable-next-line no-await-in-loop
      const response = await run(UNLISTED, { method });
      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
      expect(response.headers.has('Allow')).toBe(false);
      expectBaseHeaders(response);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed path 404', '/schemas/nope', 'GET', TEST_ENV, 404],
    ['configuration 503', LISTED, 'GET', { JSON_SCHEMA_GITHUB_REF: '' }, 503],
    ['unlisted 404', UNLISTED, 'GET', TEST_ENV, 404],
    ['405', LISTED, 'POST', TEST_ENV, 405],
    ['listed GET 200', LISTED, 'GET', TEST_ENV, 200],
  ])('returns private, no-store for %s when Authorization is present', async (_name, path, method, env, status) => {
    const response = await run(path, { method, headers: { Authorization: 'token x' } }, env);
    expect(response.status).toBe(status);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expectBaseHeaders(response);
  });

  it('answers preflight for listed paths', async () => {
    const response = await run(LISTED, { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Authorization');
    expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
    expectBaseHeaders(response);
  });

  it('answers a realistic browser preflight', async () => {
    const response = await run(LISTED, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Authorization');
    expect(response.headers.has('Cache-Control')).toBe(false);
    expectBaseHeaders(response);
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'])('returns 405 for %s on listed paths', async (method) => {
    const response = await run(LISTED, { method });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, OPTIONS');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expectBaseHeaders(response);
  });

  it('ignores query parameters when matching the allowlist', async () => {
    const response = await run(`${LISTED}?ref=evil&path=x`, { method: 'OPTIONS' });
    expect(response.status).toBe(204);
  });

  describe('GitHub fetch', () => {
    it('serves the upstream bytes unchanged with immutable caching', async () => {
      const response = await run(LISTED);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(SCHEMA_BODY);
      expect(response.headers.get('Content-Type')).toBe('application/schema+json');
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
      expectBaseHeaders(response);
    });

    it('builds the upstream request only from configuration and the validated path', async () => {
      await run(`${LISTED}?ref=evil&path=x`, {
        headers: { Authorization: 'token client', Cookie: 'a=b' },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        'https://api.github.com/repos/test-owner/test-repo/contents/schemas/shared/demo-card/v1.0.0.json?ref=test-ref',
      );
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer test-token');
      expect(headers.get('Accept')).toBe('application/vnd.github.raw');
      expect(headers.get('User-Agent')).toBe('da-sc');
      expect(headers.has('Cookie')).toBe(false);
      expect(init?.redirect).toBe('manual');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('uses the production defaults for the upstream URL', async () => {
      await run(LISTED, {}, { GITHUB_TOKEN: 't' });
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://api.github.com/repos/adobe/da-sc-sdk/contents/schemas/shared/demo-card/v1.0.0.json?ref=main',
      );
    });

    it('encodes the configured ref', async () => {
      await run(LISTED, {}, { ...TEST_ENV, JSON_SCHEMA_GITHUB_REF: 'feature/x' });
      expect(fetchMock.mock.calls[0][0]).toMatch(/\?ref=feature%2Fx$/);
    });

    it('returns no-store for success in bypass mode', async () => {
      const response = await run(LISTED, {}, { ...TEST_ENV, JSON_SCHEMA_CACHE_MODE: 'bypass' });
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    });

    it('returns private, no-store for success when Authorization is present', async () => {
      const response = await run(LISTED, { headers: { Authorization: 'token x' } });
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    });

    it('maps a GitHub 404 to a 404 cacheable for 60 s, never immutable', async () => {
      fetchMock.mockResolvedValue(githubResponse('{"message":"Not Found"}', { status: 404 }));
      const response = await run(LISTED);
      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
      expect(await response.text()).toBe('Not Found');
      expectBaseHeaders(response);
    });

    it('maps a GitHub 404 to no-store in bypass mode', async () => {
      fetchMock.mockResolvedValue(githubResponse(null, { status: 404 }));
      const response = await run(LISTED, {}, { ...TEST_ENV, JSON_SCHEMA_CACHE_MODE: 'bypass' });
      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    });

    it.each([
      ['401', () => githubResponse('{"message":"Bad credentials"}', { status: 401 })],
      ['403', () => githubResponse('{"message":"rate limit"}', { status: 403 })],
      ['429', () => githubResponse(null, { status: 429 })],
      ['500', () => githubResponse(null, { status: 500 })],
      ['204', () => githubResponse(null, { status: 204 })],
      ['302 redirect', () => githubResponse(null, { status: 302, headers: { Location: 'https://evil.example/' } })],
      ['invalid JSON', () => githubResponse('{not json')],
      ['HTML', () => githubResponse('<html></html>')],
      ['boolean schema', () => githubResponse('true')],
      ['array', () => githubResponse('[]')],
      ['null', () => githubResponse('null')],
      ['missing $id', () => githubResponse('{"type":"object"}')],
      ['wrong $id', () => githubResponse('{"$id":"https://other.example/schemas/shared/demo-card/v1.0.0.json"}')],
      ['$id from the request host', () => githubResponse(`{"$id":"https://schemas.test${LISTED}"}`)],
    ])('returns a sanitized uncached 503 for upstream %s', async (_name, upstream) => {
      fetchMock.mockResolvedValue(upstream());
      const response = await run(LISTED);
      expect(response.status).toBe(503);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.has('Location')).toBe(false);
      expect(await response.text()).toBe('Service Unavailable');
      expectBaseHeaders(response);
    });

    it.each([
      ['network error', new TypeError('Network connection lost')],
      ['timeout', new DOMException('The operation timed out.', 'TimeoutError')],
    ])('returns a sanitized uncached 503 for %s', async (_name, error) => {
      fetchMock.mockRejectedValue(error);
      const response = await run(LISTED);
      expect(response.status).toBe(503);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.text()).toBe('Service Unavailable');
    });

    it('returns 503 when the body read fails, e.g. after the timeout', async () => {
      const body = new ReadableStream({
        pull(controller) {
          controller.error(new DOMException('The operation timed out.', 'TimeoutError'));
        },
      });
      fetchMock.mockResolvedValue(githubResponse(body));
      const response = await run(LISTED);
      expect(response.status).toBe(503);
    });

    it('validates $id against the canonical origin, not the request host', async () => {
      const env = { ...TEST_ENV, JSON_SCHEMA_CANONICAL_ORIGIN: 'http://localhost:8787' };
      fetchMock.mockResolvedValue(githubResponse(`{"$id":"http://localhost:8787${LISTED}"}`));
      const response = await run(LISTED, {}, env);
      expect(response.status).toBe(200);
    });

    it('applies the 10 second timeout', async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
      await run(LISTED);
      expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    });
  });

  describe('edge cache', () => {
    function schemaFor(origin: string): string {
      return JSON.stringify({ $id: `${origin}${LISTED}`, type: 'object' });
    }

    it('serves a repeated GET from the edge cache with the stored headers', async () => {
      const first = await run(LISTED);
      const second = await run(`${LISTED}?ignored=1`);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(second.status).toBe(200);
      expect(await second.text()).toBe(await first.text());
      expect(second.headers.get('Content-Type')).toBe('application/schema+json');
      expect(second.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
      expectBaseHeaders(second);
    });

    it('caches a GitHub 404 with max-age=60, never immutable', async () => {
      fetchMock.mockImplementation(async () => githubResponse(null, { status: 404 }));
      await run(LISTED);
      const second = await run(LISTED);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(second.status).toBe(404);
      expect(second.headers.get('Cache-Control')).toBe('public, max-age=60');
      expectBaseHeaders(second);
    });

    it.each([
      ['GitHub 500', () => githubResponse(null, { status: 500 })],
      ['invalid body', () => githubResponse('{"$id":"https://wrong.example/x"}')],
    ])('does not cache a 503 from %s', async (_name, upstream) => {
      fetchMock.mockImplementation(async () => upstream());
      await run(LISTED);
      await run(LISTED);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('neither reads nor writes the cache in bypass mode', async () => {
      await run(LISTED);
      const matchSpy = vi.spyOn(caches.default, 'match');
      const putSpy = vi.spyOn(caches.default, 'put');
      const env = { ...TEST_ENV, JSON_SCHEMA_CACHE_MODE: 'bypass' };
      await run(LISTED, {}, env);
      fetchMock.mockImplementation(async () => githubResponse(null, { status: 404 }));
      await run(LISTED, {}, env);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(matchSpy).not.toHaveBeenCalled();
      expect(putSpy).not.toHaveBeenCalled();
    });

    it.each([
      ['token x'],
      ['Bearer anything'],
      ['arbitrary'],
      [''],
    ])('neither reads nor writes the cache with Authorization %j', async (authorization) => {
      await run(LISTED);
      const matchSpy = vi.spyOn(caches.default, 'match');
      const putSpy = vi.spyOn(caches.default, 'put');
      const auth = { headers: { Authorization: authorization } };
      const response = await run(LISTED, auth);
      fetchMock.mockImplementation(async () => githubResponse(null, { status: 404 }));
      await run(LISTED, auth);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(matchSpy).not.toHaveBeenCalled();
      expect(putSpy).not.toHaveBeenCalled();
    });

    it.each([
      ['ref', { JSON_SCHEMA_GITHUB_REF: 'other-ref' }],
      ['contents URL', { JSON_SCHEMA_GITHUB_CONTENTS_URL: 'https://api.github.com/repos/test-owner/other-repo/contents' }],
    ])('keeps separate entries per %s', async (_name, override) => {
      await run(LISTED);
      await run(LISTED, {}, { ...TEST_ENV, ...override });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('keeps separate entries per canonical origin', async () => {
      const other = 'https://other.example';
      await run(LISTED);
      fetchMock.mockImplementation(async () => githubResponse(schemaFor(other)));
      const response = await run(LISTED, {}, { ...TEST_ENV, JSON_SCHEMA_CANONICAL_ORIGIN: other });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(response.status).toBe(200);
      expect(JSON.parse(await response.text()).$id).toBe(`${other}${LISTED}`);
    });

    it('validates configuration before a cache hit', async () => {
      await run(LISTED);
      const response = await run(LISTED, {}, { ...TEST_ENV, GITHUB_TOKEN: undefined });
      expect(response.status).toBe(503);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    });

    it('checks the allowlist before a cache hit', async () => {
      await run(LISTED);
      const response = await run(LISTED, {}, TEST_ENV, []);
      expect(response.status).toBe(404);
    });

    it('does not use the cache for preflight or 405', async () => {
      const matchSpy = vi.spyOn(caches.default, 'match');
      const putSpy = vi.spyOn(caches.default, 'put');
      await run(LISTED, { method: 'OPTIONS' });
      await run(LISTED, { method: 'POST' });
      expect(matchSpy).not.toHaveBeenCalled();
      expect(putSpy).not.toHaveBeenCalled();
    });

    it('excludes query strings and the request path from the cache key', async () => {
      const putSpy = vi.spyOn(caches.default, 'put');
      await run(`${LISTED}?a=1`);
      const [key] = putSpy.mock.calls[0];
      const url = new URL(key instanceof Request ? key.url : String(key));
      expect(url.origin).toBe('https://schemas.test');
      expect(url.search).toBe('');
      expect(url.pathname).toMatch(/^\/[0-9a-f]{64}\/schemas\/shared\/demo-card\/v1\.0\.0\.json$/);
    });

    it('still serves the response when the cache write fails', async () => {
      vi.spyOn(caches.default, 'put').mockRejectedValue(new Error('cache down'));
      const response = await run(LISTED);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(SCHEMA_BODY);
    });

    it('returns the response before the background cache write completes', async () => {
      let resolvePut: () => void = () => {};
      const pendingPut = new Promise<void>((resolve) => {
        resolvePut = resolve;
      });
      const putSpy = vi.spyOn(caches.default, 'put').mockReturnValue(pendingPut);
      const executionCtx = createExecutionContext();
      let putSettled = false;
      pendingPut.then(() => {
        putSettled = true;
      }, () => undefined);

      const response = await handleJsonSchemaRequest(
        new Request(`https://schemas.test${LISTED}`),
        TEST_ENV,
        executionCtx,
        TEST_ALLOWLIST,
      );

      expect(putSpy).toHaveBeenCalledTimes(1);
      expect(putSettled).toBe(false);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(SCHEMA_BODY);

      resolvePut();
      await waitOnExecutionContext(executionCtx);
      expect(putSettled).toBe(true);
    });

    it('treats a failing cache read as a miss', async () => {
      vi.spyOn(caches.default, 'match').mockRejectedValue(new Error('cache down'));
      const response = await run(LISTED);
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
