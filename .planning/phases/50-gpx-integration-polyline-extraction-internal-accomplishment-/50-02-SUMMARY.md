---
phase: 50-gpx-integration-polyline-extraction-internal-accomplishment-
plan: 02
subsystem: run.gpx (GPX → leaderboard producer seam)
tags: [gpx, leaderboard, accomplishment, cross-service, best-effort, LDBR-05]
status: complete
requires:
  - "50-01: POST /api/internal/accomplishment on run.human (X-Internal-Secret gated)"
provides:
  - "run.gpx confirm-route hook that POSTs a decimated accomplishment on GPX activation"
  - "pure gpx-accomplishment lib (parseTrack / decimatePolyline / buildAccomplishmentPayload / notifyAccomplishment)"
affects:
  - "apps/run.gpx/webapp/src/app/api/gpx/files/[id]/confirm/route.ts"
tech-stack:
  added: []
  patterns:
    - "best-effort fire-and-forget cross-service POST (try/catch swallow, never breaks the primary response)"
    - "pure seams extracted for unit-testability without live S3/DynamoDB (Phase 49 convention)"
    - "RUN_HUMAN_INTERNAL_URL + X-Internal-Secret base-URL derivation (social-qr.ts template)"
key-files:
  created:
    - apps/run.gpx/webapp/src/lib/gpx-accomplishment.ts
    - apps/run.gpx/webapp/src/lib/gpx-accomplishment.test.ts
  modified:
    - apps/run.gpx/webapp/src/app/api/gpx/files/[id]/confirm/route.ts
decisions:
  - "Even-stride downsample to ≤100 {lat,lng} objects (Douglas-Peucker overkill per CONTEXT)."
  - "No GpxFile schema change — polyline lives only on run.human Accomplishment.metadata (YAGNI)."
  - "oidcSub sent = file.data.userId (run.gpx is pure JWT, so GpxFile.userId is the raw OIDC sub)."
  - "Hook reads the full S3 body (no Range); the 1KB validator stays separate."
metrics:
  duration: ~15m
  completed: 2026-07-14
  tasks: 2
  files: 3
---

# Phase 50 Plan 02: GPX Integration (run.gpx Producer Side) Summary

Wired real GPX uploads into the leaderboard: on GPX activation, run.gpx fetches the full S3 body, decimates the track to a ≤100-point `{lat,lng}` polyline in-memory, and best-effort POSTs an accomplishment payload to run.human's secret-gated `/api/internal/accomplishment` (built in 50-01) — GLOBAL community files are skipped and any failure is swallowed so the user's save never breaks.

## What Was Built

### Task 1 — Pure GPX parse + decimate + payload builder + best-effort notify (TDD)
`apps/run.gpx/webapp/src/lib/gpx-accomplishment.ts`:
- `parseTrack(gpx)` — ports the haversine + `<trkpt lat lon><ele>` regex from `scripts/seed-local-routes.ts` `stats()`; returns `{ points: [lat,lon][], distance, elevation }` (summed-haversine meters + positive-gain, both rounded).
- `decimatePolyline(points, max=100)` — for `length ≤ max` maps all to `{lat,lng}` objects; otherwise even-stride downsamples to exactly `max` entries always including the first and last point. Emits `{lat,lng}` OBJECTS (not `[lat,lng]` tuples) to match `Accomplishment.metadata.polyline`.
- `buildAccomplishmentPayload(args)` — assembles the exact run.human contract `{ oidcSub, gpxFileId, name, distance, elevation, polyline, completedAt }`; deliberately omits `source` (the endpoint server-fixes `source:"gpx"`).
- `notifyAccomplishment(payload, fetchImpl?)` — derives run.human's base URL from fixed env (`RUN_HUMAN_INTERNAL_URL` / dev `localhost:${LOCAL_HUMAN_PORT||3001}` / service-discovery host, read at call time), POSTs JSON with `X-Internal-Secret: AUTH_INTERNAL_SECRET`, and wraps everything in try/catch that swallows every error and resolves.

TDD cycle: RED (`test(50-02)` af2b65fa, import fails) → GREEN (`feat(50-02)` 497bbbf9, 5/5 tests pass).

### Task 2 — Wire the best-effort hook into confirm/route.ts
`apps/run.gpx/webapp/src/app/api/gpx/files/[id]/confirm/route.ts`:
- Added `GetObjectCommand` to the existing `@aws-sdk/client-s3` import and imported the three lib helpers.
- Immediately AFTER the status flip to `"active"` and BEFORE the success `NextResponse`, added a guarded block: only when `targetUserId !== "GLOBAL"`, full-body `GetObjectCommand` (no Range) → `parseTrack` → `buildAccomplishmentPayload` (oidcSub = `file.data.userId`, name = `file.data.fileName`, `completedAt = Date.now()`) → `await notifyAccomplishment`.
- The entire block is try/catch; a caught error is `console.log`'d with the gpxFileId only (never the secret/payload) and swallowed. The confirm success/failure response shapes, the GLOBAL branch, and the validation/failure paths are untouched.

## Verification

- `npx vitest run src/lib/gpx-accomplishment.test.ts` → 5/5 green (parse, decimate >max, decimate ≤max, payload contract, notify swallows a rejected fetch via `vi.stubGlobal`).
- Full `npx vitest run` → 16/16 green (no regression in the existing 2 suites).
- `npx tsc --noEmit` for run.gpx → fully clean (0 output, exit 0) — includes the confirm-route edit and the new lib.
- `git diff` shows no change to `apps/run.gpx/webapp/src/entities/gpx-file.ts` — no schema change / migration (CONTEXT YAGNI honored).

## Threat Mitigations Applied

| Threat ID | Mitigation |
|-----------|------------|
| T-50-06 (DoS via slow/failing notify) | Hook is try/catch fire-and-forget; S3/parse/POST errors swallowed, confirm response returned regardless (unit-proven on the notify path). |
| T-50-07 (GLOBAL bogus accomplishment) | `targetUserId !== "GLOBAL"` guard skips community files. |
| T-50-08 (secret leak via logs) | Secret sent as a header only; catch logs gpxFileId + message only. |
| T-50-09 (SSRF / spoofed host) | Base URL derived from fixed env, never request input (social-qr.ts derivation). |

## Deviations from Plan

None — plan executed exactly as written. The `tsconfig.tsbuildinfo` build-cache artifact touched by running `tsc` was restored (not committed) to keep the tree clean.

## Self-Check: PASSED

- FOUND: apps/run.gpx/webapp/src/lib/gpx-accomplishment.ts
- FOUND: apps/run.gpx/webapp/src/lib/gpx-accomplishment.test.ts
- FOUND (modified): apps/run.gpx/webapp/src/app/api/gpx/files/[id]/confirm/route.ts
- FOUND commit af2b65fa (test RED)
- FOUND commit 497bbbf9 (feat pure lib GREEN)
- FOUND commit 0ca34786 (feat confirm-route hook)
