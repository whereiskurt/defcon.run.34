# abuse-detection (v1.0.0)

Overnight pentester / abuser detection over the **ALB access logs** (Phase 41).

Two Athena detections surface an offender by **IP + User-Agent** so the operator
wakes to already-triaged email alerts:

1. **Sustained activity (AD-03)** — an IP continuously active for `>= session_hours`.
2. **Rate outlier (AD-04)** — an IP whose peak 5-min bucket exceeds `posts_per_5min`
   or `requests_per_5min`.

Alerts reuse the Phase 40 SNS topic (`dcr-admin-reports-tripwire`); findings are
written as automation-ready JSON so a later phase can drive AWS WAF IP-sets or
Impart.security.

## What this module provides (Plan 01 slice)

- **Glue database** `{site}_abuse` and **external table** `alb_access_logs` over
  the ALB access-log S3 prefix, using the AWS-documented ALB-log `RegexSerDe` and
  **date partition projection** (`day` key, `yyyy/MM/dd`) — no crawler, no
  `MSCK REPAIR`.
- **Athena workgroup** `dcr-abuse-analysis` with a per-query
  **bytes-scanned cap** (AD-02 runaway-scan guardrail) and an encrypted results
  location.
- A single **dual-role S3 bucket** `{site}-abuse-detection-{suffix}`: Athena
  query output under `query-results/` (7-day lifecycle), and Plans 03/04 write
  findings / dedup state / digest under `abuse/`.

## Posture

- **us-east-1 only** — the single live region.
- **Ships dark.** The `enabled`/schedule gate lives in `site.hcl` (wired in
  Plan 05); `schedule_enabled` defaults to `false`. Enable deliberately after a
  manual Athena query confirms the ALB-log schema parses.
- The **ALB-log bucket name is a variable** (`alb_logs_bucket_name`), derived
  from the network unit's `alb_logs_bucket_name` output in Plan 05 — never
  guessed (Phase 40 lesson #2).

## Validation

Validate with a **scoped `terragrunt plan`** against the live network dependency
(`modules=abuse-detection, region=us-east-1`) — NOT a bare `terraform validate`.
Bare validate misses the provider/dependency issues that only surface once the
terragrunt-generated `provider.tf` and the `dependency` wiring are in play
(Phase 40 lesson #1). Real plan/apply is deferred to the Plan 05 deploy
checkpoint. Local formatting is checked with
`terraform -chdir=infra/terraform/modules/abuse-detection/v1.0.0 fmt -check`.

Do **not** add a provider-requirements block to this module: the terragrunt
`include "providers"` generates `provider.tf`, and a second declaration errors
with "Duplicate required providers configuration" (Phase 40 lesson).

## Deferred seam

The finding JSON (`{ ts, rule, client_ip, user_agents[], count, window, ... }`)
is the intentional WAF/Impart seam. A later phase reads `findings.jsonl` to
populate a WAF IP-set / call Impart.security — that integration is **not** built
here.
