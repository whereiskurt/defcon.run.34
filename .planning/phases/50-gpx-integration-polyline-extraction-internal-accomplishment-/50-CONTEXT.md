# Phase 50: GPX Integration — Polyline Extraction + Internal Accomplishment Endpoint - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning
**Source:** Design spec §6.2 + a dedicated seam-exploration of run.gpx/run.human (findings baked in below)

<domain>
## Phase Boundary

**This phase wires GPX uploads into the leaderboard across TWO apps** — the only
cross-service phase of v2.2:

- **run.gpx side:** in the GPX activation path, fetch the full GPX body from S3,
  decimate the track to a ~100-point `{lat,lng}` polyline in-memory, and POST an
  accomplishment payload to a new internal endpoint on run.human.
- **run.human side:** a new secret-gated `POST /api/internal/accomplishment` that
  resolves the OIDC sub → adapter userId and calls the **already-built**
  `createAccomplishment({ source:"gpx", ... })` from Phase 49.

**NOT in this phase:** the leaderboard read API / caching / routes (Phase 51);
any UI (Phase 52); any CTF path. No changes to Phase 49's `Accomplishment`
entity or scoring — they are already gpx-ready (see below).

**Key simplification (YAGNI — decided from the seam explore):** the decimated
polyline is computed in-memory in run.gpx and persisted on the run.human
`Accomplishment.metadata.polyline` (which already exists). **There is NO new
`GpxFile.polyline` attribute and NO run.gpx schema change** — one fewer
migration, lower risk. (Spec §6.2 speculated a GpxFile.polyline "useful to
gpx-studio later"; that's YAGNI and dropped.)
</domain>

<decisions>
## Implementation Decisions (LOCKED — from spec + seam explore)

### The run.human data layer is ALREADY gpx-ready (Phase 49 shipped it)
- `apps/run.human/webapp/src/entities/accomplishment.ts`: `source` enum already
  includes `"gpx"`; `metadata.polyline` already exists as `list<{lat,lng}>`;
  `metadata.gpxFileId`/`distance`/`elevation` exist; `createAccomplishment` is
  **idempotent on `accomplishmentIdFor("gpx", gpxFileId)`** and bumps
  `RunUser.activityScore`/`activityCounts.gpx` exactly once.
- `apps/run.human/webapp/src/lib/leaderboard-scoring.ts`: `POINTS.gpx = 1`.
- So the run.human endpoint is thin: validate secret → resolve sub→userId →
  `createAccomplishment({ source:"gpx", userId, gpxFileId, name, distance,
  elevation, polyline, points: POINTS.gpx, completedAt })`. The check-in hook in
  `entities/checkin.ts` (lines ~238-251) is the exact template for building the
  input + calling the helper.

### run.gpx activation hook (LDBR-05)
- **Hook site:** `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/confirm/route.ts`,
  immediately AFTER the status flip to `"active"` (currently lines ~133-139;
  `result.data` is the activated `GpxFileItem`).
- **Guard:** only fire when `targetUserId !== "GLOBAL"`. GLOBAL = seeded community
  routes with no individual owner; they must NOT produce an accomplishment (and
  `"GLOBAL"` is not a resolvable sub). For a GLOBAL file the real owner sub is in
  `file.data.uploadedBy`, but the decision here is **skip GLOBAL entirely**.
- **Fetch full body:** the confirm route currently only validates the first 1KB
  (`gpx-validator.ts` uses `Range: bytes=0-1023`). Add a full `GetObjectCommand`
  (no Range) via the already-imported `s3Client` + `BUCKET` and
  `Body.transformToString()` to get the whole GPX for track parsing.
- **Decimate:** reuse the haversine + `<trkpt lat lon><ele>` regex from
  `apps/run.gpx/webapp/scripts/seed-local-routes.ts` (the `stats()` function,
  lines ~41-67). There is **no existing downsample function** — write a simple
  stride-based downsample to ~100 points, output `{lat, lng}` objects (NOT
  `[lat,lng]` tuples — the Accomplishment polyline wants objects). Keep total
  distance/elevation too (send as `distance`/`elevation`).
- **POST target + auth:** run.gpx already calls run.human internally. Use
  `process.env.RUN_HUMAN_INTERNAL_URL` (prod value already includes the
  `/${region}` basePath; dev falls back to `http://localhost:${LOCAL_HUMAN_PORT||3001}`)
  and header `X-Internal-Secret: process.env.AUTH_INTERNAL_SECRET`. The exact
  template is `apps/run.bib/webapp/src/lib/social-qr.ts` (base-URL derivation +
  X-Internal-Secret POST to `/api/internal/user/{sub}`) and
  `apps/run.gpx/webapp/src/app/api/gpx/public/checkins/route.ts` (RUN_HUMAN_URL
  derivation). run.gpx reads the secret in `config/auth.ts` (as `INTERNAL_SECRET`).
- **Identity sent:** run.gpx is pure JWT (no adapter) — `session.user.id` = the
  **raw OIDC sub**, and `GpxFile.userId` = that same sub. So run.gpx sends
  `file.data.userId` (the sub) directly in the payload. No lookup on the gpx side.
- **Non-fatal:** wrap the fetch+decimate+POST in try/catch; on any failure log and
  continue — the confirm response and the user's save must succeed regardless.

### run.human internal endpoint (LDBR-06)
- **New route:** `apps/run.human/webapp/src/app/api/internal/accomplishment/route.ts`
  — `POST`, body `{ oidcSub, gpxFileId, name, distance, elevation, polyline,
  completedAt }`.
- **Secret gate:** copy the pattern from
  `apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts` (validate
  `x-internal-secret` header === `config.auth.internalSecret`
  (`AUTH_INTERNAL_SECRET`); mismatch → 403).
- **sub→adapter bridge:** the resolver already exists but is a PRIVATE, duplicated
  function (`resolveAdapterUserId` in `internal/user/[oidcSub]/route.ts` ~lines
  16-30, and copy-pasted in `internal/meshtastic-radios/route.ts`). **Extract it to
  a shared exported helper `getAdapterUserIdBySub(sub)` in
  `apps/run.human/webapp/src/entities/auth-user.ts`** (which already owns the
  authjs account-table namespace + exports `scanAccountSubs`), and use it in the
  new route. Query shape: authjs table `run-human-authjs`, `IndexName: "GSI1"`,
  `GSI1PK = ACCOUNT#run.defcon.run`, `GSI1SK = ACCOUNT#{sub}` → `Items[0].userId`.
  (Refactoring the two existing call sites to use the shared helper is a nice-to-
  have; at minimum the new route uses it. Don't re-duplicate the query.)
- **No RunUser for sub:** if `getAdapterUserIdBySub` returns null, **log and return
  a benign 200/204 (dropped)** — a runner must have a run.human identity to score;
  this is not an error.
- **Create:** call the existing `createAccomplishment` (idempotent on gpxFileId).

### Claude's Discretion
- Exact downsample algorithm (even stride vs. every-Nth) — even stride to ≤100
  points is fine; Douglas-Peucker is overkill.
- Endpoint response body/status codes (beyond the 403 gate + benign-drop).
- Whether to also refactor the 2 existing `resolveAdapterUserId` duplicates to the
  shared helper (bonus cleanup; keep it if cheap, skip if it widens scope).
- Test seams: extract the pure decimation fn + the pure payload-builder so they're
  unit-testable without S3/DynamoDB (mirror Phase 49's pure-seam convention).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design spec
- `docs/superpowers/specs/2026-07-13-leaderboard-activity-table-design.md` §6.2
  (GPX seam), §7 (identity), §11/§15 (CTF boundary — unaffected here).

### run.gpx (the producer side)
- `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/confirm/route.ts` — hook site
  (status flip ~133-139; `targetUserId` at 51/72).
- `apps/run.gpx/webapp/src/lib/s3-client.ts` — `s3Client`, `BUCKET`, key layout.
- `apps/run.gpx/webapp/src/lib/gpx-validator.ts` — GetObjectCommand pattern (~99-112).
- `apps/run.gpx/webapp/scripts/seed-local-routes.ts` — haversine + trkpt regex to reuse (~41-67).
- `apps/run.gpx/webapp/src/config/auth.ts` — JWT-only, `session.user.id` = OIDC sub (~223, 269-271); `INTERNAL_SECRET` (~30).
- `apps/run.gpx/webapp/src/app/api/gpx/public/checkins/route.ts` — `RUN_HUMAN_INTERNAL_URL` derivation (~12-36).

### run.human (the consumer side)
- `apps/run.human/webapp/src/entities/accomplishment.ts` — `createAccomplishment` (gpx-ready, idempotent).
- `apps/run.human/webapp/src/lib/leaderboard-scoring.ts` — `POINTS.gpx`.
- `apps/run.human/webapp/src/entities/checkin.ts` — the create-input + call template.
- `apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts` — secret gate + `resolveAdapterUserId` to extract.
- `apps/run.human/webapp/src/entities/auth-user.ts` — where the shared `getAdapterUserIdBySub` belongs (owns account-table namespace).
- `apps/run.human/webapp/src/config/index.ts` — `config.auth.internalSecret` (~29).

### The cross-service POST template
- `apps/run.bib/webapp/src/lib/social-qr.ts` — base-URL + `X-Internal-Secret` POST to run.human `/api/internal/user/{sub}`.
</canonical_refs>

<specifics>
## Specific Ideas
- Keep the run.gpx hook a **fire-and-forget best-effort** — the leaderboard must
  never make a GPX save fail. Test that a thrown fetch/POST is swallowed.
- The polyline shape MUST be `{lat, lng}` objects to match
  `Accomplishment.metadata.polyline` (Phase 52's PolylineRenderer consumes it).
- Idempotency is already handled by `createAccomplishment` (gpxFileId key) — the
  endpoint doesn't need its own dedup; just don't double-POST unnecessarily.
</specifics>

<deferred>
## Deferred Ideas
- `GpxFile.polyline` persistence on the run.gpx side — dropped (YAGNI); revisit
  only if gpx-studio needs a server-side polyline.
- Refactoring both existing `resolveAdapterUserId` duplicates — optional cleanup.
- Leaderboard read API + UI → Phases 51/52.
- Backfill of already-active GPX files into accomplishments → optional one-off
  (pre-event, trivial).
</deferred>

---

*Phase: 50-gpx-integration-polyline-extraction-internal-accomplishment-*
*Context gathered: 2026-07-14 from spec + seam exploration*
