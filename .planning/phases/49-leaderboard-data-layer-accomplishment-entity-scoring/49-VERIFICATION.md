---
phase: 49-leaderboard-data-layer-accomplishment-entity-scoring
verified: 2026-07-14T00:48:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 49: Leaderboard Data Layer — Accomplishment Entity + Scoring Verification Report

**Phase Goal:** A new `Accomplishment` ElectroDB entity becomes the leaderboard's source of truth for check-ins + GPX, with denormalized `RunUser` rollups bumped atomically only via create/delete helpers, a pure unit-tested scoring module, and check-in write hooks — reading (never writing) the CTF rollup.
**Verified:** 2026-07-14T00:48:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | A check-in creates exactly one `activity` Accomplishment (source `checkin`, carrying `isPrivate`), atomically raising `activityScore`+`activityCounts.checkin`; delete reverses, floored at 0 | ✓ VERIFIED | Full path traced (see below) + pure-seam tests pass |
| 2 | `globalScore = activityScore + ctfScore`, degrades to `activityScore` when ctfScore unset | ✓ VERIFIED | `leaderboard-scoring.ts:44-46`; test asserts 3+2=5, 3(unset)=3, {}=0 |
| 3 | Rank comparator: globalScore↓ → count↓ → latestActivityAt↓ → createdAt↑, tie-tested | ✓ VERIFIED | `leaderboard-scoring.ts:62-76`; 5 tie tests incl 4-level cascade |
| 4 | No CTF write path — `source` cannot be ctf/qr; POINTS has no ctf key; no judge import | ✓ VERIFIED | grep-confirmed across all 4 source files |

**Score:** 4/4 truths verified (0 present, behavior-unverified)

#### SC#1 — code-path trace (checkin.ts → accomplishment.ts → run-user.ts)

- `createCheckIn(userId, data)` (`checkin.ts:265`) writes the CheckIn row (`isPrivate ?? true`, `checkInId = crypto.randomUUID()`), then calls `createAccomplishment(buildCheckinAccomplishmentInput({...}))` (`checkin.ts:321`).
- `buildCheckinAccomplishmentInput` (`checkin.ts:238`) fixes `source:"checkin"`, `type:"activity"`, `points: POINTS.checkin` (=1), threads `isPrivate` verbatim, passes `checkInId`.
- `createAccomplishment` (`accomplishment.ts:278`) mints deterministic id `checkin#<checkInId>` (`accomplishmentIdFor`), `get`s it first — if present returns without a second write/bump (idempotent, no double-score); else `Accomplishment.create(...)` then, for source `checkin|gpx` only, calls `updateRunUserActivityCounts(increment:true)`.
- `updateRunUserActivityCounts` (`run-user.ts:382`) read-modify-writes: `nextScore = Math.max(0, current + scoreDelta)`, `nextCount = Math.max(0, current + countDelta)`, sets `latestActivityAt`. Single patch. **Sole writer** of the three rollup fields.
- `deleteCheckIn` (`checkin.ts:403`) calls `deleteAccomplishment(userId, accomplishmentIdFor("checkin", checkInId))` (`checkin.ts:422`). `deleteAccomplishment` (`accomplishment.ts:373`) `get`s the row (idempotent no-op if gone — no negative drift), deletes it, then `updateRunUserActivityCounts(increment:false)` reversing score+count, floored at 0 by the `Math.max(0, …)` clamp.

Note: the pure seams (`activityDelta`, `accomplishmentIdFor`, `findDuplicate`, `buildCheckinAccomplishmentInput`) are unit-tested; the live-DynamoDB round-trip (atomic dual-write + floor-at-0) is not exercised by an integration test, by design (unit suite has no live table). The floor clamp is a directly-observable one-line `Math.max(0, …)` and the dual-write is a straightforward traced `await` sequence — correct by inspection; a post-deploy sanity check of a real check-in→delete cycle is a reasonable (non-blocking) confirmation.

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `entities/accomplishment.ts` | Entity + create/get/delete + dup-guard | ✓ VERIFIED | 393 lines; source enum `checkin|gpx|strava`; byType/byYear GSIs; deterministic id; idempotent create/delete |
| `entities/run-user.ts` | +activityScore/activityCounts/latestActivityAt + updateRunUserActivityCounts | ✓ VERIFIED | Additive only (+117 lines, 0 removed); default-zero fields; sole-writer mutator with floor |
| `lib/leaderboard-scoring.ts` | POINTS, globalScore, rankComparator | ✓ VERIFIED | Pure; POINTS `{checkin:1,gpx:1,strava:1}`; no ctf/qr key |
| `entities/checkin.ts` | createCheckIn/deleteCheckIn hooks | ✓ VERIFIED | +75 lines; wires create/delete accomplishment carrying isPrivate |
| 4 test files | run-user-activity, leaderboard-scoring, accomplishment, checkin-hook | ✓ VERIFIED | 31 tests total, all pass |

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| checkin.ts | accomplishment.ts | `createAccomplishment` / `deleteAccomplishment` import + call | ✓ WIRED |
| accomplishment.ts | run-user.ts | `updateRunUserActivityCounts(increment:true/false)` | ✓ WIRED |
| checkin.ts | leaderboard-scoring.ts | `POINTS.checkin` import | ✓ WIRED |
| run-user.ts rollup fields | mutator only | grep: no other patch/set of activityScore/activityCounts/latestActivityAt | ✓ WIRED (single-writer) |

