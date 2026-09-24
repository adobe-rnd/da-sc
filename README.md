# da-sc

A Cloudflare Worker that fetches Edge Delivery Services (EDS) HTML and converts it to structured JSON.

The conversion is handled by `@adobe/da-sc-sdk` (`convertHtmlToJson`), while this service focuses on request routing and EDS fetching.

## API reference

See the [API reference](docs/api.md) for parameters, response shapes, errors, and examples.

## Commands

- `npm run dev` - start local development server
- `npm run build` - build worker assets
- `npm run test` - run tests
