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
import type { Engine, ModelNode } from '@adobe/da-sc-sdk';

/**
 * Navigate the State Engine's model to the node addressed by a model pointer,
 * driving `addItem` to materialize array item structure (see
 * ../../docs/fragment-api/mapping-spec.cfm.md §5). No custom schema parsing — the SDK
 * stays the source of truth.
 */

/** Max model-pointer depth — guards against recursive schemas looping. */
export const MAX_MODEL_DEPTH = 32;

/** Materialize and return the first item of an array node (adds one if empty). */
function materializeItem(engine: Engine, arrayPointer: string): ModelNode {
  let array = engine.getState().model?.byPointer[arrayPointer];
  if (!array || array.kind !== 'array') {
    throw new Error(`Expected an array at ${arrayPointer}`);
  }
  if (!array.items || array.items.length === 0) {
    array = engine.addItem(arrayPointer).model?.byPointer[arrayPointer];
  }
  const item = array?.items?.[0];
  if (!item) {
    throw new Error(`Could not materialize an item for ${arrayPointer}`);
  }
  return item;
}

/**
 * Return the `ModelNode` addressed by `modelPointer` (e.g. `''`, `/author`,
 * `/ctas`, `/ctas/speaker`). Array segments are unwrapped to their materialized
 * item node. Throws on an unknown segment or past {@link MAX_MODEL_DEPTH}.
 */
export function navigateToModelNode(engine: Engine, modelPointer = ''): ModelNode {
  const segments = modelPointer.split('/').filter(Boolean);
  if (segments.length > MAX_MODEL_DEPTH) {
    throw new Error(`Model pointer exceeds max depth (${MAX_MODEL_DEPTH}): ${modelPointer}`);
  }

  const root = engine.getState().model?.root;
  if (!root) {
    throw new Error('Schema produced no model');
  }

  let node: ModelNode = root;
  let depth = 0;
  for (const segment of segments) {
    depth += 1;
    if (depth > MAX_MODEL_DEPTH) {
      throw new Error(`Model navigation exceeded max depth (${MAX_MODEL_DEPTH})`);
    }
    if (node.kind !== 'object') {
      throw new Error(`Cannot descend into a ${node.kind} at "${segment}"`);
    }
    const child = (node.children ?? []).find((c) => c.key === segment);
    if (!child) {
      throw new Error(`Unknown model segment: "${segment}"`);
    }
    node = child.kind === 'array' ? materializeItem(engine, child.pointer) : child;
  }

  return node;
}