### Landmine Checks

| Landmine | Status | Evidence |
| --- | --- | --- |
| RunUser edit strictly additive (no ctfScore/ctfSolves added, no reorder) | ✓ PASS | `git diff 940603d2` = 1022 insertions, 0 deletions across all 8 files; no `-` lines in run-user.ts |
| Rollup mutated ONLY via create/delete helpers (single-writer) | ✓ PASS | `updateRunUserActivityCounts` called only from createAccomplishment/deleteAccomplishment; not patched elsewhere |
| Accomplishment.userId = RunUser adapter uuid | ✓ PASS | Same `userId` (session.user.id) threaded createCheckIn → createAccomplishment pk → RunUser.patch key |

### Accepted Deviation — Strava

`strava`-source accomplishment persists a row but does NOT bump the rollup: create/delete guard on `source === "checkin" || "gpx"` (`accomplishment.ts:339,385`), and `activityCounts` has only `checkin|gpx` slots. Confirmed **intentional and consistent** (Strava reserved this milestone per CONTEXT §domain; documented in `createAccomplishment` JSDoc). Does not break the check-in/gpx invariants — the guard is type-safe (`updateRunUserActivityCounts` source param is `"checkin"|"gpx"`).

### SC#4 — No CTF Write Path (grep evidence)

- `source` enum: `["checkin","gpx","strava"]` — no `ctf`/`qr` (grep for literals in entity: none).
- `POINTS`: no `ctf`/`qr` key; test `"ctf" in POINTS === false`, `"qr" in POINTS === false`.
- No import of CTF judge / `hiddenctfsub` / `CtfSolve` in any phase-49 file (only doc-comment mentions).
- `ctfScore`/`ctfSolves` never written — only read as optional `ScorableUser` fields in scoring.

### Requirements Coverage

| Requirement | Status | Evidence |
| --- | --- | --- |
| LDBR-01 (Accomplishment entity + helpers + dup-guard) | ✓ SATISFIED | accomplishment.ts |
| LDBR-02 (RunUser rollups, single-writer, additive) | ✓ SATISFIED | run-user.ts |
| LDBR-03 (scoring module: POINTS, globalScore, comparator) | ✓ SATISFIED | leaderboard-scoring.ts |
| LDBR-04 (check-in hook create/delete, idempotent) | ✓ SATISFIED | checkin.ts |
| LDBR-12 (CTF read-only boundary) | ✓ SATISFIED | SC#4 grep evidence |

### Gate Commands (independently run)

| Gate | Command | Result | Status |
| --- | --- | --- | --- |
| Unit tests | `npx vitest run` (4 phase suites, Node 23.6.0) | **31 passed (4 files)** | ✓ PASS |
| Typecheck | `npx tsc --noEmit` | 5 errors in 2 files — both out-of-scope | ✓ PASS |

tsc errors (all pre-existing, none in phase-49 files):
- `src/components/header/dropdown-user.tsx:34` — missing `@public/header/dcjack.svg` module (QR-card work, untouched here).
- `src/entities/__tests__/checkin.test.ts:108-111` — `.model` property (4 lines, one root cause; pre-existing test file, NOT the phase's `checkin-hook.test.ts`).

Both files are absent from this phase's diff (8 changed files, neither listed), confirming these errors are pre-existing and untouched.

### Anti-Patterns Found

None. Sole `XXX` match (`run-user.ts:183` `rabbit_XXXX`) is a displayName-format notation in a pre-existing doc comment, not a debt marker and not in phase-49 code.

### Gaps Summary

No gaps. All 4 Success Criteria are made TRUE by the shipped code (traced end-to-end, not merely present). All landmines pass, the Strava deviation is intentional and consistent, both gate commands pass with only the two documented out-of-scope tsc errors. No CTF write path exists.

---

_Verified: 2026-07-14T00:48:00Z_
_Verifier: Claude (gsd-verifier)_
