---
phase: 38-custom-copy-admin-plugin
plan: 02
subsystem: admin-ui
tags: [strapi, strapi5, admin, design-system, copy-catalog, ui-string, react, typescript, vite]

# Dependency graph
requires:
  - phase: 38-custom-copy-admin-plugin (plan 01)
    provides: "POST /ui-strings/bulk-upsert (atomic all-or-nothing upsert; 200 { data: saved } / 400 { error: { details: { errors: [{index,code,message}] } } })"
  - phase: 35-cms-copy-catalog-foundation
    provides: "ui-string content-type (key/locale/value/namespace); GET /api/ui-strings collection"
provides:
  - "Copy Catalog custom admin page mounted via register(app)/addMenuLink at /{region}/admin/copy-catalog (first admin menu-link injection in the repo)"
  - "src/admin/pages/CopyCatalog.tsx — load-all three-column (Label·Locale·Value) grid with client-side namespace filter, dirty tracking, add-row, and bulk Save with atomic-reject per-row error rendering"
  - "src/admin/tsconfig.json (admin preset) + server tsconfig exclusion of src/admin — the standard Strapi-5 TS split that lets JSX admin pages compile"
affects: [38-03-live-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "First register(app)/addMenuLink admin injection on the src/admin/app.tsx default export (alongside the existing config + SSO bootstrap)"
    - "Custom Strapi admin page composed from @strapi/design-system v2.0.1 + @strapi/icons v2.0.1 + @strapi/strapi/admin hooks (useFetchClient/useNotification/Layouts/Page)"
    - "Two-tsconfig split (server tsconfig excludes src/admin; src/admin/tsconfig.json extends @strapi/typescript-utils/tsconfigs/admin) — the standard Strapi-5 layout this repo was missing"

key-files:
  created:
    - apps/run.cms/app/src/admin/pages/CopyCatalog.tsx
    - apps/run.cms/app/src/admin/tsconfig.json
  modified:
    - apps/run.cms/app/src/admin/app.tsx
    - apps/run.cms/app/tsconfig.json

key-decisions:
  - "Menu icon is Pencil (edit-authoring semantics) rather than the pattern's example Plus; Plus is reserved for the Add row button per UI-SPEC"
  - "Save/list use the admin fetch client against /api/ui-strings and /api/ui-strings/bulk-upsert (the default Strapi REST prefix is /api; the fetch client does NOT auto-prepend it)"
  - "Added src/admin/tsconfig.json + excluded src/admin from the server tsconfig so `strapi build` compiles the first JSX admin page — the repo lacked the admin tsconfig scaffold because the pre-existing app.tsx avoided JSX via ambient declares (Rule 3 build-config fix)"
  - "Per-row error index maps back to the exact grid row by position in the submitted (dirty+new) payload; new-row DB ids reconciled by (key,locale) match"

requirements-completed: [ADMN-01, ADMN-02]

coverage:
  - id: SC-1
    description: "'Copy Catalog' menu link registered via register()/addMenuLink on the app.tsx default export (SSO bootstrap untouched); route resolves under /{region}/admin/copy-catalog"
    requirement: ADMN-01
    verification:
      - kind: integration
        ref: "cd apps/run.cms/app && npm run build (strapi build — server TS compile + Vite admin bundle including app.tsx register hook + CopyCatalog page)"
        status: pass
      - kind: manual_procedural
        ref: "38-03 human-verify: menu link renders and route resolves under the region-prefixed admin path against a running CMS"
        status: unknown
    human_judgment: true
    rationale: "Live menu render + region-prefixed route resolution needs a running admin panel; deferred to 38-03 by plan design"
  - id: SC-2
    description: "Full catalog loads in one fetch and renders as a three-column Label·Locale·Value table with inline-editable cells; namespace SingleSelect filters client-side; Add row inherits the active namespace prefix"
    requirement: ADMN-01, ADMN-02
    verification:
      - kind: integration
        ref: "cd apps/run.cms/app && npm run build (compiles the interactive grid + toolbar; confirms @strapi/design-system / @strapi/icons / @strapi/strapi/admin imports resolve)"
        status: pass
      - kind: manual_procedural
        ref: "38-03 human-verify: filter narrows the grid, add-row inherits prefix, values render as raw markdown"
        status: unknown
    human_judgment: true
    rationale: "Behavioral filter/add-row/render proof needs a live CMS with catalog rows; deferred to 38-03"
  - id: SC-3
    description: "Save posts ONLY dirty + new rows to /api/ui-strings/bulk-upsert; on 2xx clears dirty flags + reconciles returned ids + success toast; on 4xx renders per-row danger cells + inline errors + reject banner and preserves dirty state"
    requirement: ADMN-01
    verification:
      - kind: integration
        ref: "cd apps/run.cms/app && npm run build (compiles the Save/error-render path)"
        status: pass
      - kind: manual_procedural
        ref: "38-03 live round-trip: valid batch upserts + success toast; duplicate (key,locale) rejected atomically with inline per-row errors and nothing written"
        status: unknown
    human_judgment: true
    rationale: "Atomic round-trip + toast + atomic-reject rendering requires a live Strapi + the 38-01 endpoint; no in-process test harness exists on this admin surface (deferred to 38-03)"

# Metrics
duration: ~7min
completed: 2026-07-06
status: complete
---

# Phase 38 Plan 02: Custom Copy Admin — Grid Page Summary

**A custom Strapi admin page (mounted via the first `register()`/`addMenuLink` injection in the repo) that loads the whole `ui-string` catalog into a three-column Label·Locale·Value spreadsheet grid — client-side namespace filter, inline edit, add-row, and a single bulk Save that posts only dirty + new rows to the 38-01 bulk-upsert endpoint with atomic-reject per-row error rendering.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-07-06T05:11:35Z
- **Completed:** 2026-07-06T05:18:38Z
- **Tasks:** 2
- **Files:** 4 (2 created, 2 modified)

## Accomplishments

- **Task 1** — Added a `register(app)` hook to the existing `src/admin/app.tsx` default export (alongside `config` + the untouched SSO `bootstrap`), calling `app.addMenuLink` with `to:'/copy-catalog'`, a `Pencil` icon, `intlLabel` "Copy Catalog", `permissions: []` (any authenticated admin), and a lazy `Component` importing `./pages/CopyCatalog`. Created `src/admin/pages/CopyCatalog.tsx` (the first `src/admin/pages/` file): loads the full catalog in one `GET /api/ui-strings?pagination[pageSize]=1000` and renders it as a `<Table>` with three columns (**Label** — the underlying `key` field per D-07 — `Locale`, `Value`), inline `TextInput`/`Textarea` cells, plus Loader / empty / load-error states.
- **Task 2** — Added the toolbar (`SingleSelect` "Namespace" client-side filter over the loaded catalog, secondary "Add row" with `Plus`, primary "Save" disabled when nothing is dirty), per-row dirty/new tracking with a `primary100` row tint, add-row that inherits the active namespace prefix (`bib.` etc.) and focuses the new Label cell, and the bulk Save: POSTs **only** dirty + new rows to `POST /api/ui-strings/bulk-upsert`, on 2xx clears dirty flags + reconciles returned DB ids by `(key,locale)` + fires the success toast (`useNotification`), on 4xx maps the Strapi error envelope's per-row `{index,code,message}` back onto the submitted rows (danger cell borders via `hasError` + inline `pi`-variant messages + the reject banner) while preserving dirty state.
- All copy strings are the verbatim 38-UI-SPEC Copywriting Contract; theming consumes only Strapi tokens (Box/Flex spacing indices, `<Typography variant>`, color tokens like `primary100`/`danger600`) — no hardcoded px/hex, no external UI dependency.

## Task Commits

1. **Task 1: register() menu link + CopyCatalog page shell (load-all + three-column render) + admin tsconfig fix** — `05f90b00` (feat)
2. **Task 2: namespace filter + dirty tracking + add-row + bulk Save/error rendering** — `5c378ed3` (feat)

## Files Created/Modified

- `apps/run.cms/app/src/admin/pages/CopyCatalog.tsx` (NEW) — the Copy Catalog page component (load-all grid, client-side namespace filter, dirty tracking, add-row, bulk Save with atomic-reject per-row error rendering).
- `apps/run.cms/app/src/admin/tsconfig.json` (NEW) — admin TS config extending `@strapi/typescript-utils/tsconfigs/admin` (jsx: react-jsx, DOM lib, Bundler resolution) so JSX admin pages type-check under the correct settings.
- `apps/run.cms/app/src/admin/app.tsx` (MODIFIED) — added the `register(app)` hook + `Pencil` import; the SSO redirect / fetch-interception `bootstrap` and all helpers are untouched.
- `apps/run.cms/app/tsconfig.json` (MODIFIED) — excluded `src/admin` from the server compile so `strapi build`'s server TS step no longer type-checks JSX/DOM admin code (Vite builds the admin separately).

## Decisions Made

- **Menu icon `Pencil`, not the pattern's example `Plus`** — `Plus` is reserved for the "Add row" button per the UI-SPEC icon inventory; `Pencil` reads as edit-authoring for the nav.
- **Admin fetch client targets `/api/...`** — the default Strapi REST prefix is `/api` and the admin fetch client (`getFetchClient`) does NOT auto-prepend it (verified in `getFetchClient.mjs`: it only adds a leading slash and joins `window.strapi.backendURL`). So the load hits `/api/ui-strings` and Save hits `/api/ui-strings/bulk-upsert` (the 38-01 route path is `/ui-strings/bulk-upsert`, served under the `/api` prefix).
- **Per-row error mapping by payload position** — the submitted array is `pending` (dirty + new) in order; the 38-01 controller returns per-row errors with `index` into that array, so errors map back to the exact grid row by `pending.findIndex(tempKey)`. New-row DB ids are reconciled by `(key,locale)` since the saved order is not relied upon.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking build config] Missing `src/admin/tsconfig.json` broke `strapi build` on the first JSX admin page**
- **Found during:** Task 1 (`npm run build` verify).
- **Issue:** `strapi build`'s "Compiling TS" step runs the server `tsconfig.json` (which `include`s `./src`) over ALL of `src/`, including `src/admin`. That config uses `module: CommonJS`, `lib: ES2020`, classic `moduleResolution` and no `jsx` — so the first JSX admin page failed with `TS17004 (Cannot use JSX unless '--jsx' is set)`, `TS2307` (`@strapi/strapi/admin` unresolvable under classic resolution), and `TS2812` (no DOM lib). The pre-existing `app.tsx` had dodged this by declaring its own ambient `window`/`Promise`/`URL`/`console` and never using JSX — so the repo never had the admin tsconfig that a fresh Strapi-5 TS project scaffolds.
- **Fix:** Added `src/admin/tsconfig.json` extending `@strapi/typescript-utils/tsconfigs/admin` (jsx: react-jsx, DOM lib, Bundler resolution) and excluded `src/admin` from the server `tsconfig.json`. This is the standard Strapi-5 two-tsconfig split: the server tsc compiles server code, and the admin panel is bundled by Vite (which is where `CopyCatalog.tsx` and `app.tsx` are actually compiled during `strapi build`).
- **Files modified:** `apps/run.cms/app/src/admin/tsconfig.json` (new), `apps/run.cms/app/tsconfig.json`.
- **Verification:** `npm run build` now passes both the server "Compiling TS" step and the "Building admin panel" Vite bundle (which compiles the new page + register hook — the plan's designated import/JSX gate).
- **Committed in:** `05f90b00` (with Task 1).

**Total deviations:** 1 auto-fixed (1 blocking build-config issue). No scope creep — the fix is the minimal, standard Strapi-5 TS layout required for any JSX admin page.

## Verification

- `cd apps/run.cms/app && npm run build` — PASS. Server TS compiles; the Vite admin bundle builds including `src/admin/pages/CopyCatalog.tsx` and the new `register` hook, confirming every import resolves: `@strapi/design-system` v2.0.1 (`Table/Thead/Tbody/Tr/Td/Th/Typography/TextInput/Textarea/SingleSelect/SingleSelectOption/Button/Flex/Box/Loader`), `@strapi/icons` v2.0.1 (`Plus`, `Pencil`), `@strapi/strapi/admin` (`Layouts/Page/useFetchClient/useNotification`).
- SSO redirect / fetch-interception logic in `app.tsx` unchanged — only the `register` hook + `Pencil` import were added.
- No Tailwind/HeroUI/shadcn import; no hardcoded px/hex (theme tokens only) in `CopyCatalog.tsx`.
- Save targets `/api/ui-strings/bulk-upsert` (the 38-01 endpoint) and sends only dirty + new rows.

## Deferred to 38-03 (human-verify — by plan design)

The build gate is the automated proof; the following are runtime/visual behaviors verified live in 38-03 (no automated e2e harness exists on this Strapi admin surface):
- Menu link renders and the route resolves under the region-prefixed admin path.
- Namespace filter narrows the grid; add-row inherits the prefix.
- Save round-trips (upsert + success toast); a duplicate `(key,locale)` is rejected atomically with inline per-row errors and nothing written.
- Read-only-token denial / admin-auth enforcement (T-38-06) and the S3 `copy.json` export firing on master.

## User Setup Required

None — no external service configuration; the page uses the admin panel's existing SSO-backed auth and the 38-01 endpoint. No new dependency added.

## Next Phase Readiness

- **38-03** (live verification) can now exercise the full authoring loop end-to-end: load → filter → edit/add → Save → atomic-reject, plus the T-38-06 auth check and S3 export, against a running CMS.

## Self-Check: PASSED

- Created/modified files present on disk: `CopyCatalog.tsx`, `src/admin/tsconfig.json`, modified `app.tsx` + `tsconfig.json`, this SUMMARY.
- Commits present: `05f90b00` (Task 1), `5c378ed3` (Task 2).
- Automated gate `npm run build` re-run green after the final (Task 2) state of the page.

---
*Phase: 38-custom-copy-admin-plugin*
*Completed: 2026-07-06*
