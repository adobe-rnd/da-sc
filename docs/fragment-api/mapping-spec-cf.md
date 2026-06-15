# Structured Content → Content Fragment — Mapping Specification

A precise, self-contained reference for how a DA **Structured Content (SC)**
document is converted into the **AEM Content Fragment Management API**
`getFragment` shape. Written so an agent (or a developer) can reproduce the
conversion deterministically.

This document is **normative for the converter** in `src/cf/`. For a quick
overview see `summary.md`; for the model side see `mapping-spec.cfm.md`.

---

## 1. Scope and intent

- **Best effort, one direction:** SC → CF. We do not round-trip.
- **Single fragment per document**, with nested objects expanded into a
  hierarchy of child fragments (see §6).
- **Not carried over:** authoring identity/timestamps, variations, workflow.
  These are emitted as empty/placeholder values so the output still satisfies
  the CF schema's required fields.

---

## Deviations from the official OpenAPI contract (intentional)

The output is **structurally** a valid `ContentFragment`, but we knowingly
override these rules from the AEM Sites OpenAPI. A strict validator will flag
them; they are deliberate so the result is meaningful and addressable for DA
content. (Audited against `aem-sites-api-schema/content-fragments/author`.)

| # | CF field | Contract says | We emit | Why |
|---|----------|---------------|---------|-----|
| 1 | `id` (fragment **and** every reference `id`) | `format: uuid` (`UUID.yaml`) | `base64url(fragmentPath)` | Reversible — the id **is** the `/cf/{tier}/{id}` addressing key (round-trip). A UUID is one-way and we keep no stateful UUID→path index. |
| 2 | `path` | `AssetOrLaunchPath`: `^/content/(dam\|launches)(/.*)?$` | `/{org}/{site}/{contentPath}` | The real DA delivery path, not the AEM DAM convention. |
| 3 | `model.path` (`ContentFragmentModelIdentifier`) | `ContentFragmentModelPath`: `^/conf(/.*)?$` | `/{org}/{site}/.da/forms/schemas/{schemaName}{pointer}` | The real DA schema location (and it round-trips with `/cfm`). |
| 4 | `content-fragment` field `values[]` | `FragmentOrLaunchIdentifier`: a `/content/(dam\|launches)/…` path **or** a bare UUID | the child's DA path `/{org}/{site}/…` (neither) | Consistent with #2; the child's reversible `id` is still available on the matching `references[]` entry. |

**Best-effort (not contract violations, but not "real" data):**

- `created: {}` (empty), `variations: []`, no `modified`/`published`/`tags`/
  `fieldTags` content — SC carries no authoring or variations (see §1).
- `status` is **synthesized from the tier** (`live` → `PUBLISHED`, else `DRAFT`),
  not a real publication state.
- **Type fidelity:** the SC dialect exposes no `format`, so `date`/`time`/
  `long-text` aren't derivable → they map to `text` (see §8).

**What does conform:** field `name`/`type`/`multiple`/`values`-as-array and the
discriminated field types; `enumeration` detection; required scaffolding arrays;
and reference `path` (it uses the lenient `Path` pattern, which our paths satisfy).

---

## 2. Inputs and outputs

### Input A — SC delivery document

Produced by `@adobe/da-sc-sdk` `convertHtmlToJson`:

```jsonc
{
  "metadata": { "schemaName": "coffee-promotion", "title": "Coffee" },
  "data": { "...": "schema-shaped content tree" }
}
```

### Input B — SC JSON Schema

Loaded from DA and compiled. It drives field typing. See §8.

### Input C — Identity context

`/cf` accepts two addressing forms (both yield `{ org, site, path, tier }`):

- **By id** *(preferred)*: `/cf/{tier}/{fragmentId}` — `fragmentId` is the
  emitted `ContentFragment.id`, i.e. `base64url(fragmentPath)` (one segment,
  reversible → org/site/path).
- **By path** *(temporary fallback)*: `/cf/{tier}/{org}/{site}/{path}`.

> The emitted `id` **is** the addressing key — a true round-trip
> (`decodeFragmentId(id)` → path), the same scheme `/cfm` uses for model ids.
> **Contract note:** the OpenAPI types `ContentFragment.id` as `format: uuid`;
> we emit `base64url(path)` instead, a deliberate deviation (same trade-off as
> the real-DA paths) so ids are reversible and addressable.

### Output — Content Fragment

A `ContentFragment` object (the `getFragment` response shape). Top-level shape
in §4; field shape in §5.

