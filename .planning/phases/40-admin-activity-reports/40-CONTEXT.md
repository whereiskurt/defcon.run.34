# Phase 40: Admin Activity Reports - Context

**Gathered:** 2026-07-05
**Status:** Ready for planning
**Source:** PRD Express Path (docs/superpowers/specs/2026-07-05-admin-activity-reports-design.md)

<domain>
## Phase Boundary

Deliver lightweight, CloudWatch-native fraud/abuse/activity visibility for defcon.run, leveraging the logging infra that is already enabled (ALB access logs → S3, CloudFront access logs → S3, ECS awslogs → CloudWatch). Explicitly NOT a full observability stack: no OTEL, no Grafana, no Container Insights.

The operator must be able to answer three questions:
1. **Glance** — how much traffic, which endpoints, how many *distinct users/IPs* are active right now?
2. **Dig in** — who is user X / IP Y and what have they done (signups, gpx uploads/shares, logins, checkins)?
3. **Alert** — get notified when someone starts doing anything unusual (pre-con, that means *anything at all*, since the user baseline is ~zero and any activity is presumptively recon/abuse).

**In scope:**
- App-level structured event logging (`logEvent`) in run.auth, run.gpx, run.human
- Terraform module `admin-reports/v1.0.0`: metric filters, one CloudWatch dashboard, saved Logs Insights queries, SNS tripwire alarms with site.hcl-parameterized thresholds, 90-day retention on `/ecs/*` log groups
- Mapbox account-hardening checklist (URL-restrict token, per-app tokens, spending cap) + a `gpx.map.view` leading-indicator event
- Strava rate-limit-header metric from the existing strava-sync path

**Out of scope (do NOT build):**
- IP blocking — the operator already has an external real-time IP-block mechanism; this phase does not build one
- WAF request logging — the existing WAF module's CloudWatch metrics/dashboard cover it when `waf.enabled` flips on
- Athena over S3 access logs — deferred to a separate Phase 2 (later, pre-conference)
- run.bib / run.flash event instrumentation — same `logEvent` pattern can be adopted later; not required here

</domain>

<decisions>
## Implementation Decisions

