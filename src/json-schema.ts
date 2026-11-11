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
};

type JsonSchemaSource = {
  contentsUrl: string;
  ref: string;
};

const DEFAULT_CONTENTS_URL = 'https://api.github.com/repos/adobe/da-sc-sdk/contents';
const DEFAULT_REF = 'main';
const MAX_NAME_LENGTH = 64;

const SCHEMA_PATH = /^\/schemas\/shared\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\/v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.json$/;
const CONTENTS_URL = /^https:\/\/api\.github\.com\/repos\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/contents$/;
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

function resolveSource(env: JsonSchemaEnv): JsonSchemaSource | undefined {
  const contentsUrl = env.JSON_SCHEMA_GITHUB_CONTENTS_URL ?? DEFAULT_CONTENTS_URL;
  const ref = env.JSON_SCHEMA_GITHUB_REF ?? DEFAULT_REF;
  if (!CONTENTS_URL.test(contentsUrl) || !REF.test(ref)) {
    return undefined;
  }
  return { contentsUrl, ref };
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

function notFound(cacheControl?: string): Response {
  return textResponse(404, 'Not Found', cacheControl ? { 'Cache-Control': cacheControl } : {});
}

function serviceUnavailable(): Response {
  return textResponse(503, 'Service Unavailable', { 'Cache-Control': 'no-store' });
}

async function respond(
  request: Request,
  env: JsonSchemaEnv,
  allowlist: JsonSchemaAllowlist,
): Promise<Response> {
  const schemaPath = parseSchemaPath(new URL(request.url).pathname);
  if (!schemaPath) {
    return notFound();
  }

  if (!resolveSource(env)) {
    return serviceUnavailable();
  }

  if (!allowlist.includes(schemaPath)) {
    return notFound('public, max-age=60');
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
    return textResponse(405, 'Method Not Allowed', { Allow: 'GET, OPTIONS' });
  }

  // Fetching from GitHub is not implemented yet.
  return serviceUnavailable();
}

export async function handleJsonSchemaRequest(
  request: Request,
  env: JsonSchemaEnv,
  _executionCtx: ExecutionContext,
  allowlist: JsonSchemaAllowlist = JSON_SCHEMA_ALLOWLIST,
): Promise<Response> {
  const response = await respond(request, env, allowlist);
  if (request.headers.has('Authorization')) {
    response.headers.set('Cache-Control', 'private, no-store');
  }
  return response;
}
