---
phase: 50-gpx-integration-polyline-extraction-internal-accomplishment-
verified: 2026-07-14T01:25:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
gates:
  run_human_vitest: "16/16 pass (auth-user 4, gpx-accomplishment-input 7, internal/accomplishment route 5)"
  run_human_tsc: "PASS — only the 2 known pre-existing out-of-scope errors remain (dropdown-user.tsx dcjack.svg module + checkin.test.ts .model x4); ZERO in phase-50 files"
  run_gpx_vitest: "5/5 pass (parseTrack, decimate >max, decimate <=max, payload contract, notify swallow)"
  run_gpx_tsc: "PASS — exit 0, fully clean"
---

# Phase 50: GPX Integration — Polyline Extraction + Internal Accomplishment Endpoint — Verification Report

**Phase Goal:** GPX uploads (owned by run.gpx) become leaderboard accomplishments on run.human without coupling run.human to run.gpx's table — on non-GLOBAL GPX activation, run.gpx fetches the full S3 body, decimates to a ~100-point `{lat,lng}` polyline in-memory, and POSTs to a new secret-gated internal endpoint that resolves sub→userId and calls the Phase-49 `createAccomplishment(source:"gpx")`. NO GpxFile schema change.
**Verified:** 2026-07-14
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
| --- | ------- | ---------- | -------------- |
| SC1 | Activating a non-GLOBAL GPX file produces exactly one `gpx` Accomplishment (polyline + distance/elevation), raising `activityScore` + `activityCounts.gpx` | ✓ VERIFIED | End-to-end path traced (below); both seam halves unit-tested; score-bump is Phase-49 `createAccomplishment` (untouched, 31-test verified) reached via the route's `createAccomplishment(buildGpxAccomplishmentInput(...))` call, proven called-exactly-once with `source:"gpx"`/`points:POINTS.gpx`/`userId`/`gpxFileId` in the route test |
| SC2 | Re-sending the same `gpxFileId` is a no-op (no double-score) — idempotency proven by test | ✓ VERIFIED | Route passes `gpxFileId` through `buildGpxAccomplishmentInput` and calls `createAccomplishment` once with no local dedup; idempotency lives in Phase-49 `accomplishment.ts` (`accomplishmentIdFor` → `gpx#{gpxFileId}` deterministic sk + get-first short-circuit, lines 306–313, T-49-05 tested). Mechanism confirmed present + correctly inherited |
| SC3 | Endpoint rejects wrong/absent `x-internal-secret` (403), maps sub→userId, drops-with-log an unresolvable sub (benign 200, not error) | ✓ VERIFIED | `route.ts` L28–31 403 before body parse; L54 `getAdapterUserIdBySub`; L55–64 null→`console.log(gpxFileId only)`→200 `{dropped:true}`. Route test asserts all: absent-secret 403 (+`json` never called), wrong-secret 403, unresolvable→200 `{dropped:true}` + create never called, happy→create once |
| SC4 | A GPX-notify failure (or GLOBAL file) leaves the upload/save successful; GLOBAL produces no accomplishment | ✓ VERIFIED | `confirm/route.ts` L151 `if (targetUserId !== "GLOBAL")` guard; L152–177 the whole hook is try/catch (caught error `console.log`'d with gpxFileId only, swallowed); `notifyAccomplishment` has its own inner try/catch swallow (L165–178). Swallow-test present (`gpx-accomplishment.test.ts` L89–106: resolves when fetch rejects) |

**Score:** 4/4 truths verified (0 present-but-behavior-unverified)

### SC1 End-to-End Trace (producer → consumer → data layer)

1. `confirm/route.ts` L151 guards non-GLOBAL; L154–155 `GetObjectCommand{Bucket,Key:file.data.key}` (NO Range) → L157 `Body.transformToString()` = full body.
2. L158 `parseTrack(gpxText)` → `{points,distance,elevation}` (haversine sum + positive-gain, ported from `seed-local-routes.ts`).
3. L160–168 `buildAccomplishmentPayload({oidcSub:file.data.userId, gpxFileId:id, name:file.data.fileName, points, distance, elevation, completedAt:Date.now()})` → `decimatePolyline(points,100)` emits ≤100 `{lat,lng}` OBJECTS (first/last preserved), `source` deliberately omitted.
4. L169 `await notifyAccomplishment(payload)` POSTs to `${humanBaseUrl()}/api/internal/accomplishment` with `X-Internal-Secret`.
5. run.human `route.ts` L54 `getAdapterUserIdBySub(oidcSub)` (GSI1 `ACCOUNT#run.defcon.run`/`ACCOUNT#{sub}` → `Items[0].userId`); L68 `createAccomplishment(buildGpxAccomplishmentInput(body, userId))` with server-fixed `source:"gpx"`, `points:POINTS.gpx`.
6. Phase-49 `createAccomplishment` (untouched) L315–323 stores `metadata.polyline`/distance/elevation; L339–346 `updateRunUserActivityCounts(source:"gpx",increment:true)` bumps `activityScore` + `activityCounts.gpx` exactly once for a genuinely-new row.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ----------- | ------ | ------- |
| `run.human/.../entities/auth-user.ts` | exported `getAdapterUserIdBySub` (GSI1 bridge) | ✓ VERIFIED | L100–115 exported async; single shared home; imported by both internal routes |
| `run.human/.../lib/gpx-accomplishment-input.ts` | pure `buildGpxAccomplishmentInput`, server-fixed source | ✓ VERIFIED | L56–94; `source:"gpx"` hardcoded L80, throws on missing userId/gpxFileId/name/completedAt |
| `run.human/.../api/internal/accomplishment/route.ts` | new secret-gated POST | ✓ VERIFIED | 403 gate → parse → resolve → drop-or-create; wired to shared helper + Phase-49 create |
| `run.human/.../api/internal/accomplishment/__tests__/route.test.ts` | 3-branch route test | ✓ VERIFIED | 5 tests (403 absent, 403 wrong, benign-drop, 400 missing sub, happy create-once) |
| `run.human/.../entities/auth-user.test.ts` | resolver test | ✓ VERIFIED | 4 tests (id / empty / absent-Items null / exact GSI1 keys) |
| `run.human/.../lib/gpx-accomplishment-input.test.ts` | pure builder test | ✓ VERIFIED | 7 tests (mapping/source-fix/throws) |
| `run.gpx/.../lib/gpx-accomplishment.ts` | parseTrack + decimatePolyline + buildAccomplishmentPayload + notifyAccomplishment | ✓ VERIFIED | all 4 present; notify swallows all errors; base URL from fixed env only |
| `run.gpx/.../lib/gpx-accomplishment.test.ts` | 5 behaviors | ✓ VERIFIED | 5/5 pass |
| `run.gpx/.../api/gpx/files/[id]/confirm/route.ts` | guarded best-effort hook after status flip | ✓ VERIFIED | L146–177 post-activation, non-GLOBAL, full try/catch |

### Key Link Verification

| From | To | Via | Status |
| ---- | --- | --- | ------ |
| confirm/route.ts | gpx-accomplishment.ts | `import {parseTrack,buildAccomplishmentPayload,notifyAccomplishment}` L8–12; called L158/160/169 | ✓ WIRED |
| notifyAccomplishment | run.human `/api/internal/accomplishment` | POST `${humanBaseUrl()}/api/internal/accomplishment` + `X-Internal-Secret` | ✓ WIRED |
| route.ts | getAdapterUserIdBySub | `import from @/entities/auth-user` L3; called L54 | ✓ WIRED |
| route.ts | createAccomplishment | `import from @/entities/accomplishment` L4; called L68 | ✓ WIRED |
| secret gate | config.auth.internalSecret | `AUTH_INTERNAL_SECRET` (config/index.ts L29), header `x-internal-secret` | ✓ WIRED |
| [oidcSub]/route.ts (GET+PATCH) | shared getAdapterUserIdBySub | imports shared helper; private duplicate deleted (grep count 0) | ✓ WIRED |

### Boundaries / Landmines

| Check | Status | Evidence |
| ----- | ------ | -------- |
| source server-fixed to `"gpx"` (LDBR-12 — cannot be ctf/qr) | ✓ VERIFIED | Hardcoded in builder L80; body's source ignored; Accomplishment enum excludes ctf/qr; unit-asserted |
| NO GpxFile schema change | ✓ VERIFIED | `git diff 4acb37f3..HEAD` — `entities/gpx-file.ts` UNTOUCHED |
| `getAdapterUserIdBySub` single shared exported helper, no private duplicate | ✓ VERIFIED | grep `resolveAdapterUserId` across run.human src = 0 matches |
| Phase-49 `accomplishment.ts` + `leaderboard-scoring.ts` UNTOUCHED | ✓ VERIFIED | `git diff 4acb37f3..HEAD` — neither file appears |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
| ----------- | ---------- | ------ | -------- |
| LDBR-05 (run.gpx confirm hook: full S3 fetch + decimate ≤100 `{lat,lng}` + POST + skip GLOBAL + non-fatal + no schema change) | 50-02 | ✓ SATISFIED | confirm/route.ts hook + gpx-accomplishment.ts; SC1/SC4 verified |
| LDBR-06 (run.human secret-gated route + shared getAdapterUserIdBySub + idempotent on gpxFileId + drop-with-log) | 50-01 | ✓ SATISFIED | route.ts + auth-user.ts + builder; SC2/SC3 verified |

### Behavioral Spot-Checks / Gates (run independently, Node 23.6.0)

| Gate | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| run.human phase-50 vitest | `npx vitest run src/entities/auth-user.test.ts src/lib/gpx-accomplishment-input.test.ts src/app/api/internal/accomplishment` | 16 passed (3 files) | ✓ PASS |
| run.human tsc | `npx tsc --noEmit` | Only 2 known pre-existing out-of-scope errors (dropdown-user.tsx dcjack.svg + checkin.test.ts `.model` x4); ZERO in phase-50 files | ✓ PASS |
| run.gpx phase-50 vitest | `npx vitest run src/lib/gpx-accomplishment.test.ts` | 5 passed | ✓ PASS |
| run.gpx tsc | `npx tsc --noEmit` | exit 0, fully clean | ✓ PASS |

### Anti-Patterns Found

None. No unreferenced TBD/FIXME/XXX debt markers in phase-50 files. The `console.log` drop/skip lines are intentional benign-drop/best-effort logging (gpxFileId only, never the secret — T-50-04/T-50-08). The two remaining tsc errors are pre-existing and documented in `deferred-items.md` (untouched import graph).

### Human Verification Required

None blocking. All four Success Criteria are proven by traced code plus unit tests on both seam halves; the score-bump state transition is Phase-49-tested behavior reached through a call-once-asserted route seam.

_Optional (non-blocking) integration smoke, if a live environment is available later:_ activate a real non-GLOBAL GPX file end-to-end and confirm one `gpx` Accomplishment appears with a decimated `metadata.polyline` and that `activityScore`/`activityCounts.gpx` increment — this exercises the live S3-fetch + cross-service HTTP transport that unit tests stub. Not required for phase sign-off.

### Gaps Summary

No gaps. Both plans (50-01 consumer, 50-02 producer) delivered exactly the seam the goal specifies. The cross-service contract matches on both sides (`{oidcSub, gpxFileId, name, distance, elevation, polyline, completedAt}` sent; producer omits `source`, endpoint server-fixes it). Idempotency, the 403 gate, benign-drop, GLOBAL-skip, and best-effort swallow are all present and test-backed. No GpxFile schema change; Phase-49 data layer untouched; the sub→userId resolver was correctly centralized with the private duplicate removed. All four gate commands pass.

---

_Verified: 2026-07-14T01:25:00Z_
_Verifier: Claude (gsd-verifier)_