---

## 3. Pipeline (how the inputs combine)

```
HTML  ──convertHtmlToJson──▶  { metadata, data }            (Input A)
schemaName ──loadSchema──▶    raw JSON Schema               (Input B)
(schema, document) ──createEngine().getState()──▶  model    (compiled ModelNode tree)
(model, document, identity) ──convertScToCf──▶  ContentFragment
```

The converter walks the **compiled `ModelNode` tree** (not the raw JSON),
because the model carries the resolved `kind`, `enumValues`, and `label` per
node. The tree root corresponds to `data`.

---

## 4. Top-level ContentFragment mapping

| CF property         | Value / source                                                        |
|---------------------|-----------------------------------------------------------------------|
| `id`                | `base64url(path)` (reversible) — see §7                                |
| `path`              | `/{org}/{site}/{contentPath}` — see §7                                |
| `title`             | `metadata.title` if a non-empty string, else the fragment `path`      |
| `model`             | synthesized model identifier — see §9                                 |
| `status`            | `tier === 'live' ? 'PUBLISHED' : 'DRAFT'`                             |
| `created`           | `{}` (empty AuthoringInfo — no authoring data in SC)                  |
| `fields`            | one entry per top-level `data` property — see §5, §6                  |
| `references`        | hydrated child fragments — see §6                                     |
| `variations`        | `[]` (SC has no variations)                                          |
| `tags`              | `[]`                                                                  |
| `fieldTags`         | `[]`                                                                  |
| `validationStatus`  | `[]`                                                                  |

All of `created`, `variations`, `tags`, `fieldTags`, `validationStatus` are
**required by the CF schema** but have no SC source, so they are emitted empty.

---

## 5. Field type mapping (leaf nodes)

Each field is `{ name, type, multiple, values }`. **`values` is always an
array.** A single value `v` becomes `[v]`; `null`/`undefined` becomes `[]`.

Decision order for a node's `type` (first match wins):

| Condition on the `ModelNode`                | CF `type`        |
|---------------------------------------------|------------------|
| `enumValues` present and non-empty          | `enumeration`    |
| `kind === 'string'`                         | `text`           |
| `kind === 'integer'`                        | `number`         |
| `kind === 'number'`                         | `float-number`   |
| `kind === 'boolean'`                        | `boolean`        |
| `kind === 'unsupported'` (fallback)         | `json`           |

`name` is the node's key (the `data` property name). `multiple` is `false` for
a scalar leaf.

### Arrays of primitives

An array whose items are scalars maps to **one** field:

- `type` = the type of the first item (per the table above); empty array → `text`.
- `multiple` = `true`.
- `values` = the array elements in order.

---

## 6. Nesting → child fragments + references

SC keeps nested objects inline; CF models them as **separate fragments** linked
by reference. The converter expands them as follows.

### Object-valued node

- The parent gets a field: `{ name, type: 'content-fragment', multiple: false,
  values: [childPath] }`.
- A **hydrated** `ContentFragmentReference` is appended to the nearest
  enclosing fragment's `references[]`.

### Array-of-objects node

- The parent gets: `{ name, type: 'content-fragment', multiple: true,
  values: [childPath0, childPath1, ...] }`.
- One hydrated reference per element is appended to `references[]`.

### Reference object shape

```jsonc
{
  "type": "content-fragment",
  "path": "<child path>",          // §7  (data pointer, with array indices)
  "id": "<child id>",              // §7  (base64url of child path)
  "fieldName": "<parent field name>",
  "title": "<node label from schema>",
  "model": { ...child sub-model... },  // §9 (keyed by SCHEMA pointer — see below)
  "fields": [ ...child fields... ],       // recursively mapped (§5, §6)
  "references": [ ...grandchildren... ],   // recursive
  "variations": [],
  "tags": []
}
```

### `references` modes (CF query parameter)

The `references` query param controls what `references[]` contains. The
content-fragment **field** (with its `values`) is always present; only the
`references[]` collection varies:

| mode | collected | depth | hydrated (`fields` populated) |
|---|---|---|---|
| `none` | — | — | — (`references[]` empty) |
| `direct` | direct children | 1 level | no (`fields: []`) |
| `direct-hydrated` *(default)* | direct children | 1 level | yes |
| `all` | all descendants | recursive | no (`fields: []`) |
| `all-hydrated` | all descendants | recursive | yes |

