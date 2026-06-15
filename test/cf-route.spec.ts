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
import { convertJsonToHtml, type Document } from '@adobe/da-sc-sdk';
import worker from '../src';
import type { ContentFragment } from '../src/cf/types';

// This suite exercises the real SDK (no module mock) so the `/cf` route runs
// the full pipeline: convertHtmlToJson -> loadSchema -> createEngine -> convert.

const schema = {
  type: 'object',
  title: 'Coffee Promotion',
  properties: {
    headline: { type: 'string', title: 'Headline' },
    tags: { type: 'array', title: 'Tags', items: { type: 'string', title: 'Tag' } },
    author: {
      type: 'object',
      title: 'Author',
      properties: { name: { type: 'string', title: 'Name' } },
    },
  },
};

const document: Document = {
  metadata: { schemaName: 'coffee-promotion', title: 'Coffee' },
  data: { headline: 'Coffee Promotion', tags: ['hot'], author: { name: 'Sarah' } },
};

function wireHtml(): string {
  const result = convertJsonToHtml({ json: document });
  if ('error' in result) throw new Error(result.error);
  return result.html;
}

function schemaShell(): string {
  const json = JSON.stringify(schema, null, 2);
  return `<body><header></header><main><div><pre><code>${json}</code></pre></div></main><footer></footer></body>`;
}

/** Route the EDS host to the doc HTML and admin.da.live to the schema shell. */
function mockFetch(schemaResponse?: Response) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('admin.da.live')) {
      return schemaResponse ?? new Response(schemaShell(), { status: 200 });
    }
    return new Response(wireHtml(), { status: 200 });
  });
}

async function runRequest(url: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(url, init));
}

describe('/cf route', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a content fragment for a cf GET request', async () => {
    mockFetch();
    const response = await runRequest('http://example.com/cf/live/org/site/blog/post');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/json');

    const fragment = await response.json() as ContentFragment;
    expect(fragment.path).toBe('/org/site/blog/post');
    expect(fragment.model.name).toBe('Coffee Promotion');
    expect(fragment.status).toBe('PUBLISHED');

    const headline = fragment.fields.find((f) => f.name === 'headline');
    expect(headline?.values).toEqual(['Coffee Promotion']);

    const authorRef = fragment.references.find((r) => r.fieldName === 'author');
    expect(authorRef?.path).toBe('/org/site/blog/post/author');
  });

  it('fetches the schema from admin.da.live after the EDS document', async () => {
    const fetchSpy = mockFetch();
    await runRequest('http://example.com/cf/preview/org/site/blog/post');

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toBe('https://main--site--org.aem.page/blog/post');
    expect(urls).toContain('https://admin.da.live/source/org/site/.da/forms/schemas/coffee-promotion.html');
  });

  it('forwards the Authorization token to the schema fetch', async () => {
    const fetchSpy = mockFetch();
    await runRequest('http://example.com/cf/live/org/site/blog/post', {
      headers: { Authorization: 'token secret' },
    });

    const schemaCall = fetchSpy.mock.calls.find((c) => String(c[0]).includes('admin.da.live'));
    expect(schemaCall?.[1]).toMatchObject({ headers: { Authorization: 'token secret' } });
  });

  it('returns 500 when the schema cannot be loaded', async () => {
    mockFetch(new Response('nope', { status: 404 }));
    const response = await runRequest('http://example.com/cf/live/org/site/blog/post');

    expect(response.status).toBe(500);
    expect(await response.text()).toContain('Failed to convert to Content Fragment');
  });

  it('honors the references query parameter (none → no references)', async () => {
    mockFetch();
    const response = await runRequest('http://example.com/cf/live/org/site/blog/post?references=none');
    const fragment = await response.json() as ContentFragment;
    expect(fragment.references).toEqual([]);
    // the content-fragment field itself is still present
    expect(fragment.fields.find((f) => f.name === 'author')?.type).toBe('content-fragment');
  });

  it('returns 400 for an invalid references value', async () => {
    mockFetch();
    const response = await runRequest('http://example.com/cf/live/org/site/blog/post?references=bogus');
    expect(response.status).toBe(400);
  });

  it('addresses /cf by base64url fragment id', async () => {
    mockFetch();
    const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const id = b64url('/org/site/blog/post');
    const response = await runRequest(`http://example.com/cf/live/${id}`);
    expect(response.status).toBe(200);
    const fragment = await response.json() as ContentFragment;
    expect(fragment.path).toBe('/org/site/blog/post');
  });
});
