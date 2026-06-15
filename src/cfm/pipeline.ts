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
import { createEngine } from '@adobe/da-sc-sdk';
import { loadSchema } from '../cf/schema-loader.js';
import type { IdentitySource } from '../cf/identity.js';
import { convertSchemaToCfm } from './build.js';
import type { ContentFragmentModel } from './types.js';

/**
 * Impure adapter: load the SC schema from DA, build a State Engine, and convert
 * the addressed object into a Content Fragment Model. The builder stays
 * SDK-driven; this is the only place that touches fetch.
 */
export interface ModelPipelineInput {
  identity: Pick<IdentitySource, 'org' | 'site'>;
  schemaName: string;
  /** Model pointer addressing the object (`''` for the root). */
  pointer?: string;
  /** Forwarded as `Authorization` to the DA source API when loading the schema. */
  authorization?: string;
  /** Override fetch (defaults to global `fetch`); used for testing. */
  fetchImpl?: typeof fetch;
}

export type ModelPipelineResult =
  | { model: ContentFragmentModel; error?: undefined }
  | { error: string; model?: undefined };

/** Convert an SC schema (at a model pointer) into a Content Fragment Model. */
export async function schemaToContentFragmentModel(
  input: ModelPipelineInput,
): Promise<ModelPipelineResult> {
  const { org, site } = input.identity;

  let schema: unknown;
  try {
    schema = await loadSchema({ org, site }, input.schemaName, {
      fetchImpl: input.fetchImpl,
      authorization: input.authorization,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const engine = createEngine({
    schema,
    document: { metadata: { schemaName: input.schemaName }, data: {} },
  });

  try {
    const model = convertSchemaToCfm({
      engine,
      identity: input.identity,
      schemaName: input.schemaName,
      pointer: input.pointer ?? '',
    });
    return { model };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
