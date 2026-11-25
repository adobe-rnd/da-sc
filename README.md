# da-sc

A Cloudflare Worker that fetches Edge Delivery Services (EDS) HTML and converts it to structured JSON.

The conversion is handled by `@adobe/da-sc-sdk` (`convertHtmlToJson`), while this service focuses on request routing and EDS fetching.

## Request format

```
/{tier}/{org}/{site}/{path}
```

- `tier`: `preview`, `review` or `live`
- `org`: organization name
- `site`: site name
- `path`: content path on the EDS domain

## Shared JSON Schemas

The Worker also serves the shared JSON Schemas bundled in `@adobe/da-sc-sdk`:

```
/schemas/shared/{name}/v{major}.{minor}.{patch}.json
```

Each schema is served at the path of its `$id` (`https://headless.adobe.net/schemas/shared/...`),
looked up by name and version with the SDK's `getSharedSchema`. No external service is called.

| Request | Status | `Cache-Control` |
| --- | --- | --- |
| `GET` on a known schema path | `200`, `application/schema+json` | `public, max-age=31536000, immutable` |
| `OPTIONS` on any `/schemas` path | `204` (CORS preflight) | none |
| Malformed schema path, except `OPTIONS` | `404` | `no-store` |
| Well-formed schema path with no matching name/version, except `OPTIONS` | `404` | `public, max-age=60` |
| Other methods on a known schema path | `405` | `no-store` |

- Every response allows any origin (CORS) and carries `X-Content-Type-Options: nosniff` and a
  restrictive `Content-Security-Policy`.
- Responses to requests with an `Authorization` header are marked `private, no-store`.

### Adding a schema version

Schemas are defined and versioned in `@adobe/da-sc-sdk`. Published versions are immutable:
the SDK only adds versions and never changes or removes them. To publish a new version, release
the SDK and update the dependency in this repository.

## Commands

- `npm run dev` - start local development server
- `npm run build` - build worker assets
- `npm run test` - run tests
