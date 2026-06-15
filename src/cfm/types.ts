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
 * A hand-written subset of the AEM Content Fragment Model schemas (`getModel`
 * response), covering only the parts this converter emits.
 *
 * Source of truth: aem-sites-api-schema/.../openapi/schemas/models.
 */
import type { AuthoringInfo, DataType } from '../cf/types.js';

/** Lifecycle status of a content fragment model. */
export type ContentFragmentModelStatus = 'enabled' | 'disabled' | 'draft';

/** A key/value option of an enumeration field. */
export interface ModelEnumValue {
  key: string;
  value: string;
}

/**
 * A field definition within a model. Common props plus the type-specific extras
 * we emit (others from the full CF schema are omitted).
 */
export interface ContentFragmentModelField {
  name: string;
  label: string;
  description?: string;
  required: boolean;
  multiple: boolean;
  minItems?: number;
  maxItems?: number;
  type: DataType;
  /** text: maximum length. */
  maxLength?: number;
  /** number / float-number: bounds. */
  min?: number;
  max?: number;
  /** scalar: default value. */
  defaultValue?: unknown;
  /** enumeration: allowed key/value options. */
  values?: ModelEnumValue[];
  /** content-fragment: allowed referenced model ids (Base64URLId). */
  items?: string[];
}

/**
 * The `getModel` response object. All properties required by the CF schema are
 * present; optional authoring/replication/preview fields are omitted.
 */
export interface ContentFragmentModel {
  id: string;
  path: string;
  name: string;
  description?: string;
  created: AuthoringInfo;
  locked: boolean;
  status: ContentFragmentModelStatus;
  fields: ContentFragmentModelField[];
}
