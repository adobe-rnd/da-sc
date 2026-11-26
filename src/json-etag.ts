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

export async function getJsonEtag(bytes: BufferSource): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `W/"${hex}"`;
}

export function matchesJsonEtag(condition: string | null, etag: string): boolean {
  if (!condition) return false;
  if (condition.trim() === '*') return true;
  const opaqueTag = etag.slice(2);
  // Parse complete quoted tags, including those containing a comma.
  for (const [, tag] of condition.matchAll(/(?:^|,)[ \t]*(?:W\/)?("[!#-~\x80-\xff]*")[ \t]*(?=,|$)/g)) {
    if (tag === opaqueTag) return true;
  }
  return false;
}
