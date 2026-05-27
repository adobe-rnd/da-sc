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
import { describe, expect, it } from 'vitest';
import { getCtx } from '../src/context';

describe('getCtx', () => {
  it('maps preview tier to .page domain', () => {
    const ctx = getCtx('https://worker.example/preview/org/site/path/to/doc');
    expect(ctx).toEqual({
      org: 'org',
      site: 'site',
      edsDomainUrl: 'https://main--site--org.aem.page',
      contentPath: 'path/to/doc',
    });
  });

  it('maps review tier to .reviews domain', () => {
    const ctx = getCtx('https://worker.example/review/org/site/path');
    expect(ctx.edsDomainUrl).toBe('https://main--site--org.aem.reviews');
  });

  it('defaults to .live for live and unknown tiers', () => {
    expect(getCtx('https://worker.example/live/org/site/path').edsDomainUrl).toBe('https://main--site--org.aem.live');
    expect(getCtx('https://worker.example/stage/org/site/path').edsDomainUrl).toBe('https://main--site--org.aem.live');
  });

  it('strips .json suffix from the content path', () => {
    const ctx = getCtx('https://worker.example/preview/org/site/blog/post.json');
    expect(ctx.contentPath).toBe('blog/post');
  });

  it('throws usage error when org and site are missing', () => {
    expect(() => getCtx('https://worker.example/preview')).toThrow('Usage: /tld/org/site/path');
  });
});
