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
import type { ModelNode } from '@adobe/da-sc-sdk';
import {
  dataTypeForNode,
  isScalarKind,
  mapPrimitiveArrayField,
  mapScalarField,
} from '../../src/cf/field-mapping';

/** Build a minimal ModelNode for tests. */
function node(partial: Partial<ModelNode> & Pick<ModelNode, 'key' | 'kind'>): ModelNode {
  return {
    pointer: `/data/${partial.key}`,
    label: partial.key,
    required: false,
    readonly: false,
    validation: {},
    value: undefined,
    ...partial,
  } as ModelNode;
}

describe('isScalarKind', () => {
  it('recognises scalar kinds', () => {
    expect(isScalarKind('string')).toBe(true);
    expect(isScalarKind('integer')).toBe(true);
    expect(isScalarKind('number')).toBe(true);
    expect(isScalarKind('boolean')).toBe(true);
    expect(isScalarKind('object')).toBe(false);
    expect(isScalarKind('array')).toBe(false);
  });
});

describe('dataTypeForNode', () => {
  it('maps scalar kinds to CF types', () => {
    expect(dataTypeForNode(node({ key: 'a', kind: 'string' }))).toBe('text');
    expect(dataTypeForNode(node({ key: 'a', kind: 'integer' }))).toBe('number');
    expect(dataTypeForNode(node({ key: 'a', kind: 'number' }))).toBe('float-number');
    expect(dataTypeForNode(node({ key: 'a', kind: 'boolean' }))).toBe('boolean');
  });

  it('maps enum nodes to enumeration regardless of kind', () => {
    expect(dataTypeForNode(node({ key: 'a', kind: 'string', enumValues: ['x', 'y'] }))).toBe('enumeration');
  });

  it('falls back to json for unsupported kinds', () => {
    expect(dataTypeForNode(node({ key: 'a', kind: 'unsupported' }))).toBe('json');
  });
});

describe('mapScalarField', () => {
  it('wraps a value in a single-element array', () => {
    expect(mapScalarField(node({ key: 'headline', kind: 'string', value: 'Hello' }))).toEqual({
      name: 'headline',
      type: 'text',
      multiple: false,
      values: ['Hello'],
    });
  });

  it('keeps empty string as a value', () => {
    expect(mapScalarField(node({ key: 'empty', kind: 'string', value: '' })).values).toEqual(['']);
  });

  it('emits an empty values array for null/undefined', () => {
    expect(mapScalarField(node({ key: 'a', kind: 'string', value: null })).values).toEqual([]);
    expect(mapScalarField(node({ key: 'a', kind: 'string' })).values).toEqual([]);
  });
});

describe('mapPrimitiveArrayField', () => {
  it('maps an array of primitives to a multiple field', () => {
    const arr = node({
      key: 'list',
      kind: 'array',
      items: [
        node({ key: '0', kind: 'string', value: 'Test 1' }),
        node({ key: '1', kind: 'string', value: 'Test 2' }),
      ],
    });
    expect(mapPrimitiveArrayField(arr)).toEqual({
      name: 'list',
      type: 'text',
      multiple: true,
      values: ['Test 1', 'Test 2'],
    });
  });

  it('defaults an empty array to text', () => {
    expect(mapPrimitiveArrayField(node({ key: 'list', kind: 'array', items: [] }))).toEqual({
      name: 'list',
      type: 'text',
      multiple: true,
      values: [],
    });
  });
});
