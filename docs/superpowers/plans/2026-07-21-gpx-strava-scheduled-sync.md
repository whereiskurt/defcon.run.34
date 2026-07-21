# Scheduled Strava Sync + Sync-Now Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Twice-daily (10:00/22:00 America/Los_Angeles) background Strava sync for all linked runners, a per-user "Sync now" button (2/day), and strip cards that let runners tag already-imported untagged runs.

**Architecture:** First-ever deploy of the Phase-33 EventBridge Scheduler module (bumped to v1.1.0: multi-schedule + timezone), invoking the existing secret-guarded gpx internal batch route, which gains a rolling last-7-days default window and the `AUTH_INTERNAL_SECRET` guard fallback (no new secrets — the Lambda reads the existing `jwt/internal_secret` SSM param). A new session-authenticated `sync-now` route reuses the untagged batch import for one user, limited 2/day via a tiny new ElectroDB counter entity. The activities list joins `fileId`/`conDay` so imported-untagged strip cards become tag-a-day UI (confirming via the shipped `PUT files/{id}` conDay path).

**Spec:** `docs/superpowers/specs/2026-07-21-gpx-strava-scheduled-sync-design.md` (decisions table binding).

## Global Constraints

- Branch `feature/gpx-strava-scheduled-sync` (already at origin/main + spec commit). Commit per task; NEVER merge PRs without Kurt.
- Tests: `cd apps/run.gpx/webapp && source ~/.nvm/nvm.sh && nvm use 22.12.0 && npx vitest run` (baseline 123 passed / 1 skipped).
- `strava.ratelimit` telemetry contract LOCKED; all Strava calls via `stravaGet`.
- Secrets rule (2026-07-21 hotfix pattern): guards/callers use `INTERNAL_SYNC_SECRET ?? AUTH_INTERNAL_SECRET`; NO new SSM parameters. The scheduler Lambda reads SSM `/{site}/secrets/{region}/jwt/internal_secret` (the AUTH_INTERNAL_SECRET source — see run.gpx service.hcl:192).
- Untagged imports (batch + sync-now) consume NO user quotas and NO conDay (existing batch semantics).
- Sync-now daily limit: 2/day non-admin (admins uncapped), day boundary = con-local date (`CON_TZ_OFFSET_HOURS` from con-days.ts). Counter rows are tiny (1/user/day); NO DynamoDB TTL (table TTL is off — do not touch it).
- Infra applies ONLY via CI workflows (terragrunt-plan.yml / terragrunt-apply.yml), never local terragrunt (worktree is uninitialized). Show Kurt the plan output before apply.
- Studio build gate: `cd apps/run.gpx && ./build-frontend.sh`.
- Do not commit build artifacts (tsconfig.tsbuildinfo, next-env.d.ts, webapp/public/studio).

---

### Task 1: Server lib + internal route — rolling window, guard fallback, untagged single-user sync

**Files:**
- Modify: `apps/run.gpx/webapp/src/lib/strava-sync.ts`
- Modify: `apps/run.gpx/webapp/src/app/api/gpx/internal/strava-sync/route.ts`
- Test: `apps/run.gpx/webapp/src/lib/strava-sync.test.ts` (append), `apps/run.gpx/webapp/src/app/api/gpx/internal/strava-sync/route.test.ts` (new)

**Interfaces produced:**
- `bandBounds(afterDaysDefault = 7)` (stays private): env `STRAVA_SYNC_AFTER`/`BEFORE` still win; when NEITHER is set, returns `{ after: floor(Date.now()/1000) - afterDaysDefault*86400 }` — the rolling window.
- `export async function syncUserUntagged(user: StravaUserToken, afterUnixSeconds: number): Promise<{ imported: number; skipped: number }>` — single-user version of the batch `syncUser`: banded activity list (per_page 100, ≤3 pages, `after` param), dedupe via `getExistingStravaIds`, `importActivity(user, activity)` with NO conDay and NO quota, per-activity try/catch, hard cap 30 imports per call (sanity bound; count overflow as skipped).
- Internal route: guard becomes `process.env.INTERNAL_SYNC_SECRET ?? process.env.AUTH_INTERNAL_SECRET` (comment: 2026-07-21 pattern, Lambda sends the jwt/internal_secret value). Accepts an OPTIONAL JSON body `{ afterDays?: number }` (integer 1–60) forwarded to `runStravaSync(afterDays)` → `bandBounds(afterDays)`; absent/invalid body → default 7. `runStravaSync` gains the optional `afterDays` param threaded to `syncUser`.

