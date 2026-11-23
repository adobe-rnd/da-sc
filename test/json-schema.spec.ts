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
import { describe, expect, it } from 'vitest';
import { handleJsonSchemaRequest } from '../src/json-schema';

const SCHEMA_ORIGIN = 'https://headless.adobe.net';
const PATHS = [
  '/schemas/shared/image/v1.0.0.json',
  '/schemas/shared/file/v1.0.0.json',
];
const [LISTED] = PATHS;
const UNKNOWN = '/schemas/shared/unknown-schema/v1.0.0.json';

async function run(path: string, init?: RequestInit): Promise<Response> {
  return handleJsonSchemaRequest(new Request(`https://schemas.test${path}`, init));
}

function expectBaseHeaders(response: Response): void {
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('Content-Security-Policy'))
    .toBe("default-src 'none'; frame-ancestors 'none'; sandbox");
  expect(response.headers.has('Access-Control-Allow-Credentials')).toBe(false);
  expect(response.headers.has('Set-Cookie')).toBe(false);
}

describe('shared schemas from the SDK', () => {
  it.each(PATHS.map((path) => [path]))('serves %s with $id equal to its public URL', async (path) => {
    const response = await run(path);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/schema+json');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expectBaseHeaders(response);
    const body = await response.json() as { $id: unknown };
    expect(body.$id).toBe(`${SCHEMA_ORIGIN}${path}`);
  });
});

describe('handleJsonSchemaRequest', () => {
  it.each([
    '/schemas',
    '/schemas/',
    '/schemas/shared/',
    UNKNOWN,
    `${LISTED}/`,
    LISTED.replace('/v', '/V'),
    LISTED.replace('.json', '%2Ejson'),
    LISTED.replace('/schemas/', '/schemas//'),
    LISTED.replace('/v1.0.0', '/1.0.0'),
    LISTED.replace('/v1.0.0', '/vv1.0.0'),
    LISTED.replace('/image/', '/image/x/'),
    '/schemas/shared/image%2Fv1.0.0.json',
  ])('returns 404 for %s, cacheable for 60 s, for GET and POST', async (path) => {
    for (const method of ['GET', 'POST']) {
      // eslint-disable-next-line no-await-in-loop
      const response = await run(path, { method });
      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
      expect(response.headers.has('Allow')).toBe(false);
      expectBaseHeaders(response);
    }
  });

  it('ignores query strings', async () => {
    const response = await run(`${LISTED}?v=2&ref=other`);
    expect(response.status).toBe(200);
  });

  it.each(['/schemas', UNKNOWN])('answers preflight for %s without a lookup', async (path) => {
    const response = await run(path, { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
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
    expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
    expect(response.headers.has('Cache-Control')).toBe(false);
    expectBaseHeaders(response);
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'])('returns no-store 405 for %s', async (method) => {
    const response = await run(LISTED, { method });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, OPTIONS');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expectBaseHeaders(response);
  });

  it.each([
    ['200', LISTED, 'GET', 200],
    ['404', UNKNOWN, 'GET', 404],
    ['405', LISTED, 'POST', 405],
  ])('returns private, no-store for %s when Authorization is present', async (_name, path, method, status) => {
    for (const authorization of ['token x', 'Bearer y', '']) {
      // eslint-disable-next-line no-await-in-loop
      const response = await run(path, { method, headers: { Authorization: authorization } });
      expect(response.status).toBe(status);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expectBaseHeaders(response);
    }
  });
});
