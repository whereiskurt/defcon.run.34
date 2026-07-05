# Admin Activity Reports — Design

**Date:** 2026-07-05
**Status:** Approved (brainstorm w/ KPH)
**Scope:** Lightweight fraud/abuse/quota visibility for defcon.run, leveraging existing CloudWatch + S3 access logs. Explicitly NOT a full observability stack (no OTEL, no Grafana, no Container Insights).

## 1. Goal & posture

Pre-conference, the user baseline is ~zero — **any activity is signal**. Anyone hitting endpoints now has probably found them by scanning; the reports act as a tripwire. During the conference the same data serves as normal admin reporting with raised thresholds.

Answers three questions:
1. **Glance** — how much traffic, which endpoints, how many *distinct users/IPs* are actively doing something right now?
2. **Dig in** — who is user X / IP Y and what have they done? (signups, gpx uploads/shares, logins, checkins)
3. **Alert** — tell me when someone starts doing anything unusual (which pre-con means "anything at all").

**Out of scope:** IP blocking (existing external mechanism handles it); WAF request logging (WAF module's existing metrics dashboard covers it when `waf.enabled` flips on); Athena over S3 access logs (Phase 2, below).

## 2. Existing infrastructure this builds on (survey 2026-07-05)

| Capability | State | Location |
|---|---|---|
| ALB access + connection logs → S3 (90d lifecycle) | ENABLED | `infra/terraform/modules/network/v1.0.0/alb.tf:11-21` |
| CloudFront standard access logs → S3, per-domain (auth/run/cms/gpx/flash/bib) | ENABLED | `site.hcl:154`, `cloudfront/v1.0.0/main.tf:382-389` |
| ECS app container logs → CloudWatch (awslogs, `/ecs/{container}-{family}`) | ENABLED | `ecs-task/v1.0.0/main.tf:262-268` |
| ECS log group retention | ABSENT (never expires) | implicit `awslogs-create-group` |
| WAF WebACL + CloudWatch dashboard | CODE EXISTS, `enabled=false` | `site.hcl:117`, `site/v1.0.0/waf/dashboard.tf` |
| Athena/Glue partition-projection pattern | CODE EXISTS (CloudTrail module, disabled) | `cloudtrail/v1.0.0/main.tf:235-395` |
| App-level structured event logging | ABSENT (ad-hoc `console.*` only) | — |
| Dashboards / metric filters / activity alarms | ABSENT (only ECS autoscaling CPU/mem alarms) | — |

Only **us-east-1** is live (`skip_regions` excludes cac1/apse1), so all regional resources are single-region for now.

## 3. Components

### 3.1 App structured events (`logEvent`)

A ~30-line helper (copy-per-app, same shape) in **run.auth**, **run.gpx**, **run.human**; run.bib/run.flash can adopt the identical pattern later. Emits exactly one JSON line to stdout per event — ECS awslogs already ships stdout to CloudWatch, so ingestion requires zero infra.

```json
{"evt":"gpx.file.create","userId":"…","email":"…","ip":"<first x-forwarded-for hop>","ua":"…","meta":{"fileId":"…"}}
```

Event names and call sites (all existing code paths, ~8 insertions):

| `evt` | Where |
|---|---|
| `auth.signup` / `auth.login` | run.auth `src/config/auth.ts` jwt callback — `upsertAuthProfile` already distinguishes create vs update |
| `gpx.file.create` | run.gpx `src/app/api/gpx/files/route.ts` (POST) |
| `gpx.file.publish` | run.gpx `files/[id]/publish` |
| `gpx.share.request` | run.gpx `files/[id]/request-share` |
| `gpx.share.accept` | run.gpx `shares/[token]/accept` |
| `human.checkin` | run.human checkin entity write path |
| `human.upload` | run.human user-upload path |

Rules: single line (no pretty-print), `ip` = first hop of `x-forwarded-for` (the real client IP — the one field infra logs can't join to a user), never throws (wrap in try/catch), no PII beyond what the app already stores (userId + email are fine — these are the operator's own admin logs).

### 3.2 Terraform module `admin-reports/v1.0.0`

New module at `infra/terraform/modules/admin-reports/v1.0.0/`, instantiated from `site.hcl` (us-east-1). Contains:

**a) Metric filters** — one `aws_cloudwatch_log_metric_filter` per event family on the `/ecs/*` log groups, pattern `{ $.evt = "auth.signup" }` etc., publishing to namespace `DefconRun/Activity`: `Signups`, `Logins`, `GpxUploads`, `GpxShares`, `Checkins`, `Uploads`.

