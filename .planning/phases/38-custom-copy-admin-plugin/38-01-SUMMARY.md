---
phase: 38-custom-copy-admin-plugin
plan: 01
subsystem: api
tags: [strapi, strapi5, cms, ui-string, bulk-upsert, transaction, typescript]

# Dependency graph
requires:
  - phase: 35-cms-copy-catalog-foundation
    provides: "ui-string content-type, (key,locale) lifecycle uniqueness guard, copy.json S3 export (copy-export.ts)"
provides:
  - "POST /ui-strings/bulk-upsert endpoint on api::ui-string (admin/API-token authed)"
  - "bulkUpsert(rows) service method — atomic all-or-nothing batch upsert returning { saved, errors }"
  - "Pure dependency-free bulk-validate.ts (validateBatch/deriveNamespace/resolveLocale/MESSAGES)"
  - "bulkUpsert(ctx) controller action mapping the all-or-nothing result to 200/400"
affects: [38-02-custom-admin-grid, 38-03-live-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "customizer-form core service/controller (createCoreService/Controller with ({ strapi }) => ({...})) beside a hand-written sibling route file"
    - "pure, strapi-free validation module co-located in services/ for framework-free self-checking"
    - "pre-flight-validate-then-write-in-one-transaction for atomic all-or-nothing bulk writes through the existing lifecycle path"

key-files:
  created:
    - apps/run.cms/app/src/api/ui-string/services/bulk-validate.ts
    - apps/run.cms/app/src/api/ui-string/routes/ui-string-bulk.ts
  modified:
    - apps/run.cms/app/src/api/ui-string/services/ui-string.ts
    - apps/run.cms/app/src/api/ui-string/controllers/ui-string.ts

key-decisions:
  - "Extracted the pure intra-batch validation into a dependency-free bulk-validate.ts so it is testable without the strapi global (plan-sanctioned optional module)"
  - "Writes route through strapi.db.query(UID) inside one strapi.db.transaction so lifecycles.ts fires (uniqueness guard + S3 export reused, not re-implemented)"
  - "Persist namespace=key.split('.')[0] on every payload because schema marks it required though the grid posts only key/locale/value"
  - "Bulk route OMITS config.auth:false, keeping it behind admin/API-token auth (T-38-01)"

patterns-established:
  - "Pure validation module beside a factory service (mirrors copy-export.ts import-only house style)"
  - "Atomic bulk-upsert: pure pre-flight + cross-row DB uniqueness → any error writes nothing; clean batch writes per-row in one transaction"

requirements-completed: [ADMN-03]

coverage:
  - id: D1
    description: "Pure batch validation: intra-batch (key,locale) duplicate, bad namespace prefix, and empty required key/value each produce per-row indexed errors with the exact 38-UI-SPEC copywriting-contract messages; a valid batch yields zero errors"
    requirement: ADMN-03
    verification:
      - kind: unit
        ref: "node /tmp/bulk-validate.selfcheck.mjs (plain node/assert self-check against bulk-validate.ts, 8 groups) — ephemeral (no test framework installed)"
        status: pass
      - kind: integration
        ref: "cd apps/run.cms/app && npm run build (strapi build — TS compile of customized service against reused lifecycle/export imports)"
        status: pass
    human_judgment: false
  - id: D2
    description: "POST /ui-strings/bulk-upsert upserts a clean batch atomically through the Phase-35 lifecycle write path (uniqueness guard + copy.json S3 export fire) and rejects any (key,locale) collision with nothing written + per-row 400 detail; endpoint stays behind admin/API-token auth"
    requirement: ADMN-03
    verification:
      - kind: integration
        ref: "cd apps/run.cms/app && npm run build (compiles controller + new route, validates handler ref ui-string.bulkUpsert)"
        status: pass
      - kind: manual_procedural
        ref: "38-03 live CMS round-trip: 200 on valid batch, 400 + per-row errors + nothing-written on collision, S3 copy.json regenerated on master, read-only token denied"
        status: unknown
    human_judgment: true
    rationale: "Runtime request behavior (atomicity, live S3 export on master, admin-auth enforcement, read-only-token 403) requires a live Strapi + S3 and is deferred to 38-03 by plan design; no jest/vitest exists to prove it in-process"

# Metrics
duration: ~15min
completed: 2026-07-06
status: complete
---

# Phase 38 Plan 01: Custom Copy Admin — Bulk-Upsert Server Endpoint Summary

**Admin-authed `POST /ui-strings/bulk-upsert` that atomically upserts a batch of dirty+new ui-string rows — rejecting any (key,locale) collision with per-row detail and nothing written — by routing writes through the Phase-35 lifecycle path so the uniqueness guard and copy.json S3 export are reused, not re-implemented.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-06T00:47:00Z (approx)
- **Completed:** 2026-07-06T05:02:01Z
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `bulkUpsert(rows)` service: pure pre-flight (intra-batch duplicate, namespace prefix, empty required) + cross-row DB uniqueness → any error returns `{ saved: [], errors }` and writes nothing; a clean batch writes every row via `strapi.db.query` inside one `strapi.db.transaction` so `lifecycles.ts` fires (the `(key,locale)` guard AND the copy.json S3 export are reused).
- Dependency-free `bulk-validate.ts` holding the intra-batch rules and the verbatim 38-UI-SPEC copywriting-contract error strings, verified with a plain node/assert self-check (8 groups pass) — no test framework, no new dependency.
- `bulkUpsert(ctx)` controller: rejects a non-array body, delegates to the service, and maps the result to HTTP (400 + per-row `{ errors }` on any collision, 200 `{ data: saved }` on a clean save).
- New sibling route `routes/ui-string-bulk.ts` exposing `POST /ui-strings/bulk-upsert` → `ui-string.bulkUpsert`, deliberately omitting `config.auth:false` so it stays behind admin/API-token auth. The core factory router and default `/ui-strings` CRUD are untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1: bulkUpsert service (all-or-nothing batch upsert reusing Phase-35 write path)** — `9123fe74` (feat)
2. **Task 2: bulkUpsert controller action + admin-authed bulk-upsert route** — `96cad49d` (feat)
3. **NUL-byte fix in bulk-validate pair key** — `41c0dc44` (fix, Rule 1 auto-fix — see Deviations)

_TDD (Task 1): RED via the self-check failing on the missing module → GREEN after creating `bulk-validate.ts` (self-check passes) → service implemented → `npm run build` green. No separate committed test file: Strapi auto-loads `services/`, so a runtime-loaded assert file would execute on boot; the self-check is run from `/tmp` and the committed gate is `npm run build` (per plan verify notes: "no jest/vitest is installed")._

## Files Created/Modified
- `apps/run.cms/app/src/api/ui-string/services/bulk-validate.ts` (NEW) — pure, strapi-free batch validator: `validateBatch`, `deriveNamespace`, `resolveLocale`, `MESSAGES`, `VALID_NAMESPACES`.
- `apps/run.cms/app/src/api/ui-string/routes/ui-string-bulk.ts` (NEW) — hand-written route object exposing `POST /ui-strings/bulk-upsert` (no `auth:false`).
- `apps/run.cms/app/src/api/ui-string/services/ui-string.ts` (MODIFIED) — bare factory → customizer form with `bulkUpsert(rows)`.
- `apps/run.cms/app/src/api/ui-string/controllers/ui-string.ts` (MODIFIED) — bare factory → customizer form with `bulkUpsert(ctx)`.

## Decisions Made
- **Extract the pure validator** (`bulk-validate.ts`) rather than inlining it in the service — the plan explicitly sanctions this ("If the pure batch-validation helper is extracted to a dependency-free module, also self-check it"), and it enables the framework-free node/assert check. Named exports only, no default export, no side effects (mirrors `copy-export.ts`) so Strapi's service loader treats it as inert.
- **Write via `strapi.db.query` inside `strapi.db.transaction`** (not the document service): the existing `lifecycles.ts` hooks are Query-Engine-shaped (`event.params.where`/`data`), so this path fires the reused uniqueness guard and per-row S3 export on master. Per-row export is acceptable per D-03.
- **Duplicate-pair message reused** for both intra-batch collisions and cross-row DB collisions (single 38-UI-SPEC string).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stray NUL byte in the (key,locale) dedup separator**
- **Found during:** Post-Task-1 scope verification (git reported `bulk-validate.ts` as binary).
- **Issue:** The space in the template literal `` `${key} ${resolveLocale(row.locale)}` `` was written as a NUL (`0x00`) byte instead of `0x20`, flagging the file binary. Functionally still a valid separator, but fragile and produced an unreadable diff.
- **Fix:** Replaced the NUL with a real space; file is now valid UTF-8 text, git sees it as text.
- **Files modified:** apps/run.cms/app/src/api/ui-string/services/bulk-validate.ts
- **Verification:** `grep -c NUL` = 0, `file` reports "UTF-8 text", self-check (8 groups) and `npm run build` both re-run green.
- **Committed in:** `41c0dc44`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Cosmetic/robustness fix within this plan's own new file. No scope creep; both automated gates re-verified.

## Issues Encountered
- Node on PATH is v22.1.0 (no `--experimental-strip-types`); used the nvm-installed v23.6.0 (default type-stripping) to run the TS self-check directly. No code impact; the committed gate is `npm run build`.

## User Setup Required
None - no external service configuration required (reuses the Phase-35 S3 env; no new keys).

## Next Phase Readiness
- Server endpoint ready for **38-02** (the custom admin grid) to POST dirty+new rows to `/ui-strings/bulk-upsert` and reconcile returned ids; error payload shape (`{ index, code, message }`) and copy match 38-UI-SPEC so the grid can render errors inline.
- Runtime/atomicity/S3-export/auth behavior is proven live in **38-03** (no in-process test framework exists).

---
*Phase: 38-custom-copy-admin-plugin*
*Completed: 2026-07-06*
