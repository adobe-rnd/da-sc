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
import { synthesizeModel, type IdentitySource } from '../cf/identity.js';
import { navigateToModelNode } from './navigate.js';
import { mapModelField } from './field-def.js';
import type { ContentFragmentModel } from './types.js';

/**
 * Builds a single Content Fragment Model from an SC schema by reading the State
 * Engine's model (see ../../docs/fragment-api/mapping-spec.cfm.md). Only the addressed
 * object's own fields are emitted; nested objects become `content-fragment`
 * fields referencing child model ids (separate `/cfm` resources).
 */
export interface BuildModelOptions {
  engine: Engine;
  identity: Pick<IdentitySource, 'org' | 'site'>;
  schemaName: string;
  /** Model pointer addressing the object (`''` for the root). */
  pointer?: string;
}

/** Ensure an array child has a materialized item so its type can be read. */
function materializedArrayChild(engine: Engine, child: ModelNode): ModelNode {
  if (child.kind !== 'array' || (child.items?.length ?? 0) > 0) {
    return child;
  }
  return engine.addItem(child.pointer).model?.byPointer[child.pointer] ?? child;
}

/** Convert an SC schema (at a model pointer) into a Content Fragment Model. */
export function convertSchemaToCfm(options: BuildModelOptions): ContentFragmentModel {
  const {
    engine, identity, schemaName, pointer = '',
  } = options;

  const target = navigateToModelNode(engine, pointer);
  if (target.kind !== 'object') {
    throw new Error(`Model pointer "${pointer}" does not address an object model`);
  }

  const fields = (target.children ?? []).map((child) => {
    const node = materializedArrayChild(engine, child);
    return mapModelField(node, { identity, schemaName, parentPointer: pointer });
  });

  const { id, path, name } = synthesizeModel(identity, schemaName, pointer, target.label);
  return {
    id,
    path,
    name,
    created: {},
    locked: false,
    status: 'enabled',
    fields,
  };
}
