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
import { describe, expect, it } from 'vitest';
import { createEngine, type Document } from '@adobe/da-sc-sdk';
import { convertScToCf } from '../../src/cf/convert';
import type { ContentFragmentField } from '../../src/cf/types';
import { synthesizeModel, type IdentitySource } from '../../src/cf/identity';

const identity: IdentitySource = {
  org: 'org', site: 'site', path: 'blog/post', tier: 'live',
};

const schema = {
  type: 'object',
  title: 'Coffee Promotion',
  properties: {
    headline: { type: 'string', title: 'Headline' },
    price: { type: 'number', title: 'Price' },
    count: { type: 'integer', title: 'Count' },
    active: { type: 'boolean', title: 'Active' },
    size: { type: 'string', title: 'Size', enum: ['S', 'M', 'L'] },
    tags: { type: 'array', title: 'Tags', items: { type: 'string', title: 'Tag' } },
    author: {
      type: 'object',
      title: 'Author',
      properties: {
        name: { type: 'string', title: 'Name' },
        email: { type: 'string', title: 'Email' },
      },
    },
    ctas: {
      type: 'array',
      title: 'CTAs',
      items: {
        type: 'object',
        title: 'CTA',
        properties: {
          label: { type: 'string', title: 'Label' },
          url: { type: 'string', title: 'URL' },
        },
      },
    },
  },
};

const document: Document = {
  metadata: { schemaName: 'coffee-promotion', title: 'Coffee' },
  data: {
    headline: 'Coffee Promotion',
    price: 4.5,
    count: 3,
    active: true,
    size: 'M',
    tags: ['hot', 'fresh'],
    author: { name: 'Sarah', email: 's@x.com' },
    ctas: [
      { label: 'Buy', url: 'https://a' },
      { label: 'More', url: 'https://b' },
    ],
  },
};

function convert(doc: Document = document, sch: unknown = schema) {
  const engine = createEngine({ schema: sch, document: doc });
  const { model } = engine.getState();
  return convertScToCf({
    engine, model: model!, document: doc, identity,
  }).fragment;
}

function field(fields: ContentFragmentField[], name: string): ContentFragmentField {
  const found = fields.find((f) => f.name === name);
  if (!found) throw new Error(`field ${name} not found`);
  return found;
}

describe('convertScToCf — fragment scaffolding', () => {
  const fragment = convert();

  it('synthesizes a stable identity and model', () => {
    expect(fragment.id).toMatch(/^[A-Za-z0-9_-]+$/); // base64url of the path
    expect(fragment.path).toBe('/org/site/blog/post');
    expect(fragment.model.name).toBe('Coffee Promotion');
    expect(fragment.model.path).toBe('/org/site/.da/forms/schemas/coffee-promotion');
    expect(fragment.title).toBe('Coffee');
    expect(fragment.status).toBe('PUBLISHED');
  });

  it('emits empty required scaffolding', () => {
    expect(fragment.created).toEqual({});
    expect(fragment.variations).toEqual([]);
    expect(fragment.tags).toEqual([]);
    expect(fragment.fieldTags).toEqual([]);
    expect(fragment.validationStatus).toEqual([]);
  });
});

describe('convertScToCf — scalar and array fields', () => {
  const { fields } = convert();

  it('maps scalars to the right CF types', () => {
    expect(field(fields, 'headline')).toMatchObject({ type: 'text', multiple: false, values: ['Coffee Promotion'] });
    expect(field(fields, 'price')).toMatchObject({ type: 'float-number', values: [4.5] });
    expect(field(fields, 'count')).toMatchObject({ type: 'number', values: [3] });
    expect(field(fields, 'active')).toMatchObject({ type: 'boolean', values: [true] });
    expect(field(fields, 'size')).toMatchObject({ type: 'enumeration', values: ['M'] });
  });

  it('maps an array of primitives to a multiple field', () => {
    expect(field(fields, 'tags')).toMatchObject({ type: 'text', multiple: true, values: ['hot', 'fresh'] });
  });
});

describe('convertScToCf — nested objects become child fragments', () => {
  const fragment = convert();

  it('links a nested object via a content-fragment field', () => {
    const author = field(fragment.fields, 'author');
    expect(author.type).toBe('content-fragment');
    expect(author.multiple).toBe(false);
    expect(author.values).toEqual(['/org/site/blog/post/author']);
  });

  it('hydrates the nested object as a reference with its own fields', () => {
    const ref = fragment.references.find((r) => r.fieldName === 'author');
    expect(ref).toBeDefined();
    expect(ref!.type).toBe('content-fragment');
    expect(ref!.path).toBe('/org/site/blog/post/author');
    expect(field(ref!.fields!, 'name').values).toEqual(['Sarah']);
    expect(field(ref!.fields!, 'email').values).toEqual(['s@x.com']);
  });

  it('links an array of objects via a multiple content-fragment field', () => {
    const ctas = field(fragment.fields, 'ctas');
    expect(ctas.type).toBe('content-fragment');
    expect(ctas.multiple).toBe(true);
    expect(ctas.values).toEqual([
      '/org/site/blog/post/ctas/0',
      '/org/site/blog/post/ctas/1',
    ]);
  });

  it('hydrates each array-of-object item as a reference', () => {
    const ctaRefs = fragment.references.filter((r) => r.fieldName === 'ctas');
    expect(ctaRefs).toHaveLength(2);
    expect(field(ctaRefs[0].fields!, 'label').values).toEqual(['Buy']);
    expect(field(ctaRefs[1].fields!, 'url').values).toEqual(['https://b']);
  });

  it('produces distinct stable ids for parent and children', () => {
    const ids = new Set([fragment.id, ...fragment.references.map((r) => r.id)]);
    expect(ids.size).toBe(1 + fragment.references.length);
  });

  it('keys fragment models by schema pointer so they match /cfm', () => {
    const ident = { org: 'org', site: 'site' };
    // root fragment -> root model
    expect(fragment.model.id).toBe(synthesizeModel(ident, 'coffee-promotion').id);
    // author reference -> /author model
    const author = fragment.references.find((r) => r.fieldName === 'author');
    expect(author!.model!.id).toBe(synthesizeModel(ident, 'coffee-promotion', '/author').id);
    // both cta items share the /ctas model (array items collapse to one model)
    const ctaRefs = fragment.references.filter((r) => r.fieldName === 'ctas');
    const ctasModelId = synthesizeModel(ident, 'coffee-promotion', '/ctas').id;
    expect(ctaRefs.map((r) => r.model!.id)).toEqual([ctasModelId, ctasModelId]);
  });
});

