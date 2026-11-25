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
import { getSharedSchema } from '@adobe/da-sc-sdk';
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';
import { handleJsonSchemaRequest } from '../src/json-schema';

vi.mock('@adobe/da-sc-sdk', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('@adobe/da-sc-sdk')>();
  return { ...sdk, getSharedSchema: vi.fn(sdk.getSharedSchema) };
});

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
    `${LISTED}/`,
    LISTED.replace('/v', '/V'),
    LISTED.replace('.json', '%2Ejson'),
    LISTED.replace('/schemas/', '/schemas//'),
    LISTED.replace('/v1.0.0', '/1.0.0'),
    LISTED.replace('/v1.0.0', '/vv1.0.0'),
    LISTED.replace('/v1.0.0', '/v1.0'),
    LISTED.replace('/v1.0.0', '/v01.0.0'),
    LISTED.replace('/image/', '/image/x/'),
    '/schemas/shared/image%2Fv1.0.0.json',
    '/schemas/shared/image%2Ffile/v1.0.0.json',
  ])('returns a no-store 404 for malformed path %s without an SDK lookup', async (path) => {
    const lookup = vi.mocked(getSharedSchema);
    lookup.mockClear();
    for (const method of ['GET', 'POST']) {
      // eslint-disable-next-line no-await-in-loop
      const response = await run(path, { method });
      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.has('Allow')).toBe(false);
      expectBaseHeaders(response);
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    [UNKNOWN, 'GET'],
    [UNKNOWN, 'POST'],
    [LISTED.replace('/v1.0.0', '/v999.0.0'), 'GET'],
  ])('returns a 404 cacheable for 60 s on a lookup miss for %s (%s)', async (path, method) => {
    const response = await run(path, { method });

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(response.headers.has('Allow')).toBe(false);
    expectBaseHeaders(response);
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
    ['404 lookup miss', UNKNOWN, 'GET', 404],
    ['404 malformed path', '/schemas', 'GET', 404],
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

describe('schema failure logging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns once on a schema lookup miss without logging credentials or the query', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await run(`${UNKNOWN}?secret=query-value`, {
      headers: { Authorization: 'Bearer token-value' },
    });

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(warnSpy.mock.calls).toEqual([[{
      status: 404, event: 'schema_not_found', name: 'unknown-schema', version: '1.0.0',
    }]]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, 'no-store'],
    ['Bearer token-value', 'private, no-store'],
  ])('logs a lookup exception and returns a sanitized 500 (Authorization: %s)', async (auth, cacheControl) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getSharedSchema).mockImplementationOnce(() => {
      throw new Error('private SDK details');
    });

    const response = await run(`${LISTED}?secret=query-value`, {
      headers: auth === undefined ? {} : { Authorization: auth },
    });

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe(cacheControl);
    expectBaseHeaders(response);
    expect(await response.text()).toBe('Internal Server Error');
    expect(errorSpy.mock.calls).toEqual([[{ status: 500, event: 'schema_error', method: 'GET' }]]);
  });

  it('logs a serialization exception and returns a sanitized 500', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const lookup = getSharedSchema({ name: 'image', version: '1.0.0' });
    if ('error' in lookup) throw new Error('Expected the bundled image schema');
    const schema = {
      ...lookup.schema,
      toJSON() {
        throw new Error('private serialization details');
      },
    };
    vi.mocked(getSharedSchema).mockReturnValueOnce({ ...lookup, schema });

    const response = await run(LISTED);

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
    expect(errorSpy.mock.calls).toEqual([[{ status: 500, event: 'schema_error', method: 'GET' }]]);
  });

  it.each([
    ['/schemas', 'GET', 404],
    [LISTED.replace('/v1.0.0', '/vv1.0.0'), 'GET', 404],
    [LISTED, 'POST', 405],
    [UNKNOWN, 'OPTIONS', 204],
    [LISTED, 'GET', 200],
  ])('does not log %s %s (status %i)', async (path, method, status) => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await run(path, { method });

    expect(response.status).toBe(status);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
