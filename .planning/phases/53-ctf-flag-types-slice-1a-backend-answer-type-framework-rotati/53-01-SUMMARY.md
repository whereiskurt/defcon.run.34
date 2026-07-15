---
phase: 53-ctf-flag-types-slice-1a-backend-answer-type-framework-rotati
plan: 01
subsystem: database
tags: [electrodb, dynamodb, ctf, flag-types, totp, ledger, vitest]

# Dependency graph
requires:
  - phase: 44-ctf-judge-core-scoring-engine-data-model
    provides: "Ctf/CtfSolve entities, judgeSolve, computePoints, key-parity test harness, ctf-scoring structural-typing pattern"
provides:
  - "Six optional/additive Ctf gating fields (answerType, otp, unlockAfter, perPlayerIntervalHours, perPlayerMax, globalMax) — a row with none reads as static"
  - "CtfScoreEvent append-only ledger entity (pk=challenge, sk=user#bucket, byUser gsi1) + CtfScoreEventItem type + key-parity lock"
  - "Pure ctf-flag-types module: isRepeatable, scoreBucket, assertAnswerTypeTransition"
  - "CTFT-06 write guard wired into upsertCtf (rejects static<->repeatable flip once solves exist)"
  - "Dependency-free qr-errors.ts (QrValidationError) so pure helpers throw it without pulling electro"
affects: [53-03-judge-gates, 53-02-ctf-otp, 53-04-effect-plumbing, ctf-judge, qr-admin]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive-only entity extension: every new attribute optional, no index change, no required flag — backward-compatible with shipped rows"
    - "Time-bucket-in-sk: CtfScoreEvent sk carries user#bucket so the once-per-window claim is a single atomic conditional put (no read-then-write race)"
    - "Pure structurally-typed helper module (no electro import) unit-tested offline, mirroring ctf-scoring.ts"
    - "Dependency-free error module + re-export to keep a pure helper free of the electro client"

key-files:
  created:
    - apps/run.human/webapp/src/lib/ctf-flag-types.ts
    - apps/run.human/webapp/src/lib/qr-errors.ts
    - apps/run.human/webapp/src/lib/__tests__/ctf-flag-types.test.ts
  modified:
    - apps/run.human/webapp/src/entities/qr.ts
    - apps/run.human/webapp/src/entities/ctf.ts
    - apps/run.human/webapp/src/lib/qr-admin.ts
    - apps/run.human/webapp/src/entities/__tests__/ctf-key-parity.test.ts

key-decisions:
  - "Extracted QrValidationError into a dependency-free qr-errors.ts (re-exported from qr-admin.ts) so ctf-flag-types.ts stays pure and never transitively imports the electro client"
  - "scoreBucket window precedence: perPlayerIntervalHours dominates, else otpPeriodSeconds, else a documented 120s fallback"
  - "hasSolves existence read is a limit-1 query on each of CtfSolve and CtfScoreEvent challenge partitions (bounded, short-circuits) — never a full scan"

patterns-established:
  - "Additive optional entity fields with no-clobber conditional-spread passthrough in ctfAttributes"
  - "Repeatable-ness routing helper (isRepeatable) as the single source of truth for CtfSolve vs CtfScoreEvent"

requirements-completed: [CTFT-01, CTFT-03, CTFT-06]

