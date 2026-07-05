# CMS-Driven UI Copy Catalog — Design

**Date:** 2026-07-05
**Status:** Approved (design) — ready for implementation planning
**Scope:** Make static UI text across the DEF CON run apps editable from Strapi without a deploy, via a single global copy catalog and a custom admin page. Multi-lingual-ready, not multi-lingual-built.

---

## Problem

Every app (`run.human`, `run.auth`, `run.gpx`, `run.bib`, `run.flash`) hardcodes its UI copy as inline JSX string literals. The header and profile menu are copy-pasted 4× and drift by hand. There is no i18n infrastructure, no shared component library, and no CMS-driven copy today. Changing a word — a nav label, a button, a bib instruction — requires a code change, rebuild, and deploy.

**Primary goal (ranked #1 by the owner):** edit copy live, without a deploy.

Secondary benefits: de-duplicate the shared header/menu *words* (not the React components), and keep a single source of truth for brand copy.

## Non-Goals (YAGNI)

- **No shared React component library.** Each app keeps its own header/profile-menu React; only the *words* unify (via shared keys). A component-level unification is a possible future phase, explicitly out of scope here.
- **No native Strapi i18n plugin.** We model our own `locale` column instead (see Multi-lingual).
- **No Strapi blocks for copy.** Rich needs use lightweight markdown in a string field. The existing `Route.description` blocks (domain data) are untouched.
- **No structured `menu` content type.** Code owns nav order/set; it looks up labels by key. This keeps us honestly inside "words only."
- **No `rest-cache` plugin, no GraphQL, no draft/publish** in v1.

## Core Mental Model

The UI reads copy through a **toolkit that calls the Strapi `ui-string` API and caches the result** in the Next.js Data Cache. The S3 copy export is the fallback default; a committed snapshot is an optional last-resort floor.

| Artifact | Written by | Role |
|---|---|---|
| **Strapi `ui-string` rows** | Admin edits (custom page) | Authoring **source of truth**; served via the REST API |
| **Next.js Data Cache (per app)** | Toolkit `fetch(..., { next: { tags: ['copy'], revalidate: N } })` | **Live read path** — Strapi is hit at most once per revalidate window per instance |
| **S3 copy export (`copy.json`)** | Regenerated on `ui-string` change (lifecycle hook) + manual/CI | **Fallback default** when Strapi is unreachable or a key is missing |
| **Committed `copy-snapshot.json`** *(optional)* | Export script | Last-resort build-time floor for no-network / both-down |

**Runtime lookup order:** Strapi API (cached) → S3 export → *(optional)* committed snapshot → (dev-only) the key itself.

**Propagation is eventual, by design (~15 min, no extra machinery).** An edit rides the topology that already exists: master → regional worker via Litestream (~5 min cadence), then worker → app via the Data Cache `revalidate: N` window (a few minutes). No webhook, no `revalidateTag` fan-out, no shared cache handler — time-based revalidation alone converges every Fargate task in every region. Per-instance caches are fine precisely because we accept eventual consistency. Editing a word never requires a git commit or deploy. The `tags: ['copy']` label is attached only so a manual/admin revalidation *could* be wired later; it is not part of v1's propagation path.

## Data Model

### Content type: `ui-string` (collection)

| field | type | constraints | notes |
|---|---|---|---|
| `key` | string | required | dotted namespace, e.g. `common.header.nav.maps`, `bib.hero.title` |
| `locale` | string | required, default `default` | `default` now; BCP-47 codes (`fr`, `es`, …) later |
| `value` | text (multiline) | | the copy; lightweight **markdown** + `{placeholder}` interpolation, rendered client-side |
| `namespace` | enum `[common, human, auth, gpx, bib, flash]` | required | filter/index for the admin grid + bundle segmentation |
| `notes` | text | optional | "where this shows" hint for future editors |

- **Composite identity `(key, locale)` is unique.** Strapi has no declarative composite-unique constraint, so it is enforced in the bulk-upsert controller and/or a `beforeCreate`/`beforeUpdate` lifecycle hook. A DB unique index on `(key, locale)` is added via migration as a backstop.
- **No draft/publish in v1** — save = live (CDN bundle rewrite is the propagation mechanism). A Publish gate can be added later if staging is needed.
- **`namespace` is denormalizable** from `key.split('.')[0]`, but kept as an explicit field for a fast admin filter and to segment the bundle.

### Key convention

`<namespace>.<area>.<element>` — e.g. `bib.hero.title`, `common.header.nav.maps`, `common.profileMenu.logout`.

`common.*` is the **shared-chrome namespace**. Header nav, profile menu, and footer copy live under `common.header.*` / `common.profileMenu.*` / `common.footer.*`. Every app reads the *same* `common.*` keys → the copy-pasted words unify **without** touching the per-app React components. Code still owns which items render and in what order; it merely resolves each label through `t()`.

## Copy Toolkit

A small toolkit (`loadCopy` + `t`) consumed by each app. Packaging (shared `packages/copy/` vs per-app `lib/copy.ts`) is an implementation decision for the plan; lean is per-app file to avoid introducing monorepo workspaces, accepting ~100 lines duplicated — matching the existing per-app `lib/strapi.ts` precedent.

**Contract:**

- `loadCopy(locale = 'default')` — server-side. Fetches the Strapi `ui-string` API (Bearer token) **through the Next.js Data Cache**: `fetch(url, { next: { tags: ['copy'], revalidate: N } })`, with a ~2.5s `AbortController` timeout. On any failure it falls back to the **S3 copy export**, then the optional committed snapshot; it returns a resolved map and never throws.
- Refresh is by the time-based `revalidate: N` window (Next.js Data Cache) — not by `Cache-Control` headers on the response. This deliberately replaces the gpx `no-store` + edge `s-maxage` approach for copy: the point is to actually leverage Strapi calls + a real server cache. (`tags: ['copy']` is attached for a possible future manual revalidation, but v1 relies solely on time-based revalidation.)
- `t(key, vars?)` → `cms[key] ?? s3[key] ?? snapshot[key] ?? key`, with `{var}` interpolation over `vars`. Markdown in the resolved value is rendered client-side (a tiny renderer for bold/links/line-breaks; reuse/adapt the gpx sanitizing helper).

**Resilience guarantee (the gpx philosophy):** the overlays/copy must never break because the CMS is down. The committed snapshot is always present in the binary as the floor.

### Client-side copy & JavaScript strings

Much of the target copy is **not** server-rendered JSX — it lives in client-side event handlers and `.ts` logic: toast messages, modal titles/bodies, validation errors, and dynamic labels like `"You sponsored {amount}"`. `t()` must therefore work in client components, not only during server render.

Pattern:

- Load copy **once server-side** (app layout / server component) via `loadCopy(locale)`.
- Pass the resolved map into a **`<CopyProvider>` React context**; expose a **`useCopy()`** hook returning `t`.
- Client modals / toasts / forms call `t('bib.sponsor.thanksToast', { amount })` from within handlers.
- The committed `copy-snapshot.json` is a plain JSON import, so it is available client-side as the floor. Client lookup = `context[key] ?? snapshot[key] ?? key`.
- Dynamic values (amounts, names, the Venmo handle currently scattered as `VENMO_HANDLE_DEFAULT`) ride the `{placeholder}` interpolation.

This makes the catalog cover the donate/sponsor modal copy — the primary motivating surface — not just static headings.

## S3 Copy Export (fallback default)

The S3 export is the toolkit's fallback when the Strapi call fails or a key is missing — **not** the primary read path.

- A **Strapi lifecycle hook** on `ui-string` (`afterCreate` / `afterUpdate` / `afterDelete`) regenerates the full catalog as `copy.json` and uploads it to the CMS S3 bucket via the existing `@strapi/provider-upload-aws-s3` path, served through CloudFront at `cms.<siteDomain>/…` (same infra as media). This keeps the fallback fresh; it does **not** drive live propagation (that is the `revalidate: N` window).
- Runs on the **master** node only (where admin edits occur); workers need no change. CloudFront serves the object globally.
- Bundle shape: keyed by `key`, values resolved per locale — e.g. `{ "<locale>": { "<key>": "<value>" } }`, or segmented by `namespace` if size warrants. Only `default` is populated in v1.
- Fetched by the toolkit only on the fallback path (short timeout).

## Committed Snapshot (`copy-snapshot.json`) — optional

- An export script (`npm run copy:snapshot`) fetches all `default` rows from the CMS and writes a committed JSON floor into each app (or one shared committed file).
- Triggered **manually or in CI** — never on CMS data change. Regenerate when you want to move the offline floor forward.
- Guarantees builds do not depend on CMS availability, and the UI never renders a raw key even with **both** Strapi and the S3 export unreachable. Drop it if the S3 export fallback is considered sufficient.

## Custom Admin Page (v1 core)

A Strapi **admin plugin** providing a fast, spreadsheet-style editor — the editing experience the owner actually wants, treated as first-class (not a fast-follow):

- A three-column `<Table>` (`label` · `locale` · `value`) built from `@strapi/design-system` components.
- Namespace filter dropdown, inline edit, add-row, bulk save.
- Backed by a **bulk-upsert controller** that enforces `(key, locale)` uniqueness.

Strapi's default content-manager already lists `ui-string` (key/locale/value) as a fallback editing path, but the custom page is the intended UX.

## Permissions & Deployment

- Extend the existing read-only API token (minted at bootstrap for `route`) to include `ui-string` find/findOne — mirrors `ensureApiTokenPublished()` in `apps/run.cms/app/src/index.ts`. This is the token the copy toolkit uses for its Strapi calls.
- The copy toolkit reads from the regional CMS worker (read replica), so edits propagate master → worker on the existing Litestream cadence — no new sync path.
- The lifecycle hook + S3 export upload run on the master node; SQLite + Litestream topology is unchanged.
- CORS/CSP already restrict origins; the S3 export is public-readable static JSON (copy is not secret).

## Rollout (one milestone, phased so the plane can land)

1. **Data + toolkit + fallback + proof surface.** `ui-string` type, `(key, locale)` enforcement, API-token permission, the copy toolkit (`loadCopy` Strapi-API fetch through the Next Data Cache with `revalidate: N` + `CopyProvider`/`useCopy` + `t`), the S3-export lifecycle hook + optional committed snapshot fallback, and wire the **bib donate/sponsor** surface end-to-end as proof — `bib.sponsor.*` / `bib.donate.*` across `SponsorForm`, `SponsorInstructions`, `GetYourBib`, payment/Venmo/CashApp instructions, and the sponsor/QR/logout modals. This is the primary motivating surface *and* the hardest case (client-side, interpolated, modal-heavy), so proving it validates the whole approach.
2. **Custom three-column admin plugin.**
3. **Incremental copy migration.** Remaining `bib` copy, then the shared chrome (`common.header.*` / `common.profileMenu.*` — the copy-paste de-dup win), then `flash`, `human`, `auth`, `gpx`.

## Open Implementation Details (resolve in planning)

- Client packaging: shared package vs per-app file (lean: per-app).
- `revalidate: N` window length (lean: ~300s, so worst-case propagation ≈ Litestream lag + N ≈ up to ~15 min — acceptable per the eventual-consistency decision).
- S3 export shape: single object vs namespace-segmented (size-dependent).
- Whether to keep the committed snapshot or rely on the S3 export as the sole fallback.
- Markdown renderer: adapt the existing gpx `blocksToHtml`/sanitizer or a minimal inline renderer.
