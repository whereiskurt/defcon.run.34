# Phase 40 — Wave 3 (40-07) Handoff

**Status:** Waves 1–2 complete (6/7 plans). 40-07 is the only remaining plan and is `autonomous: false` — it is a **production checkpoint** that was intentionally NOT auto-run while the operator was away.

**Branch:** `gsd/phase-40-admin-reports-plan` (pushed). All app instrumentation + the `admin-reports/v1.0.0` Terraform module are committed and `terraform validate`-clean.

## Why this stopped here (not a failure)

40-07 requires actions that must not be auto-fired autonomously:
- A real deploy of run.auth / run.gpx / run.human to **us-east-1 ECS** (outward-facing, uses your AWS creds).
- `terragrunt apply` of the `admin-reports` unit (creates metric filters, adopts `/ecs/*` groups via `import{}`, dashboard, SNS topic, 4 alarms).
- **You** must click the AWS SNS subscription-confirmation email once (cannot be automated).
- Firing one of each event in prod and confirming a **tripwire email arrives in your inbox** (human-in-the-loop by design — `terragrunt plan` alone does NOT satisfy acceptance).

Also: this sandbox has **no AWS credentials** — any `terragrunt plan/apply` that evaluates `site.hcl` hangs on `sops --decrypt` (KMS unreachable). So even a dry-run plan couldn't be produced here; it must run where creds exist.

## To finish 40-07 (when you're back, with AWS creds)

Two paths — pick one:

**A) Local (repo scripts):**
1. Deploy the 3 instrumented apps to us-east-1: `./apps/release-all.sh` (or per-app `apps/build.sh` + `apps/deploy.sh`). us-east-1 only — `skip_regions` excludes cac1/apse1.
2. Apply the module: `cd infra/terraform/live/site/region/us-east-1/admin-reports && terragrunt apply`.
   - Watch the `/ecs/*` retention `import{}` block — the plan must show **adoption, not destroy/recreate** of the existing ECS log groups. If it wants to *create* them, the group names in `site.hcl admin_reports.log_group_names` don't match reality — reconcile against `aws logs describe-log-groups --log-group-name-prefix /ecs/` first.
3. Confirm the SNS email subscription (click the AWS email to `alert_email`).

**B) GitHub workflows (the ones you flagged):**
- `.github/workflows/terragrunt-plan.yml` → review the plan for the `us-east-1/admin-reports` unit first (do this before apply to catch the retention-import issue safely).
- `.github/workflows/terragrunt-apply.yml` → apply the module.
- `.github/workflows/buildpub.yml` / `deploy.yml` → build+deploy the 3 apps.
- `.github/workflows/rollback.yml` is the escape hatch if a deploy misbehaves.

**Then verify the pipeline end-to-end (the blocking human-verify task):**
1. Do a real **signup** (new account) and a **login** on auth.defcon.run → expect `Signups`/`Logins` in `DefconRun/Activity` to tick up and a **Signups≥1/hr tripwire email**.
2. Upload a gpx and view a map on gpx.defcon.run → `GpxUploads` / `MapViews` tick up.
3. Open the **`admin-reports`** CloudWatch dashboard (us-east-1) → the **distinct-active-users (last hour)** widget shows your test user; **top-IPs** shows your IP.
4. Write `40-07-SUMMARY.md` with the evidence (metric screenshots/values, the alarm email), then the phase can be verified/completed (`/gsd-verify-work 40` or `/gsd-ship`).

## Optional: status page

`/dc34-statuspage` updates the public status.defcon.run services. admin-reports is **internal operator tooling**, not a public-facing service, so it does not by itself warrant a status-page entry — left to your discretion. (Not touched autonomously since publishing to the status page is an outward-facing action.)

## Pre-con reminder

Thresholds live in `site.hcl` `admin_reports.thresholds` and are set for **pre-con** (Signups≥1/hr is meant to be noisy — any signup is signal right now). Bump them for con-week by editing `site.hcl` and re-applying the `us-east-1/admin-reports` unit. See `infra/terraform/modules/admin-reports/v1.0.0/RUNBOOK.md`.
