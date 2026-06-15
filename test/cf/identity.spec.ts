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
import {
  decodeFragmentId,
  decodeModelId,
  decodeModelPath,
  modelPath,
  statusForTier,
  synthesizeId,
  synthesizeModel,
  synthesizePath,
  type IdentitySource,
} from '../../src/cf/identity';

const source: IdentitySource = {
  org: 'org',
  site: 'site',
  path: 'blog/post',
  tier: 'live',
};

describe('synthesizeId', () => {
  it('is deterministic for the same source and pointer', () => {
    expect(synthesizeId(source)).toBe(synthesizeId(source));
  });

  it('produces a base64url id that reverses to the fragment path', () => {
    const id = synthesizeId(source);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeFragmentId(id)).toEqual({ org: 'org', site: 'site', contentPath: 'blog/post' });
  });

  it('produces distinct ids for distinct pointers', () => {
    expect(synthesizeId(source, '/ctas/0')).not.toBe(synthesizeId(source, '/ctas/1'));
    expect(synthesizeId(source)).not.toBe(synthesizeId(source, '/ctas/0'));
  });

  it('produces distinct ids for distinct sources', () => {
    const other: IdentitySource = { ...source, site: 'other' };
    expect(synthesizeId(source)).not.toBe(synthesizeId(other));
  });
});

describe('synthesizePath', () => {
  it('builds the DA path from org, site and content path', () => {
    expect(synthesizePath(source)).toBe('/org/site/blog/post');
  });

  it('omits the content segment when path is empty', () => {
    expect(synthesizePath({ ...source, path: '' })).toBe('/org/site');
  });

  it('appends the pointer for child fragments', () => {
    expect(synthesizePath(source, '/ctas/0')).toBe('/org/site/blog/post/ctas/0');
  });
});

describe('synthesizeModel', () => {
  it('binds the root model to the schema name with the real DA schema path', () => {
    const model = synthesizeModel(source, 'coffee-promotion');
    expect(model.name).toBe('coffee-promotion');
    expect(model.path).toBe('/org/site/.da/forms/schemas/coffee-promotion');
    expect(model.id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('keys sub-models by the model pointer', () => {
    const cta = synthesizeModel(source, 'coffee-promotion', '/ctas');
    expect(cta.path).toBe('/org/site/.da/forms/schemas/coffee-promotion/ctas');
    expect(cta.name).toBe('ctas');
    expect(cta.id).toBe(synthesizeModel(source, 'coffee-promotion', '/ctas').id);
    expect(cta.id).not.toBe(synthesizeModel(source, 'coffee-promotion').id);
  });

  it('uses the provided name when given', () => {
    expect(synthesizeModel(source, 'coffee-promotion', '/ctas', 'CTA').name).toBe('CTA');
  });
});

describe('modelPath / decodeModelPath', () => {
  it('round-trips path and parts', () => {
    const path = modelPath(source, 'coffee-promotion', '/ctas/speaker');
    expect(path).toBe('/org/site/.da/forms/schemas/coffee-promotion/ctas/speaker');
    expect(decodeModelPath(path)).toEqual({
      org: 'org', site: 'site', schemaName: 'coffee-promotion', modelPointer: '/ctas/speaker',
    });
  });

  it('decodes a root model path with an empty pointer', () => {
    expect(decodeModelPath('/org/site/.da/forms/schemas/coffee-promotion')).toEqual({
      org: 'org', site: 'site', schemaName: 'coffee-promotion', modelPointer: '',
    });
  });

  it('throws on a non-model path', () => {
    expect(() => decodeModelPath('/org/site/blog/post')).toThrow('Not a model path');
  });

  it('decodes a base64url model id back to its parts', () => {
    const { id } = synthesizeModel(source, 'coffee-promotion', '/ctas');
    expect(decodeModelId(id)).toEqual({
      org: 'org', site: 'site', schemaName: 'coffee-promotion', modelPointer: '/ctas',
    });
  });
});

describe('decodeFragmentId', () => {
  const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  it('decodes a base64url fragment id (encoded path) into its parts', () => {
    const id = b64url(synthesizePath(source)); // /org/site/blog/post
    expect(decodeFragmentId(id)).toEqual({ org: 'org', site: 'site', contentPath: 'blog/post' });
  });

  it('round-trips a child fragment path', () => {
    const id = b64url(synthesizePath(source, '/ctas/0'));
    expect(decodeFragmentId(id)).toEqual({ org: 'org', site: 'site', contentPath: 'blog/post/ctas/0' });
  });
});

describe('statusForTier', () => {
  it('maps live to PUBLISHED and everything else to DRAFT', () => {
    expect(statusForTier('live')).toBe('PUBLISHED');
    expect(statusForTier('preview')).toBe('DRAFT');
    expect(statusForTier('review')).toBe('DRAFT');
  });
});
