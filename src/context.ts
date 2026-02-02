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

export type Ctx = {
  org: string;
  site: string;
  edsDomainUrl: string;
  contentPath: string;
};

function getTld(tier: string): string {
  if (tier === 'preview') return 'page';
  if (tier === 'review') return 'reviews';
  return 'live';
}

export function getCtx(url: string): Ctx {
  const urlObj = new URL(url);
  const [tier, org, site, ...rest] = urlObj.pathname
        .replace('.json', '')
        .slice(1)
        .split('/');
  const tld = getTld(tier);

  if (!org && !site) {
    throw new Error('Usage: /tld/org/site/path');
  }

  return {
    org,
    site,
    edsDomainUrl: `https://main--${site}--${org}.aem.${tld}`,
    contentPath: rest.join('/') || ''
  };
}
