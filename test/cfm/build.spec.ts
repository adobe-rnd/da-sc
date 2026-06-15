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
import { createEngine } from '@adobe/da-sc-sdk';
import { convertSchemaToCfm } from '../../src/cfm/build';
import { synthesizeModel } from '../../src/cf/identity';
import type { ContentFragmentModelField } from '../../src/cfm/types';

const identity = { org: 'org', site: 'site' };
const schemaName = 'coffee-promotion';

const schema = {
  type: 'object',
  title: 'Coffee Promotion',
  properties: {
    headline: { type: 'string', title: 'Headline' },
    tags: { type: 'array', title: 'Tags', items: { type: 'string', title: 'Tag' } },
    author: {
      type: 'object', title: 'Author', properties: { name: { type: 'string', title: 'Name' } },
    },
    ctas: {
      type: 'array',
      title: 'CTAs',
      items: {
        type: 'object',
        title: 'CTA',
        properties: {
          label: { type: 'string', title: 'Label' },
          speaker: {
            type: 'object', title: 'Speaker', properties: { fullName: { type: 'string', title: 'Full name' } },
          },
        },
      },
    },
  },
};

function build(pointer = '') {
  const engine = createEngine({ schema, document: { metadata: { schemaName }, data: {} } });
  return convertSchemaToCfm({
    engine, identity, schemaName, pointer,
  });
}

function field(fields: ContentFragmentModelField[], name: string): ContentFragmentModelField {
  const found = fields.find((f) => f.name === name);
  if (!found) throw new Error(`field ${name} not found`);
  return found;
}

describe('convertSchemaToCfm — root model', () => {
  const model = build();

  it('uses the shared model identity and required scaffolding', () => {
    expect(model.id).toBe(synthesizeModel(identity, schemaName).id);
    expect(model.path).toBe('/org/site/.da/forms/schemas/coffee-promotion');
    expect(model.created).toEqual({});
    expect(model.locked).toBe(false);
    expect(model.status).toBe('enabled');
  });

  it('maps scalars, primitive arrays, and object references', () => {
    expect(field(model.fields, 'headline')).toMatchObject({ type: 'text', multiple: false });
    expect(field(model.fields, 'tags')).toMatchObject({ type: 'text', multiple: true });
    expect(field(model.fields, 'author')).toMatchObject({
      type: 'content-fragment',
      multiple: false,
      items: [synthesizeModel(identity, schemaName, '/author').id],
    });
    expect(field(model.fields, 'ctas')).toMatchObject({
      type: 'content-fragment',
      multiple: true,
      items: [synthesizeModel(identity, schemaName, '/ctas').id],
    });
  });
});

describe('convertSchemaToCfm — sub-models', () => {
  it('builds the array-item model and matches the referenced child id', () => {
    const model = build('/ctas');
    expect(model.id).toBe(synthesizeModel(identity, schemaName, '/ctas').id);
    expect(model.path).toBe('/org/site/.da/forms/schemas/coffee-promotion/ctas');
    expect(field(model.fields, 'label')).toMatchObject({ type: 'text' });
    expect(field(model.fields, 'speaker')).toMatchObject({
      type: 'content-fragment',
      items: [synthesizeModel(identity, schemaName, '/ctas/speaker').id],
    });
    // the cta model's referenced child id is exactly what /cfm returns for it
    expect(field(model.fields, 'speaker').items).toEqual([build('/ctas/speaker').id]);
  });

  it('builds a nested-in-array object model', () => {
    const model = build('/ctas/speaker');
    expect(model.name).toBe('Speaker');
    expect(field(model.fields, 'fullName')).toMatchObject({ type: 'text' });
  });
});

describe('convertSchemaToCfm — recursion', () => {
  it('builds one level of a recursive schema without hanging', () => {
    const recursive = {
      $defs: {
        Node: {
          type: 'object',
          title: 'Node',
          properties: {
            name: { type: 'string', title: 'Name' },
            children: { type: 'array', title: 'Children', items: { $ref: '#/$defs/Node' } },
          },
        },
      },
      type: 'object',
      title: 'Tree',
      properties: { root: { $ref: '#/$defs/Node' } },
    };
    const engine = createEngine({ schema: recursive, document: { metadata: { schemaName: 'tree' }, data: {} } });
    const model = convertSchemaToCfm({
      engine, identity, schemaName: 'tree', pointer: '/root',
    });
    // The SDK itself cuts recursion (compiles the recursive item as
    // `unsupported`), so the field maps via the json fallback — bounded, no hang.
    expect(field(model.fields, 'name')).toMatchObject({ type: 'text' });
    expect(field(model.fields, 'children')).toMatchObject({ type: 'json', multiple: true });
  });
});
