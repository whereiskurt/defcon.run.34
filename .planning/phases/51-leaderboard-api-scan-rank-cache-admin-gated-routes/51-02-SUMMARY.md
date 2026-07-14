---
phase: 51-leaderboard-api-scan-rank-cache-admin-gated-routes
plan: 02
subsystem: run.human leaderboard API
tags: [leaderboard, cache, admin-gate, stale-while-revalidate, LDBR-07]
requires:
  - "51-01: buildLeaderboard + isStale + LEADERBOARD_CACHE_TTL_MS (leaderboard-data.ts)"
  - "run.human: admin-gate (requireAdmin/revalidateAdmin), scanAllRunUsers, config/auth"
provides:
  - "lib/leaderboard-cache.ts: getCachedScan (60s stale-while-revalidate) + __resetLeaderboardCache"
  - "GET /api/leaderboard: admin-gated board endpoint {rows,total,page,limit}"
affects:
  - "Phase 52 UI (LeaderboardTable) consumes GET /api/leaderboard"
tech-stack:
  added: []
  patterns:
    - "Injected-scanner cache: getCachedScan(scan) — no entity coupling, stub-testable"
    - "404 non-disclosure gate + fresh-claims revalidateAdmin(authUserId) (Phase 43 parity)"
    - "vitest fake timers + vi.fn scan counter to prove cold/within-TTL/stale/single-flight"
key-files:
  created:
    - apps/run.human/webapp/src/lib/leaderboard-cache.ts
    - apps/run.human/webapp/src/lib/leaderboard-cache.test.ts
    - apps/run.human/webapp/src/app/api/leaderboard/route.ts
    - apps/run.human/webapp/src/app/api/leaderboard/__tests__/route.test.ts
  modified: []
decisions:
  - "Dropped DC33 dev file-cache (YAGNI) — in-memory module singleton only"
  - "Scanner injected into getCachedScan (not imported) — keeps cache trivially testable"
  - "HTTP no-store; freshness owned by the 60s in-memory cache, not the CDN"
metrics:
  duration_min: 6
  completed: 2026-07-14
status: complete
---

# Phase 51 Plan 02: Main Leaderboard Route + Stale-While-Revalidate Cache Summary

Shipped `GET /api/leaderboard` — the admin-gated (404 non-disclosure + fresh-claims) main board endpoint — sitting on a ported DC33 60s in-memory stale-while-revalidate scan cache that never blocks a request on the full-table `RunUser` scan.

## What Was Built

**Task 1 — `lib/leaderboard-cache.ts` (60s stale-while-revalidate cache):**
- `getCachedScan(scan)` takes an INJECTED scanner (no entity import → stub-testable). Cold path is the only one that awaits the scan; within TTL serves cached rows; past TTL serves the STALE rows synchronously and fires a single non-awaited background refresh (single-flight `refreshing` guard). A failed refresh is swallowed/logged so it never rejects a served request.
- Imports `isStale` + `LEADERBOARD_CACHE_TTL_MS` from plan-01 `leaderboard-data.ts` — one TTL source of truth. Ported DC33's mechanism minus the dev file-cache (YAGNI).
- `__resetLeaderboardCache()` (test-only) nulls state for isolation.
- 4 vitests (fake timers + `vi.fn` scan counter): cold populate 1×, within-TTL cache hit (still 1×), past-TTL stale-then-refresh (→2×, later serves new), concurrent single-flight.

**Task 2 — `app/api/leaderboard/route.ts` (`GET /api/leaderboard`):**
- Thin shell mirroring `app/api/admin/users/route.ts`: `auth()` → `requireAdmin` (→404) → `revalidateAdmin(session.user.authUserId)` (→404; identity landmine — OIDC sub, NOT `session.user.id`) → `getCachedScan(scanAllRunUsers)` → `buildLeaderboard` → `Response.json({rows,total,page,limit})` with `Cache-Control: no-store`.
- Params: `page` (default 1, min 1), `limit` (default 25, min 1), `filter` (default "").
- `runtime = "nodejs"`, `dynamic = "force-dynamic"`. RunUserItem[] assigns straight into `buildLeaderboard` — no cast (tsc-clean contract).
- 6 vitests: non-admin/anon/stale-admin → bare 404 with scan never called; admin → 200 ranked rows with globalRank over the full set and CTF-inclusive `globalScore`; page/limit parsed (page-2 slice, rank preserved); filter applied after ranking (Bob narrows to 1 row but keeps globalRank 2).

## Verification

- `leaderboard-cache.test.ts` — 4/4 pass; `leaderboard/__tests__/route.test.ts` — 6/6 pass (10 total, Node 23.6.0).
- `npx tsc --noEmit` — only the two KNOWN pre-existing out-of-scope errors remain (`dropdown-user.tsx` svg import, `checkin.test.ts` `.model`); NONE reference `leaderboard-cache.ts` or the new route. Gate PASS per the plan's tsc contract.

## Threat Mitigations (from plan `<threat_model>`)

- **T-51-06 (EoP):** non-admin path 404s and `scanAllRunUsers` is asserted un-called.
- **T-51-07 (Info Disclosure):** denial → 404 (never 403); `revalidateAdmin(authUserId)` fail-closed denies a just-revoked admin in the JWT staleness window.
- **T-51-08 (DoS):** 60s stale-while-revalidate single-flights refreshes, never blocking on the scan.
- **T-51-09 (Info Disclosure):** response carries only the plan-01 `LeaderboardRow` DTO — no email/PII.

## Deviations from Plan

None — plan executed exactly as written. RED confirmed for both tasks (missing module / missing route) before GREEN.

## Self-Check: PASSED

- FOUND: `apps/run.human/webapp/src/lib/leaderboard-cache.ts`
- FOUND: `apps/run.human/webapp/src/lib/leaderboard-cache.test.ts`
- FOUND: `apps/run.human/webapp/src/app/api/leaderboard/route.ts`
- FOUND: `apps/run.human/webapp/src/app/api/leaderboard/__tests__/route.test.ts`
- FOUND commits: 8dcb2114 (test), 41870c11 (feat cache), 575c2c9f (test), 315720b8 (feat route)
