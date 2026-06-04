# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

da-sc is a Cloudflare Worker that transforms Edge Delivery Services (EDS) HTML content into structured JSON. It fetches HTML from EDS domains and converts it using `@adobe/da-sc-sdk`.

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

### Request Flow

1. Worker receives request at `/{tier}/{org}/{site}/{path}`
   - `tier`: `preview` (.page), `review` (.reviews), or `live` (.live)
2. Context builds EDS URL: `https://main--{site}--{org}.aem.{tld}`
3. Fetches HTML from EDS domain
4. Uses `@adobe/da-sc-sdk` `convertHtmlToJson` to convert the HTML into structured JSON

### Key Dependencies

- **@adobe/da-sc-sdk** - DA Structured Content SDK used for HTML to JSON conversion

## Testing

Tests run in Cloudflare Workers environment via `@cloudflare/vitest-pool-workers`. Test files are in `test/` with `.spec.ts` extension.
