# Phase 23: Bib Build/Deploy + Branding - Context

**Gathered:** 2026-06-30
**Status:** Ready for planning (plan in detail when Phase 22 completes)

<domain>
## Phase Boundary

Wire bib into the existing build/release machinery (no new workflow), apply DC34 branding, and verify both-region deployment at bib.defcon.run. This is the "ship" phase — it piggybacks entirely on the held-release pipeline already used by flash/auth/human/etc.

</domain>

<decisions>
## Implementation Decisions

### Piggyback the existing held-release pipeline (no new workflow)
- **`apps/build.sh`:** add `run.bib` to the valid-app validation, the `case "$APP"` block (`REPO_PREFIX="dc34-run-bib"`), and the nginx/webapp component handling — bib is a standard 2-component (nginx + webapp) app, identical to flash
- **`apps/deploy.sh`:** add run.bib VERSION-file handling the same way flash is handled
- **`apps/release-all.sh`:** add `run.bib` to the default `APPS` list
- **`.github/workflows/buildpub.yml`:** add `run.bib` to the `apps` input default (line ~11) and to the repo→domain map (`["run-bib"]="bib.defcon.run"`, near the existing `["run-flash"]="flash.defcon.run"`)
- **`.github/workflows/deploy.yml`:** confirm bib is covered by the per-region deploy (region-driven module apply); add bib to any service enumeration if present
- **Result:** `buildpub.yml` builds + pushes bib images and opens the held "Release" PR via release-all.sh; `deploy.yml` (pr_number=latest) merges that held PR and deploys bib to the chosen region + invalidates CloudFront — exactly like every other service. No bib-specific workflow is created.

### Branding
- Apply DC34 branding to the bib webapp (logo, favicon, manifest, theme) — reuse DC34 brand assets already in the repo (e.g. the dc34 logos under run.mqtt/nginx or run.human public assets)
- Event name / year references set to DEF CON 34 (2026)

### Verification
- Deploy to us-east-1 and ca-central-1; confirm bib.defcon.run resolves (latency/standard CloudFront), TLS valid, sign-in works, registration persists, amount selection + cash path render, webhook endpoint reachable
- Stripe "Pay Now" end-to-end may remain stubbed pending the other dev's Stripe implementation — verify the seam (Checkout redirect attempt + webhook signature path) rather than a real charge

</decisions>

<specifics>
## Specific Ideas
- ECR repo names must match service.hcl: `dc34-run-bib-nginx`, `dc34-run-bib-app`
- First image push depends on the Phase 20 infra (ECR repos) being applied
- Keep VERSION bumps consistent with the release-all.sh bump convention

</specifics>

<code_context>
## Existing Code Insights
- `apps/build.sh` — case block + component validation (flash is the model: REPO_PREFIX="dc34-run-flash")
- `apps/release-all.sh` — `APPS="run.auth,run.human,run.cms,run.gpx,run.flash,run.mqtt"` default
- `.github/workflows/buildpub.yml` — apps input default (line ~11), repo→domain map (`["run-flash"]="flash.defcon.run"` line ~853), release-all.sh invocation
- `.github/workflows/deploy.yml` — workflow_dispatch region/pr_number/invalidate_cache inputs; merge-held-PR-then-deploy flow
- DC34 brand assets: `apps/run.mqtt/nginx/dc34-logo*.webp`, favicons, manifest

</code_context>

<deferred>
## Deferred Ideas
- Real Stripe charge verification → after the other dev lands the Stripe implementation
- Organizer cash-reconciliation tooling → product-confirmed later phase

</deferred>

---
*Phase: 23-bib-build-deploy-branding*
*Context gathered: 2026-06-30*
