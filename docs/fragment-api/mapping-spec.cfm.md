# SC Schema → Content Fragment Model — Mapping Specification

A precise, self-contained reference for how a DA **Structured Content schema** is
converted into the **AEM Content Fragment Model** (`getModel`) shape. Companion
to `mapping-spec-cf.md` (the `/cf` fragment spec); the two share model identity
(§7) so a `/cf` fragment's `model.path` is exactly a `/cfm` path.

Normative for `src/cfm/`. For a quick overview see `summary.md`.

---

## 1. Scope and intent

- **Best effort, one direction:** SC schema → CF model.
- **One model per object.** A nested object (or array-of-object item type) is a
  **separate** model. `/cfm` returns a single model; nested objects appear as
  `content-fragment` fields that **reference** child models by id (not embedded).
- **Not emitted:** authoring info, `etag`, replication/preview status, tags,
  `extensionConfig`, UI hints beyond what the schema carries.

---

## Deviations from the official OpenAPI contract (intentional)

The output is **structurally** a valid `ContentFragmentModel`, but we knowingly
override these rules (shared with `/cf` — see `mapping-spec-cf.md`):

| # | Field | Contract says | We emit | Why |
|---|-------|---------------|---------|-----|
| 1 | `path` (and `content-fragment` field child model paths) | `ContentFragmentModelPath`: `^/conf(/.*)?$` | `/{org}/{site}/.da/forms/schemas/{schemaName}{modelPointer}` | The real DA schema location; round-trips with `/cf` model references. |