### App structured events — `logEvent` helper (AR-01)
- A ~30-line helper, copied per-app (same shape), in **run.auth**, **run.gpx**, **run.human**. Do NOT build a shared cross-app package — copy-per-app matches the monorepo's existing per-app independence.
- Emits exactly **one JSON line to stdout per event** (no pretty-print). ECS awslogs already ships stdout to CloudWatch, so ingestion needs zero new infra.
- Event line shape: `{"evt":"<name>","userId":"…","email":"…","ip":"<first x-forwarded-for hop>","ua":"…","meta":{…}}`.
- `ip` MUST be the **first hop of `x-forwarded-for`** (the real client IP — the one field infra logs cannot join to a user).
- MUST never throw — wrap the whole body in try/catch, swallow errors, never `await` it in a way that can break the request path.
- No PII beyond what the app already stores (userId + email are acceptable — these are the operator's own admin logs).

### Event names and call sites (AR-02)
All call sites are existing code paths (~8 insertions total):

| `evt` | App | Where |
|---|---|---|
| `auth.signup` | run.auth | `src/config/auth.ts` jwt callback / `upsertAuthProfile` — emit on the create branch |
| `auth.login` | run.auth | `src/config/auth.ts` jwt callback — emit on the update/returning branch |
| `gpx.file.create` | run.gpx | `src/app/api/gpx/files/route.ts` (POST) |
| `gpx.file.publish` | run.gpx | `src/app/api/gpx/files/[id]/publish/route.ts` |
| `gpx.share.request` | run.gpx | `src/app/api/gpx/files/[id]/request-share/route.ts` |
| `gpx.share.accept` | run.gpx | `src/app/api/gpx/shares/[token]/accept/route.ts` |
| `gpx.map.view` | run.gpx | map render / public map API path (Mapbox leading indicator) |
| `human.checkin` | run.human | Checkin entity write path |
| `human.upload` | run.human | user-upload write path |

(`auth.signup` vs `auth.login` are one insertion point with a create/update branch — counted as the ~8.)

### Terraform module `admin-reports/v1.0.0` (AR-03)
- New module at `infra/terraform/modules/admin-reports/v1.0.0/`, instantiated from `site.hcl` (us-east-1 only, matching current single-live-region reality).
- Follow existing module conventions (versioned dir, variables.tf/main.tf/outputs.tf, tagging) — mirror `modules/site/v1.0.0/waf/` and `modules/cloudtrail/v1.0.0/` structure.

### Metric filters (AR-04)
- One `aws_cloudwatch_log_metric_filter` per event family on the `/ecs/*` app log groups.
- Pattern form `{ $.evt = "auth.signup" }` etc., publishing to namespace `DefconRun/Activity` with metric names: `Signups`, `Logins`, `GpxUploads`, `GpxShares`, `Checkins`, `Uploads`, `MapViews`.

### Dashboard `admin-reports` (AR-05)
- One `aws_cloudwatch_dashboard` named `admin-reports` containing:
  - ALB per-target-group `RequestCount`, `HTTPCode_Target_4XX_Count`, `HTTPCode_Target_5XX_Count`, `TargetResponseTime` (existing free metrics)
  - CloudFront `Requests` + `4xxErrorRate`/`5xxErrorRate` per distribution (all six domains: auth/run/cms/gpx/flash/bib; CloudFront metrics live in us-east-1)
  - Custom `DefconRun/Activity` event metrics (stacked, per hour)
  - **Logs Insights widget: distinct active users, last hour** (`count_distinct(userId)` across app log groups) — the live "how many users are actively doing something" number
  - **Logs Insights widget: top IPs by event count**
  - Strava rate-limit widget (see AR-08)

### Saved Logs Insights queries (AR-06)
- `aws_cloudwatch_query_definition`, folder-prefixed `admin/…`:
  - `admin/user-activity` — all events for a given userId/email (edit placeholder, run)
  - `admin/ip-activity` — all events from a given IP
  - `admin/top-ips-1h`
  - `admin/top-uploaders`
  - `admin/signups-over-time`
  - `admin/distinct-users-by-day`
  - `admin/error-spikes` — non-event `console.error` volume per service

### Tripwire alarms (AR-07)
- SNS topic with an email subscription (address parameterized in `site.hcl`).
- Alarms, all thresholds parameterized in `site.hcl` so pre-con → con-week is a one-line bump:
  - `Signups >= 1` per hour (pre-con: any signup is news)
  - `GpxUploads >= 5` per hour (pre-con default)
  - ALB total `RequestCount` **anomaly-detection** alarm
  - ALB `HTTPCode_Target_5XX_Count >= 10` per 5 min (pre-con default)

### Log retention (AR-08a)
- Set **90-day retention** on the `/ecs/*` app log groups (currently they never expire). Verify interaction with `awslogs-create-group=true` — likely need to pre-create or import the groups so the module can manage retention without fighting the ECS auto-create.

### Third-party key quota — Mapbox (AR-08b)
- **No Mapbox usage API exists** (stats are dashboard-only, ~24h lag, filterable per token). Deliver an account-side hardening checklist + one app event:
  1. **URL-restrict** the public token to `*.defcon.run` origins (the critical control — token is scrapeable from client JS)
  2. **Dedicated token per app** (gpx at minimum) so the dashboard per-token filter attributes usage
  3. **Spending cap** on the Mapbox account
  4. Our own `gpx.map.view` event metric as the real-time leading indicator (our logs are live; Mapbox's dashboard lags a day)
- The checklist is a documented runbook (markdown in the module or phase dir); the only *code* deliverable here is wiring the `gpx.map.view` event (covered by AR-02) and, if straightforward, splitting the gpx Mapbox token env.

### Third-party key quota — Strava (AR-08c)
- The strava-sync Lambda logs the `X-RateLimit-Usage` / `X-RateLimit-Limit` response headers as a JSON line → metric filter → widget on the `admin-reports` dashboard.

### Claude's Discretion
- Exact CloudWatch dashboard widget geometry / layout JSON.
- Exact Logs Insights query syntax and field extraction, provided the widgets answer the stated questions.
- Whether `logEvent` is a standalone module file or a small addition to an existing util file per app — follow each app's existing conventions.
- Precise Terraform variable names/shapes, provided thresholds and the SNS email are surfaced in `site.hcl`.
- Whether log-group retention is handled by import vs pre-create — pick the approach that least disrupts the running ECS services.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design source of truth
- `docs/superpowers/specs/2026-07-05-admin-activity-reports-design.md` — the approved design; full rationale, cost, and Phase 2 boundary

### Existing infra to build on / mirror
- `infra/terraform/live/site/site.hcl` — master config; where the new `admin-reports` module + thresholds + SNS email get wired (note `skip_regions` leaves only us-east-1 live)
- `infra/terraform/modules/network/v1.0.0/alb.tf` — ALB access logs already ON (reference for ALB metric names/target groups)
- `infra/terraform/modules/cloudfront/v1.0.0/main.tf` — CloudFront access logs already ON, per-domain distributions
- `infra/terraform/modules/site/v1.0.0/waf/dashboard.tf` — existing CloudWatch dashboard pattern to mirror
- `infra/terraform/modules/cloudtrail/v1.0.0/main.tf` — existing Athena/Glue + query-definition pattern (for Phase 2 later; structural reference now)
- `infra/terraform/modules/ecs-task/v1.0.0/main.tf` — awslogs driver config (`/ecs/{container}-{family}` groups; retention currently absent)

### App instrumentation points
- `apps/run.auth/webapp/src/config/auth.ts` — jwt callback + `upsertAuthProfile` (signup vs login branch)
- `apps/run.gpx/webapp/src/app/api/gpx/files/route.ts` — gpx create
- `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/publish/route.ts` — publish
- `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/request-share/route.ts` — share request
- `apps/run.gpx/webapp/src/app/api/gpx/shares/[token]/accept/route.ts` — share accept
- `apps/run.human/webapp/src/entities/checkin.ts` — checkin write path
- `apps/run.human/webapp/src/entities/user-upload.ts` — upload write path

</canonical_refs>

<specifics>
## Specific Ideas

- The `count_distinct(userId)` last-hour widget is the single most important deliverable — it's the "how many humans are actually here" number the operator keeps asking for.
- Pre-con posture is deliberately noisy: `Signups >= 1/hr` firing is a feature, not a bug. `site.hcl` thresholds are the volume knob for con-week.
- Deploy-time verification must actually fire one of each event in prod (test signup, real gpx upload) and confirm the metric increments + the tripwire email arrives — not just `terragrunt plan`.

</specifics>

<deferred>
## Deferred Ideas

- **Phase 2 (separate, pre-conference):** Athena + Glue partition-projected tables over the CloudFront and ALB S3 access logs (crib the pattern from the disabled CloudTrail module) for full request-history SQL — "everything this /24 touched across all six domains, including static assets."
- run.bib / run.flash `logEvent` adoption.
- Container Insights / OTEL — explicitly rejected as too heavy for this need.

</deferred>

---

*Phase: 40-admin-activity-reports*
*Context gathered: 2026-07-05 via PRD Express Path*
