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
import { convertHtmlToJson, createEngine } from '@adobe/da-sc-sdk';
import { convertScToCf, type ReferencesMode } from './convert.js';
import { loadSchema } from './schema-loader.js';
import type { ContentFragment } from './types.js';
import type { IdentitySource } from './identity.js';

/**
 * Impure adapter wiring the delivery HTML through to a Content Fragment:
 * `convertHtmlToJson` → `loadSchema` → `createEngine` → `convertScToCf`.
 * The core converter stays pure; this is the only place that touches fetch and
 * the SDK engine.
 */
export interface PipelineInput {
  /** The EDS wire-format HTML for the document. */
  html: string;
  identity: IdentitySource;
  /** Reference hydration mode (CF `references` param). Defaults to `direct-hydrated`. */
  referencesMode?: ReferencesMode;
  /** Forwarded as `Authorization` to the DA source API when loading the schema. */
  authorization?: string;
  /** Override fetch (defaults to global `fetch`); used for testing. */
  fetchImpl?: typeof fetch;
}

export type PipelineResult =
  | { fragment: ContentFragment; error?: undefined }
  | { error: string; fragment?: undefined };

/** Convert delivery HTML into a Content Fragment, or return a structured error. */
export async function htmlToContentFragment(input: PipelineInput): Promise<PipelineResult> {
  const conversion = convertHtmlToJson({ html: input.html });
  if ('error' in conversion) {
    return { error: conversion.error };
  }

  const { json } = conversion;
  const schemaName = json.metadata?.schemaName;
  if (!schemaName) {
    return { error: 'Converted document is missing metadata.schemaName' };
  }

  let schema: unknown;
  try {
    schema = await loadSchema(
      { org: input.identity.org, site: input.identity.site },
      schemaName,
      { fetchImpl: input.fetchImpl, authorization: input.authorization },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }

  const engine = createEngine({ schema, document: json });
  const { model } = engine.getState();
  if (!model) {
    return { error: `Could not build a model for schema "${schemaName}"` };
  }

  return convertScToCf({
    engine,
    model,
    document: json,
    identity: input.identity,
    referencesMode: input.referencesMode,
  });
}