**b) Dashboard `admin-reports`** — one `aws_cloudwatch_dashboard`:
- ALB per-target-group `RequestCount`, `HTTPCode_Target_4XX_Count`, `HTTPCode_Target_5XX_Count`, `TargetResponseTime` (metrics already exist, free)
- CloudFront `Requests` + `4xxErrorRate`/`5xxErrorRate` per distribution (all six domains; CloudFront metrics live in us-east-1)
- Custom `DefconRun/Activity` event metrics (stacked, per hour)
- Two Logs Insights widgets: **distinct active users, last hour** (`count_distinct(userId)` across app log groups) and **top IPs by event count** — the live "how many users are actively doing something" number

**c) Saved Logs Insights queries** — `aws_cloudwatch_query_definition`, folder-prefixed `admin/…`:
- `admin/user-activity` — all events for a given userId/email (edit placeholder, run)
- `admin/ip-activity` — all events from a given IP
- `admin/top-ips-1h`, `admin/top-uploaders`, `admin/signups-over-time`, `admin/distinct-users-by-day`
- `admin/error-spikes` — non-event `console.error` volume per service

**d) Tripwire alarms** — SNS topic (email subscription, address via `site.hcl`) + alarms with thresholds parameterized in `site.hcl` so pre-con → con-week is a one-line bump:
- `Signups >= 1` per hour (pre-con: any signup is news)
- `GpxUploads >= 5` per hour (pre-con default)
- ALB total `RequestCount` **anomaly detection** alarm
- ALB `HTTPCode_Target_5XX_Count >= 10` per 5 min (pre-con default)

All four thresholds parameterized; con-week values set later by editing `site.hcl`.

**e) Log retention** — set 90-day retention on the `/ecs/*` log groups (module manages `aws_cloudwatch_log_group` retention; verify interaction with `awslogs-create-group=true` — likely import or pre-create the groups).

### 3.3 Third-party key quota

- **Mapbox — no usage API exists** ([Mapbox statistics are dashboard-only](https://docs.mapbox.com/accounts/faq/what-statistics-are-available-for-my-mapbox-account/), ~24h lag, filterable per token). Mitigations, all account-side + one app event:
  1. **URL-restrict** the public token to `*.defcon.run` origins — the critical control; the token is scrapeable from client JS
  2. **Dedicated token per app** (gpx at minimum) so the dashboard per-token filter attributes usage
  3. **Spending cap** on the Mapbox account
  4. Our own `gpx.map.view` event metric as the *leading* indicator (our logs are real-time; Mapbox's dashboard lags a day)
- **Strava**: strava-sync Lambda logs the `X-RateLimit-Usage`/`X-RateLimit-Limit` response headers as a JSON line → metric filter → widget on the same dashboard
- **AWS**: nothing to build; service quotas/billing already surface in CloudWatch

## 4. Error handling

- `logEvent` must never break a request path: try/catch, swallow, no awaits on it.
- Metric filters silently no-op on non-matching lines — malformed events just don't count; the saved `admin/error-spikes` query catches systemic logging breakage.
- Alarm noise pre-con is the *point*; `site.hcl` thresholds are the volume knob.

## 5. Testing / verification

- Unit: `logEvent` emits valid single-line JSON with expected fields (vitest per app, trivial).
- Deploy verify: fire one of each event in prod (signup with a test account, upload a gpx), confirm the metric increments, the dashboard widget shows it, and the tripwire email arrives.
- `terragrunt plan` clean on unrelated stacks.

## 6. Phase 2 (separate, pre-con)

Athena + Glue partition-projected tables over the **CloudFront and ALB S3 access logs** (crib the exact pattern from the disabled CloudTrail module) for full request-history SQL — "everything this /24 touched across all six domains, including static assets." Deliberately deferred: Logs Insights over app events covers ~90% of forensics needs.

## 7. Cost

Pennies: metric filters/dashboards/query definitions are near-free; alarms ~$0.10/mo each; Logs Insights scans metered per GB but trivial at current volume; 90-day retention *reduces* current cost (logs currently never expire).
