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
 * Loads the JSON Schema backing a Structured Content document so the converter
 * can map fields schema-driven (see ../../docs/fragment-api/mapping-spec-cf.md).
 *
 * Schemas are stored in DA at `/{org}/{site}/.da/forms/schemas/{name}.html` as a
 * fixed HTML shell wrapping the pretty-printed JSON in a `<pre><code>` block:
 *
 *   <body>...<main><div><pre><code>{{JSON}}</code></pre></div></main>...</body>
 */

const DA_SOURCE_BASE = 'https://admin.da.live/source';

/** Decode the HTML entities that can appear in escaped JSON text content. */
function unescapeHtml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#0*34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Extract and parse the JSON Schema from the DA schema HTML shell. Pure — no
 * fetch. Throws if the code block is missing or the JSON is invalid.
 */
export function extractSchemaFromHtml(html: string): unknown {
  const match = html.match(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/i);
  if (!match) {
    throw new Error('Schema code block not found in schema HTML');
  }
  const json = unescapeHtml(match[1]).trim();
  try {
    return JSON.parse(json);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse schema JSON: ${message}`);
  }
}

/** Source identifiers needed to locate a schema. */
export interface SchemaSource {
  org: string;
  site: string;
}

/** Options for {@link loadSchema}, mainly to allow injecting fetch in tests. */
export interface LoadSchemaOptions {
  /** Override the fetch implementation (defaults to global `fetch`). */
  fetchImpl?: typeof fetch;
  /** Optional `Authorization` header value to forward to the DA source API. */
  authorization?: string;
}

/** Build the DA source URL for a schema. */
export function schemaSourceUrl(source: SchemaSource, schemaName: string): string {
  return `${DA_SOURCE_BASE}/${source.org}/${source.site}/.da/forms/schemas/${schemaName}.html`;
}

/**
 * Fetch and parse the JSON Schema for `schemaName` from the DA source API.
 * Throws if the schema cannot be fetched or parsed.
 */
export async function loadSchema(
  source: SchemaSource,
  schemaName: string,
  options: LoadSchemaOptions = {},
): Promise<unknown> {
  const { fetchImpl = fetch, authorization } = options;
  const url = schemaSourceUrl(source, schemaName);
  const resp = await fetchImpl(url, {
    ...(authorization ? { headers: { Authorization: authorization } } : {}),
  });
  if (!resp.ok) {
    throw new Error(`Failed to load schema "${schemaName}": ${resp.status}`);
  }
  return extractSchemaFromHtml(await resp.text());
}