coverage:
  - id: D1
    description: "Six optional/additive Ctf gating fields + no-clobber CtfInput passthrough; a shipped row with no answerType reads/scores as static (backward compat)"
    requirement: "CTFT-01"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-judge.test.ts (15 tests — unchanged behavior)"
        status: pass
      - kind: unit
        ref: "src/lib/__tests__/qr-admin.test.ts (42 tests — passthrough unchanged)"
        status: pass
    human_judgment: false
  - id: D2
    description: "CtfScoreEvent append-only ledger entity (pk=challenge, sk=user#bucket, byUser gsi1) + CtfScoreEventItem type + encoded-key parity lock"
    requirement: "CTFT-03"
    verification:
      - kind: unit
        ref: "src/entities/__tests__/ctf-key-parity.test.ts#CtfScoreEvent key parity"
        status: pass
    human_judgment: false
  - id: D3
    description: "Pure helpers isRepeatable / scoreBucket / assertAnswerTypeTransition behave per truth tables"
    requirement: "CTFT-03"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-flag-types.test.ts (16 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "CTFT-06 guard: flipping answerType static<->repeatable is rejected at the upsertCtf write boundary once CtfSolve/CtfScoreEvent history exists; flips with no solves pass"
    requirement: "CTFT-06"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/ctf-flag-types.test.ts#assertAnswerTypeTransition"
        status: pass
    human_judgment: false

# Metrics
duration: 6min
completed: 2026-07-15
status: complete
---

# Phase 53 Plan 01: Flag-Types Data-Model + Pure-Helper Foundation Summary

**Additive `Ctf` gating fields, the `CtfScoreEvent` atomic once-per-window ledger (bucket-in-sk), and the pure `isRepeatable`/`scoreBucket`/`assertAnswerTypeTransition` helpers with the CTFT-06 flip guard wired into `upsertCtf` — all backward-compatible with shipped static flags.**

## Performance

- **Duration:** ~6 min (excludes one-time `npm ci` env restore in the fresh worktree)
- **Started:** 2026-07-15T03:27:01Z
- **Completed:** 2026-07-15T03:32:29Z
- **Tasks:** 3
- **Files modified:** 7 (3 created, 4 modified)

## Accomplishments
- Extended the `Ctf` entity with six OPTIONAL flag-type fields (`answerType`, `otp` map, `unlockAfter`, `perPlayerIntervalHours`, `perPlayerMax`, `globalMax`) plus loud DISTINCT comments separating `globalMax` (hard global cutoff) from `maxSolves` (curve denominator N). Passed through `CtfInput`/`ctfAttributes` with the existing no-clobber conditional-spread. Existing judge + qr-admin tests stay green (backward compat proven).
- Added the `CtfScoreEvent` append-only ledger entity: `pk=challenge`, `sk=user#bucket`, `byUser` gsi1. The time bucket lives in the sk so 53-03's once-per-window claim is a single atomic conditional put. Pinned the encoded pk/sk + byUser index with a new key-parity block.
- Created the pure, electro-free `ctf-flag-types.ts` (`isRepeatable`, `scoreBucket`, `assertAnswerTypeTransition`) with 16 unit tests, and wired the CTFT-06 flip guard into `upsertCtf` behind a bounded `CtfSolve`/`CtfScoreEvent` existence read.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add optional gating fields to the Ctf entity + CtfInput passthrough (CTFT-01)** - `6313afaf` (feat)
2. **Task 2: Add the CtfScoreEvent ledger entity + key-parity lock (CTFT-03)** - `7081500d` (feat)
3. **Task 3: Pure ctf-flag-types helpers + CTFT-06 edit-semantics guard** - `4a5be951` (feat)

**Plan metadata:** see final `docs(53-01)` commit.

_Note: TDD tasks — the RED test for Task 3 (`ctf-flag-types.test.ts`) and its GREEN implementation are captured in the single Task 3 commit; the key-parity extension in Task 2 was authored against pre-computed emitted keys and committed with its entity._

## Files Created/Modified
- `src/lib/ctf-flag-types.ts` (created) - Pure helpers: repeatable-ness routing, time-bucket token, flip guard. No electro import.
- `src/lib/qr-errors.ts` (created) - Dependency-free `QrValidationError` so pure helpers can throw it without pulling the electro client.
- `src/lib/__tests__/ctf-flag-types.test.ts` (created) - 16 unit tests: isRepeatable truth table, scoreBucket same/adjacent window, guard throw/no-op matrix.
- `src/entities/qr.ts` (modified) - Six optional `Ctf` fields + DISTINCT globalMax/maxSolves comments.
- `src/entities/ctf.ts` (modified) - `CtfScoreEvent` entity + `CtfScoreEventItem` type + header note (no resolver .mjs mirror).
- `src/lib/qr-admin.ts` (modified) - `CtfInput` fields + no-clobber passthrough; `QrValidationError` re-export; `upsertCtf` flip guard + bounded `challengeHasSolves` read.
- `src/entities/__tests__/ctf-key-parity.test.ts` (modified) - `CtfScoreEvent` parity block pinning `pk`/`sk` + byUser index.

## Decisions Made
- **QrValidationError extraction (Rule 3 seam):** The plan requires `assertAnswerTypeTransition` to throw `QrValidationError` while keeping `ctf-flag-types.ts` pure (no electro import). Since `QrValidationError` lived in `qr-admin.ts` (which imports the entities → electro client), I extracted it into a dependency-free `qr-errors.ts` and re-exported it from `qr-admin.ts`. Both existing importers (`route.ts`, `qr-admin.test.ts`) are unchanged.
- **scoreBucket precedence:** `perPlayerIntervalHours` dominates when set (>0), else `otpPeriodSeconds`, else a documented 120s fallback — matching the meshtk OTP period convention and the spec's "OTP period for tighter flags".
- **hasSolves as a bounded read:** a limit-1 primary query on each ledger's challenge partition, short-circuiting on the first hit — never a partition scan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extracted `QrValidationError` into a dependency-free module**
- **Found during:** Task 3 (pure helpers + guard)
- **Issue:** The pure helper must throw `QrValidationError`, but that symbol lived in `qr-admin.ts`, which transitively imports the electro client — importing it would make `ctf-flag-types.ts` non-pure and drag AWS-client construction into a pure unit.
- **Fix:** Moved the class to `src/lib/qr-errors.ts` (no imports) and re-exported it from `qr-admin.ts`; `ctf-flag-types.ts` imports from `qr-errors.ts`. Non-breaking for the two existing importers.
- **Files modified:** `src/lib/qr-errors.ts` (new), `src/lib/qr-admin.ts`, `src/lib/ctf-flag-types.ts`
- **Verification:** `qr-admin.test.ts` (42) + `ctf-flag-types.test.ts` (16) green; tsc clean for touched files.
- **Committed in:** `4a5be951` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking / seam extraction)
**Impact on plan:** Necessary to satisfy the plan's explicit "pure, no electro import" + "throw QrValidationError" constraints simultaneously. No scope creep; no behavior change.

