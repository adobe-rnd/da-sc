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
import type { ModelNode, NodeKind } from '@adobe/da-sc-sdk';
import type { ContentFragmentField, DataType } from './types.js';

/**
 * Maps a compiled SC {@link ModelNode} leaf to a Content Fragment field type.
 * See ../../docs/fragment-api/mapping-spec-cf.md for the table and model limitations
 * (the SDK does not expose `format`, so date/time/long-text are not derivable).
 */
const SCALAR_TYPE: Partial<Record<NodeKind, DataType>> = {
  string: 'text',
  integer: 'number',
  number: 'float-number',
  boolean: 'boolean',
};

/** Whether a node kind is a scalar leaf (not object/array). */
export function isScalarKind(kind: NodeKind): boolean {
  return kind === 'string' || kind === 'number' || kind === 'integer' || kind === 'boolean';
}

/** The CF data type for a scalar/leaf node. */
export function dataTypeForNode(node: ModelNode): DataType {
  if (Array.isArray(node.enumValues) && node.enumValues.length > 0) {
    return 'enumeration';
  }
  return SCALAR_TYPE[node.kind] ?? 'json';
}

/** Wrap a single value as a CF `values` array (empty for null/undefined). */
function toValues(value: unknown): unknown[] {
  return value === undefined || value === null ? [] : [value];
}

/** Map a scalar leaf node to a single-valued field. */
export function mapScalarField(node: ModelNode): ContentFragmentField {
  return {
    name: node.key,
    type: dataTypeForNode(node),
    multiple: false,
    values: toValues(node.value),
  };
}

/**
 * Map an array-of-primitives node to a `multiple` field. The element type comes
 * from the first item, or — for an empty array — from `itemNode` (a probed
 * representative item) so an empty array is typed correctly instead of defaulting
 * to `text`. Falls back to `text` only when no item node is available at all.
 */
export function mapPrimitiveArrayField(
  node: ModelNode,
  itemNode?: ModelNode,
): ContentFragmentField {
  const items = node.items ?? [];
  const typeSource = items[0] ?? itemNode;
  return {
    name: node.key,
    type: typeSource ? dataTypeForNode(typeSource) : 'text',
    multiple: true,
    values: items.map((item) => item.value),
  };
}
