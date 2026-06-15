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
import type { ContentFragmentModelIdentifier, ContentFragmentStatus } from './types.js';

/** Inputs that identify the source document (from the request context). */
export interface IdentitySource {
  org: string;
  site: string;
  /** The content path within the site (may be empty). */
  path: string;
  /** Delivery tier: `preview` | `review` | `live`. */
  tier: string;
}

/** base64url-encode a string (no padding), for use as a Base64URLId. */
function base64url(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode a base64url (no padding) string. Inverse of {@link base64url}. */
function base64urlDecode(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  return atob(b64 + pad);
}

/**
 * The content fragment's DA path: `/{org}/{site}/{contentPath}`. Child fragments
 * append their JSON pointer to the root path.
 */
export function synthesizePath(source: IdentitySource, pointer = ''): string {
  const base = `/${source.org}/${source.site}`;
  const content = source.path ? `/${source.path}` : '';
  return `${base}${content}${pointer}`;
}

/**
 * Deterministic fragment id: `base64url` of the fragment path. Reversible (see
 * {@link decodeFragmentId}), so the emitted `id` is also the addressing key for
 * `/cf/{tier}/{id}` — the same scheme model ids use. Stable across runs; child
 * fragments get distinct ids from their distinct paths.
 */
export function synthesizeId(source: IdentitySource, pointer = ''): string {
  return base64url(synthesizePath(source, pointer));
}

/** Marks the schema location within a DA site path. */
const SCHEMA_SEGMENT = '/.da/forms/schemas/';

/**
 * The DA path of a model: `/{org}/{site}/.da/forms/schemas/{schemaName}` plus a
 * `modelPointer` addressing a sub-object model. The model pointer uses schema
 * property names with array indices collapsed (all items of an array share one
 * model), e.g. `''` (root), `/author`, `/ctas`, `/ctas/speaker`.
 */
export function modelPath(
  source: Pick<IdentitySource, 'org' | 'site'>,
  schemaName: string,
  modelPointer = '',
): string {
  return `/${source.org}/${source.site}${SCHEMA_SEGMENT}${schemaName}${modelPointer}`;
}

/** The parts addressed by a model path. Inverse of {@link modelPath}. */
export interface ModelPathParts {
  org: string;
  site: string;
  schemaName: string;
  modelPointer: string;
}

/** Parse a model path back into its parts. Inverse of {@link modelPath}. */
export function decodeModelPath(path: string): ModelPathParts {
  const at = path.indexOf(SCHEMA_SEGMENT);
  if (at === -1) {
    throw new Error(`Not a model path: ${path}`);
  }
  const [org, site] = path.slice(1, at).split('/');
  const [schemaName, ...rest] = path.slice(at + SCHEMA_SEGMENT.length).split('/');
  return {
    org,
    site,
    schemaName,
    modelPointer: rest.length ? `/${rest.join('/')}` : '',
  };
}

/** Parse a base64url model id into its parts (decode + {@link decodeModelPath}). */
export function decodeModelId(id: string): ModelPathParts {
  return decodeModelPath(base64urlDecode(id));
}

/** The parts addressed by a fragment path `/{org}/{site}/{contentPath}`. */
export interface FragmentPathParts {
  org: string;
  site: string;
  contentPath: string;
}

/**
 * Parse a base64url fragment id (an encoded fragment path) into its parts. Used
 * to address `/cf` by id; the emitted `ContentFragment.id` is still a UUID — this
 * id is a reversible path encoding, distinct from that UUID.
 */
export function decodeFragmentId(id: string): FragmentPathParts {
  const [org, site, ...rest] = base64urlDecode(id).replace(/^\//, '').split('/');
  return { org, site, contentPath: rest.join('/') };
}

/**
 * Synthesize the model identifier (schema binding). `id` and `path` are keyed by
 * the `modelPointer`, so a `/cf` fragment and the `/cfm` model for the same
 * object resolve to the same `id`/`path`. `name` defaults to the last pointer
 * segment (or `schemaName` for the root) and can be overridden with the node's
 * label.
 */
export function synthesizeModel(
  source: Pick<IdentitySource, 'org' | 'site'>,
  schemaName: string,
  modelPointer = '',
  name = '',
): ContentFragmentModelIdentifier {
  const path = modelPath(source, schemaName, modelPointer);
  const lastSegment = modelPointer ? modelPointer.split('/').pop() : '';
  return {
    id: base64url(path),
    path,
    name: name || lastSegment || schemaName,
  };
}

/** Map a delivery tier to a content fragment status (best effort). */
export function statusForTier(tier: string): ContentFragmentStatus {
  return tier === 'live' ? 'PUBLISHED' : 'DRAFT';
}