## Issues Encountered
- Fresh worktree had no `node_modules` and the host default Node (v22.1.0) is below vitest's floor. Restored deps with `npm ci` and ran all vitest/tsc under `nvm use 23.6.0` (per the repo's documented Node-for-tests gotcha).
- Pre-existing repo-wide `tsc` errors in untouched files (`components/header/dropdown-user.tsx` missing `@public/header/dcjack.svg`; `entities/__tests__/checkin.test.ts` `.model` access) are out of scope — logged, not fixed. All plan-touched files type-check clean.

## User Setup Required
None - no external service configuration required. (This is a backend data-model/pure-helper slice; no UI, no new env vars, no infra.)

## Next Phase Readiness
- **53-02 (ctf-otp, wave 1, independent):** unblocked — the `otp` field shape is defined; `ctf-otp.ts` TOTP core is self-contained.
- **53-03 (judge gates, wave 2):** unblocked — `isRepeatable`/`scoreBucket` route the solve, `CtfScoreEvent` (bucket-in-sk) is the atomic once-per-window substrate, and the entity fields the gates read all exist.
- **53-04 (effect plumbing):** unaffected by this plan's surface.
- No blockers. The `perPlayerMax` atomic-counter seam (the plan-checker's non-blocking advisory) remains a 53-03 concern.

## Self-Check: PASSED

All created files exist on disk; all three task commits (`6313afaf`, `7081500d`, `4a5be951`) are present in git log. Full verification suite green: `ctf-flag-types.test.ts` (16), `ctf-key-parity.test.ts` (6), `ctf-judge.test.ts` (15), `qr-admin.test.ts` (42) = 79 tests passing. `tsc --noEmit` clean for all plan-touched files.

---
*Phase: 53-ctf-flag-types-slice-1a-backend-answer-type-framework-rotati*
*Completed: 2026-07-15*
