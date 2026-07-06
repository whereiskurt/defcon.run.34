# Phase 38: Custom Copy Admin Plugin - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 38 delivers the **organizer-facing editing UX** for the v1.9 copy catalog: a fast, spreadsheet-style **three-column (`key`/`label` · `locale` · `value`) admin page inside Strapi** that lists the whole `ui-string` catalog, filters by `namespace`, supports inline edit + add-row, and saves everything in **one bulk-upsert** that enforces `(key, locale)` uniqueness. It replaces Strapi's default content-manager as the intended authoring surface (the content-manager remains as a fallback path).

Delivers requirements **ADMN-01, ADMN-02, ADMN-03**.

**In scope (Phase 38):**
- A custom Strapi **admin page** (registered via the existing `src/admin` injection — see D-01), presenting `ui-string` rows as a three-column `key · locale · value` `<Table>` with inline edit and add-row (ADMN-01).
- A **namespace filter** dropdown over the grid (ADMN-02).
- A **bulk-upsert server endpoint** (custom route + controller action on the existing `api::ui-string`) that upserts all dirty + new rows and enforces `(key, locale)` uniqueness, rejecting conflicts atomically (ADMN-03).

**Explicitly OUT of scope (do NOT build here):**
- Any new `ui-string` schema fields, the `(key,locale)` lifecycle/DB-index enforcement, or the S3 `copy.json` export — all **already shipped in Phase 35** and reused as-is.
- The runtime copy toolkit (`loadCopy`/`t`/`CopyProvider`) — **Phase 36**, done.
- Migrating any app copy (remaining bib, shared chrome, flash/human/auth/gpx) — **Phase 39**.
- Draft/publish, native Strapi i18n, GraphQL, per-locale authoring beyond `default` — out of scope for the whole milestone (YAGNI).

The dividing line: Phase 38 makes the already-authorable/readable/exportable catalog **pleasant and fast to edit in bulk**. The data model and propagation machinery are untouched.
</domain>

<decisions>
## Implementation Decisions

### Admin surface architecture (ADMN-01)
- **D-01:** Mount the editor as a **custom admin page via the existing `src/admin` injection**, NOT a full standalone Strapi plugin. Register a menu link + page component through the Strapi 5 admin entry (`apps/run.cms/app/src/admin/app.tsx` already customizes the admin panel — SSO redirect logic — and is the established injection precedent). Add a `register()`/`addMenuLink` hook that points at a page component (e.g. `src/admin/pages/CopyCatalog.tsx`).
  - **Rejected:** a full `src/plugins/copy-catalog/` plugin (server+admin halves, `config/plugins.ts` registration). Too much ceremony/files for a single in-house page; no plan to package or externally reuse it. Matches AGENTS.md "single-file until proven insufficient, boring patterns preferred."
  - **Note for planner:** verify the exact Strapi 5.6 admin-injection API for adding a custom page + menu link from `src/admin/app.tsx` (Strapi 5 renamed/moved several `bootstrap`/`register` admin hooks vs Strapi 4). The existing file exports `{ config, bootstrap() }`; the page registration likely goes in a `register(app)` export alongside them. Confirm empirically that the menu link renders and the route resolves under the region-prefixed admin path (`/{region}/admin/...`).

### Bulk-save & conflict UX (ADMN-03)
- **D-02:** Save posts **only dirty + new rows** (not the whole grid) to a single **bulk-upsert endpoint** — a custom `POST /ui-strings/bulk-upsert` route + `bulkUpsert` controller action on the existing `api::ui-string` (`src/api/ui-string/routes` + `controllers`, currently default core factories).
- **D-03:** Conflict handling is **atomic reject with per-row errors**: if ANY row collides — a duplicate `(key, locale)` within the submitted batch, or a new/edited key that would violate uniqueness against a *different* existing row — the **whole save is rejected, nothing is written**, and the response carries per-row error detail the grid renders inline. No partial commit, no last-write-wins clobber. This mirrors the Phase 35 lifecycle hook that already rejects duplicate writes with a clean 4xx.
  - **Rejected:** partial commit (mixed saved/unsaved grid state, easy to misread) and last-write-wins merge (accidental duplicate silently overwrites copy).
  - **Upsert semantics:** an edit to an existing row's `value` (same `key,locale`) is an in-place update, not a conflict. A conflict is only a NEW `(key,locale)` pair that already exists on another row, or two submitted rows sharing a `(key,locale)`.

