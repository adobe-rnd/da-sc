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
import type {
  Document, Engine, Model, ModelNode,
} from '@adobe/da-sc-sdk';
import type {
  ContentFragment,
  ContentFragmentField,
  ContentFragmentReference,
} from './types.js';
import {
  isScalarKind,
  mapPrimitiveArrayField,
  mapScalarField,
} from './field-mapping.js';
import {
  statusForTier,
  synthesizeId,
  synthesizeModel,
  synthesizePath,
  type IdentitySource,
} from './identity.js';

/**
 * Pure best-effort converter from SC delivery output to a Content Fragment
 * (`getFragment` shape). Nested objects/arrays-of-objects become separate,
 * hydrated child fragments referenced from `references[]`; see
 * ../../docs/fragment-api/mapping-spec-cf.md.
 */

/** Reference hydration depth (see CF `references` query param). */
export type ReferencesMode =
  | 'none'
  | 'direct'
  | 'direct-hydrated'
  | 'all'
  | 'all-hydrated';

export interface ConvertOptions {
  model: Model;
  document: Document;
  identity: IdentitySource;
  /**
   * The engine the model came from. Used to determine the item type of *empty*
   * arrays (which the data-driven model can't reveal) by materializing a probe
   * item — so an empty array-of-objects is still typed `content-fragment`, not
   * `text`. The `model` snapshot drives values/structure; the engine is only a
   * type oracle.
   */
  engine: Engine;
  /** Maps the CF `references` query param. Defaults to `direct-hydrated`. */
  referencesMode?: ReferencesMode;
}

/** Resolved reference behavior for a single walk level. */
interface RefBehavior {
  /** Collect references at this level into `references[]`. */
  collect: boolean;
  /** Collect references of collected children too (recursive depth). */
  recurse: boolean;
  /** Populate each reference's `fields` (hydrated) vs leave empty. */
  hydrate: boolean;
}

function behaviorFor(mode: ReferencesMode): RefBehavior {
  switch (mode) {
    case 'none':
      return { collect: false, recurse: false, hydrate: false };
    case 'direct':
      return { collect: true, recurse: false, hydrate: false };
    case 'all':
      return { collect: true, recurse: true, hydrate: false };
    case 'all-hydrated':
      return { collect: true, recurse: true, hydrate: true };
    case 'direct-hydrated':
    default:
      return { collect: true, recurse: false, hydrate: true };
  }
}

/** A field plus any child-fragment references it produced. */
interface ProcessedNode {
  field: ContentFragmentField;
  references: ContentFragmentReference[];
}

/** Strip the model's `/data` root prefix to get a document-relative pointer. */
function relPointer(node: ModelNode): string {
  return node.pointer.replace(/^\/data/, '');
}

/**
 * A representative item node for an array, used only to determine the item
 * *type*. For a populated array it's `items[0]`. For an *empty* array the
 * data-driven model has no item, so we materialize a throwaway one via the
 * engine (the `model` snapshot we walk is unaffected). Returns `null` if no
 * item can be obtained.
 */
function representativeItem(engine: Engine, arrayNode: ModelNode): ModelNode | null {
  if ((arrayNode.items?.length ?? 0) > 0) {
    return arrayNode.items![0];
  }
  const probed = engine.addItem(arrayNode.pointer).model?.byPointer[arrayNode.pointer];
  return probed?.items?.[0] ?? null;
}

/**
 * Walk an object node's children into fields plus child-fragment references.
 * `schemaPointer` is the model pointer of this object (indices collapsed); its
 * children's models are keyed beneath it so they match the `/cfm` model ids.
 */
function walkObject(
  engine: Engine,
  objectNode: ModelNode,
  identity: IdentitySource,
  schemaName: string,
  schemaPointer: string,
  behavior: RefBehavior,
): { fields: ContentFragmentField[]; references: ContentFragmentReference[] } {
  const fields: ContentFragmentField[] = [];
  const references: ContentFragmentReference[] = [];
  for (const child of objectNode.children ?? []) {
    // eslint-disable-next-line no-use-before-define -- mutual recursion with processNode
    const processed = processNode(engine, child, identity, schemaName, schemaPointer, behavior);
    fields.push(processed.field);
    references.push(...processed.references);
  }
  return { fields, references };
}

