# Phase 31b — Strava date-banded ingestion worker (DESIGN — needs Kurt review)

Split out of Phase 31. **Phase 31a** (Convert-to-public + compliance guards + entity fields
`source`/`publicShareEligible`/`stravaActivityId`) ships separately and is app-only. This doc
is the ingestion worker: infra + cross-service + external API — flagged for review before build.

## Goal
On a schedule, poll Strava for each linked user and import their in-window runs as **private**
routes (`source:strava`, `publicShareEligible:false`) into their gpx.studio collection, deduped
by activity id. They become public only via Convert-to-public (31a) → request-share/publish.

## Findings (where things live)
- **Strava tokens:** run.auth uses NextAuth `@auth/dynamodb-adapter` → access/refresh tokens are
  in the auth table's `account` records (provider=`strava`, has `refresh_token`, `access_token`,
  `expires_at`, `providerAccountId`=athlete id). `auth-profile` holds Strava profile (`strava.id`, etc.).
- **Strava secrets:** `AUTH_STRAVA_CLIENT_ID` / `AUTH_STRAVA_CLIENT_SECRET` in SSM
  `/dc34/secrets/{region}/strava/*` (used for token refresh).
- **Target store:** run.gpx `dc34-gpx` table + S3 uploads bucket (write private GpxFile rows + GPX objects).

## Cross-service access — the key decision
The worker must read run.auth's NextAuth `account` tokens. Options (pick one — **Kurt**):
1. **Worker in run.auth** (owns the tokens) that writes GPX into run.gpx's table/bucket. Keeps token
   reads in-service; needs run.gpx DDB/S3 write grants.
2. **Worker in run.gpx** granted read on the auth table. Keeps GPX logic in-service; crosses into auth's data.
3. **Small internal auth endpoint** (`GET /internal/strava-tokens`, secret-auth) that returns
   {userId, athleteId, accessToken} for linked users (refreshing as needed); run.gpx worker calls it.
   Cleanest boundary; no cross-table IAM. **Recommended.**

## Worker shape
- **Trigger:** EventBridge Scheduler (cron, e.g. every 6h) → invokes the worker.
- **Host:** either a Lambda, or an internal Next route `POST /api/gpx/internal/strava-sync`
  (shared-secret / SigV4) hit by the scheduler via an invoker Lambda or API-destination.
  (run.gpx is Next-on-ECS; simplest is a secret-guarded internal route + EventBridge→Lambda→route,
  or an EventBridge→Lambda that does the work with the SDK.)
- **Per linked user:** refresh token → `GET /athlete/activities?after=<band.start>&before=<band.end>`
  (paginate) → for each new activity (not already imported by `stravaActivityId`):
  `GET /activities/{id}/streams?keys=latlng,altitude,time` → build GPX → write S3 object +
  private GpxFile (`source:strava`, `publicShareEligible:false`, `stravaActivityId`, status active).
- **Rate limits:** 600/15min, 30k/day — throttle + per-user watermark; a throttled user retries next cycle.

## Date band (Kurt: configurable)
- Config (SSM/env), NOT hardcoded — his usual band Black Hat→end of DEF CON (~2wk, ~Aug 2–11 DC34).
- One range now (`STRAVA_SYNC_AFTER` / `STRAVA_SYNC_BEFORE` epoch), extensible to multiple.
- Passed straight to Strava `after`/`before` so out-of-window runs are never fetched.

## Infra (Terraform, under infra/terraform/live/site/services/run.gpx/)
- EventBridge Scheduler rule + target (Lambda or invoker).
- Worker Lambda (if option 1/2/3-invoker) + IAM (SSM strava secret read, DDB/S3 access, and per the
  cross-service option, auth-table read or auth internal-endpoint secret).
- Deploy surface per repo convention: build + terragrunt apply for the run.gpx service units.

## Open questions for Kurt
1. Cross-service option 1 / 2 / 3 (recommend 3 — internal auth endpoint)?
2. Poll cadence (every 6h? nightly during the band?).
3. Confirm the date-band default + where to store it (SSM param vs service env).
4. GPX builder: reuse the `gpx` lib's `buildGPX` server-side, or assemble minimal GPX directly?

## Testing
Needs a real Strava-linked account in the band — Kurt is linking whereiskurt@. Until infra + a
linked account exist, this can't be end-to-end verified; app-layer GPX-building can be unit-tested.
