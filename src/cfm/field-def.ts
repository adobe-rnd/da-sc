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
import type { ModelNode } from '@adobe/da-sc-sdk';
import { dataTypeForNode } from '../cf/field-mapping.js';
import { synthesizeModel, type IdentitySource } from '../cf/identity.js';
import type { ContentFragmentModelField, ModelEnumValue } from './types.js';

/**
 * Maps a child `ModelNode` to a Content Fragment Model field definition. Object
 * and array-of-object children become `content-fragment` fields referencing a
 * child model id (keyed by the schema pointer, shared with `/cf`). See
 * ../../docs/fragment-api/mapping-spec.cfm.md §5.
 *
 * Array nodes must already have their item materialized (`items[0]`), which the
 * builder does via the engine before calling this.
 */
export interface FieldContext {
  identity: Pick<IdentitySource, 'org' | 'site'>;
  schemaName: string;
  /** Model pointer of the parent object (`''` for root). */
  parentPointer: string;
}

function enumValuesOf(node: ModelNode): ModelEnumValue[] | undefined {
  if (!Array.isArray(node.enumValues) || node.enumValues.length === 0) {
    return undefined;
  }
  return node.enumValues.map((v) => ({ key: String(v), value: String(v) }));
}

export function mapModelField(node: ModelNode, ctx: FieldContext): ContentFragmentModelField {
  const multiple = node.kind === 'array';
  const valueNode = multiple ? node.items?.[0] : node;

  const field: ContentFragmentModelField = {
    name: node.key,
    label: node.label,
    required: !!node.required,
    multiple,
    type: 'text',
  };
  if (multiple && node.minItems !== undefined) {
    field.minItems = node.minItems;
  }
  if (multiple && node.maxItems !== undefined) {
    field.maxItems = node.maxItems;
  }

  // Object (or array-of-object) → reference a child model by id.
  if (valueNode?.kind === 'object') {
    field.type = 'content-fragment';
    const pointer = `${ctx.parentPointer}/${node.key}`;
    field.items = [synthesizeModel(ctx.identity, ctx.schemaName, pointer).id];
    return field;
  }

  // Scalar (or empty array — falls back to the array node's own kind).
  const scalar = valueNode ?? node;
  field.type = dataTypeForNode(scalar);
  const values = enumValuesOf(scalar);
  if (values) {
    field.values = values;
  }
  const validation = scalar.validation ?? {};
  if (typeof validation.maxLength === 'number') {
    field.maxLength = validation.maxLength;
  }
  if (typeof validation.minimum === 'number') {
    field.min = validation.minimum;
  }
  if (typeof validation.maximum === 'number') {
    field.max = validation.maximum;
  }
  if (scalar.defaultValue !== undefined) {
    field.defaultValue = scalar.defaultValue;
  }
  return field;
}
