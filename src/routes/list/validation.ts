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

export class InvalidListError extends Error {}

export type ListPagination = {
  offset: number;
  limit: number;
};

export type IndexPage = {
  paths: string[];
  total: number;
};

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_CURSOR_LENGTH = 1024;
const CURSOR_VERSION = 1;
const MIN_CURSOR_OFFSET = 1;
const BASE64_GROUP_SIZE = 4;

export const EDS_INDEX_FILENAME = 'structured-content-index.json';

function parseInteger(value: string | null, name: string, defaultValue: number): number {
  if (value === null) return defaultValue;
  if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new InvalidListError(`${name} must be a nonnegative integer`);
  }
  return Number(value);
}

function validatePath(path: unknown): path is string {
  if (typeof path !== 'string' || !path || path.startsWith('//') || /[?#\\]/.test(path)) return false;

  const relativePath = path.startsWith('/') ? path.slice(1) : path;
  if (/^[a-z][a-z\d+.-]*:/i.test(relativePath)) return false;

  try {
    const decodedPath = decodeURIComponent(relativePath);
    return !decodedPath.startsWith('/')
      && !/[?#\\]/.test(decodedPath)
      && !decodedPath.split('/').some((segment) => segment === '.' || segment === '..');
  } catch {
    return false;
  }
}

function hasPath(value: unknown): value is { path: string } {
  return value !== null && typeof value === 'object' && 'path' in value && validatePath(value.path);
}

function cursorScope(url: string): string {
  return new URL(url).pathname.replace(/\/$/, '');
}

export function encodeCursor(offset: number, url: string): string {
  const value = JSON.stringify({ version: CURSOR_VERSION, offset, scope: cursorScope(url) });
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(cursor: string, url: string): number {
  if (!cursor || cursor.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new InvalidListError('cursor is invalid');
  }

  let value: unknown;
  try {
    const base64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
    value = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / BASE64_GROUP_SIZE) * BASE64_GROUP_SIZE, '=')));
  } catch {
    throw new InvalidListError('cursor is invalid');
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || !('version' in value) || value.version !== CURSOR_VERSION
    || !('offset' in value) || typeof value.offset !== 'number'
    || !Number.isSafeInteger(value.offset) || value.offset < MIN_CURSOR_OFFSET
    || !('scope' in value) || value.scope !== cursorScope(url)
    || Object.keys(value).length !== 3
    || encodeCursor(value.offset, url) !== cursor) {
    throw new InvalidListError('cursor is invalid or belongs to a different list');
  }
  return value.offset;
}

export function parseListPagination(url: string): ListPagination {
  const params = new URL(url).searchParams;
  for (const name of params.keys()) {
    if (!['offset', 'limit', 'cursor'].includes(name) || params.getAll(name).length !== 1) {
      throw new InvalidListError(`Unexpected or repeated query parameter: ${name}`);
    }
  }

  if (params.has('cursor') && params.has('offset')) {
    throw new InvalidListError('cursor and offset cannot be used together');
  }
  const offset = params.has('cursor')
    ? decodeCursor(params.get('cursor') ?? '', url)
    : parseInteger(params.get('offset'), 'offset', 0);
  const limit = parseInteger(params.get('limit'), 'limit', DEFAULT_LIMIT);
  if (limit < 1 || limit > MAX_LIMIT) {
    throw new InvalidListError(`limit must be between 1 and ${MAX_LIMIT}`);
  }

  return { offset, limit };
}

export function parseIndexPage(value: unknown, offset: number, limit: number): IndexPage {
  if (value === null || typeof value !== 'object' || !('total' in value) || !('data' in value)
    || typeof value.total !== 'number' || !Number.isSafeInteger(value.total) || value.total < 0
    || !Array.isArray(value.data) || !value.data.every(hasPath)) {
    throw new InvalidListError(`EDS ${EDS_INDEX_FILENAME} has an invalid format`);
  }

  const paths = value.data.map((entry: { path: string }) => entry.path);
  if (('offset' in value && value.offset === offset) && paths.length <= limit
    && (offset >= value.total ? paths.length === 0 : offset + paths.length <= value.total)) {
    if (paths.length === 0 && offset < value.total) {
      throw new InvalidListError('EDS index returned an empty page before its end');
    }
    return { paths, total: value.total };
  }

  if (paths.length === value.total && (!('offset' in value) || value.offset === 0)) {
    return { paths: paths.slice(offset, offset + limit), total: value.total };
  }

  throw new InvalidListError('EDS index did not return the requested page or a complete dump');
}
