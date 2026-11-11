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
import { JSON_SCHEMA_ALLOWLIST, type JsonSchemaAllowlist } from './json-schema-allowlist.js';

type JsonSchemaEnv = {
  JSON_SCHEMA_GITHUB_CONTENTS_URL?: string;
  JSON_SCHEMA_GITHUB_REF?: string;
  JSON_SCHEMA_CACHE_MODE?: string;
  JSON_SCHEMA_CANONICAL_ORIGIN?: string;
  GITHUB_TOKEN?: string;
};

type JsonSchemaCacheMode = 'immutable' | 'bypass';

type JsonSchemaConfig = {
  contentsUrl: string;
  ref: string;
  token: string;
  cacheMode: JsonSchemaCacheMode;
  canonicalOrigin: string;
};

const DEFAULT_CONTENTS_URL = 'https://api.github.com/repos/adobe/da-sc-sdk/contents';
const DEFAULT_REF = 'main';
const DEFAULT_CACHE_MODE: JsonSchemaCacheMode = 'immutable';
// Placeholder until the production hostname is known; replacing it is a cutover step.
const DEFAULT_CANONICAL_ORIGIN = 'https://schemas.example.invalid';
const MAX_NAME_LENGTH = 64;
const GITHUB_TIMEOUT_MS = 10_000;
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const NEGATIVE_CACHE_CONTROL = 'public, max-age=60';

const SCHEMA_PATH = /^\/schemas\/shared\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\/v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.json$/;
const CONTENTS_URL = /^https:\/\/api\.github\.com\/repos\/[A-Za-z0-9-]+\/(?!\.+\/)[A-Za-z0-9._-]+\/contents$/;
const REF = /^[A-Za-z0-9._/-]+$/;

const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
};

/** Returns true for the reserved `/schemas` namespace (exact or `/schemas/` prefix). */
export function isJsonSchemaPath(pathname: string): boolean {
  return pathname === '/schemas' || pathname.startsWith('/schemas/');
}

/**
 * Returns the repository-relative schema path (e.g. `schemas/shared/image/v1.0.0.json`)
 * for a valid public schema pathname, otherwise `undefined`.
 */
export function parseSchemaPath(pathname: string): string | undefined {
  const match = SCHEMA_PATH.exec(pathname);
  if (!match || match[1].length > MAX_NAME_LENGTH) {
    return undefined;
  }
  return pathname.slice(1);
}

function isCacheMode(value: string): value is JsonSchemaCacheMode {
  return value === 'immutable' || value === 'bypass';
}

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value;
  } catch {
    return false;
  }
}

/** Returns the validated configuration, or \`undefined\` if any binding is invalid. */
function resolveConfig(env: JsonSchemaEnv): JsonSchemaConfig | undefined {
  const contentsUrl = env.JSON_SCHEMA_GITHUB_CONTENTS_URL ?? DEFAULT_CONTENTS_URL;
  const ref = env.JSON_SCHEMA_GITHUB_REF ?? DEFAULT_REF;
  const cacheMode = env.JSON_SCHEMA_CACHE_MODE ?? DEFAULT_CACHE_MODE;
  const canonicalOrigin = env.JSON_SCHEMA_CANONICAL_ORIGIN ?? DEFAULT_CANONICAL_ORIGIN;
  const token = env.GITHUB_TOKEN;
  if (
    !CONTENTS_URL.test(contentsUrl)
    || !REF.test(ref)
    || !isCacheMode(cacheMode)
    || !isOrigin(canonicalOrigin)
    || !token
  ) {
    return undefined;
  }
  return {
    contentsUrl, ref, token, cacheMode, canonicalOrigin,
  };
}

function textResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers },
  });
}

function notFound(cacheControl: string): Response {
  return textResponse(404, 'Not Found', { 'Cache-Control': cacheControl });
}

function serviceUnavailable(): Response {
  return textResponse(503, 'Service Unavailable', { 'Cache-Control': 'no-store' });
}

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns true if the body is a JSON object whose `$id` equals the canonical URL. */
function isValidSchemaBody(body: string, canonicalUrl: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  return isSchemaObject(parsed) && parsed.$id === canonicalUrl;
}