/**
 * Build a `content-fragment` reference for a nested object node. The fragment
 * `id`/`path` use the data pointer (with array indices); the `model` uses the
 * schema pointer (indices collapsed) so array items share one model. Per the
 * `references` behavior: `fields` are populated only when hydrating, and nested
 * `references` are collected only when recursing.
 */
function buildChildReference(
  engine: Engine,
  objectNode: ModelNode,
  identity: IdentitySource,
  fieldName: string,
  schemaName: string,
  schemaPointer: string,
  behavior: RefBehavior,
): ContentFragmentReference {
  const pointer = relPointer(objectNode);
  // Nested references are collected only when recursing (`all` / `all-hydrated`).
  const childBehavior: RefBehavior = { ...behavior, collect: behavior.recurse };
  const walked = walkObject(engine, objectNode, identity, schemaName, schemaPointer, childBehavior);
  return {
    type: 'content-fragment',
    path: synthesizePath(identity, pointer),
    id: synthesizeId(identity, pointer),
    fieldName,
    title: objectNode.label,
    model: synthesizeModel(identity, schemaName, schemaPointer, objectNode.label),
    fields: behavior.hydrate ? walked.fields : [],
    references: walked.references,
    variations: [],
    tags: [],
  };
}

/** Map a single named node to a field, spinning off child fragments as needed. */
function processNode(
  engine: Engine,
  node: ModelNode,
  identity: IdentitySource,
  schemaName: string,
  parentSchemaPointer: string,
  behavior: RefBehavior,
): ProcessedNode {
  const fieldName = node.key;
  const schemaPointer = `${parentSchemaPointer}/${fieldName}`;

  const childRef = (item: ModelNode): ContentFragmentReference => buildChildReference(
    engine,
    item,
    identity,
    fieldName,
    schemaName,
    schemaPointer,
    behavior,
  );

  if (node.kind === 'object') {
    const path = synthesizePath(identity, relPointer(node));
    return {
      field: {
        name: fieldName, type: 'content-fragment', multiple: false, values: [path],
      },
      references: behavior.collect ? [childRef(node)] : [],
    };
  }

  if (node.kind === 'array') {
    const items = node.items ?? [];
    // Item type comes from a representative item so an EMPTY array-of-objects is
    // still `content-fragment` (not mistyped `text`) and keeps a consistent type.
    const itemNode = representativeItem(engine, node);
    if (itemNode?.kind === 'object') {
      return {
        field: {
          name: fieldName,
          type: 'content-fragment',
          multiple: true,
          values: items.map((item) => synthesizePath(identity, relPointer(item))),
        },
        references: behavior.collect ? items.map(childRef) : [],
      };
    }
    return { field: mapPrimitiveArrayField(node, itemNode ?? undefined), references: [] };
  }

  // scalar leaf or unsupported
  return { field: mapScalarField(node), references: [] };
}

/** Convert SC delivery output to a Content Fragment. */
export function convertScToCf(options: ConvertOptions): { fragment: ContentFragment } {
  const {
    engine, model, document, identity,
  } = options;
  const { root } = model;
  const schemaName = String(document.metadata?.schemaName ?? '');
  const behavior = behaviorFor(options.referencesMode ?? 'direct-hydrated');

  let fields: ContentFragmentField[] = [];
  let references: ContentFragmentReference[] = [];

  if (root.kind === 'object') {
    ({ fields, references } = walkObject(engine, root, identity, schemaName, '', behavior));
  } else if (root.kind === 'array') {
    // Root array: expose a single `items` field carrying the elements.
    const processed = processNode(engine, { ...root, key: 'items' }, identity, schemaName, '', behavior);
    fields = [processed.field];
    references = processed.references;
  } else if (isScalarKind(root.kind)) {
    fields = [mapScalarField(root)];
  }

  const metadataTitle = (document.metadata as { title?: unknown })?.title;
  const title = typeof metadataTitle === 'string' && metadataTitle
    ? metadataTitle
    : synthesizePath(identity);

  const fragment: ContentFragment = {
    id: synthesizeId(identity),
    path: synthesizePath(identity),
    title,
    model: synthesizeModel(identity, schemaName, '', root.label),
    status: statusForTier(identity.tier),
    created: {},
    fields,
    variations: [],
    references,
    tags: [],
    fieldTags: [],
    validationStatus: [],
  };

  return { fragment };
}
