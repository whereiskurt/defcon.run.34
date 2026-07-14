---
phase: 51-leaderboard-api-scan-rank-cache-admin-gated-routes
verified: 2026-07-14T02:00:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 51: Leaderboard API — Scan/Rank/Cache + Admin-Gated Routes Verification Report

**Phase Goal:** Two admin-gated read APIs back the (hidden) board. `GET /api/leaderboard` scans `RunUser`, computes `globalScore`, assigns `globalRank` over the full sorted list (filter narrows display, not rank), paginates, and caches 60s with stale-while-revalidate. `GET /api/leaderboard/[userId]/accomplishments` lazily returns a runner's runs (incl. `polyline`). Both `requireAdmin` → 404 on denial; marked no-op privacy hook.
**Verified:** 2026-07-14
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| SC1 | Non-admin → 404 on BOTH routes (bare, no body, scan/read NOT called on denial); admin → JSON; entry revalidates fresh claims via `revalidateAdmin(authUserId)` | ✓ VERIFIED | Both routes: `if (!gate.ok) return NOT_FOUND()` then `if (!authUserId || !(await revalidateAdmin(authUserId))) return NOT_FOUND()` with `NOT_FOUND = () => new Response(null, { status: 404 })`. Both routes read `session?.user?.authUserId` (NOT `session.user.id`). Tests assert non-admin/anonymous/stale-admin → status 404 + empty body + `mockScan`/`mockGetAccomplishmentsByUser` never called, and `revalidateAdmin` called with `"sub-1"`. route.test.ts 6/6, accomplishments route.test.ts 4/4. |
| SC2 | `buildLeaderboard` assigns `globalRank` over the FULL sorted set, THEN filters + paginates; pagination math; ctfScore-absent → globalScore degrades to activityScore | ✓ VERIFIED | `leaderboard-data.ts`: sorts a COPY with `rankComparator`, maps assigning `globalRank = index + 1` over full set, THEN filters (case-insensitive displayName contains), THEN paginates. `globalScore(u)` = `activityScore + (ctfScore ?? 0)`. Tests: filter "charlie" returns C at globalRank 3; page-2/limit-2 returns global ranks [3,4]; ctf-absent row's globalScore == activityScore. Route test confirms end-to-end: filter=bob → globalRank 2 preserved; A's globalScore 150 (100+50 ctf). data.test.ts 15/15. |
| SC3 | leaderboard-cache 60s stale-while-revalidate: cold populates, within-TTL hit, past-TTL serves stale synchronously + non-awaited background refresh (never blocks on scan); single-flight; TTL named constant | ✓ VERIFIED | `leaderboard-cache.ts`: cold path awaits scan once; past-TTL fires `refreshInBackground` (non-awaited `void Promise`) and returns current stale `data` immediately; `refreshing` guard single-flights. `LEADERBOARD_CACHE_TTL_MS = 60_000` named constant, imported by cache (one TTL source). Tests (fake timers): cold=1× scan, within-TTL=1× (no rescan), past-TTL returns rowsA synchronously + scan→2× + later call sees rowsB, single-flight concurrent call stays 2×. cache.test.ts 4/4. |
| SC4 | Per-user route returns runs incl. `metadata.polyline` intact | ✓ VERIFIED | `accomplishments/route.ts` maps `getAccomplishmentsByUser` rows to `{ type, source, name, description, completedAt, year, metadata }` keeping `metadata` whole. Test asserts `row.metadata.polyline` deep-equals `[{lat,lng},...]`. accomplishments route.test.ts. |