### Namespace filter + add-row (ADMN-02)
- **D-04:** The **namespace filter is client-side** over the full already-loaded catalog (instant, no round-trip). An "All" option shows every row; selecting a namespace filters the in-memory list.
- **D-05:** **Add-row inherits the active namespace**: when a namespace is filtered, a new row pre-fills that `namespace` and stubs the key with the prefix (e.g. `bib.`). Under "All", add-row starts blank and the editor types the full dotted key. `namespace` on save is derived/validated against `key.split('.')[0]` (the enum from Phase 35: `common, human, auth, gpx, bib, flash`).

### Grid data & value editing (ADMN-01)
- **D-06:** **Load the entire catalog into one grid** — no pagination/virtualization. v1 size is tens–low-hundreds of `default` rows; a single fetch of all rows is simplest and fast enough. (Flag if catalog growth ever makes this heavy — deferred, not now.)
- **D-07:** `value` is edited **inline as raw markdown source** in a growable textarea cell. The lightweight markdown (`**bold**`, `[link](url)`, line-breaks) is rendered *downstream* by the Phase 36 toolkit, not previewed in the admin grid at v1. Three visible columns: `key` (labelled "label" per the spec) · `locale` · `value`; `namespace` drives the filter, `notes` is private and not shown in the grid.

### Claude's Discretion
- Exact grid component composition — `@strapi/design-system` `<Table>`/`<Tr>`/`<Td>` + `<Textarea>`/`<SingleSelect>` (available transitively via Strapi 5.6 admin) vs a lighter hand-rolled table — as long as it visually reads as the intended spreadsheet UX and reuses Strapi's design system for theme consistency.
- Dirty-row tracking mechanism (per-row dirty flag, id-vs-new discrimination) and how new rows are keyed client-side before they have a DB id.
- Exact bulk-upsert transaction strategy (validate-all-then-write within one DB transaction vs pre-flight uniqueness check) — the observable requirement is all-or-nothing with clear per-row errors, reusing/serving the same uniqueness rule the Phase 35 lifecycle hook enforces (avoid divergent duplicate logic — prefer sharing a service helper).
- Whether the bulk-upsert action calls the existing entity service per row inside a transaction (so the Phase 35 lifecycle hooks — uniqueness + S3 export — fire naturally) vs a batched write; **prefer** the path that still triggers the S3 `copy.json` export exactly once (or acceptably per-row) so an admin edit propagates without extra wiring.
- Admin authorization: the page should be reachable by authenticated Strapi admins only (default admin-route protection) — confirm no extra RBAC/permission scaffolding is needed beyond mounting under the admin panel.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design (authoritative)
- `docs/superpowers/specs/2026-07-05-cms-copy-catalog-design.md` — approved milestone design. §"Custom Admin Page (v1 core)" (three-column `<Table>` from `@strapi/design-system`, namespace filter, inline edit, add-row, bulk-upsert controller enforcing `(key,locale)`), §"Permissions & Deployment", and Rollout item 2 govern this phase. **MUST read before planning.**

### Phase 35 foundation (what this page edits — reuse, do not rebuild)
- `apps/run.cms/app/src/api/ui-string/content-types/ui-string/schema.json` — the `ui-string` fields (`key`, `locale` default `"default"`, `value` text, `namespace` enum `[common,human,auth,gpx,bib,flash]`, `notes` private), `draftAndPublish:false`.
- `apps/run.cms/app/src/api/ui-string/content-types/ui-string/lifecycles.ts` — the existing `(key,locale)` uniqueness guard AND the S3 `copy.json` export hook (master-only). The bulk-upsert MUST route writes so this uniqueness rule and export still fire — share it, don't duplicate divergent logic.
- `apps/run.cms/app/src/api/ui-string/services/copy-export.ts` — S3 export the write path triggers.
- `apps/run.cms/app/src/api/ui-string/routes/ui-string.ts` + `controllers/ui-string.ts` — currently default `createCoreRouter`/`createCoreController`; extend with the custom `bulk-upsert` route + action.
- `.planning/phases/35-cms-copy-catalog-foundation/35-CONTEXT.md` — locale is always `default` in v1; `notes` is private; SQLite (`better-sqlite3`) backend, table `ui_strings`.

