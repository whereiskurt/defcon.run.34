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

Three layers, cleanly separated by *purpose*:

| Artifact | Written by | Trigger | Role |
|---|---|---|---|
| **Strapi `ui-string` rows** | Admin edits (custom page) | Human | Authoring source of truth |
| **CDN `copy.json` bundle** | Strapi lifecycle hook | On any `ui-string` create/update/delete | **Live runtime source** — near-instant, no deploy |
| **Committed `copy-snapshot.json`** | Export script (`npm run copy:snapshot`) | Manual / CI | **Offline floor** baked into each app binary — UI never shows a raw key, never breaks if the CMS/CDN is down |

**Runtime lookup order:** `CDN copy.json` → committed `copy-snapshot.json` → (dev-only) the key itself.

Editing a word rewrites one static JSON on the CDN with **no git commit and no deploy** — this is what delivers "edit without a deploy." The committed snapshot is a git-tracked build-time floor and is *never* auto-regenerated on CMS change (that would reintroduce a deploy per edit).

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

## Runtime Client

A small client (`loadCopy` + `t`) consumed by each app. Packaging (shared `packages/copy/` vs per-app `lib/copy.ts`) is an implementation decision for the plan; lean is per-app file to avoid introducing monorepo workspaces, accepting ~100 lines duplicated — matching the existing per-app `lib/strapi.ts` precedent.

**Contract:**

- `loadCopy(locale = 'default')` — server-side. Fetches the **CDN `copy.json`** bundle (`cache: 'no-store'`, ~2.5s `AbortController` timeout). On any failure, returns `{}` and the app falls through to the committed snapshot. Never throws.
- The consuming Next.js route/page sets `Cache-Control: public, s-maxage=<n>, stale-while-revalidate=…` so the CDN JSON is edge-cached per region (the proven `run.gpx` pattern). Because the bundle is static, `<n>` can be short or an invalidation can force freshness.
- `t(key, vars?)` → `cdn[key] ?? snapshot[key] ?? key`, with `{var}` interpolation over `vars`. Markdown in the resolved value is rendered client-side (a tiny renderer for bold/links/line-breaks; reuse/adapt the gpx sanitizing helper).

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

## Live Bundle (CDN `copy.json`)

- A **Strapi lifecycle hook** on `ui-string` (`afterCreate` / `afterUpdate` / `afterDelete`) regenerates the full catalog as `copy.json` and uploads it to the CMS S3 bucket via the existing `@strapi/provider-upload-aws-s3` path, served through CloudFront at `cms.<siteDomain>/…` (same infra as media).
- Runs on the **master** node only (where admin edits occur); workers need no change. CloudFront serves the object globally.
- Bundle shape: keyed by `key`, values resolved per locale — e.g. `{ "<locale>": { "<key>": "<value>" } }`, or segmented by `namespace` if size warrants. Only `default` is populated in v1.
- Optional: issue a CloudFront invalidation for `copy.json` on write for instant propagation; otherwise rely on a short TTL.

## Committed Snapshot (`copy-snapshot.json`)

- An export script (`npm run copy:snapshot`) fetches all `default` rows from the CMS and writes a committed JSON floor into each app (or one shared committed file).
- Triggered **manually or in CI** — never on CMS data change. Regenerate when you want to move the offline floor forward.
- Guarantees builds do not depend on CMS availability, and the UI never renders a raw key even with the CDN unreachable.

## Custom Admin Page (v1 core)

A Strapi **admin plugin** providing a fast, spreadsheet-style editor — the editing experience the owner actually wants, treated as first-class (not a fast-follow):

- A three-column `<Table>` (`label` · `locale` · `value`) built from `@strapi/design-system` components.
- Namespace filter dropdown, inline edit, add-row, bulk save.
- Backed by a **bulk-upsert controller** that enforces `(key, locale)` uniqueness.

Strapi's default content-manager already lists `ui-string` (key/locale/value) as a fallback editing path, but the custom page is the intended UX.

## Permissions & Deployment

- Extend the existing read-only API token (minted at bootstrap for `route`) to include `ui-string` find/findOne — mirrors `ensureApiTokenPublished()` in `apps/run.cms/app/src/index.ts`.
- The lifecycle hook + bundle upload run on the master node; SQLite + Litestream topology is unchanged.
- CORS/CSP already restrict origins; the CDN bundle is public-readable static JSON (copy is not secret).

## Rollout (one milestone, phased so the plane can land)

1. **Data + client + bundle + proof surface.** `ui-string` type, `(key, locale)` enforcement, API-token permission, lifecycle-hook → CDN `copy.json`, snapshot export script, runtime client (`loadCopy` + `CopyProvider`/`useCopy` + `t`), and wire the **bib donate/sponsor** surface end-to-end as proof — `bib.sponsor.*` / `bib.donate.*` across `SponsorForm`, `SponsorInstructions`, `GetYourBib`, payment/Venmo/CashApp instructions, and the sponsor/QR/logout modals. This is the primary motivating surface *and* the hardest case (client-side, interpolated, modal-heavy), so proving it validates the whole approach.
2. **Custom three-column admin plugin.**
3. **Incremental copy migration.** Remaining `bib` copy, then the shared chrome (`common.header.*` / `common.profileMenu.*` — the copy-paste de-dup win), then `flash`, `human`, `auth`, `gpx`.

## Open Implementation Details (resolve in planning)

- Client packaging: shared package vs per-app file (lean: per-app).
- Bundle shape: single object vs namespace-segmented (size-dependent).
- CloudFront invalidation-on-write vs short TTL.
- Markdown renderer: adapt the existing gpx `blocksToHtml`/sanitizer or a minimal inline renderer.
