import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import HTMLConverter from '../src/html2json';

function parseHtml(html: string) {
	return unified()
		.use(rehypeParse, { fragment: false })
		.parse(html);
}

const codeFormatHtml = `<!doctype html><html><head>
    <title>Da Form</title>
    <link rel="canonical" href="https://main--da-frescopa--aemsites.aem.page/forms/offer">
    <meta property="og:title" content="Da Form">
    <meta property="og:url" content="https://main--da-frescopa--aemsites.aem.page/forms/offer">
    <meta property="og:image" content="https://main--da-frescopa--aemsites.aem.page/default-meta-image.png?width=1200&#x26;format=pjpg&#x26;optimize=medium">
    <meta property="og:image:secure_url" content="https://main--da-frescopa--aemsites.aem.page/default-meta-image.png?width=1200&#x26;format=pjpg&#x26;optimize=medium">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Da Form">
    <meta name="twitter:image" content="https://main--da-frescopa--aemsites.aem.page/default-meta-image.png?width=1200&#x26;format=pjpg&#x26;optimize=medium">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">
  </head>
  <body>
    <header></header>
    <main>
      <div>
        <div class="da-form">
          <div>
            <div>x-schema-name</div>
            <div>offer</div>
          </div>
          <div>
            <div>x-storage-format</div>
            <div>code</div>
          </div>
        </div>
        <pre><code>{
  "headline": "Fall in love with coffee. Every single day. (preview)",
  "detail": "With a MyBarista subscription, you get hand-selected coffees delivered right to your door each month.",
  "cta": {
    "label": "LEARN MORE",
    "url": "/subscription"
  }
}
</code></pre>
      </div>
    </main>
    <footer></footer>
  </body></html>`;

describe('HTMLConverter', () => {
	describe('code storage format', () => {
		it('extracts JSON from pre>code block when storageFormat is "code"', () => {
			const converter = new HTMLConverter(parseHtml(codeFormatHtml));
			const json = converter.getJson();

			expect(json).toEqual({
				headline: 'Fall in love with coffee. Every single day. (preview)',
				detail: 'With a MyBarista subscription, you get hand-selected coffees delivered right to your door each month.',
				cta: {
					label: 'LEARN MORE',
					url: '/subscription',
				},
			});
		});

		it('detects metadata with schemaName and storageFormat', () => {
			const converter = new HTMLConverter(parseHtml(codeFormatHtml));
			const metadata = converter.getMetadata();

			expect(metadata.schemaName).toBe('offer');
			expect(metadata.storageFormat).toBe('code');
		});
	});
});
