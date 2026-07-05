---
phase: 36-runtime-copy-toolkit
plan: 01
subsystem: ui
tags: [copy-catalog, strapi, next-data-cache, unstable_cache, fallback, vitest, run.bib]

# Dependency graph
requires:
  - phase: 35-cms-copy-catalog-foundation
    provides: "ui-string content type, read-only API token, S3 copy.json export (cms.${SITE_DOMAIN}/${REGION_SHORT}/cms/copy.json)"
provides:
  - "loadCopy(locale): cached single merged copy map via the Next.js Data Cache"
  - "resolveCopy: never-throwing Strapi > S3 > snapshot fallback resolver (test seam)"
  - "copy-core.ts: client-safe pure t/interpolate shared by server + Plan 03 client provider"
  - "committed copy-snapshot.json offline floor + copy:snapshot regeneration script"
  - "run.bib's first CMS read wiring (CMS_INTERNAL_URL + STRAPI_API_TOKEN)"
affects: [37-bib-donate-sponsor-proof, 38-custom-copy-admin, 39-copy-migration, copy-provider, useCopy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cached fallback chain: unstable_cache wraps the resolver so the RESOLVED map (incl. fallback) is cached, not just the happy-path fetch"
    - "Split client-safe core (copy-core.ts, no env/no server-only) from server-only resolver (copy.ts) so one lookup path is shared server+client"
    - "Env-at-call-time reads (mirror social-qr.ts) so vi.stubEnv drives resolver tests"

key-files:
  created:
    - apps/run.bib/webapp/src/lib/copy-core.ts
    - apps/run.bib/webapp/src/lib/copy.ts
    - apps/run.bib/webapp/src/lib/copy-snapshot.json
    - apps/run.bib/webapp/scripts/copy-snapshot.mjs
    - apps/run.bib/webapp/src/__tests__/copy.test.ts
  modified:
    - apps/run.bib/webapp/package.json
    - apps/run.bib/webapp/.env.example

key-decisions:
  - "Did NOT use literal `import 'server-only'` — Next 16 vendors that package internally (next/dist/compiled/server-only) with no top-level module, so a literal import breaks tsc + vitest; enforced server-only by convention like the other bib server libs (social-qr.ts, ssm.ts)"
  - "Runtime resolver does a single bulk Strapi fetch (pagination[pageSize]=1000) rather than runtime pagination — one bulk resolve per revalidate window (SC-1); the paginating loop lives only in the manual copy:snapshot script"
  - "Strapi layer skipped cleanly when CMS_INTERNAL_URL/STRAPI_API_TOKEN absent (run.bib had no CMS client before) — goes straight to S3 then snapshot, no wasted fetch"

patterns-established:
  - "Copy toolkit as a per-app file (lib/copy*.ts), NOT a shared workspace (D-01); first home run.bib (D-02)"
  - "Snapshot regeneration is a manual/CI-only npm script, never wired into build (D-04)"

requirements-completed: [TOOL-01, TOOL-02, TOOL-04, FALL-02, FALL-03, FALL-04]

coverage:
  - id: D1
    description: "copy-core t/interpolate: pure O(1) map[key] ?? key with {placeholder} interpolation; missing key echoes the key (FALL-04, TOOL-01)"
    requirement: TOOL-01
    verification:
      - kind: unit
        ref: "src/__tests__/copy.test.ts#copy-core: t / copy-core: interpolate"
        status: pass
    human_judgment: false
  - id: D2
    description: "resolveCopy merges Strapi > S3 > committed snapshot into one flat locale map (TOOL-02)"
    requirement: TOOL-02
    verification:
      - kind: unit
        ref: "src/__tests__/copy.test.ts#merges Strapi over S3 over the committed snapshot"
        status: pass
    human_judgment: false
  - id: D3
    description: "Never-throwing cached fallback: Strapi-fail -> S3, both-fail -> snapshot floor; a snapshot-present key never renders raw (FALL-02, FALL-04)"
    requirement: FALL-02
    verification:
      - kind: unit
        ref: "src/__tests__/copy.test.ts#falls through to S3 when the Strapi fetch rejects / falls through to the committed snapshot when Strapi AND S3 both fail"
        status: pass
    human_judgment: false
  - id: D4
    description: "loadCopy wraps resolveCopy in unstable_cache (revalidate:300, tags:['copy']) so the resolved map incl. fallback is cached; ~15min cross-region propagation with no deploy (TOOL-04)"
    requirement: TOOL-04
    verification:
      - kind: other
        ref: "code review: loadCopy = unstable_cache((loc)=>resolveCopy(loc),['copy',locale],{revalidate:300,tags:['copy']})(locale) in src/lib/copy.ts"
        status: pass
    human_judgment: true
    rationale: "Cache behavior (one slow call per revalidate window, cross-region propagation) is a Next.js runtime property not exercisable in the node-env unit test; needs a live/deployed observation"
  - id: D5
    description: "Committed copy-snapshot.json floor seeded with self-proof keys + copy:snapshot regen script that exits non-zero without writing when CMS env is absent (FALL-03)"
    requirement: FALL-03
    verification:
      - kind: automated
        ref: "node -e snapshot-keys assertion + env -u CMS_INTERNAL_URL -u STRAPI_API_TOKEN node scripts/copy-snapshot.mjs (exit 1, floor md5 unchanged)"
        status: pass
    human_judgment: false

# Metrics
duration: ~50min
completed: 2026-07-05
status: complete
---

# Phase 36 Plan 01: Runtime Copy Toolkit (server resolver) Summary

**Server-side `loadCopy` for run.bib: a single already-merged copy map behind the Next.js Data Cache, with a never-throwing Strapi → S3 export → committed-snapshot fallback that is itself cached, plus a client-safe pure `t`/`interpolate` core shared with the future client provider.**

## Performance

- **Duration:** ~50 min (dominated by environment repair — see Issues)
- **Completed:** 2026-07-05
- **Tasks:** 2
- **Files modified:** 7 (5 created, 2 modified)

## Accomplishments
- `copy-core.ts` — client-safe, env-free `interpolate` + `t` (pure `map[key] ?? key` then interpolation, missing keys echo the key). One lookup path shared by the server resolver and Plan 03's client provider.
- `copy.ts` (server-only by convention) — `resolveCopy` merges Strapi (wins) over the S3 export over the committed snapshot, catching every layer independently so it never throws; `loadCopy` wraps it in `unstable_cache` (revalidate:300, tags:['copy']) so the resolved map *including the fallback outcome* is what gets cached (fallback as cheap as the happy path).
- Committed `copy-snapshot.json` offline floor seeded with the two `bib.selftest.*` self-proof keys Plan 03 asserts; `scripts/copy-snapshot.mjs` regenerates it from the live catalog and refuses to write an empty floor when CMS env is absent.
- `.env.example` documents `CMS_INTERNAL_URL` + `STRAPI_API_TOKEN` (server-only secrets, never `NEXT_PUBLIC_*`) — run.bib's first CMS read.
- 10 vitest cases green (interpolate, t, merge precedence, Strapi-fail / S3-fail / both-fail fallback, no-token skip).

## Task Commits

1. **Task 1: Committed snapshot floor + copy:snapshot regeneration script** — `b29fd8ed` (feat)
2. **Task 2: copy-core + loadCopy resolver + cached fallback + env wiring + tests** — `2e16ad4a` (feat)

_Task 2 is TDD (RED test → GREEN impl); committed as one atomic task per the plan's single-task structure._

## Files Created/Modified
- `apps/run.bib/webapp/src/lib/copy-core.ts` — client-safe pure `interpolate`/`t` + `CopyMap` type
- `apps/run.bib/webapp/src/lib/copy.ts` — server-only `resolveCopy` (test seam) + cached `loadCopy`
- `apps/run.bib/webapp/src/lib/copy-snapshot.json` — committed offline floor (self-proof keys)
- `apps/run.bib/webapp/scripts/copy-snapshot.mjs` — manual/CI-only regeneration script
- `apps/run.bib/webapp/src/__tests__/copy.test.ts` — 10 vitest cases
- `apps/run.bib/webapp/package.json` — added `copy:snapshot` script (NOT in build)
- `apps/run.bib/webapp/.env.example` — documents `CMS_INTERNAL_URL` + `STRAPI_API_TOKEN`

## Decisions Made
- **No literal `import 'server-only'`.** Next 16 vendors `server-only` internally at `next/dist/compiled/server-only` and does not expose a top-level resolvable module, so a literal import fails both `tsc --noEmit` and vitest. The server-only contract is enforced by convention (token read only server-side, at call time; never `NEXT_PUBLIC_*`; only the resolved map crosses to the client) — identical to the existing bib server libs `social-qr.ts`, `ssm.ts`, `stripe.ts`. Documented as a Rule 3 deviation.
- **Single bulk Strapi fetch at runtime** (`pagination[pageSize]=1000`) rather than a runtime pagination loop — one bulk resolve per revalidate window (SC-1). The paginating loop lives only in the manual `copy:snapshot` script.
- **Strapi layer skipped when CMS env absent** — resolver goes straight to S3 then snapshot with no wasted fetch (run.bib has no CMS wiring until the ECS task def is provisioned).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Server-only marking without the `server-only` package**
- **Found during:** Task 2 (copy.ts implementation)
- **Issue:** The plan suggested `import 'server-only'`, but `server-only` is not a resolvable top-level module in this project — Next 16 vendors it internally (`next/dist/compiled/server-only`). A literal import breaks `tsc --noEmit` and vitest, and installing the package would be a new dependency (violates D-05 / no new deps).
- **Fix:** Enforced the server-only contract by convention (documented module header; call-time server-side env reads; never `NEXT_PUBLIC_*`; only the resolved map crosses to the client) — matching the existing bib server libs. The prohibition (token never in the client bundle) is fully preserved.
- **Files modified:** apps/run.bib/webapp/src/lib/copy.ts
- **Verification:** `tsc --noEmit` reports zero errors from copy.ts/copy-core.ts; token is only read via `process.env` server-side.
- **Committed in:** 2e16ad4a (Task 2 commit)

**2. [Rule 3 - Blocking] Broken worktree toolchain (node_modules + Node version)**
- **Found during:** Task 2 verification (running vitest)
- **Issue:** The worktree had no `node_modules`; `npm ci` then hit the known npm optional-dependencies bug (missing `@rolldown/binding-darwin-arm64`, then a `std-env` ESM/CJS mismatch). Separately, the active Node (v22.1.0) is too old for vitest 4 / vite's `require(ESM)` usage.
- **Fix:** Repaired the environment (not a code change): symlinked the worktree `node_modules` to the fully-installed main-checkout `node_modules` (identical deps), and ran tests/typecheck with Node v23.6.0 (per project MEMORY note "use node v23.6.0 for tests"). No new packages introduced; the committed lockfile is untouched.
- **Verification:** `npx vitest run src/__tests__/copy.test.ts` → 10/10 pass under Node 23.6.0.
- **Committed in:** N/A (environment repair only; `node_modules` is gitignored)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking)
**Impact on plan:** No scope change. Deviation 1 preserves the exact security prohibition via a project-consistent convention. Deviation 2 is pure toolchain repair.