> Note: `model.id` and `content-fragment` field `items[]` **conform** to
> `Base64URLId` (they are base64url, no padding) — only the *decoded path* inside
> them deviates (per #1). So the id format is contract-valid; the path it encodes
> is the DA location.

**Best-effort (not contract violations, but not "real" data):**

- `created: {}` (empty) and `locked: false` — no authoring/lock data in SC.
- `status` is always **`enabled`** (not derived from a real model state).
- **Type fidelity:** no `format` in the SC dialect → `date`/`time`/`long-text`
  map to `text` (see §5 limitations); recursive `$ref` items the SDK marks
  `unsupported` map to `json`.

**What does conform:** field `name`/`label`/`type`, the discriminated field
types, `enumeration` `values:[{key,value}]`, `content-fragment` `items` as
`Base64URLId[]`, and the required scaffolding (`id`/`path`/`name`/`created`/
`locked`/`status`/`fields`).

---

## 2. Endpoint

```
GET /cfm/{tier}/{modelId}
```

- Addressed by the **base64url model id** (matches the real `getModel(id)`); the
  id decodes (§7) to `{org, site, schemaName, modelPointer}`. It is the same id a
  `/cf` fragment carries in `model.id`.
- `tier` is cosmetic (the schema is fetched from `admin.da.live` regardless).
- Decoded empty `modelPointer` → the root model; a sub-pointer → a nested model.

---

## 3. How the model is built: drive the State Engine

We do **not** parse the JSON Schema ourselves — the SDK stays the single source
of truth. We read its compiled `ModelNode` tree and materialize structure with
mutations:

1. `createEngine({ schema, document: { data: {} } })` — object nodes expose their
   `children` immediately (no data needed).
2. Navigate to the target node by `modelPointer`; for each **array** segment,
   call `engine.addItem(pointer)` and descend into the materialized `items[0]`
   (the item is the model).
3. For the target object, map each child node to a field (§5). For an **array**
   child, one `addItem` reveals whether its item is an object or a scalar.

Only **one level** is materialized per model (nested objects are separate
models), so the work is bounded. A **max-depth guard** (32) plus the SDK's own
recursion cut (recursive `$ref` items compile as `unsupported`) keep recursive
schemas safe.

---

## 4. Output: ContentFragmentModel

Required by the CF schema: `id, path, name, created, locked, status, fields`.

| Property   | Value / source                                             |
|------------|------------------------------------------------------------|
| `id`       | `base64url(path)` — §7                                      |
| `path`     | model path — §7                                            |
| `name`     | the target node's `label` (schema `title`)                 |
| `created`  | `{}` (empty AuthoringInfo — no authoring data)             |
| `locked`   | `false`                                                    |
| `status`   | `enabled`                                                  |
| `fields`   | one `ContentFragmentModelField` per child node — §5        |

---

## 5. Field-definition mapping (ModelNode → model field)

Common props read off the node: `name` = `key`, `label` = `label`, `required` =
`required`, `multiple` = is-array, `minItems`/`maxItems` (arrays), plus
type-specific extras from `validation`.

| Child node                          | field `type` + extras                                   |
|-------------------------------------|---------------------------------------------------------|
| `enumValues` present                | `enumeration`, `values: [{key,value}]` from `enumValues`|
| `kind: 'string'`                    | `text` (+ `maxLength`)                                  |
| `kind: 'integer'`                   | `number` (+ `min`/`max`)                                |
| `kind: 'number'`                    | `float-number` (+ `min`/`max`)                          |
| `kind: 'boolean'`                   | `boolean`                                               |
| `kind: 'unsupported'`               | `json`                                                  |
| `kind: 'object'`                    | `content-fragment`, `multiple:false`, `items:[childId]` |
| `kind: 'array'`, scalar item        | the item's scalar type, `multiple:true`                 |
| `kind: 'array'`, object item        | `content-fragment`, `multiple:true`, `items:[childId]`  |

`childId` = `base64url(childModelPath)`, child model pointer = parent pointer +
`/` + property key (§7). Scalar typing reuses `cf/field-mapping.ts`.

### Model limitations

Same as `/cf` (the SDK retains only `minLength/maxLength/minimum/maximum/pattern`
— no `format`): `date`/`time`/`long-text` are not derivable; strings → `text`.

---

## 6. Nesting → child-model references

- **Object property** → one `content-fragment` field, `multiple:false`,
  `items:[childModelId]`.
- **Array-of-objects property** → one `content-fragment` field, `multiple:true`,
  `items:[childModelId]` — a single child model id (all items share it).

The referenced child model is a **separate `/cfm` resource**; fetch it at its
pointer to get its fields.

---

## 7. Model identity (shared with `/cf`)

```
modelPath(P) = "/" + org + "/" + site + "/.da/forms/schemas/" + schemaName + P
modelId(P)   = base64url(modelPath(P))
```

`P` is the **model pointer**: schema property names with **array indices
collapsed** (`''`, `/author`, `/ctas`, `/ctas/speaker`). This is identical to the
scheme `/cf` uses for `fragment.model`, so:

> a `/cf` fragment's `model.path` == the `/cfm` path that returns that model.

Reversible: split `path` on `/.da/forms/schemas/` → `/{org}/{site}` on the left;
first segment on the right is `schemaName`, the rest is `P`.

---

## 8. Worked example

Schema `coffee-promotion` (org `org`, site `site`):

```jsonc
{
  "type": "object", "title": "Coffee Promotion",
  "properties": {
    "headline": { "type": "string", "title": "Headline" },
    "tags": { "type": "array", "title": "Tags", "items": { "type": "string", "title": "Tag" } },
    "author": { "type": "object", "title": "Author",
      "properties": { "name": { "type": "string", "title": "Name" } } },
    "ctas": { "type": "array", "title": "CTAs",
      "items": { "type": "object", "title": "CTA",
        "properties": {
          "label": { "type": "string", "title": "Label" },
          "speaker": { "type": "object", "title": "Speaker",
            "properties": { "fullName": { "type": "string", "title": "Full name" } } }
        } } }
  }
}
```

### `GET /cfm/live/L29yZy9zaXRlLy5kYS9mb3Jtcy9zY2hlbWFzL2NvZmZlZS1wcm9tb3Rpb24` (root model)
<!-- id decodes to /org/site/.da/forms/schemas/coffee-promotion -->

```jsonc
{
  "id": "L29yZy9zaXRlLy5kYS9mb3Jtcy9zY2hlbWFzL2NvZmZlZS1wcm9tb3Rpb24",
  "path": "/org/site/.da/forms/schemas/coffee-promotion",
  "name": "Coffee Promotion",
  "created": {}, "locked": false, "status": "enabled",
  "fields": [
    { "name": "headline", "label": "Headline", "type": "text",            "required": false, "multiple": false },
    { "name": "tags",     "label": "Tags",     "type": "text",            "required": false, "multiple": true  },
    { "name": "author",   "label": "Author",   "type": "content-fragment","required": false, "multiple": false,
      "items": ["L29yZy9zaXRlLy5kYS9mb3Jtcy9zY2hlbWFzL2NvZmZlZS1wcm9tb3Rpb24vYXV0aG9y"] },
    { "name": "ctas",     "label": "CTAs",     "type": "content-fragment","required": false, "multiple": true,
      "items": ["L29yZy9zaXRlLy5kYS9mb3Jtcy9zY2hlbWFzL2NvZmZlZS1wcm9tb3Rpb24vY3Rhcw"] }
  ]
}
```

### `GET /cfm/live/L29yZy9zaXRlLy5kYS9mb3Jtcy9zY2hlbWFzL2NvZmZlZS1wcm9tb3Rpb24vY3Rhcw` (CTA item model)
<!-- id decodes to /org/site/.da/forms/schemas/coffee-promotion/ctas -->

```jsonc
{
  "id": "L29yZy9zaXRlLy5kYS9mb3Jtcy9zY2hlbWFzL2NvZmZlZS1wcm9tb3Rpb24vY3Rhcw",
  "path": "/org/site/.da/forms/schemas/coffee-promotion/ctas",
  "name": "CTA",
  "created": {}, "locked": false, "status": "enabled",
  "fields": [
    { "name": "label",   "label": "Label",   "type": "text",             "required": false, "multiple": false },
    { "name": "speaker", "label": "Speaker", "type": "content-fragment",  "required": false, "multiple": false,
      "items": ["L29yZy9zaXRlLy5kYS9mb3Jtcy9zY2hlbWFzL2NvZmZlZS1wcm9tb3Rpb24vY3Rhcy9zcGVha2Vy"] }
  ]
}
```

The `ctas` field's `items` id above is exactly the `id` of this CTA model — and
it is the same model the `/cf` `ctas/0` and `ctas/1` fragments point to.

---

## 9. Quick reference (cheat sheet)

```
GET /cfm/{tier}/{modelId}            // modelId = base64url(model.path); decodes to org/site/schema/pointer

model.id    = base64url(model.path)
model.path  = /{org}/{site}/.da/forms/schemas/{schemaName}{modelPointer}
              modelPointer: property names, array indices COLLAPSED
model.name  = schema node title ; created {} ; locked false ; status enabled

field: { name, label, required, multiple, type, ...extras }
  scalar           → text | number | float-number | boolean | enumeration | json
  enum             → enumeration + values:[{key,value}]
  object           → content-fragment, multiple:false, items:[childModelId]
  array of scalar  → <scalar type>, multiple:true
  array of object  → content-fragment, multiple:true, items:[childModelId]

build = createEngine({schema, data:{}}) → navigate (addItem on arrays) → map children
limits: no format → no date/time/long-text ; depth guard 32 ; root-array unsupported
```
