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
      console.log('Detected type: code');
      const code = select('pre > code', this.htmlDocument);
      if (code) {
        json = JSON.parse(toString(code));
      }
    } else {
      console.log('Detected type: blocks');
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
        const elementChildren = (row.children as Element[]).filter((child) => child.type === 'element');
        const [keyCol, valCol] = elementChildren;
        const key = toString(keyCol).trim();
        // If there's absolutely no children in cell, return an empty string
        const valColChild = valCol.children[0] as Element | undefined;
        if (!valColChild) {
          rdx[key] = '';
        } else if (valColChild.children && (valColChild.children as Element[]).length === 1) {
          // Li
          const firstChild = valColChild.children[0] as Element;
          if ((firstChild.children as Element[])?.length) {
            rdx[key] = [this.getTypedValue((firstChild.children[0] as { value: string }).value)];
          } else {
            const isArr = firstChild.children;
            const value = this.getTypedValue((firstChild as unknown as { value: string }).value);
            rdx[key] = isArr ? [value] : value;
          }
        } else {
          //rdx[key] = this.getArrayValues(key, valColChild.children as Element[]);
          rdx[key] = toString(valColChild).trim();
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
    return parent.reduce((acc: unknown[], listItem: Element) => {
      // Only push non empty LIs
      if (listItem.children.length > 0) {
        const { value } = listItem.children[0] as { value: string };
        if (!value) {
          return acc;
        }
        const reference = this.getReference(value);
        acc.push(reference ?? value);
      }
      return acc;
    }, []);
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