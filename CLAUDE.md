# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

da-sc is a Cloudflare Worker that transforms Edge Delivery Services (EDS) HTML content into structured JSON. It fetches HTML from EDS domains and converts it using HAST (Hypertext Abstract Syntax Tree) utilities.

## Commands

```bash
npm run dev      # Start local development server (wrangler dev)
npm run build    # Build the worker (wrangler build)
npm run deploy   # Deploy to Cloudflare (wrangler deploy)
npm test         # Run tests (vitest run)
```

## Architecture

### Source Files

- **`src/index.ts`** - Cloudflare Worker entry point (fetch handler)
- **`src/context.ts`** - Parses request URL to extract org/site/path and constructs EDS domain URL
- **`src/html2json.ts`** - `HTMLConverter` class that converts HAST to JSON

### Request Flow

1. Worker receives request at `/{tier}/{org}/{site}/{path}`
   - `tier`: `preview` (.page), `review` (.reviews), or `live` (.live)
2. Context builds EDS URL: `https://main--{site}--{org}.aem.{tld}`
3. Fetches HTML from EDS domain
4. Parses HTML to HAST using unified/rehype-parse
5. `HTMLConverter` extracts metadata from `da-form` block and converts blocks to JSON

### Key Dependencies

- **unified/rehype-parse** - HTML parsing to HAST
- **hast-util-select** - CSS selector queries on HAST
- **hast-util-to-html/to-string** - HAST output utilities

## Testing

Tests run in Cloudflare Workers environment via `@cloudflare/vitest-pool-workers`. Test files are in `test/` with `.spec.ts` extension.
