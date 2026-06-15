# Fragment API — Summary

A quick, readable overview of how the **da-sc worker** turns DA **Structured
Content (SC)** into the **AEM Content Fragment** API shapes. For the exact,
normative rules see the two specs:

- [**mapping-spec-cf.md**](./mapping-spec-cf.md) — SC document → Content Fragment (`getFragment`)
- [**mapping-spec.cfm.md**](./mapping-spec.cfm.md) — SC schema → Content Fragment Model (`getModel`)

Worked example (real worker output) lives in `examples/` — see the end.

---

## The two endpoints

| Route | Returns | Built from |
|-------|---------|-----------|
| `/cf/{tier}/{id-or-path}` | a **Content Fragment** (content + values) | the SC document, typed by its schema |
| `/cfm/{tier}/{modelId}` | a **Content Fragment Model** (field definitions) | the SC schema alone |

Both are **best-effort**: authoring info, variations, and AEM-specific niceties
are intentionally dropped.

---

## How a document maps (`/cf`)

- The SC `data` object becomes a flat **`fields[]`** array. Every field is
  `{ name, type, multiple, values }` and **`values` is always an array**.
- **Nested objects become separate child fragments**, linked by a
  `content-fragment` field (values = child paths) and surfaced as hydrated
  entries in `references[]`. Arrays-of-objects → one child fragment per item.
- The `references` query param controls hydration depth:
  `none` · `direct` · `direct-hydrated` *(default)* · `all` · `all-hydrated`.

### Type mapping (SC → CF)

| SC | CF field `type` |
|----|------|
| string | `text` |
| string + `enum` | `enumeration` |
| integer | `number` |
| number | `float-number` |
| boolean | `boolean` |
| object / array-of-object | `content-fragment` (→ child fragment) |
| array of scalars | the scalar type + `multiple: true` |

> The SC dialect has no `format`, so `date`/`time`/`long-text` aren't derivable
> → they map to `text`. Item type for *empty* arrays is recovered from the
> schema (via the engine), so an empty array-of-objects stays `content-fragment`.

## How a schema maps (`/cfm`)

- Each object (and each array-of-object item type) is **its own model**.
- `getModel` returns a single model; nested objects appear as `content-fragment`
  fields whose `items: [childModelId]` reference child models by id (not embedded).
- Built by driving the SDK State Engine (no hand-rolled schema parsing).

---

## Identity (the contract that links `/cf` and `/cfm`)

```
fragment.id   = base64url(fragmentPath)        # reversible — also the /cf addressing key
fragment.path = /{org}/{site}/{contentPath}[/{dataPointer}]   # array indices kept
model.id      = base64url(modelPath)
model.path    = /{org}/{site}/.da/forms/schemas/{schemaName}{schemaPointer}
```

- **Fragment** id/path use the **data pointer** (with array indices) — every
  instance is distinct (`/sections/0`, `/sections/1`).
- **Model** id/path use the **schema pointer** (indices collapsed) — so all
  items of an array share **one** model (`/sections`).
- A `/cf` fragment's `model.id` is exactly the id `/cfm` returns for that object,
  so you can take any fragment's `model.id` and `GET /cfm/{tier}/{model.id}`.

> **Known deviations from the official OpenAPI** (accepted, by design):
> 1. fragment `id` is `base64url(path)`, not a UUID — so it's reversible/addressable;
> 2. fragment `path` is `/{org}/{site}/{contentPath}`, not `/content/dam/…`;
> 3. `model.path` is `/{org}/{site}/.da/forms/schemas/…`, not `/conf/…`;
> 4. `content-fragment` field `values` are DA paths, not `/content` paths or UUIDs.
>
> Plus best-effort omissions (empty `created`, no variations, synthesized
> `status`, `date`/`time`/`long-text` → `text`). Everything else conforms. Each
> spec has a full **"Deviations from the official OpenAPI contract"** section.

---

## Worked example — `examples/`

A travel-guide article ("48 Hours in Lisbon") exercising every SC type:

- `travel-guide.schema.json` — the schema (all types: text, enum, integer,
  number, boolean, arrays, nested objects via `$ref`, arrays-of-objects).
- `travel-guide.data.json` — the SC document (`{ metadata, data }`).
- `travel-guide.cf.json` — the actual `/cf` worker output for that document.

In that output you can see: enums → `enumeration`, integer → `number`,
number → `float-number`, `destination`/`author`/`sections`/`highlights` →
`content-fragment` with hydrated references, and array items (`sections/0..2`)
sharing one model id (`…/schemas/travel-guide/sections`).
