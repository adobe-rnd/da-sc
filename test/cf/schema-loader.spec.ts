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
import {
  extractSchemaFromHtml,
  loadSchema,
  schemaSourceUrl,
} from '../../src/cf/schema-loader';

const SHELL = (json: string) => `<body><header></header><main><div><pre><code>${json}</code></pre></div></main><footer></footer></body>`;

describe('extractSchemaFromHtml', () => {
  it('parses the JSON from the code block', () => {
    const schema = { type: 'object', title: 'Coffee' };
    expect(extractSchemaFromHtml(SHELL(JSON.stringify(schema, null, 2)))).toEqual(schema);
  });

  it('decodes HTML entities in the JSON before parsing', () => {
    const html = SHELL('{&quot;type&quot;: &quot;string&quot;, &quot;pattern&quot;: &quot;a &amp; b&quot;}');
    expect(extractSchemaFromHtml(html)).toEqual({ type: 'string', pattern: 'a & b' });
  });

  it('throws when no code block is present', () => {
    expect(() => extractSchemaFromHtml('<body><main></main></body>')).toThrow('code block not found');
  });

  it('throws when the JSON is invalid', () => {
    expect(() => extractSchemaFromHtml(SHELL('{ not json'))).toThrow('Failed to parse schema JSON');
  });
});

describe('schemaSourceUrl', () => {
  it('builds the DA source URL', () => {
    expect(schemaSourceUrl({ org: 'org', site: 'site' }, 'coffee')).toBe(
      'https://admin.da.live/source/org/site/.da/forms/schemas/coffee.html',
    );
  });
});

describe('loadSchema', () => {
  it('fetches and parses the schema', async () => {
    const schema = { type: 'object', title: 'Coffee' };
    const body = SHELL(JSON.stringify(schema));
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));
    const result = await loadSchema({ org: 'org', site: 'site' }, 'coffee', { fetchImpl });
    expect(result).toEqual(schema);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://admin.da.live/source/org/site/.da/forms/schemas/coffee.html',
      {},
    );
  });

  it('forwards the Authorization header when provided', async () => {
    const fetchImpl = vi.fn(async () => new Response(SHELL('{}'), { status: 200 }));
    await loadSchema({ org: 'org', site: 'site' }, 'coffee', {
      fetchImpl,
      authorization: 'token secret',
    });
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), {
      headers: { Authorization: 'token secret' },
    });
  });

  it('throws on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 }));
    await expect(loadSchema({ org: 'org', site: 'site' }, 'missing', { fetchImpl })).rejects.toThrow('404');
  });
});
