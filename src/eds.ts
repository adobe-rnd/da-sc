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
import { convertHtmlToJson } from '@adobe/da-sc-sdk';
import {
  errorMessage, HEADER_NAMES, HTTP_STATUS, NOT_FOUND_ERROR,
} from './http.js';

const LIST_FETCH_CONCURRENCY = 5;

export type ListItem =
  | { path: string; json: unknown }
  | { path: string; error: string; status: number };

export function getEdsUrl(origin: string, path: string): string {
  return `${origin}/${path.startsWith('/') ? path.slice(1) : path}`;
}

export async function fetchEdsPage(url: string, tokenAuth?: string): Promise<Response> {
  return fetch(url, {
    cf: { scrapeShield: false },
    ...(tokenAuth ? { headers: { [HEADER_NAMES.AUTHORIZATION]: tokenAuth } } : {}),
  });
}

export async function convertEdsPage(response: Response) {
  return convertHtmlToJson({ html: await response.text() });
}

async function convertListItem(
  origin: string,
  path: string,
  tokenAuth?: string,
): Promise<ListItem> {
  let response: Response;
  try {
    response = await fetchEdsPage(getEdsUrl(origin, path), tokenAuth);
  } catch (error) {
    return { path, error: errorMessage(error), status: HTTP_STATUS.BAD_GATEWAY };
  }

  if (!response.ok) {
    try {
      return {
        path,
        error: response.status === HTTP_STATUS.NOT_FOUND ? NOT_FOUND_ERROR : await response.text(),
        status: response.status,
      };
    } catch (error) {
      return { path, error: `Failed to read EDS response: ${errorMessage(error)}`, status: HTTP_STATUS.BAD_GATEWAY };
    }
  }

  try {
    const conversion = await convertEdsPage(response);
    if ('error' in conversion) {
      return { path, error: `Failed to convert EDS HTML: ${conversion.error}`, status: HTTP_STATUS.INTERNAL_SERVER_ERROR };
    }
    return { path, json: conversion.json };
  } catch (error) {
    return { path, error: errorMessage(error), status: HTTP_STATUS.INTERNAL_SERVER_ERROR };
  }
}

export async function convertListItems(
  origin: string,
  paths: string[],
  tokenAuth: string | undefined,
  start = 0,
): Promise<ListItem[]> {
  const batch = await Promise.all(paths.slice(start, start + LIST_FETCH_CONCURRENCY)
    .map((path) => convertListItem(origin, path, tokenAuth)));
  if (start + LIST_FETCH_CONCURRENCY >= paths.length) return batch;
  const nextStart = start + LIST_FETCH_CONCURRENCY;
  const remaining = await convertListItems(origin, paths, tokenAuth, nextStart);
  return batch.concat(remaining);
}
