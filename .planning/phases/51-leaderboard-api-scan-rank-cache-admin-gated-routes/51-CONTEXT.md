# Phase 51: Leaderboard API — Scan/Rank/Cache + Admin-Gated Routes - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning
**Source:** Design spec §8.1 + Phase 49/50 shipped code (all helpers this phase consumes already exist)

<domain>
## Phase Boundary

**run.human-only, read-side API only.** Two admin-gated GET routes that back the
(hidden) leaderboard, plus a testable pure ranking/cache core:

- `GET /api/leaderboard?page&limit&filter` — scan `RunUser`, compute
  `globalScore` per row, assign `globalRank` over the FULL sorted list (a
  `filter` narrows the returned page but NOT the rank), paginate; 60s in-memory
  cache with stale-while-revalidate (DC33 parity). Admin-gated (`requireAdmin` →
  404 on denial).
- `GET /api/leaderboard/[userId]/accomplishments` — lazily return one runner's
  runs (incl. `metadata.polyline`) via the Phase-49 `getAccomplishmentsByUser`.
  Admin-gated. **No privacy filter now** (admin-only surface) — but leave a clearly
  marked hook point where the launch-time privacy filter will slot in (spec §9).

**NOT in this phase:** any UI, `PolylineRenderer`, `LeaderboardTable`, or the page
(Phase 52); any write path; any CTF write. The scoring math + entity reads all
already exist (Phases 49/50) — this phase only assembles + serves + caches + gates.
</domain>

<decisions>
## Implementation Decisions (LOCKED — from spec + shipped code)

### Everything the routes consume already exists — reuse, don't rebuild
- **Ranking:** `apps/run.human/webapp/src/lib/leaderboard-scoring.ts` exports
  `globalScore(user)` = `activityScore + (ctfScore ?? 0)` and `rankComparator`
  (globalScore↓ → total count↓ → latestActivityAt↓ → createdAt↑). USE THESE — do
  not re-derive scoring.
- **User scan:** `apps/run.human/webapp/src/entities/run-user.ts` /
  `admin-report.ts` already expose `scanAllRunUsers()` (full-table scan → row
  spine). Reuse it.
- **Per-user runs:** `apps/run.human/webapp/src/entities/accomplishment.ts`
  exports `getAccomplishmentsByUser(userId)` (Phase 49). Reuse it.
- **Admin gate:** `apps/run.human/webapp/src/lib/admin-gate.ts` exports
  `requireAdmin(session)` (+ `revalidateAdmin` for fresh-claims on entry). Denial
  MUST map to **404** (not 403) per the non-disclosure contract — for a route
  handler: `return new Response(null, { status: 404 })`. This is the SAME gate
  Phase 43's admin dashboard uses.
- **CTF signal:** `ctfScore` / `ctfSolves` are read straight off the scanned
  `RunUser` rows (CTF-owned, default 0 until that judge ships) — for the score sum
  and the CTF count chip. Never written here.

### Pure, testable core (mirror Phase 49 convention)
- Extract the assembly into a PURE function, e.g.
  `lib/leaderboard-data.ts` `buildLeaderboard(users, { page, limit, filter })`
  → `{ rows: [{ globalRank, userId, displayName, mqttUsertype, globalScore,
  activityCounts, ctfSolves, ... }], total, page, ... }`. Rank is assigned over
  the full sorted list BEFORE the filter/paginate slice. Unit-test: ranking
  order, rank-stable-under-filter, pagination math, ctfScore-absent → score
  degrades. No DynamoDB needed for these tests (feed in fixture rows).
- The route handler is a thin shell: gate → (cache) → `scanAllRunUsers` →
  `buildLeaderboard` → JSON.

### Cache: 60s in-memory + stale-while-revalidate (DC33 port)
- Port the mechanism from DC33 `app/api/leaderboard/route.ts` (60s `CACHE_DURATION`
  in-memory; serve stale while a background refresh runs so no request blocks on
  the scan). Keep it a small module-level cache in the route (or a tiny
  `lib/leaderboard-cache.ts`). A cold call populates; within 60s serves cached;
  past 60s serves stale + refreshes. Make the TTL a named constant.
