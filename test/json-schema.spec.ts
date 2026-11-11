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
  afterEach, describe, expect, it, vi,
} from 'vitest';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { handleJsonSchemaRequest, parseSchemaPath } from '../src/json-schema';
import { JSON_SCHEMA_ALLOWLIST, type JsonSchemaAllowlist } from '../src/json-schema-allowlist';

const LISTED = '/schemas/shared/demo-card/v1.0.0.json';
const UNLISTED = '/schemas/shared/demo-card/v9.9.9.json';

const TEST_ENV = {
  JSON_SCHEMA_GITHUB_CONTENTS_URL: 'https://api.github.com/repos/test-owner/test-repo/contents',
  JSON_SCHEMA_GITHUB_REF: 'test-ref',
};

const TEST_ALLOWLIST: JsonSchemaAllowlist = [LISTED.slice(1)];

async function run(
  path: string,
  init?: RequestInit,
  env: Record<string, string> = TEST_ENV,
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 404 without caching for malformed paths, for every method', async () => {
    for (const method of ['GET', 'OPTIONS', 'POST']) {
      // eslint-disable-next-line no-await-in-loop
      const response = await run('/schemas/shared/Image/v1.0.0.json', { method });
      expect(response.status).toBe(404);
      expect(response.headers.has('Cache-Control')).toBe(false);
      expectBaseHeaders(response);
    }
  });

  it('checks path format before configuration', async () => {
    const response = await run('/schemas/nope', {}, { JSON_SCHEMA_GITHUB_REF: '' });
    expect(response.status).toBe(404);
  });

  it.each([
    [{ JSON_SCHEMA_GITHUB_CONTENTS_URL: 'https://example.com/repos/a/b/contents' }],
    [{ JSON_SCHEMA_GITHUB_CONTENTS_URL: '' }],
    [{ ...TEST_ENV, JSON_SCHEMA_GITHUB_REF: '' }],
  ])('returns uncached 503 for invalid source configuration %o', async (env) => {
    const response = await run(LISTED, {}, env);
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expectBaseHeaders(response);
  });

  it('returns uncached 503 for GET on listed paths until GitHub fetching exists', async () => {
    const response = await run(LISTED);
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expectBaseHeaders(response);
  });

  it('accepts the production source defaults when no bindings are set', async () => {
    const response = await run(LISTED, { method: 'OPTIONS' }, {});
    expect(response.status).toBe(204);
  });

  it('checks configuration before the allowlist', async () => {
    const response = await run(UNLISTED, {}, { JSON_SCHEMA_GITHUB_REF: '' });
    expect(response.status).toBe(503);
  });

  it('returns 404 for unlisted paths for every method, cacheable by clients for 60 s', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    for (const method of ['GET', 'OPTIONS', 'POST', 'DELETE']) {
      // eslint-disable-next-line no-await-in-loop
      const response = await run(UNLISTED, { method });
      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
      expect(response.headers.has('Allow')).toBe(false);
      expectBaseHeaders(response);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed path 404', '/schemas/nope', 'GET', TEST_ENV, 404],
    ['configuration 503', LISTED, 'GET', { JSON_SCHEMA_GITHUB_REF: '' }, 503],
    ['unlisted 404', UNLISTED, 'GET', TEST_ENV, 404],
    ['405', LISTED, 'POST', TEST_ENV, 405],
    ['listed GET 503', LISTED, 'GET', TEST_ENV, 503],
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
    expectBaseHeaders(response);
  });

  it('ignores query parameters when matching the allowlist', async () => {
    const response = await run(`${LISTED}?ref=evil&path=x`, { method: 'OPTIONS' });
    expect(response.status).toBe(204);
  });
});
