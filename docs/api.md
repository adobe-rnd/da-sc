# API reference

The worker supports read operations only. Both endpoints use `GET`, and clients do not supply a list of paths. The list endpoint accepts an optional path-prefix filter.

| Operation | Method | Path |
| --- | --- | --- |
| Read indexed pages | `GET` | `/{tier}/{org}/{site}` |
| Read one page | `GET` | `/{tier}/{org}/{site}/{path}` |

Create, update, and delete are not supported. `POST`, `PUT`, `PATCH`, and `DELETE` return HTTP 405.

## Common path parameters

| Name | Required | Description |
| --- | --- | --- |
| `tier` | Yes | `preview` (.page), `review` (.reviews), or `live` (.live). |
| `org` | Yes | Organization name. |
| `site` | Yes | Site name. |

## Authentication and preflight

An optional `Authorization` header using `token <secret>` is forwarded to EDS for both the index and individual pages. Successful authenticated responses include `Cache-Control: private, no-store`. Other authorization schemes are not forwarded. `OPTIONS` returns HTTP 204 for CORS preflight and allows `GET`, `Content-Type`, and `Authorization`.

## GET /{tier}/{org}/{site}/{path}

Fetches one EDS HTML page and returns its converted JSON. The `path` parameter identifies the page on the selected EDS site. A GET request for a page named `list` still reads that page. Omitting `path` now invokes the indexed list operation rather than reading the EDS site root.

| Status | Content type | Response |
| --- | --- | --- |
| `200` | `application/json` | Converted JSON object. |
| Upstream error status | `application/json` | `{"error":"..."}` with the upstream error or `404 Not Found`. |
| `500` | `text/plain` or `application/json` | Conversion error text or an unexpected worker error. |

## GET /{tier}/{org}/{site}

Fetches `structured-content-index.json` from the selected EDS site, then fetches and converts a page of indexed paths. The index uses the EDS JSON dump format with `total` and a `data` array of objects containing `path`. Clients do not send a request body or page paths.

Pagination follows the [AEM Content Fragment Delivery list convention](https://developer.adobe.com/experience-cloud/experience-manager-apis/api/stable/contentfragments/delivery/#operation/fragments/getFragments). Start without a cursor, then pass the returned opaque `cursor` on the next request. A response without `cursor` is the last page. Use a cursor only with the same tier, organization, site, and path filter. It represents a position in the current index, not a frozen snapshot if the index changes between requests.

The worker forwards the resolved offset and `limit` to the EDS index. If the index serves a complete dump without applying those parameters, the worker slices it locally. An incomplete or malformed index is reported as an error instead of producing an incorrect page.

When `path` is present, the worker scans index rows, matches the site-relative prefix, and paginates the matching collection. A leading slash is optional in the query and in index entries. The original indexed path is preserved in each item. Use a trailing slash when matching a directory to avoid similarly named siblings. Only the selected matching documents are fetched and converted. Without `path`, the existing unfiltered behavior is unchanged.

```json
{
  "total": 2,
  "offset": 0,
  "limit": 2,
  "data": [{"path": "/blog/one"}, {"path": "blog/two"}]
}
```

### Query parameters

| Name | Type | Default | Constraints |
| --- | --- | --- | --- |
| `cursor` | Opaque string | Omitted | Use the value from a previous list response. Cannot be combined with `offset`. |
| `limit` | Integer | `10` | Between 1 and 50. |
| `path` | Site-relative path prefix | Omitted | Filters indexed paths before pagination. Resend the same prefix with each cursor. |
| `offset` | Integer | `0` | Legacy numeric pagination. Zero or greater. Cannot be combined with `cursor`. |

### Responses

| Status | Content type | Response |
| --- | --- | --- |
| `200` | `application/json` | A page of successful conversions and per-path errors. |
| `400` | `application/json` | `{"error":"..."}` for invalid pagination, path prefix, or unsupported query parameters. |
| Upstream error status | `application/json` | `{"error":"..."}` when the EDS index cannot be retrieved. |
| `502` | `application/json` | `{"error":"..."}` when the index is invalid or cannot be read. |
| `500` | `application/json` | `{"error":"..."}` for an unexpected worker error. |

Each item contains its original `path` and either `json` or an `error` with a numeric `status`. Fetch and conversion failures are reported per item, so the list response remains HTTP 200.

| Response field | Description |
| --- | --- |
| `items` | Conversions and errors for the selected page. |
| `count` | Number of returned items, including errors. |
| `total` | Number of matching paths when filtered, otherwise the EDS index total. |
| `limit` | Requested page size. |
| `cursor` | Opaque string for the next page. Omitted when there are no more items. |
| `offset` | Starting index of this page, retained for legacy clients. |
| `nextOffset` | Next numeric offset or `null`, retained for legacy clients. |

```json
{
  "items": [
    {"path": "/blog/one", "json": {"metadata": {"schemaName": "article"}, "data": {"title": "One"}}},
    {"path": "blog/two", "error": "404 Not Found", "status": 404}
  ],
  "count": 2,
  "total": 2,
  "offset": 0,
  "limit": 10,
  "nextOffset": null
}
```

### Browse the next page

For a site with an index, start with a GET request without a cursor. The names below are illustrative.

```bash
curl 'http://127.0.0.1:8787/live/demo-org/demo-site?limit=2'
```

For an example index with four entries, the first page returns two items. These fields from its response include the cursor for the next page.

```json
{
  "count": 2,
  "total": 4,
  "cursor": "eyJ2ZXJzaW9uIjoxLCJvZmZzZXQiOjIsInNjb3BlIjoiL2xpdmUvZGVtby1vcmcvZGVtby1zaXRlIn0"
}
```

Pass the cursor back unchanged to browse the next two items.

```bash
curl 'http://127.0.0.1:8787/live/demo-org/demo-site?cursor=eyJ2ZXJzaW9uIjoxLCJvZmZzZXQiOjIsInNjb3BlIjoiL2xpdmUvZGVtby1vcmcvZGVtby1zaXRlIn0&limit=2'
```

That page contains the third and fourth indexed paths. Continue using each returned `cursor` until it is omitted.

To browse only demo card documents, include the encoded prefix in both requests.

```bash
curl 'http://127.0.0.1:8787/live/demo-org/demo-site?path=%2Fforms%2Fdemo%2Fcards%2F&limit=2'
curl 'http://127.0.0.1:8787/live/demo-org/demo-site?path=%2Fforms%2Fdemo%2Fcards%2F&cursor=<returned-cursor>&limit=2'
```

The second request uses the `cursor` from the first filtered response. Its `total`, `count`, and next cursor refer only to matching card paths. A prefix with no matches returns `items: []`, `count: 0`, and `total: 0` without a cursor. The numeric `offset` and `nextOffset` fields remain available for existing clients, but new clients should use `cursor`. Filtering by schema or title is not supported yet.
