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

/**
 * A hand-written subset of the AEM Content Fragment Management API schemas
 * (`getFragment` response), covering only the parts this converter emits.
 *
 * Source of truth: aem-sites-api-schema/content-fragments/author/openapi/schemas.
 */

/** Field data types we emit. Mirrors a subset of the CF `DataType` enum. */
export type DataType =
  | 'text'
  | 'long-text'
  | 'number'
  | 'float-number'
  | 'boolean'
  | 'date'
  | 'time'
  | 'date-time'
  | 'enumeration'
  | 'tag'
  | 'content-fragment'
  | 'content-reference'
  | 'json'
  | 'composite';

/**
 * A single content fragment field. `values` is always an array, even for
 * single-valued fields (`multiple: false` ⇒ a one-element array).
 */
export interface ContentFragmentField {
  name: string;
  type: DataType;
  multiple: boolean;
  values: unknown[];
}

/**
 * Authoring details. Every property is optional, so an empty object is a valid
 * value — which is what we emit, since SC carries no authoring data.
 */
export interface AuthoringInfo {
  at?: string;
  by?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
}

/** Lifecycle status of a content fragment. */
export type ContentFragmentStatus =
  | 'NEW'
  | 'DRAFT'
  | 'PUBLISHED'
  | 'MODIFIED'
  | 'UNPUBLISHED';

/** Minimal information about the content fragment model (the schema binding). */
export interface ContentFragmentModelIdentifier {
  id: string;
  path: string;
  name: string;
  title?: string;
  description?: string;
}

/** Type of a referenced resource. */
export type ReferenceType =
  | 'content-fragment'
  | 'experience-fragment'
  | 'asset'
  | 'page';

/** A content fragment variation. SC has no variations, so we never populate. */
export interface ContentFragmentVariation {
  name?: string;
  title: string;
  description?: string;
  fields: ContentFragmentField[];
  tags: unknown[];
  validationStatus: unknown[];
  // eslint-disable-next-line no-use-before-define -- circular type with ContentFragmentReference
  references: ContentFragmentReference[];
  fieldTags: unknown[];
}

/**
 * A reference entry on a fragment. When `type` is `content-fragment` and the
 * reference is hydrated, the child fragment's content is inlined via `fields`
 * (and optionally `references`, `variations`, `tags`).
 */
export interface ContentFragmentReference {
  type: ReferenceType;
  path: string;
  name?: string;
  fieldName?: string;
  title?: string;
  /** content-fragment, hydrated: */
  id?: string;
  model?: ContentFragmentModelIdentifier;
  description?: string;
  fields?: ContentFragmentField[];
  variations?: ContentFragmentVariation[];
  tags?: unknown[];
  references?: ContentFragmentReference[];
}

/**
 * The `getFragment` response object. All properties required by the CF schema
 * are present; optional authoring/preview fields are omitted.
 */
export interface ContentFragment {
  id: string;
  path: string;
  title: string;
  description?: string;
  model: ContentFragmentModelIdentifier;
  status: ContentFragmentStatus;
  created: AuthoringInfo;
  modified?: AuthoringInfo;
  published?: AuthoringInfo;
  fields: ContentFragmentField[];
  variations: ContentFragmentVariation[];
  references: ContentFragmentReference[];
  tags: unknown[];
  fieldTags: unknown[];
  validationStatus: unknown[];
}
