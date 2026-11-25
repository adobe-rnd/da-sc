/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import type { ContentRoute } from './context.js';

const CDN_HEADERS = {
  akamai: { policy: 'Edge-Control', tags: ['Edge-Cache-Tag'] },
  fastly: { policy: 'Surrogate-Control', tags: ['Surrogate-Key'] },
  cloudflare: { policy: 'CDN-Cache-Control', tags: ['Cache-Tag', 'X-Cache-Tag'] },
  cloudfront: { policy: undefined, tags: ['X-Amz-Meta-Cache-Tag'] },
} as const;

type Cdn = keyof typeof CDN_HEADERS;

export type CacheEnv = {
  ENABLE_EDS_AUTH_CACHE_AND_PUSH_INVALIDATION?: boolean | string;
};

type EdsCacheRequest = {
  headers: Record<string, string>;
  cdn: Cdn | undefined;
  token: string | undefined;
  allowAuthenticatedCaching: boolean;
};

function getCdn(headers: Headers): Cdn | undefined {
  const explicit = headers.get('X-BYO-CDN-Type');
  if (explicit === 'akamai' || explicit === 'fastly' || explicit === 'cloudflare' || explicit === 'cloudfront') {
    return explicit;
  }
  const via = headers.get('Via') ?? '';
  const loop = headers.get('CDN-Loop') ?? '';
  if (/akamai/i.test(via)) return 'akamai';
  if (/varnish/i.test(via) || /fastly$/i.test(loop)) return 'fastly';
  if (/cloudflare/i.test(loop)) return 'cloudflare';
  if (/cloudfront/i.test(via)) return 'cloudfront';
  return undefined;
}

export function getEdsCacheRequest(
  incoming: Headers,
  token: string | undefined,
  env: CacheEnv,
): EdsCacheRequest {
  const cdn = getCdn(incoming);
  const host = incoming.get('X-Forwarded-Host');
  const enabled = env.ENABLE_EDS_AUTH_CACHE_AND_PUSH_INVALIDATION;
  // Wrangler vars can be booleans; .dev.vars values are strings.
  const allowAuthenticatedCaching = enabled === true || enabled === 'true';
  const pushRequested = /^(enabled|enable)$/.test(incoming.get('X-Push-Invalidation') ?? '');
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = token;
  if (host) headers['X-Forwarded-Host'] = host;
  if (cdn) headers['X-BYO-CDN-Type'] = cdn;
  if (allowAuthenticatedCaching && pushRequested) {
    headers['X-Push-Invalidation'] = 'enabled';
  }
  return {
    headers, cdn, token, allowAuthenticatedCaching,
  };
}

function withoutSharedMaxAge(policy: string): string {
  // A quoted directive value can contain commas; don't split those directives.
  const directives = policy.match(/(?:[^",]|"[^"]*")+/g) ?? [];
  const filtered = directives.filter((part) => !/^\s*s-maxage\s*(?:=|$)/i.test(part));
  return filtered.length === directives.length
    ? policy : filtered.map((part) => part.trim()).join(', ');
}

export function copyEdsCacheHeaders(
  upstream: Response,
  downstream: Headers,
  request: EdsCacheRequest,
): void {
  const { cdn, token, allowAuthenticatedCaching } = request;
  const fields = cdn && CDN_HEADERS[cdn];
  const copy = (name: string): void => {
    const value = upstream.headers.get(name);
    if (value !== null) downstream.set(name, value);
  };
  ['Vary', 'X-Error', 'X-Robots-Tag'].forEach(copy);
  if (fields) fields.tags.forEach(copy);

  const cacheableTokenStatus = upstream.status === 200 || upstream.status === 404;
  if (token && (!allowAuthenticatedCaching || !cacheableTokenStatus)) {
    downstream.set('Cache-Control', 'private, no-store');
    return;
  }

  const edsPolicy = upstream.headers.get('Cache-Control') ?? '';
  const policy = cdn === 'cloudfront' ? edsPolicy : withoutSharedMaxAge(edsPolicy);
  downstream.set('Cache-Control', policy || 'no-store');
  // Don't let a CDN override the no-store fallback when EDS sent no browser policy.
  if (policy && fields && fields.policy) copy(fields.policy);
}

export function mapEdsLocation(
  location: string,
  edsUrl: string,
  requestUrl: URL,
  route: ContentRoute,
): string {
  let destination: URL;
  try {
    destination = new URL(location, edsUrl);
  } catch {
    return location;
  }
  if (destination.origin !== new URL(edsUrl).origin) return location;
  const {
    tier, org, site, suffix,
  } = route;
  return `${requestUrl.origin}/${tier}/${org}/${site}${destination.pathname}${suffix}${destination.search}${destination.hash}`;
}