Non-hydrated references still satisfy the schema's required
`fields`/`variations`/`tags` by emitting empty arrays. An invalid value is a
`400`.

### Model identity per fragment (matches `/cfm`)

Each fragment's `model` is the **sub-model** for that object, so it resolves to
exactly the model the `/cfm` endpoint returns (you can fetch it to inspect the
schema). Crucially, two **different pointers** are at play:

- **id / path** use the **data pointer** — array indices included
  (`/ctas/0`, `/ctas/1`), so every fragment is distinct.
- **model** uses the **schema pointer** — array indices **collapsed**
  (`/ctas`), so all items of an array reference **one shared model**.

So `ctas/0` and `ctas/1` are distinct fragments that share the model
`…/.da/forms/schemas/{schemaName}/ctas`. See §9.

### Root array

If `data` itself is an array, the whole fragment exposes a single field named
`items` carrying the elements (primitive array per §5, or array-of-objects per
this section).

---

## 7. ID and path generation (deterministic)

**The id is a reversible encoding of the path; the path is a function of
identity + JSON pointer.**

### Path

```
path(pointer) = "/" + org + "/" + site
              + (contentPath ? "/" + contentPath : "")
              + pointer
```

- Root fragment: `pointer = ""` → `/{org}/{site}/{contentPath}`.
- Child fragment: `pointer` is the child's JSON pointer relative to `data`
  (the model's `/data` prefix is stripped). E.g. `/author`, `/ctas/0`.

### ID

```
id(pointer) = base64url( path(pointer) )      // URL-safe base64, no padding
```

> Reproduce in Node:
> ```js
> Buffer.from('/org/site/blog/post').toString('base64')
>   .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
> // => L29yZy9zaXRlL2Jsb2cvcG9zdA
> ```

**Reversible:** `decodeFragmentId(id)` base64url-decodes back to the path, so the
emitted `id` is also the `/cf/{tier}/{id}` addressing key (round-trip). Same path
⇒ same id; distinct paths (incl. distinct array indices) ⇒ distinct ids. Uses
only `btoa`/`atob` — no `uuid` dependency, workerd-safe. (Deviation from the
contract's `id: format uuid` — see §2.)

---

## 8. Schema loading and field typing

- `schemaName` comes from `metadata.schemaName`.
- The schema is fetched from the DA source API:
  `https://admin.da.live/source/{org}/{site}/.da/forms/schemas/{schemaName}.html`
  and extracted from the `<pre><code>…</code></pre>` block (HTML-unescaped,
  `JSON.parse`d).
- `createEngine({ schema, document }).getState().model` yields the `ModelNode`
  tree used for typing.

### Model limitations (affect §5)

The SDK's compiled model only retains validation keywords `minLength`,
`maxLength`, `minimum`, `maximum`, `pattern` — **no `format`**. Therefore:

- `date` / `time` / `date-time` are **not** detectable → strings map to `text`.
- `long-text` is **not** reliably distinguishable → strings map to `text`.
- Empty arrays carry no item node in the data-driven model. We recover the item
  type by materializing a throwaway probe item via the engine
  (`representativeItem`), so an **empty array-of-objects is still
  `content-fragment`** and an empty primitive array keeps its element type — the
  field type is consistent whether or not the array has data.

---

## 9. Model identifier generation

A fragment at **schema pointer** `P` (property names, array indices collapsed;
`''` for the root) gets:

```
model = {
  name: <schema node label>,
  path: "/" + org + "/" + site + "/.da/forms/schemas/" + schemaName + P,
  id:   base64url(model.path)        // URL-safe base64, no padding
}
```

- Root fragment → `P = ''` → `…/{schemaName}`.
- `author` object → `P = '/author'`.
- `ctas` array items → `P = '/ctas'` (shared by every item).

This is the **same identity scheme `/cfm` uses**, so a fragment's `model.path`
is exactly the path you GET from `/cfm/{tier}/{org}/{site}/{schemaName}{P}` to
inspect the model. See `mapping-spec.cfm.md`.

---

## 10. Worked example

### Input

Identity: `org=org`, `site=site`, `contentPath=blog/post`, `tier=live`.

```jsonc
// document
{
  "metadata": { "schemaName": "coffee-promotion", "title": "Coffee" },
  "data": {
    "headline": "Coffee Promotion",
    "price": 4.5,
    "count": 3,
    "active": true,
    "size": "M",                       // schema enum: ["S","M","L"]
    "tags": ["hot", "fresh"],
    "author": { "name": "Sarah", "email": "s@x.com" },
    "ctas": [
      { "label": "Buy",  "url": "https://a" },
      { "label": "More", "url": "https://b" }
    ]
  }
}
```

### Output (abridged)

```jsonc
{
  "id": "L29yZy9zaXRlL2Jsb2cvcG9zdA",          // base64url("/org/site/blog/post")
  "path": "/org/site/blog/post",
  "title": "Coffee",
  "status": "PUBLISHED",
  "created": {},
  "model": {
    "name": "coffee-promotion",
    "path": "/org/site/.da/forms/schemas/coffee-promotion",
    "id": "L29yZy9zaXRlLy5kYS9mb3Jtcy9zY2hlbWFzL2NvZmZlZS1wcm9tb3Rpb24"
  },
  "fields": [
    { "name": "headline", "type": "text",          "multiple": false, "values": ["Coffee Promotion"] },
    { "name": "price",    "type": "float-number",   "multiple": false, "values": [4.5] },
    { "name": "count",    "type": "number",         "multiple": false, "values": [3] },
    { "name": "active",   "type": "boolean",        "multiple": false, "values": [true] },
    { "name": "size",     "type": "enumeration",    "multiple": false, "values": ["M"] },
    { "name": "tags",     "type": "text",           "multiple": true,  "values": ["hot", "fresh"] },
    { "name": "author",   "type": "content-fragment","multiple": false,"values": ["/org/site/blog/post/author"] },
    { "name": "ctas",     "type": "content-fragment","multiple": true, "values": [
        "/org/site/blog/post/ctas/0", "/org/site/blog/post/ctas/1"
    ] }
  ],
  "references": [
    {
      "type": "content-fragment", "fieldName": "author", "title": "Author",
      "id": "L29yZy9zaXRlL2Jsb2cvcG9zdC9hdXRob3I",
      "path": "/org/site/blog/post/author",
      "fields": [
        { "name": "name",  "type": "text", "multiple": false, "values": ["Sarah"] },
        { "name": "email", "type": "text", "multiple": false, "values": ["s@x.com"] }
      ],
      "references": [], "variations": [], "tags": []
    },
    {
      "type": "content-fragment", "fieldName": "ctas", "title": "CTA",
      "id": "L29yZy9zaXRlL2Jsb2cvcG9zdC9jdGFzLzA",
      "path": "/org/site/blog/post/ctas/0",
      "fields": [
        { "name": "label", "type": "text", "multiple": false, "values": ["Buy"] },
        { "name": "url",   "type": "text", "multiple": false, "values": ["https://a"] }
      ],
      "references": [], "variations": [], "tags": []
    },
    {
      "type": "content-fragment", "fieldName": "ctas", "title": "CTA",
      "id": "L29yZy9zaXRlL2Jsb2cvcG9zdC9jdGFzLzE",
      "path": "/org/site/blog/post/ctas/1",
      "fields": [
        { "name": "label", "type": "text", "multiple": false, "values": ["More"] },
        { "name": "url",   "type": "text", "multiple": false, "values": ["https://b"] }
      ],
      "references": [], "variations": [], "tags": []
    }
  ],
  "variations": [], "tags": [], "fieldTags": [], "validationStatus": []
}
```

All ids above are reproducible: `base64url(<path>)`. (This output is
`references=direct-hydrated`, the default; here the children have no nested
objects, so `direct-hydrated` and `all-hydrated` coincide.)

---

## 11. Quick reference (cheat sheet)

```
ContentFragment.id    = base64url(path)   // reversible; == the /cf/{tier}/{id} key
ContentFragment.path  = /{org}/{site}/{contentPath}[/{dataPointer...}]   // indices kept
ContentFragment.model = { name: <node label>,
                          path: /{org}/{site}/.da/forms/schemas/{schemaName}{schemaPointer},
                          id:   base64url(model.path) }   // schemaPointer: indices collapsed
status                = live → PUBLISHED ; else → DRAFT
// model.path == the /cfm path for that object — array items share one model

scalar field          = { name, type, multiple:false, values:[v] | [] }
primitive array       = { name, type(item), multiple:true, values:[...] }
object                = content-fragment field (multiple:false) + 1 child ref
array of objects      = content-fragment field (multiple:true)  + N child refs

type:  enum→enumeration · string→text · integer→number ·
       number→float-number · boolean→boolean · unsupported→json
       (date/time/long-text NOT derivable — see §8)
```