describe('convertScToCf — root array', () => {
  it('exposes root array elements via an items field', () => {
    const rootArraySchema = {
      type: 'array',
      title: 'Colors',
      items: { type: 'string', title: 'Color' },
    };
    const doc: Document = {
      metadata: { schemaName: 'colors' },
      data: ['red', 'green'],
    };
    const fragment = convert(doc, rootArraySchema);
    expect(field(fragment.fields, 'items')).toMatchObject({
      type: 'text', multiple: true, values: ['red', 'green'],
    });
  });
});

describe('convertScToCf — references modes', () => {
  // Two levels of nesting so depth (direct vs all) is observable.
  const nestedSchema = {
    type: 'object',
    title: 'Root',
    properties: {
      title: { type: 'string', title: 'Title' },
      author: {
        type: 'object',
        title: 'Author',
        properties: {
          name: { type: 'string', title: 'Name' },
          address: {
            type: 'object', title: 'Address', properties: { city: { type: 'string', title: 'City' } },
          },
        },
      },
    },
  };
  const nestedDoc: Document = {
    metadata: { schemaName: 'nested' },
    data: { title: 'T', author: { name: 'A', address: { city: 'NYC' } } },
  };

  function convertMode(mode?: Parameters<typeof convertScToCf>[0]['referencesMode']) {
    const engine = createEngine({ schema: nestedSchema, document: nestedDoc });
    const { model } = engine.getState();
    return convertScToCf({
      engine, model: model!, document: nestedDoc, identity, referencesMode: mode,
    }).fragment;
  }

  const author = (f: ReturnType<typeof convertMode>) => f.references.find((r) => r.fieldName === 'author');

  it('always keeps the content-fragment field, regardless of mode', () => {
    expect(field(convertMode('none').fields, 'author').type).toBe('content-fragment');
  });

  it('none → no references collected', () => {
    expect(convertMode('none').references).toEqual([]);
  });

  it('direct → direct child only, not hydrated (empty fields), no grandchildren', () => {
    const a = author(convertMode('direct'))!;
    expect(a.fields).toEqual([]);
    expect(a.references).toEqual([]);
  });

  it('direct-hydrated (default) → direct child hydrated, no grandchild references', () => {
    const a = author(convertMode())!;
    expect(a.fields!.map((x) => x.name)).toEqual(['name', 'address']);
    expect(a.references).toEqual([]);
  });

  it('all → recursive references, not hydrated', () => {
    const a = author(convertMode('all'))!;
    expect(a.fields).toEqual([]);
    const address = a.references!.find((r) => r.fieldName === 'address');
    expect(address).toBeDefined();
    expect(address!.fields).toEqual([]);
  });

  it('all-hydrated → recursive and hydrated', () => {
    const a = author(convertMode('all-hydrated'))!;
    const address = a.references!.find((r) => r.fieldName === 'address');
    expect(field(address!.fields!, 'city').values).toEqual(['NYC']);
  });
});

describe('convertScToCf — empty array typing (schema-driven)', () => {
  const sch = {
    type: 'object',
    title: 'Doc',
    properties: {
      events: {
        type: 'array',
        title: 'Events',
        items: {
          type: 'object', title: 'Event', properties: { label: { type: 'string', title: 'Label' } },
        },
      },
      scores: { type: 'array', title: 'Scores', items: { type: 'integer', title: 'Score' } },
    },
  };
  const docOf = (data: unknown): Document => ({ metadata: { schemaName: 'doc' }, data });

  it('types an EMPTY array-of-objects as content-fragment (not text), consistently', () => {
    const empty = field(convert(docOf({ events: [] }), sch).fields, 'events');
    const populated = field(convert(docOf({ events: [{ label: 'x' }] }), sch).fields, 'events');
    expect(empty).toMatchObject({ type: 'content-fragment', multiple: true, values: [] });
    expect(populated.type).toBe('content-fragment'); // same field, same type whether empty or not
  });

  it('types an empty array-of-objects field with no references', () => {
    expect(convert(docOf({ events: [] }), sch).references).toEqual([]);
  });

  it('types an empty primitive array by its element type, not text', () => {
    expect(field(convert(docOf({ scores: [] }), sch).fields, 'scores'))
      .toMatchObject({ type: 'number', multiple: true, values: [] });
  });
});
