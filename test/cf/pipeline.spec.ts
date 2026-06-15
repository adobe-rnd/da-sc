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
import { convertJsonToHtml, type Document } from '@adobe/da-sc-sdk';
import { htmlToContentFragment } from '../../src/cf/pipeline';
import type { IdentitySource } from '../../src/cf/identity';

const identity: IdentitySource = {
  org: 'org', site: 'site', path: 'blog/post', tier: 'live',
};

const schema = {
  type: 'object',
  title: 'Coffee Promotion',
  properties: {
    headline: { type: 'string', title: 'Headline' },
    tags: { type: 'array', title: 'Tags', items: { type: 'string', title: 'Tag' } },
  },
};

const document: Document = {
  metadata: { schemaName: 'coffee-promotion', title: 'Coffee' },
  data: { headline: 'Coffee Promotion', tags: ['hot', 'fresh'] },
};

function html(doc: Document = document): string {
  const result = convertJsonToHtml({ json: doc });
  if ('error' in result) throw new Error(result.error);
  return result.html;
}

function schemaShell(sch: unknown): string {
  const json = JSON.stringify(sch, null, 2);
  return `<body><header></header><main><div><pre><code>${json}</code></pre></div></main><footer></footer></body>`;
}

describe('htmlToContentFragment', () => {
  it('converts delivery HTML into a content fragment', async () => {
    const fetchImpl = vi.fn(async () => new Response(schemaShell(schema), { status: 200 }));
    const result = await htmlToContentFragment({ html: html(), identity, fetchImpl });
    expect(result.error).toBeUndefined();
    expect(result.fragment!.model.name).toBe('Coffee Promotion');
    const headline = result.fragment!.fields.find((f) => f.name === 'headline');
    expect(headline!.values).toEqual(['Coffee Promotion']);
  });

  it('fetches the schema from the DA source API with auth forwarded', async () => {
    const fetchImpl = vi.fn(async () => new Response(schemaShell(schema), { status: 200 }));
    await htmlToContentFragment({
      html: html(), identity, fetchImpl, authorization: 'token secret',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://admin.da.live/source/org/site/.da/forms/schemas/coffee-promotion.html',
      { headers: { Authorization: 'token secret' } },
    );
  });

  it('returns an error when the HTML cannot be converted', async () => {
    const fetchImpl = vi.fn();
    const result = await htmlToContentFragment({ html: '', identity, fetchImpl });
    expect(result.error).toBeDefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns an error when the schema cannot be loaded', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }));
    const result = await htmlToContentFragment({ html: html(), identity, fetchImpl });
    expect(result.error).toContain('404');
  });
});
