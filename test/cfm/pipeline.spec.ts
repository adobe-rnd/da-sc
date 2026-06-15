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
  describe, expect, it, vi,
} from 'vitest';
import { schemaToContentFragmentModel } from '../../src/cfm/pipeline';
import { synthesizeModel } from '../../src/cf/identity';

const identity = { org: 'org', site: 'site' };

const schema = {
  type: 'object',
  title: 'Coffee Promotion',
  properties: {
    headline: { type: 'string', title: 'Headline' },
    author: {
      type: 'object', title: 'Author', properties: { name: { type: 'string', title: 'Name' } },
    },
  },
};

function schemaShell(sch: unknown): string {
  const json = JSON.stringify(sch, null, 2);
  return `<body><header></header><main><div><pre><code>${json}</code></pre></div></main><footer></footer></body>`;
}

describe('schemaToContentFragmentModel', () => {
  it('loads the schema and builds the root model', async () => {
    const body = schemaShell(schema);
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));
    const result = await schemaToContentFragmentModel({
      identity, schemaName: 'coffee-promotion', fetchImpl,
    });
    expect(result.error).toBeUndefined();
    expect(result.model!.id).toBe(synthesizeModel(identity, 'coffee-promotion').id);
    expect(result.model!.fields.map((f) => f.name)).toEqual(['headline', 'author']);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://admin.da.live/source/org/site/.da/forms/schemas/coffee-promotion.html',
      {},
    );
  });

  it('builds a sub-model by pointer', async () => {
    const body = schemaShell(schema);
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));
    const result = await schemaToContentFragmentModel({
      identity, schemaName: 'coffee-promotion', pointer: '/author', fetchImpl,
    });
    expect(result.model!.path).toBe('/org/site/.da/forms/schemas/coffee-promotion/author');
    expect(result.model!.fields.map((f) => f.name)).toEqual(['name']);
  });

  it('returns an error when the schema cannot be loaded', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }));
    const result = await schemaToContentFragmentModel({
      identity, schemaName: 'missing', fetchImpl,
    });
    expect(result.error).toContain('404');
  });

  it('returns an error when the pointer does not address an object', async () => {
    const body = schemaShell(schema);
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));
    const result = await schemaToContentFragmentModel({
      identity, schemaName: 'coffee-promotion', pointer: '/headline', fetchImpl,
    });
    expect(result.error).toContain('does not address an object');
  });
});
