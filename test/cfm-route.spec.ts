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
import worker from '../src';
import { synthesizeModel } from '../src/cf/identity';
import type { ContentFragmentModel } from '../src/cfm/types';

/** base64url model id for a pointer (the route is addressed by id). */
function idFor(pointer = '', schemaName = 'coffee-promotion'): string {
  return synthesizeModel({ org: 'org', site: 'site' }, schemaName, pointer).id;
}

// Exercises the real SDK (no module mock): /cfm runs loadSchema -> createEngine
// -> convertSchemaToCfm. Only the schema is fetched (no EDS document).

const schema = {
  type: 'object',
  title: 'Coffee Promotion',
  properties: {
    headline: { type: 'string', title: 'Headline' },
    ctas: {
      type: 'array',
      title: 'CTAs',
      items: {
        type: 'object', title: 'CTA', properties: { label: { type: 'string', title: 'Label' } },
      },
    },
  },
};

function schemaShell(): string {
  const json = JSON.stringify(schema, null, 2);
  return `<body><header></header><main><div><pre><code>${json}</code></pre></div></main><footer></footer></body>`;
}

function mockFetch(schemaResponse?: Response) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (
    schemaResponse ?? new Response(schemaShell(), { status: 200 })
  ));
}

async function runRequest(url: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(url, init));
}

describe('/cfm route', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the root model (by id) and fetches only the schema', async () => {
    const fetchSpy = mockFetch();
    const response = await runRequest(`http://example.com/cfm/live/${idFor()}`);

    expect(response.status).toBe(200);
    const model = await response.json() as ContentFragmentModel;
    expect(model.path).toBe('/org/site/.da/forms/schemas/coffee-promotion');
    expect(model.fields.map((f) => f.name)).toEqual(['headline', 'ctas']);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      'https://admin.da.live/source/org/site/.da/forms/schemas/coffee-promotion.html',
    );
  });

  it('returns a sub-model addressed by the sub-model id', async () => {
    mockFetch();
    const response = await runRequest(`http://example.com/cfm/live/${idFor('/ctas')}`);
    const model = await response.json() as ContentFragmentModel;
    expect(model.path).toBe('/org/site/.da/forms/schemas/coffee-promotion/ctas');
    expect(model.fields.map((f) => f.name)).toEqual(['label']);
  });

  it('returns 500 when the id does not resolve to an object model', async () => {
    mockFetch();
    const response = await runRequest(`http://example.com/cfm/live/${idFor('/headline')}`);
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('Failed to build Content Fragment Model');
  });

  it('returns 500 when the schema cannot be loaded', async () => {
    mockFetch(new Response('nope', { status: 404 }));
    const response = await runRequest(`http://example.com/cfm/live/${idFor('', 'missing')}`);
    expect(response.status).toBe(500);
  });

  it('errors when the model id is missing', async () => {
    mockFetch();
    const response = await runRequest('http://example.com/cfm/live');
    expect(response.status).toBe(500);
  });
});