**Score:** 4/4 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/lib/leaderboard-data.ts` | Pure buildLeaderboard + isStale + TTL const | ✓ VERIFIED | 136 lines; imports `globalScore`/`rankComparator` from scoring; no DynamoDB/network. Wired by cache + route. |
| `src/lib/leaderboard-cache.ts` | 60s stale-while-revalidate scan cache | ✓ VERIFIED | 89 lines; imports `isStale`/`LEADERBOARD_CACHE_TTL_MS`; injected scanner. Wired by route. |
| `src/app/api/leaderboard/route.ts` | Admin-gated main board endpoint | ✓ VERIFIED | Gate→cache→buildLeaderboard→JSON; `runtime=nodejs`, `dynamic=force-dynamic`. |
| `src/app/api/leaderboard/[userId]/accomplishments/route.ts` | Admin-gated per-user runs + privacy hook | ✓ VERIFIED | Gate→getAccomplishmentsByUser→applyPrivacyFilter (no-op)→JSON. |
| 4 `*.test.ts` / `__tests__` suites | Full coverage | ✓ VERIFIED | 29 tests, all pass (15+4+6+4). |

### Key Link Verification

| From | To | Via | Status |
| ---- | --- | --- | ------ |
| leaderboard-data.ts | leaderboard-scoring.ts | `import { globalScore, rankComparator }` — no re-derived scoring | ✓ WIRED |
| leaderboard-cache.ts | leaderboard-data.ts | `import { isStale, LEADERBOARD_CACHE_TTL_MS }` — one TTL source | ✓ WIRED |
| route.ts | admin-gate.ts / run-user / leaderboard-cache / leaderboard-data | requireAdmin/revalidateAdmin + scanAllRunUsers + getCachedScan + buildLeaderboard | ✓ WIRED |
| accomplishments/route.ts | admin-gate.ts / accomplishment.ts | requireAdmin/revalidateAdmin + getAccomplishmentsByUser | ✓ WIRED |

### Boundary Verification

| Boundary | Status | Evidence |
| -------- | ------ | -------- |
| Both routes deny → 404 never 403 | ✓ VERIFIED | Only `new Response(null, { status: 404 })` in both; no 403/401 anywhere. Tests assert 404 + empty body on all deny paths. |
| REUSE only (globalScore/rankComparator/scanAllRunUsers/getAccomplishmentsByUser/requireAdmin) | ✓ VERIFIED | All consumed via import; nothing re-implemented. |
| Phase 49/50 files UNTOUCHED (git) | ✓ VERIFIED | `git log --stat` shows accomplishment.ts, leaderboard-scoring.ts, run-user.ts last modified by Phase 49 commits (8a4076e2, 4aab1a16, f08a9063, 9606cb5d/ecee6c5d); zero Phase-51 commits touch them. |
| Marked no-op privacy hook (spec §9) | ✓ VERIFIED | `applyPrivacyFilter(items)` identity no-op with block comment referencing launch-time filter; called explicitly (`const visible = applyPrivacyFilter(...)`). |
| No PII/email in leaderboard row DTO | ✓ VERIFIED | `LeaderboardRow` = {globalRank, userId, displayName, mqttUsertype, globalScore, activityCounts, ctfSolves}. Test asserts exact key set + `not.toHaveProperty("email"/"emailFull")`. |
| revalidateAdmin uses authUserId not session.user.id | ✓ VERIFIED | Both routes: `session?.user?.authUserId`; tests assert `toHaveBeenCalledWith("sub-1")`. |

### Behavioral Spot-Checks / Gates (independently run)

| Gate | Command | Result | Status |
| ---- | ------- | ------ | ------ |
| Phase-51 vitest | `npx vitest run src/lib/leaderboard-data.test.ts src/lib/leaderboard-cache.test.ts src/app/api/leaderboard` (Node 23.6.0) | 4 files, **29 passed** | ✓ PASS (matches expected 29) |
| tsc | `npx tsc --noEmit` | Only the 2 known pre-existing out-of-scope errors: `dropdown-user.tsx(34,24)` svg module + `checkin.test.ts` `.model` (×4 lines, one family). NONE reference any phase-51 file. | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
| ----------- | ----------- | ------ | -------- |
| LDBR-07 | 51-01, 51-02 | ✓ SATISFIED | scan→globalScore→globalRank-over-full-list→paginate + 60s stale-while-revalidate + requireAdmin→404 + count chips from activityCounts/ctfSolves. |
| LDBR-08 | 51-03 | ✓ SATISFIED | Per-user admin-gated route returns runs incl. polyline; no-op privacy hook marked. |

### Anti-Patterns Found

None. No TODO/FIXME/XXX/TBD/HACK/placeholder markers in any phase-51 source file. The `applyPrivacyFilter` no-op is an intentional, spec-§9-referenced deferral (T-51-05, disposition "accept"), not unreferenced debt.

### Disconfirmation Pass (Confirmation Bias Counter)

- **Partial requirement?** None found — count chips (`ctfSolves`, `activityCounts`) are surfaced and normalized to 0 (never NaN/undefined), tested.
- **Test that passes but doesn't test the behavior?** The route test stubs `getCachedScan` as passthrough — cache behavior is NOT proven by the route test. But it IS proven independently by cache.test.ts (fake-timer stale/background/single-flight). No gap.
- **Uncovered error path?** Background refresh failure: `refreshInBackground` `.catch` swallows+logs so a served-stale request never rejects — covered by design; the single-flight test exercises a hanging refresh. Adequate.
- **INFO (non-blocking):** `admin-gate.ts` block comment (a Phase-43 file, untouched here) still says `revalidateAdmin(session.user.id)` in prose, while the actual routes correctly pass `authUserId`. Pre-existing doc drift in an out-of-scope file, not a Phase-51 defect.

### Gaps Summary

No gaps. All 4 Success Criteria trace to shipped code exercised by 29 passing behavioral tests; both admin gates deny with a bare 404 and never invoke the data layer on denial; ranking is stable under filter; the cache serves stale synchronously with a non-awaited single-flight background refresh; the per-user route preserves `metadata.polyline`; the DTO carries no PII; Phase 49/50 files are git-confirmed untouched; the privacy hook is marked. tsc clean except the 2 known out-of-scope errors.

---

_Verified: 2026-07-14T02:00:00Z_
_Verifier: Claude (gsd-verifier)_