**Steps:** TDD — (1) tests: bandBounds precedence (env wins / rolling default; use vi.stubEnv), syncUserUntagged (mock fetch: dedupe respected, no conDay in created record — assert via mocked GpxFile.create args or skip entity-level and test via fetch-URL band + return counts), internal route tests (403 wrong/missing secret with only AUTH_INTERNAL_SECRET set via vi.stubEnv — proves fallback; afterDays forwarded — mock runStravaSync). (2) implement. (3) full suite green. (4) commit `feat(gpx): rolling sync window, guard fallback, untagged single-user sync`.

---

### Task 2: Sync-now route + daily counter entity

**Files:**
- Create: `apps/run.gpx/webapp/src/entities/gpx-sync-now.ts`
- Create: `apps/run.gpx/webapp/src/app/api/gpx/strava/sync-now/route.ts`
- Test: `apps/run.gpx/webapp/src/app/api/gpx/strava/sync-now/route.test.ts`, `apps/run.gpx/webapp/src/lib/sync-now-limit.test.ts` (if a pure helper is extracted)

**Interfaces:**
- Entity `GpxSyncNow` (standalone file, copy the client/table boilerplate from `gpx-file.ts:1-15`): model `{ entity: "gpxSyncNow", version: "1", service: "gpx" }`, attributes `userId` (pk composite), `date` (sk composite, con-local `YYYY-MM-DD`), `count` (number, default 0). Primary index only.
- `export const SYNC_NOW_PER_DAY = 2;`
- Route `POST /api/gpx/strava/sync-now`: guard stack identical to `strava/activities` (session, gpxstudio, hasStrava, live-lockout). Con-local today via the same offset math con-days.ts uses (import/export `conLocalDate` from con-days.ts — export it if currently private). Non-admin: read counter row; `count >= 2` → 429 `{ error: "Sync limit reached", message: "You've used both of today's syncs — the background sync runs at 10 AM and 10 PM anyway", remainingToday: 0 }`. Increment counter (ElectroDB `upsert`/`add`) BEFORE syncing. Then `fetchSingleUserStravaToken` (409 if null — do NOT decrement back; a burned slot on a broken link is acceptable and simpler), `syncUserUntagged(token, now-7d)`. Response `{ ok, imported, skipped, remainingToday }`. `maxDuration = 120`. logEvent `gpx.strava.syncnow` meta `{ imported, skipped }`.
- Admins: skip counter entirely, `remainingToday: 99`.

**Steps:** TDD with the standard vi.hoisted mock pattern (see `strava/activities/route.test.ts`): 401/403/400 guards, 429 at count 2, increment-then-sync order, admin bypass, happy path shape. Commit `feat(gpx): POST /strava/sync-now — untagged per-user sync, 2/day`.

---

### Task 3: Activities list joins fileId/conDay for imported cards

**Files:**
- Modify: `apps/run.gpx/webapp/src/lib/strava-sync.ts` (extend index fn + StripActivity)
- Modify: `apps/run.gpx/webapp/src/app/api/gpx/strava/activities/route.ts`
- Test: append to `strava-sync.test.ts` + adjust `activities/route.test.ts`

**Interfaces:**
- `export async function getStravaFileIndex(userId): Promise<Map<string, { fileId: string; conDay?: string }>>` — same single query as `getExistingStravaIds` (byCreatedAt, pages all, non-failed files with stravaActivityId), returning the richer map. Reimplement `getExistingStravaIds` as `new Set(index.keys())` over it (one query pattern, no behavior change).
- `StripActivity` gains optional `fileId?: string; conDay?: string | null`. `toStripActivities(activities, index: Map<...>)` — CHANGED second param (was Set). `imported = index.has(String(id))`; when imported, set `fileId` and `conDay` (null when file has no tag). Update the two existing call sites (activities route passes the map; nothing else uses toStripActivities).
- Activities route: `Promise.all([listStripActivitiesBackfill…, getStravaFileIndex(...)])`.

