---
phase: 48-cloudfront-integration-exposure
plan: 01
subsystem: infra/cloudfront
tags: [cloudfront, terraform, ctf, covert-channel, deploy-spec]
requires:
  - Phase 46 covert-path decision (extension-less /use1/assets/theme)
provides:
  - CTF-12 covert-path CloudFront ordered_cache_behavior (authored, validate-clean, NOT applied)
  - DEPLOY-SPEC-ctf-covert.md (human apply + curl verification recipe)
affects:
  - infra/terraform/modules/cloudfront/v1.0.0 (shared six-distro module; run distro only)
tech-stack:
  added: []
  patterns:
    - "Domain-gated dynamic ordered_cache_behavior via each.key == \"run\" ? toset([...]) : toset([]) (mirrors cms-media gating)"
    - "First-match behavior ordering: exact path authored before wildcard in HCL list order"
    - "Cred-free terraform validate via temp-copy + provider-alias shim"
key-files:
  created:
    - infra/terraform/modules/cloudfront/v1.0.0/DEPLOY-SPEC-ctf-covert.md
  modified:
    - infra/terraform/modules/cloudfront/v1.0.0/main.tf
decisions:
  - "Covert path routes to alb-use1 (app origin), NOT s3-use1, so per-request auth-state CSS renders."
  - "CachingDisabled + AllViewerExceptHostHeader reused (no new policy shapes) — uncached, cookie-forwarded."
  - "Exact /use1/assets/theme authored BEFORE /{region}/assets/* wildcard (first-match precedence)."
  - "use1-only this phase; per-region /{region}/assets/theme variant deliberately out of scope."
  - "NOTHING applied; apply + curl deferred to human via DEPLOY-SPEC (runtime precedence + six-distro blast radius unprovable by validate)."
metrics:
  duration: ~8m
  completed: 2026-07-14
status: complete
---

# Phase 48 Plan 01: Covert-Path CloudFront Behavior (CTF-12) Summary

Authored a run-domain-gated exact `/use1/assets/theme` → `alb-use1` ordered CloudFront behavior (CachingDisabled + AllViewerExceptHostHeader), placed before the `/{region}/assets/*` S3 wildcard so first-match ordering routes the covert CSS channel to the app uncached with the session cookie forwarded — `terraform validate`/`fmt` clean, nothing applied, paired with a human apply+curl DEPLOY-SPEC.

## What Was Built

### Task 1 — Covert behavior in the cloudfront module (`main.tf`)
Added one `dynamic "ordered_cache_behavior"` gated `each.key == "run" ? toset(["theme"]) : toset([])`, authored immediately BEFORE the `/{region}/assets/*` S3 wildcard block. The exact HCL:

```hcl
dynamic "ordered_cache_behavior" {
  for_each = each.key == "run" ? toset(["theme"]) : toset([])
  content {
    path_pattern           = "/use1/assets/theme"
    target_origin_id       = "alb-use1"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3" # Managed-AllViewerExceptHostHeader
  }
}
```

Gating (run-only), origin (`alb-use1`, app not S3), policies (CachingDisabled + AllViewerExceptHostHeader), and ordering (covert `path_pattern` at line 354 < S3 wildcard at line 377) all satisfy the load-bearing must_haves. The other five distros (auth/cms/gpx/flash/bib) render the empty `toset([])` → unchanged.

### Task 2 — `DEPLOY-SPEC-ctf-covert.md`
Reviewer-facing operational spec covering: what changed (path/origin/policies table), the load-bearing ordering requirement + mis-order risk, the six-distro blast-radius `terragrunt plan` check, the apply unit + command (`live/site/global/cloudfront` → `terragrunt apply`, ~5–15 min propagation), a curl verification matrix (signed-in vs not / correct vs wrong: app-origin routing, `X-Cache: Miss`, no-store, cookie-forwarded body diff limited to the award marker), and rollback. Explicitly frames apply + curl as a deliberate human follow-up NOT done in this phase.

## Verification

- `terraform fmt -check` on the module: clean (no diff).
- `terraform validate` (temp copy + provider-alias shim, cred-free): `Success! The configuration is valid.` (rc=0).
- Ordering: `/use1/assets/theme` (line 354) precedes `/${ordered_cache_behavior.key}/assets/*` (line 377).
- DEPLOY-SPEC exists and names covert path, `global/cloudfront` unit, `terragrunt apply`, and curl matrix.
- No `terragrunt plan`/`apply` run; no live AWS/curl executed.

## Deviations from Plan

None — plan executed exactly as written.

## Threat Model Coverage

- **T-48-01** (info disclosure — cached per-user CSS): mitigated via Managed-CachingDisabled in the authored behavior; curl matrix row #4 asserts `X-Cache: Miss`.
- **T-48-02** (routing precedence): mitigated by authoring the exact behavior before the S3 wildcard; DEPLOY-SPEC §2/§3 require plan-diff ordering confirmation.
- **T-48-03** (six-distro blast radius): mitigated by `each.key == "run"` gate; DEPLOY-SPEC §3 mandates a scoped plan-diff check (only `run` gains one behavior).
- **T-48-04** (DoS via uncached forwarding): accepted — single lightweight GET on an origin already fronting all `/use1/*` traffic.

## Scope Confirmation

Only the run.defcon.run distro edit in `main.tf` + the paired DEPLOY-SPEC were touched. The q-resolver module (48-02) and the integration doc (48-03) were NOT touched. Nothing was applied or deployed — apply is a deliberate human follow-up per the DEPLOY-SPEC.

## Self-Check: PASSED

- FOUND: infra/terraform/modules/cloudfront/v1.0.0/main.tf (covert block present)
- FOUND: infra/terraform/modules/cloudfront/v1.0.0/DEPLOY-SPEC-ctf-covert.md
- FOUND commit 9be88648 (Task 1), 2a1bbec5 (Task 2)