- Keep the cache logic thin and testable where practical (e.g. a pure
  "is-stale(now, fetchedAt)" helper), but the in-memory store itself is fine to
  prove by inspection + a route test with a stubbed scan.

### Route shapes
- `GET /api/leaderboard` — query params `page` (default 1), `limit` (default 25,
  DC33 used 25), `filter` (optional substring/keyword over displayName; narrows
  the returned page, rank stays global). Returns `{ rows, page, limit, total }`.
- `GET /api/leaderboard/[userId]/accomplishments` — returns
  `{ accomplishments: [{ type, source, name, description, completedAt, year,
  metadata }] }` from `getAccomplishmentsByUser`. Mark the privacy-filter hook
  point (a no-op passthrough now with a comment: launch will filter others'
  `isPrivate`).

### Claude's Discretion
- Exact row DTO fields (keep it lean — what Phase 52's table needs: rank, id,
  displayName, mqttUsertype, globalScore, activityCounts, ctfSolves).
- Whether the cache lives inline in the route vs. a tiny helper module.
- Filter semantics (case-insensitive displayName contains is fine).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design spec
- `docs/superpowers/specs/2026-07-13-leaderboard-activity-table-design.md` §8.1
  (API), §9 (privacy — deferred, but mark the hook), §3 (admin-gated decision).

### DC33 source to port (read-only, different repo)
- `/Users/khundeck/working/defcon.run.33/apps/nx/apps/webapp/src/app/api/leaderboard/route.ts`
  — the 60s cache + stale-while-revalidate + globalRank-over-full-list logic to port.
- `/Users/khundeck/working/defcon.run.33/apps/nx/apps/webapp/src/app/api/leaderboard/[userId]/accomplishments/route.ts`
  — the per-user accomplishments route shape.

### DC34 patterns + already-shipped helpers to reuse (this repo)
- `apps/run.human/webapp/src/lib/leaderboard-scoring.ts` — `globalScore`, `rankComparator` (Phase 49).
- `apps/run.human/webapp/src/entities/run-user.ts` + `apps/run.human/webapp/src/lib/admin-report.ts` — `scanAllRunUsers` + `RunUserItem`.
- `apps/run.human/webapp/src/entities/accomplishment.ts` — `getAccomplishmentsByUser` (Phase 49).
- `apps/run.human/webapp/src/lib/admin-gate.ts` — `requireAdmin`/`revalidateAdmin`; denial → 404.
- `apps/run.human/webapp/src/app/(protected)/admin/` + `app/api/admin/users/route.ts` (Phase 43) — the exact admin-gated route + 404 pattern to mirror.
- `apps/run.human/webapp/src/lib/admin-report.test.ts` — pure-helper unit-test convention to mirror for `leaderboard-data.ts`.
</canonical_refs>

<specifics>
## Specific Ideas
- `globalRank` MUST be computed over the FULL sorted set, then the filter/paginate
  applied — so a filtered view still shows a runner's true global rank (DC33
  behavior). Unit-test this explicitly.
- Admin denial is 404, never 403 (route-existence non-disclosure — the whole board
  is hidden). Both routes.
- The board must rank correctly with `ctfScore` absent (CTF judge not shipped yet)
  — `globalScore` already defaults it to 0; test a mixed fixture.
</specifics>

<deferred>
## Deferred Ideas
- Privacy filter on the per-user route (others' private check-ins) → launch-time
  (spec §9); leave a marked no-op hook now.
- UI (`PolylineRenderer`, `LeaderboardTable`, the page) → Phase 52.
- Profile rank widget, nav link, public gate relaxation → launch flip.
</deferred>

---

*Phase: 51-leaderboard-api-scan-rank-cache-admin-gated-routes*
*Context gathered: 2026-07-14 from spec + Phase 49/50 shipped code*