**Steps:** TDD (toStripActivities map variant incl. untagged-null vs tagged; route test asserts fileId/conDay in response). Full suite green. Commit `feat(gpx): activities list carries fileId/conDay for imported runs`.

---

### Task 4: Strip UI — Sync now button + tag-a-day cards

**Files:**
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/logic/strava-import.ts`
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/StravaStrip.svelte`

**Interfaces/behavior:**
- Client: `StripActivity` mirror gains `fileId?`, `conDay?: string | null`. New `export async function syncNowStrava(): Promise<{ imported: number; skipped: number; remainingToday: number }>` — POST `${getApiBase()}/strava/sync-now`, same 401/error handling idiom as siblings.
- Header: "Sync now" button (icon `Zap` or `RefreshCw`-variant, label "Sync now") between the Strava title and refresh; disabled while syncing; on success toast "Synced N new runs (M skipped) · X sync{s} left today" then re-run `loadStrip()` and `refreshMyConRuns()`. 429 → show its message inline (same error row as list errors). Hidden when `!$hasStrava`.
- Cards: three states — (a) fresh (unimported): unchanged import flow; (b) imported + `conDay == null`: NOT dimmed/inert — amber "Assign a day" badge instead of the green ✓; tap opens the SAME popover in assign mode (title "Which DEF CON day is this run for?"), confirm calls `updateCloudFile(fileId, { conDay })` (from `$lib/cloud-sync`, shipped in #869) then marks the card's `conDay`, decrements that day's usage `remaining`, `refreshMyConRuns()`; (c) imported + tagged: dimmed, green badge now shows `✓ {weekday-short}` (e.g. "✓ Fri") — inert (reassignment stays in My Maps Save-as dialog).
- Popover: one component, a `mode: 'import' | 'assign'` distinction only in the confirm handler + button label ("Import run" / "Save day").

**Steps:** implement; gate `./build-frontend.sh` clean + zero svelte-check errors in touched files; commit `feat(gpx): strip Sync-now button + tag-a-day cards for untagged imports`.

---

### Task 5: Infra — scheduler module v1.1.0 + live unit

**Files:**
- Create: `infra/terraform/modules/strava-sync-scheduler/v1.1.0/` (copy v1.0.0 then modify: `main.tf`, `variables.tf`, keep `iam.tf`, `lambda/index.mjs` unchanged except as noted)
- Create: `infra/terraform/modules/strava-sync-scheduler/config.hcl`
- Create: `infra/terraform/live/site/region/us-east-1/strava-sync-scheduler/terragrunt.hcl`

**Module v1.1.0 changes:**
- `variables.tf`: replace `schedule_expression` with `schedules` = `map(string)` (name → cron), default `{}`; add `schedule_expression_timezone` (string, default `"UTC"`).
- `main.tf`: `aws_scheduler_schedule` gains `for_each = var.schedules`, name suffixed `-${each.key}`, `schedule_expression = each.value`, `schedule_expression_timezone = var.schedule_expression_timezone`. Outputs adjust (`schedule_names = keys`).
- Lambda `index.mjs`: unchanged (POSTs `SYNC_URL` with `x-internal-secret`, no body — the route's rolling 7-day default from Task 1 makes a body unnecessary).
- `config.hcl`: mirror `modules/bib-reconcile-lambda/config.hcl` verbatim pattern (site_vars/region_vars/module_path/merged_inputs, no source_path needed).

**Live unit (`region/us-east-1/strava-sync-scheduler/terragrunt.hcl`):** mirror `region/us-east-1/bib-reconcile/terragrunt.hcl` structure (skip include, module include → `${find_in_parent_folders("modules")}/strava-sync-scheduler/config.hcl`, providers regional, `terraform.source = .../v1.1.0`, NO npm before_hook). Inputs:
```hcl
inputs = merge(include.module.locals.merged_inputs, {
  sync_url                      = "http://<gpx internal origin>/api/gpx/internal/strava-sync"
  internal_sync_secret_ssm_path = "/<site>/secrets/use1/jwt/internal_secret"
  internal_sync_secret_ssm_arn  = "arn:aws:ssm:us-east-1:<acct>:parameter/<site>/secrets/use1/jwt/internal_secret"
  schedules = {
    morning = "cron(0 10 * * ? *)"
    evening = "cron(0 22 * * ? *)"
  }
  schedule_expression_timezone = "America/Los_Angeles"
  schedule_enabled             = true
})
```
Resolve the REAL values by reading how sibling units reference the gpx service origin and site labels: `sync_url` must reach the gpx ALB/service internally — find the exact internal URL pattern other units/services use for `AUTH_INTERNAL_URL`-style cross-service calls (`grep -rn "internal" infra/terraform/live/site/services/run.gpx/service.hcl` and how `AUTH_INTERNAL_URL` is templated) and mirror it for gpx; the SSM path comes from service.hcl:192's `valueFrom` template with `{{SITE_LABEL}}`/`{{REGION_LABEL}}` resolved the way the site/region vars resolve them (check site.hcl). If the internal origin is only reachable inside the VPC, confirm the module's Lambda has VPC config; v1.0.0 has none — if the sync URL is a public CloudFront/ALB URL that admits the path, DO NOT use it (internal routes must never be public); instead check how the ALB listener exposes the service internally (e.g. `http://run-gpx.internal…` service-connect / private DNS seen in `CMS_INTERNAL_URL` values). Follow whatever pattern `AUTH_INTERNAL_URL` uses for gpx→auth, applied to →gpx.

**Steps:** (1) author files; (2) `gh workflow run terragrunt-plan.yml -f region=us-east-1 -f modules=strava-sync-scheduler` (confirm input names against the workflow file first) and read the run's plan output — it must show ONLY adds (Lambda, roles, log group, 2 schedules); (3) commit `feat(infra): strava-sync-scheduler v1.1.0 — 10am/10pm PT schedules (use1)`. DO NOT apply in this task.

---

### Task 6: Gates, PR, ship, apply, verify

1. Full vitest + `npm run build` (webapp) + `./build-frontend.sh` → green.
2. Push branch; `gh pr create` (summary: scheduler deploy, sync-now 2/day, tag-a-day cards, rolling window; note the terragrunt plan run URL); **merge only with Kurt's standing ship-it approval for this phase** (granted 2026-07-21).
3. Release: `./apps/release-all.sh --apps run.gpx --regions use1 --pr --no-merge`; deploy via `gh workflow run deploy.yml -f region=us-east-1 -f pr_number=<release PR> -f invalidate_cache=true -f runner=github-hosted`; wait rollout COMPLETED. App MUST be live before infra (the guard fallback must be serving).
4. Infra apply: `gh workflow run terragrunt-apply.yml -f region=us-east-1 -f modules=strava-sync-scheduler -f runner=github-hosted`; watch to success.
5. Verify: invoke the Lambda once manually (`aws lambda invoke --function-name <output name>`) and check gpx logs show the batch run (not 403); confirm the two schedules exist (`aws scheduler list-schedules`); UAT notes for Kurt (Sync now button, tag-a-day cards).
6. Ledger + memory updates.

## Self-review notes
- Spec coverage: schedule (T5), rolling window (T1), untagged semantics (T1/T2), 2/day counter (T2), strip Sync-now + tagging UI (T3/T4), server-controlled knobs (constants). Deliberate deviations from spec: no `{afterDays}` Lambda body (route default suffices — spec's mechanism simplified, same outcome); counter has no TTL (table TTL off; rows negligible).
- Consistency: `syncUserUntagged` (T1) consumed by T2; `getStravaFileIndex`/`toStripActivities(map)` (T3) consumed by T4; guard fallback (T1) prerequisite for T5's Lambda secret choice.
