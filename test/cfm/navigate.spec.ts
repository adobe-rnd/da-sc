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
import { createEngine } from '@adobe/da-sc-sdk';
import { MAX_MODEL_DEPTH, navigateToModelNode } from '../../src/cfm/navigate';

const schema = {
  type: 'object',
  title: 'Root',
  properties: {
    headline: { type: 'string', title: 'Headline' },
    author: {
      type: 'object',
      title: 'Author',
      properties: { name: { type: 'string', title: 'Name' } },
    },
    ctas: {
      type: 'array',
      title: 'CTAs',
      items: {
        type: 'object',
        title: 'CTA',
        properties: {
          label: { type: 'string', title: 'Label' },
          speaker: {
            type: 'object',
            title: 'Speaker',
            properties: { fullName: { type: 'string', title: 'Full name' } },
          },
        },
      },
    },
  },
};

function engineFor(s: unknown = schema) {
  return createEngine({ schema: s, document: { metadata: { schemaName: 'x' }, data: {} } });
}

describe('navigateToModelNode', () => {
  it('returns the root for an empty pointer', () => {
    expect(navigateToModelNode(engineFor()).label).toBe('Root');
  });

  it('descends into an object', () => {
    const node = navigateToModelNode(engineFor(), '/author');
    expect(node.kind).toBe('object');
    expect((node.children ?? []).map((c) => c.key)).toEqual(['name']);
  });

  it('unwraps an array of objects to its materialized item', () => {
    const node = navigateToModelNode(engineFor(), '/ctas');
    expect(node.kind).toBe('object');
    expect((node.children ?? []).map((c) => c.key)).toEqual(['label', 'speaker']);
  });

  it('descends through an array item into a nested object', () => {
    const node = navigateToModelNode(engineFor(), '/ctas/speaker');
    expect(node.kind).toBe('object');
    expect((node.children ?? []).map((c) => c.key)).toEqual(['fullName']);
  });

  it('throws on an unknown segment', () => {
    expect(() => navigateToModelNode(engineFor(), '/missing')).toThrow('Unknown model segment');
  });

  it('throws when descending into a non-object segment', () => {
    expect(() => navigateToModelNode(engineFor(), '/headline/nope')).toThrow('Cannot descend into a string');
  });

  it('throws when the schema produces no model', () => {
    const engine = createEngine({ schema: null, document: { metadata: { schemaName: 'x' }, data: {} } });
    expect(() => navigateToModelNode(engine)).toThrow('Schema produced no model');
  });

  it('guards against recursive schemas via a max-depth cap', () => {
    const recursive = {
      $defs: {
        Node: {
          type: 'object',
          title: 'Node',
          properties: {
            name: { type: 'string', title: 'Name' },
            children: { type: 'array', title: 'Children', items: { $ref: '#/$defs/Node' } },
          },
        },
      },
      type: 'object',
      title: 'Tree',
      properties: { root: { $ref: '#/$defs/Node' } },
    };
    const deep = `/root${'/children'.repeat(MAX_MODEL_DEPTH + 1)}`;
    expect(() => navigateToModelNode(engineFor(recursive), deep)).toThrow('max depth');
  });
});
