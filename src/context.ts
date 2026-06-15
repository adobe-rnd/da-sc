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
import { decodeFragmentId, decodeModelId } from './cf/identity.js';

/** Output format: structured content (default), Content Fragment, or CF Model. */
export type Format = 'sc' | 'cf' | 'cfm';

export type Ctx = {
  org: string;
  site: string;
  edsDomainUrl: string;
  contentPath: string;
  tier: string;
  format: Format;
};

function getTld(tier: string): string {
  if (tier === 'preview') return 'page';
  if (tier === 'review') return 'reviews';
  return 'live';
}

export function getCtx(url: string): Ctx {
  const urlObj = new URL(url);
  let segments = urlObj.pathname
    .replace('.json', '')
    .slice(1)
    .split('/');

  // A leading `cf` or `cfm` segment selects the output format:
  // `/cf/{tier}/{org}/{site}/{path}` (Content Fragment) or
  // `/cfm/{tier}/{modelId}` (CF Model, addressed by the base64url model id).
  // Otherwise it is the SC route.
  let format: Format = 'sc';
  const [prefix] = segments;
  if (prefix === 'cf' || prefix === 'cfm') {
    format = prefix;
    segments = segments.slice(1);
  }

  // The CF Model route is addressed by the model id, which decodes to
  // org/site/schema/pointer. `contentPath` carries `{schemaName}{pointer}`.
  if (format === 'cfm') {
    const [tier, modelId] = segments;
    if (!modelId) {
      throw new Error('Usage: /cfm/tier/{modelId}');
    }
    const {
      org, site, schemaName, modelPointer,
    } = decodeModelId(modelId);
    return {
      org,
      site,
      edsDomainUrl: `https://main--${site}--${org}.aem.${getTld(tier)}`,
      contentPath: `${schemaName}${modelPointer}`,
      tier,
      format,
    };
  }

  // `/cf` id form: `/cf/{tier}/{fragmentId}` — exactly one segment after the
  // tier (a base64url-encoded fragment path). More than one segment is the
  // path form `/cf/{tier}/{org}/{site}/{path}` (temporary fallback).
  if (format === 'cf' && segments.length === 2) {
    const [tier, fragmentId] = segments;
    const { org, site, contentPath } = decodeFragmentId(fragmentId);
    return {
      org,
      site,
      edsDomainUrl: `https://main--${site}--${org}.aem.${getTld(tier)}`,
      contentPath,
      tier,
      format,
    };
  }

  const [tier, org, site, ...rest] = segments;
  const tld = getTld(tier);

  if (!org && !site) {
    throw new Error('Usage: /tld/org/site/path');
  }

  return {
    org,
    site,
    edsDomainUrl: `https://main--${site}--${org}.aem.${tld}`,
    contentPath: rest.join('/') || '',
    tier,
    format,
  };
}
