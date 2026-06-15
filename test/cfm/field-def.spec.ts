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
import { createEngine, type ModelNode } from '@adobe/da-sc-sdk';
import { mapModelField, type FieldContext } from '../../src/cfm/field-def';
import { synthesizeModel } from '../../src/cf/identity';

const ctx: FieldContext = {
  identity: { org: 'org', site: 'site' },
  schemaName: 'coffee-promotion',
  parentPointer: '',
};

const schema = {
  type: 'object',
  title: 'Coffee Promotion',
  required: ['headline'],
  properties: {
    headline: { type: 'string', title: 'Headline', maxLength: 100 },
    price: { type: 'number', title: 'Price' },
    count: {
      type: 'integer', title: 'Count', minimum: 1, maximum: 9,
    },
    active: { type: 'boolean', title: 'Active' },
    size: { type: 'string', title: 'Size', enum: ['S', 'M', 'L'] },
    tags: { type: 'array', title: 'Tags', items: { type: 'string', title: 'Tag' } },
    author: {
      type: 'object', title: 'Author', properties: { name: { type: 'string', title: 'Name' } },
    },
    ctas: {
      type: 'array',
      title: 'CTAs',
      items: {
        type: 'object', title: 'CTA', properties: { label: { type: 'string', title: 'Label' } },
      },
    },
  },
};

// Build a fully-materialized model by giving every array one element.
const document = {
  metadata: { schemaName: 'coffee-promotion' },
  data: {
    headline: 'H', price: 1.5, count: 3, active: true, size: 'M', tags: ['t'], author: { name: 'A' }, ctas: [{ label: 'L' }],
  },
};

const { model } = createEngine({ schema, document }).getState();
const child = (key: string): ModelNode => model!.root.children!.find((c) => c.key === key)!;

describe('mapModelField', () => {
  it('maps scalars with validation', () => {
    expect(mapModelField(child('headline'), ctx)).toMatchObject({
      name: 'headline', type: 'text', required: true, multiple: false, maxLength: 100,
    });
    expect(mapModelField(child('price'), ctx)).toMatchObject({ type: 'float-number' });
    expect(mapModelField(child('count'), ctx)).toMatchObject({ type: 'number', min: 1, max: 9 });
    expect(mapModelField(child('active'), ctx)).toMatchObject({ type: 'boolean' });
  });

  it('maps an enum to enumeration with key/value options', () => {
    expect(mapModelField(child('size'), ctx)).toMatchObject({
      type: 'enumeration',
      values: [{ key: 'S', value: 'S' }, { key: 'M', value: 'M' }, { key: 'L', value: 'L' }],
    });
  });

  it('maps an array of primitives to a multiple scalar field', () => {
    expect(mapModelField(child('tags'), ctx)).toMatchObject({ type: 'text', multiple: true });
  });

  it('maps an object to a content-fragment field referencing the child model', () => {
    const field = mapModelField(child('author'), ctx);
    expect(field).toMatchObject({ type: 'content-fragment', multiple: false });
    expect(field.items).toEqual([synthesizeModel(ctx.identity, 'coffee-promotion', '/author').id]);
  });

  it('maps an array of objects to a multiple content-fragment field', () => {
    const field = mapModelField(child('ctas'), ctx);
    expect(field).toMatchObject({ type: 'content-fragment', multiple: true });
    expect(field.items).toEqual([synthesizeModel(ctx.identity, 'coffee-promotion', '/ctas').id]);
  });

  it('carries a scalar default value', () => {
    const sch = {
      type: 'object',
      title: 'D',
      properties: { motto: { type: 'string', title: 'Motto', default: 'hi' } },
    };
    const state = createEngine({ schema: sch, document: { metadata: { schemaName: 'd' }, data: {} } }).getState();
    const motto = state.model!.root.children!.find((c) => c.key === 'motto')!;
    expect(mapModelField(motto, ctx).defaultValue).toBe('hi');
  });
});