async function fetchSchema(schemaPath: string, config: JsonSchemaConfig): Promise<Response> {
  const upstreamUrl = `${config.contentsUrl}/${schemaPath}?ref=${encodeURIComponent(config.ref)}`;
  const bypass = config.cacheMode === 'bypass';
  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        Accept: 'application/vnd.github.raw',
        Authorization: `Bearer ${config.token}`,
        'User-Agent': 'da-sc',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    if (upstream.status === 404) {
      await upstream.body?.cancel();
      return notFound(bypass ? 'no-store' : NEGATIVE_CACHE_CONTROL);
    }
    if (upstream.status !== 200) {
      await upstream.body?.cancel();
      return serviceUnavailable();
    }
    const body = await upstream.text();
    if (!isValidSchemaBody(body, `${config.canonicalOrigin}/${schemaPath}`)) {
      return serviceUnavailable();
    }
    return new Response(body, {
      status: 200,
      headers: {
        ...BASE_HEADERS,
        'Content-Type': 'application/schema+json',
        'Cache-Control': bypass ? 'no-store' : IMMUTABLE_CACHE_CONTROL,
      },
    });
  } catch {
    return serviceUnavailable();
  }
}

/**
 * Internal cache key: request origin, a namespace derived from the effective
 * source and canonical origin, and the validated path. Never includes the
 * incoming query string or credentials.
 */
async function edgeCacheKey(
  request: Request,
  schemaPath: string,
  config: JsonSchemaConfig,
): Promise<Request> {
  const source = JSON.stringify([config.contentsUrl, config.ref, config.canonicalOrigin]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  const namespace = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return new Request(`${new URL(request.url).origin}/${namespace}/${schemaPath}`, { method: 'GET' });
}

async function fetchSchemaWithEdgeCache(
  request: Request,
  schemaPath: string,
  config: JsonSchemaConfig,
  executionCtx: ExecutionContext,
): Promise<Response> {
  const cache = caches.default;
  const key = await edgeCacheKey(request, schemaPath, config);
  try {
    const cached = await cache.match(key);
    if (cached) {
      return new Response(cached.body, cached);
    }
  } catch {
    // Treat cache failures as a miss.
  }

  const response = await fetchSchema(schemaPath, config);
  if (response.status === 200 || response.status === 404) {
    executionCtx.waitUntil(cache.put(key, response.clone()).catch(() => undefined));
  }
  return response;
}

async function respond(
  request: Request,
  env: JsonSchemaEnv,
  executionCtx: ExecutionContext,
  allowlist: JsonSchemaAllowlist,
): Promise<Response> {
  const schemaPath = parseSchemaPath(new URL(request.url).pathname);
  if (!schemaPath) {
    return notFound('no-store');
  }

  const config = resolveConfig(env);
  if (!config) {
    return serviceUnavailable();
  }

  if (!allowlist.includes(schemaPath)) {
    return notFound(config.cacheMode === 'bypass' ? 'no-store' : NEGATIVE_CACHE_CONTROL);
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...BASE_HEADERS,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (request.method !== 'GET') {
    return textResponse(405, 'Method Not Allowed', {
      Allow: 'GET, OPTIONS',
      'Cache-Control': 'no-store',
    });
  }

  if (config.cacheMode === 'bypass' || request.headers.has('Authorization')) {
    return fetchSchema(schemaPath, config);
  }
  return fetchSchemaWithEdgeCache(request, schemaPath, config, executionCtx);
}

export async function handleJsonSchemaRequest(
  request: Request,
  env: JsonSchemaEnv,
  executionCtx: ExecutionContext,
  allowlist: JsonSchemaAllowlist = JSON_SCHEMA_ALLOWLIST,
): Promise<Response> {
  const response = await respond(request, env, executionCtx, allowlist);
  if (request.headers.has('Authorization')) {
    response.headers.set('Cache-Control', 'private, no-store');
  }
  return response;
}
