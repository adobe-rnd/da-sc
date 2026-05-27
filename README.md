# da-sc

A Cloudflare Worker that fetches Edge Delivery Services (EDS) HTML and converts it to structured JSON.

The conversion is handled by `da-sc-sdk` (`convertHtmlToJson`), while this service focuses on request routing and EDS fetching.

## Request format

```
/{tier}/{org}/{site}/{path}
```

- `tier`: `preview`, `review` or `live`
- `org`: organization name
- `site`: site name
- `path`: content path on the EDS domain

## Commands

- `npm run dev` - start local development server
- `npm run build` - build worker assets
- `npm run test` - run tests
