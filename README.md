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

## JSON Schemas

The Worker also serves shared JSON Schemas, read from GitHub:

```
/schemas/shared/{name}/v{major}.{minor}.{patch}.json
```

- `name`: lowercase kebab-case (`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`), at most 64 characters
- version: plain numbers without leading zeros or suffixes (`v1.10.2`, not `v01.0.0` or `v1.0.0-beta`)

The file is fetched from the same repository-relative path in the configured GitHub
repository (default: `adobe/da-sc-sdk`, branch `main`) and served unchanged with
`Content-Type: application/schema+json`.

### Rules for schema producers

- **Published versions are immutable.** Any change, including fixes, requires a new
  version and a new file. Never edit, reuse or delete a published version file.
  Clients and the edge cache keep a served version for up to a year.
- Each file must be a JSON object whose `$id` equals its public URL, for example
  `https://{canonical origin}/schemas/shared/image/v1.0.0.json`. Otherwise the
  Worker returns `503`.

### Publishing a new schema version

Only paths listed in [`src/json-schema-allowlist.ts`](src/json-schema-allowlist.ts) are
served; all other paths return `404` without contacting GitHub.

1. Add the file to the schema repository.
2. Add its repository-relative path (e.g. `schemas/shared/image/v1.1.0.json`) to the
   allowlist. Only add entries; never change or remove them.
3. Commit as `feat(schemas): …` so semantic-release creates a release and deploys it.

### Responses

| Situation | Status | `Cache-Control` |
| --- | --- | --- |
| Schema found | `200` | `public, max-age=31536000, immutable` |
| Malformed path, or method failure (`405`) | `404` / `405` | `no-store` |
| Path not on the allowlist, or missing in GitHub | `404` | `public, max-age=60` |
| Invalid configuration, GitHub error or timeout (10 s), invalid file | `503` | `no-store` |

- Supported methods: `GET` and `OPTIONS`; every response allows any origin (CORS).
- Successful responses and GitHub `404`s are stored in the Cloudflare edge cache.
- With cache mode `bypass`, nothing is cached and all responses use `no-store`.
- Requests with an `Authorization` header bypass the edge cache and get
  `private, no-store`. The header is never forwarded to GitHub.

### Configuration

| Binding | Default | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` (secret) | none, required | Read-only GitHub token for the schema repository |
| `JSON_SCHEMA_GITHUB_CONTENTS_URL` | `https://api.github.com/repos/adobe/da-sc-sdk/contents` | GitHub Contents API root |
| `JSON_SCHEMA_GITHUB_REF` | `main` | Branch, tag or commit |
| `JSON_SCHEMA_CACHE_MODE` | `immutable` | `immutable` or `bypass` (dev and CI) |
| `JSON_SCHEMA_CANONICAL_ORIGIN` | placeholder `https://schemas.example.invalid` | Origin expected in each schema's `$id` |

Unset bindings use the default; empty or invalid values return `503`. Production uses a
token of a dedicated service user; personal tokens are only for local development.
Set the production secret with `wrangler secret put GITHUB_TOKEN --env production`.

### Local development

Create an uncommitted `.dev.vars` file:

```
GITHUB_TOKEN=<read-only token for your test repository>
JSON_SCHEMA_GITHUB_CONTENTS_URL=https://api.github.com/repos/<owner>/da-test/contents
JSON_SCHEMA_GITHUB_REF=<branch>
JSON_SCHEMA_CANONICAL_ORIGIN=<origin used in your fixtures' $id values>
```

`wrangler.toml` sets `JSON_SCHEMA_CACHE_MODE=bypass` for dev and CI. To serve test
files, add their paths to the allowlist temporarily and do not commit them. Then run
`npm run dev`.

### Production cutover checklist

- Add the production custom-domain route to `wrangler.toml` (the edge cache is not
  effective on `workers.dev`).
- Replace the placeholder canonical origin in `src/json-schema.ts`.
- Provision the service-user `GITHUB_TOKEN` secret for production.
- Confirm schema names, paths and `$id` values in the schema repository, then
  populate and release the allowlist.
- After deployment, confirm that a repeated request is served from the edge cache.

## Commands

- `npm run dev` - start local development server
- `npm run build` - build worker assets
- `npm run test` - run tests