### Admin injection precedent (how to mount the page)
- `apps/run.cms/app/src/admin/app.tsx` — existing admin-panel customization (exports `{ config, bootstrap() }`, does SSO-redirect + fetch interception). The new page registration/menu-link goes here (or a sibling `src/admin/` module it imports).
- `apps/run.cms/app/src/admin/vite.config.ts`, `apps/run.cms/app/config/admin.ts` — Strapi 5 Vite admin build + admin config; relevant if the page needs build/config wiring.
- `apps/run.cms/app/package.json` — Strapi `^5.6.0` (`@strapi/strapi`, `@strapi/design-system` available transitively via the admin); confirm design-system import path for Strapi 5.6.

### Requirements
- `.planning/REQUIREMENTS.md` — ADMN-01, ADMN-02, ADMN-03 exact text + phase mapping.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/admin/app.tsx` — established admin-injection entry; the page + menu link register here rather than in a new plugin scaffold.
- `src/api/ui-string/content-types/ui-string/lifecycles.ts` — the `(key,locale)` uniqueness enforcement + S3 export already exist; the bulk-upsert reuses this write path so admin edits propagate with no new sync wiring.
- `@strapi/design-system` (transitive via `@strapi/strapi ^5.6.0`) — `<Table>`, `<Textarea>`, `<SingleSelect>`, `<Button>` for the grid, keeping the page theme-consistent with the rest of the admin.

### Established Patterns
- `api::ui-string` uses Strapi core-factory routes/controllers — the bulk-upsert adds a custom route + action alongside the factory (standard Strapi 5 pattern: `routes/ui-string.ts` can export a custom route array or a separate `routes/*` file; controller gains a `bulkUpsert` method).
- `src/admin/app.tsx` already patches admin behavior at load — the region-prefixed admin path (`/{region}/admin`) and localhost-no-prefix cases it handles are the same routing context the custom page mounts under.

### Integration Points
- **Master-node write semantics (Phase 35):** admin edits happen on master; the S3 export lifecycle is gated `CMS_MODE === 'master'`. Bulk-upsert runs on master (that's where the admin panel edits), so the export fires there; regional workers pick up the SQLite change via Litestream (~5 min). No new sync path.
- **Admin auth:** the page sits behind Strapi's admin authentication (SSO-backed per `app.tsx`); no public/token exposure — distinct from the read-only API token the toolkit uses.
</code_context>

<specifics>
## Specific Ideas

- Spreadsheet feel: three columns `key · locale · value`, namespace dropdown + "＋ Add row" above the grid, inline editable cells, one "Save" that commits the batch. Add-row under an active namespace pre-fills `bib.` (etc.) so the editor only types the tail of the key.
- The default content-manager stays available as a fallback editing path (per the design doc) — the custom page is the *intended* UX, not the only one.
- Value cells show raw markdown source (no live preview in v1); rendering is the toolkit's job downstream.
</specifics>

<deferred>
## Deferred Ideas

- **Live markdown preview** in the value cell (side-by-side rendered vs source) — nice-to-have, not v1.
- **Pagination / row virtualization** for the grid — only if catalog size ever makes load-all heavy; not at v1 scale.
- **Per-locale authoring** (columns/tabs for `fr`, `es`, …) — the schema is multi-lingual-ready but only `default` is populated this milestone.
- **Manual `revalidateTag('copy')` fan-out** from the admin page for instant propagation — out of scope; v1 relies on time-based revalidation.
- **Migrate remaining bib copy + shared chrome + other apps** — Phase 39; this page is the tool used to author those keys.

None — discussion stayed within phase scope.
</deferred>

---

*Phase: 38-custom-copy-admin-plugin*
*Context gathered: 2026-07-06*
