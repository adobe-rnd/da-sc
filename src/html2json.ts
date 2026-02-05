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
import { select, selectAll } from 'hast-util-select';
import { Element, Root } from 'hast';
import { toString } from 'hast-util-to-string';

const SELF_REF = 'self://#';

type BlockProperties = Record<string, unknown>;

export default class HTMLConverter {
  private htmlDocument: Root;

  private blocks: Element[];

  constructor(htmlDocument: Root) {
    this.htmlDocument = htmlDocument;
    this.blocks = selectAll('main > div > div', this.htmlDocument);
  }

  convertBlocksToJson() {
    const metadata = this.getMetadata();
    const data = this.findAndConvert(metadata.schemaName as string);
    return { metadata, data };
  }

  getJson() {
    const metadata = this.getMetadata();
    let json = {};
    if (metadata.storageFormat === 'code') {
      const code = select('pre > code', this.htmlDocument);
      if (code) {
        json = JSON.parse(toString(code));
      }
    } else {
      json = this.convertBlocksToJson();
    }

    return json;
  }

  getMetadata(): { schemaName: unknown } & BlockProperties {
    const baseMeta = this.findAndConvert('da-form' as string);
    const { 'x-schema-name': schemaName, 'x-storage-format': storageFormat, ...rest } = baseMeta as BlockProperties;
    return { schemaName, storageFormat, ...rest };
  }

  getProperties(block: Element): BlockProperties {
    return (block.children as Element[]).reduce((rdx: BlockProperties, row: Element) => {
      if (row.children) {
        // Get only element-tag children (exclude text/comments/etc)
        const elementChildren = selectAll(':scope > *', row);
        // Get the first two children as key and value columns
        const [keyCol, valCol] = elementChildren;
        const key = toString(keyCol).trim();
        const valColChild = valCol.children[0] as Element | undefined;
        const listElement = select('ul, ol', valCol);
        if (!valColChild) {
          rdx[key] = '';
        } else if (listElement) {
          // List element - convert to array
          rdx[key] = this.getArrayValues(key, selectAll('li', listElement));
        } else {
          // Simple value - get typed value from text content
          rdx[key] = this.getTypedValue(toString(valCol).trim());
        }
      }
      return rdx;
    }, {});
  }

  /**
   * Find and convert a block to its basic JSON data
   * @param {String} searchTerm the block name or variation
   * @param {Boolean} searchRef if the variation should be used for search
   * @returns {Object} the JSON Object representing pug
   */
  findAndConvert(searchTerm: string, searchRef: boolean = false): BlockProperties {
    return this.blocks.reduce((acc, block) => {
      // If we are looking for a reference,
      // use the variation, not the block name
      const idx = searchRef ? 1 : 0;
      if ((block.properties?.className as string[] | undefined)?.[idx] === searchTerm) {
        return this.getProperties(block);
      }
      return acc;
    }, {});
  }

  // We will always try to convert to a strong type.
  // The schema is responsible for knowing if it
  // is correct and converting back if necessary.
  getTypedValue(value: string): string | boolean | number | BlockProperties | null {
    // It it doesn't exist, resolve to empty
    if (!value) return '';

    // Attempt boolean
    const boolean = this.getBoolean(value);
    if (boolean !== null) return boolean;

    // Attempt reference
    const reference = this.getReference(value);
    if (reference !== null) return reference;

    // Attempt number
    const number = this.getNumber(value);
    if (number !== null) return number;

    return value;
  }

  getArrayValues(key: string, parent: Element[]): unknown[] {
    if (!parent.length) return [];
    // Return empty if first item is completely empty
    // For type safety, HTML will persist a ul with an empty li.
    if (parent.length === 1) {
      const firstChild = parent[0].children[0] as { value: string } | undefined;
      if (!firstChild?.value) return [];
    }
    return parent.map((listItem: Element) => {
      const firstChild = listItem.children[0] as { value: string } | undefined;
      const reference = this.getReference(firstChild!.value);
      return reference ?? firstChild!.value;
    });
  }

  getReference(text: string): BlockProperties | null {
    if (text.startsWith(SELF_REF)) {
      const refId = text.split(SELF_REF)[1].replaceAll('/', '-');
      const reference = this.findAndConvert(refId, true);
      if (reference) return reference;
    }
    return null;
  }

  getBoolean(text: string): boolean | null {
    if (text === 'true') return true;
    if (text === 'false') return false;
    return null;
  }

  getNumber(text: string): number | null {
    const num = Number(text);
    const isNum = Number.isFinite(num);
    if (!isNum) return null;
    return num;
  }
}
