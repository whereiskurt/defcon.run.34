# Phase 33 — Strava/aggregate scheduler infra (DRAFT for Kurt review)

Wires the Phase 31b Strava sync (and, later, the Phase 32 aggregate precompute) to a cron.
**DRAFT: authored without `terragrunt plan`/`validate` in-sandbox (no terraform/terragrunt
binary + no scheduler precedent in the repo) — validate before apply.** Modeled on
`bib-reconcile-lambda`.

## What's in this PR
- **Module** `infra/terraform/modules/strava-sync-scheduler/v1.0.0/` — `aws_scheduler_schedule`
  (EventBridge Scheduler, first in the repo) → invoker Lambda (`lambda/index.mjs`) + IAM
  (lambda exec role w/ SSM read of the secret; scheduler role w/ `lambda:InvokeFunction`).
- The Lambda reads the shared secret from SSM and POSTs the run.gpx internal endpoint.

## Still needs authoring/decision (didn't commit — would break deploys if half-wired)
1. **SSM secret** — create SecureString `/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/internal/sync_secret`
   (a `secrets` module entry or manual). Both run.auth + run.gpx read it; the scheduler Lambda reads it.
2. **`service.hcl` env/secret wiring** (add, matching existing `environment[]`/`secrets[]`):
   - run.auth: `secrets += INTERNAL_SYNC_SECRET → …/internal/sync_secret`
   - run.gpx: `secrets += INTERNAL_SYNC_SECRET → same`; `environment += AUTH_INTERNAL_URL`
     (VERIFY the run.auth basePath so `${AUTH_INTERNAL_URL}/api/internal/strava-tokens` resolves),
     `STRAVA_SYNC_AFTER`, `STRAVA_SYNC_BEFORE` (epoch band — your Black Hat→end-of-DEFCON window).
   - ⚠️ add the `secrets[]` entry only AFTER the SSM param exists (missing valueFrom fails the task).
3. **`config.hcl`** for the module (mirror `bib-reconcile-lambda/config.hcl`: `module_path`,
   `merged_inputs`) — I didn't replicate it blind; copy that file's shape.
4. **Live unit** `infra/terraform/live/site/region/us-east-1/strava-sync/terragrunt.hcl` — model on
   `region/us-east-1/bib-reconcile/terragrunt.hcl`:
   ```hcl
   include "skip"      { path = "${find_in_parent_folders("region")}/skip.hcl" ; expose = true }
   include "module"    { path = "${find_in_parent_folders("modules")}/strava-sync-scheduler/config.hcl" ; expose = true }
   include "providers" { path = "${find_in_parent_folders("providers")}/regional.hcl" }
   terraform { source = "${include.module.locals.module_path}/v1.0.0" }
   inputs = merge(include.module.locals.merged_inputs, {
     sync_url                      = "https://gpx.${site.dns.zonename}/${region.label}/api/gpx/internal/strava-sync"
     internal_sync_secret_ssm_path = "/${site.label}/secrets/${region.label}/internal/sync_secret"
     internal_sync_secret_ssm_arn  = "arn:aws:ssm:us-east-1:${account}:parameter/${site.label}/secrets/${region.label}/internal/sync_secret"
     schedule_expression           = "rate(6 hours)"
   })
   ```

## Phase 32 aggregate precompute (fast-follow, same module)
Add a second target (or a second schedule) that POSTs a `/api/gpx/internal/aggregate-build`
route (to add) which writes the merged GeoJSON to an S3 artifact; the public
`/api/gpx/public/aggregate` then serves that artifact instead of building on-demand. Keeps the
public path O(1) at scale.

## Deploy
`make build-lambdas` isn't involved (this is a self-contained module). Apply the new live unit
via terragrunt (us-east-1 first — regions cross-cancel). Then the app env wiring rides the next
run.gpx/run.auth deploy. Open questions for Kurt: poll cadence, the date band values, and whether
to also provision in cac1/apse1 or keep the scheduler us-east-1-only (like bib-reconcile).
