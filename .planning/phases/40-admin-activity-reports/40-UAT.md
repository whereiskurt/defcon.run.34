---
status: partial
phase: 40-admin-activity-reports
source: [40-01-SUMMARY.md, 40-02-SUMMARY.md, 40-03-SUMMARY.md, 40-04-SUMMARY.md, 40-05-SUMMARY.md, 40-06-SUMMARY.md]
started: 2026-07-05
updated: 2026-07-05
---

## Current Test

[testing paused — all non-prod-dependent items verified; remainder blocked on 40-07 deploy]

## Tests

### 1. logEvent helper unit — run.auth
expected: `logEvent` emits one single-line JSON stdout event with the locked `{evt,userId,email,ip,ua,meta}` shape; ip = first x-forwarded-for hop; never throws.
result: pass
source: automated
coverage_id: 40-01/D1
evidence: `apps/run.auth/webapp` → `vitest run src/lib/log-event.test.ts` = 6/6 passed (node v23.6.0).

### 2. logEvent helper unit — run.gpx
expected: same locked helper contract as run.auth.
result: pass
source: automated
coverage_id: 40-02/D1
evidence: `apps/run.gpx/webapp` vitest = 6/6 passed.

### 3. logEvent helper unit — run.human
expected: same locked helper contract.
result: pass
source: automated
coverage_id: 40-03/D1
evidence: `apps/run.human/webapp` vitest = 6/6 passed.

### 4. Helper byte-identity across the three apps
expected: the copy-per-app helper is logically identical (only header comments differ) so all three produce the same line shape.
result: pass
source: automated
evidence: comment/blank-stripped hash of all three `src/lib/log-event.ts` collapses to 1 distinct hash.

### 5. Auth events wired at call site (code-level)
expected: jwt callback emits `auth.signup` on new-user create and `auth.login` on returning user.
result: pass
source: automated
coverage_id: 40-01/D2
evidence: `apps/run.auth/webapp/src/config/auth.ts` contains exactly 2 `logEvent("auth.signup"|"auth.login"` calls. (Live emit-in-CloudWatch is Test 12.)

### 6. GPX events wired at call sites (code-level)
expected: five events fire at their locked call sites.
result: pass
source: automated
coverage_id: 40-02/D2
evidence: `gpx.file.create`, `gpx.file.publish`, `gpx.share.request`, `gpx.share.accept`, `gpx.map.view` all present as `logEvent(...)` calls in `apps/run.gpx/webapp/src`.

### 7. Human events wired at call sites (code-level)
expected: `human.checkin` after checkin write, `human.upload` on presign.
result: pass
source: automated
coverage_id: 40-03/D2
evidence: both `logEvent("human.checkin"` and `logEvent("human.upload"` present in `apps/run.human/webapp/src`.

### 8. Strava rate-limit producer + value binding (code-level)
expected: `strava.ratelimit` line carries numeric `meta.usage`/`meta.limit` from the X-RateLimit headers; the metric filter binds its value to `$.meta.usage`.
result: pass
source: automated
coverage_id: 40-02/D3
evidence: `strava-sync.ts:59` emits `logEvent("strava.ratelimit", { meta: { usage, limit } })` (first-hop of the 15-min header); `metrics.tf:99` sets `StravaRateLimitUsage` `value = "$.meta.usage"` (not a literal 1).

### 9. Producer↔consumer event-string contract
expected: every event string the apps emit has a matching `$.evt` metric filter, and vice-versa (a mismatch would silently produce empty metrics).
result: pass
source: automated
evidence: 10 emitted evt strings == 10 metric-filter `$.evt` references (exact set match).

### 10. admin-reports module validates + resource inventory
expected: the Terraform module is valid and contains the metric filters, dashboard, saved queries, SNS topic, and alarms per the design.
result: pass
source: automated
evidence: `terraform validate` = "Success! The configuration is valid." Inventory: 8 metric filters, 7 `admin/*` query definitions, 1 dashboard, 4 alarms, 1 SNS topic, retention `import{}` block + 2 `prevent_destroy`.

### 11. /ecs/* retention adoption is non-destructive (live plan)
expected: `terragrunt plan` of the us-east-1/admin-reports unit shows the existing ECS-created `/ecs/*` log groups ADOPTED via import (retention set), with NO destroy/recreate.
result: blocked
blocked_by: release-build
reason: "Requires AWS credentials + live terragrunt plan; sandbox has no creds (sops/KMS unreachable). Gated on 40-07."

### 12. Events increment DefconRun/Activity metrics in prod
expected: firing one of each event in the running us-east-1 environment increments the matching metric within a few minutes.
result: blocked
blocked_by: release-build
reason: "Requires the 40-07 deploy (instrumented apps live + module applied). Cannot observe CloudWatch without prod."

### 13. Dashboard distinct-active-users + top-IPs widgets populate
expected: the `admin-reports` dashboard's last-hour `count_distinct(userId)` widget shows the test user and top-IPs shows the test IP.
result: blocked
blocked_by: release-build
reason: "Requires 40-07 deploy + live events flowing."

### 14. Tripwire alarm email actually arrives
expected: a real signup triggers the Signups≥1/hr alarm and an email lands in the operator inbox.
result: blocked
blocked_by: release-build
reason: "Requires 40-07 deploy, a confirmed SNS subscription, and a real inbox — human-in-the-loop by design."

### 15. SNS email subscription confirmed
expected: the alert_email SNS subscription status is `Confirmed` (operator clicks the AWS confirmation email once).
result: blocked
blocked_by: release-build
reason: "Operator action during 40-07 apply; cannot be automated."

## Summary

total: 15
passed: 10
issues: 0
pending: 0
skipped: 0
blocked: 5

## Gaps

[none — 0 issues found. The 5 blocked tests are prod-deploy prerequisites (40-07), not defects.]