## Issues Encountered
- **`tsc --noEmit` is not globally clean in this environment** — 30 pre-existing `TS2307 Cannot find module` errors for UI deps (`@heroui/react`, `clsx`, `next-themes`, `react-icons/*`, `qrcode`, `framer-motion`, `altcha-lib/v1`). These reproduce identically on the baseline main checkout (its `node_modules` is a partial install missing those UI packages) and are unrelated to this plan. **Zero** of the errors originate from the files this plan created/modified — `copy.ts`/`copy-core.ts` are type-clean. Logged as out-of-scope (SCOPE BOUNDARY); not fixed here (a full dependency reinstall is beyond this plan and risks lockfile churn).

## User Setup Required

**run.bib needs CMS runtime env before Phase 37 ships to prod.** run.bib had no CMS client until this plan. Until the ECS task definition provides them, the toolkit silently serves the S3 export then the committed snapshot floor (no crash) but never reads live copy:
- `CMS_INTERNAL_URL` — regional CMS worker base URL (mirror run.human's value in `infra/terraform/live/site/services/*`)
- `STRAPI_API_TOKEN` — the read-only `run-human-internal` API token from Phase 35 (server-only secret, never `NEXT_PUBLIC_*`)

## Next Phase Readiness
- `loadCopy` + `copy-core` are ready for Plan 03 (client `CopyProvider`/`useCopy`) to carry the resolved map to the client, and for Phase 37 (bib donate/sponsor) as the first real consumer.
- Blocker for prod: the two env vars above must be wired into run.bib's runtime before Phase 37 deploys.

## Self-Check: PASSED

- All 5 created files verified present on disk.
- Both task commits verified in git log (`b29fd8ed`, `2e16ad4a`).
- `npx vitest run src/__tests__/copy.test.ts` → 10/10 pass (Node v23.6.0).
- `tsc --noEmit`: zero errors from copy.ts/copy-core.ts (30 pre-existing missing-UI-dep errors are out-of-scope, reproduce on baseline main checkout).

---
*Phase: 36-runtime-copy-toolkit*
*Completed: 2026-07-05*
