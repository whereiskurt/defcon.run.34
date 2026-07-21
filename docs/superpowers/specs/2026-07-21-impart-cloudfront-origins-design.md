# Impart Security CloudFront Origins — Design

**Date:** 2026-07-21
**Status:** Approved design, pending implementation plan
**Scope:** Route app traffic CloudFront → Impart cloud gateway → our ALB, per-app toggleable, additive and non-destructive. GPX first, then run.

## Background

Traffic today: viewer → CloudFront (one distro per app domain) → single public ALB
(`alb-use1-defcon-run`) → ECS services, routed by ALB listener rules on Host header
(`gpx.defcon.run`, `run.defcon.run`, …; default action is fixed-response).

Verified facts the design depends on:

- The origin request policy on all app behaviors is `216adef6-5c7f-47e4-b989-5492eafa07d3`,
  which is **`Managed-AllViewer`** — the viewer Host header IS forwarded to the origin.
  (The comments in `modules/cloudfront/v1.0.0/main.tf` mislabel it as
  `AllViewerExceptHostHeader`; this design fixes the comments.) Host-header routing at the
  ALB works only because of this.
- The ALB's `securemgmt` security group allows 443 **only** from the CloudFront
  origin-facing managed prefix list. Impart → ALB traffic needs its own allow rule.
- No AWS WAF is attached to any distro. The existing `waf` module/toggle in `site.hcl`
  stays untouched and off.
- Impart provides **one cloud gateway per app**, e.g.
  `gpx-defconrun-seoks0.impartcloud.net`, `run-defconrun-n1xdxk.impartcloud.net`.
  Each gateway presents a TLS cert valid for our app hostname (e.g. `gpx.defcon.run`),
  so CloudFront's origin cert validation passes with the forwarded Host header and the
  gateway forwards to our ALB with Host intact — ALB rules never change.
- Impart egress IPs (their gateway → our ALB):
  - us-east-1 primary: `44.196.43.182/32`, `44.218.171.39/32`, `54.234.154.163/32`, `54.83.239.56/32`
  - us-west-1 failover: `13.56.35.105/32`, `52.8.178.200/32`, `52.9.193.103/32`, `54.177.54.69/32`

## Configuration (single file, all knobs)

New `infra/terraform/live/site/impart.hcl`, next to `site.hcl` so every terragrunt unit
that needs it (`global/cloudfront`, `region/us-east-1/network`, `region/us-east-1/ecs-service`)
can discover it via `find_in_parent_folders("impart.hcl")`. (A file under `global/` would
not be discoverable from the regional units.)

```hcl
locals {
  impart = {
    enabled = true

    # Impart gateway egress IPs allowed to reach the ALB on 443
    alb_ingress_cidrs = [
      # us-east-1 primary
      "44.196.43.182/32", "44.218.171.39/32", "54.234.154.163/32", "54.83.239.56/32",
      # us-west-1 failover
      "13.56.35.105/32", "52.8.178.200/32", "52.9.193.103/32", "54.177.54.69/32",
    ]

    origins = {
      gpx = {
        dns_name           = "gpx-defconrun-seoks0.impartcloud.net"
        state              = "off"                  # off | canary | on
        canary_path        = "/use1/api/health"     # optional; this is the default
        enforce_alb_header = false                  # flip only after state=on has soaked
      }
      run = {
        dns_name           = "run-defconrun-n1xdxk.impartcloud.net"
        state              = "off"
        enforce_alb_header = false
      }
    }
  }
}
```

Secrets, in the existing `.secrets.sops.json` (read with the same `try(..., "")` fallback
pattern `site.hcl` uses):

- `impart_origin_verify` — value CloudFront injects toward the Impart gateway.
- `impart_edge_header` — value Impart injects toward our ALB (shared with Impart out of band).

## Module changes (all additive; empty/absent config ⇒ zero plan diff)

### 1. `modules/cloudfront/v1.0.0` (edited in place, no version copy)

New optional variable:

```hcl
variable "impart" {
  description = "Per-domain Impart gateway origins and rollout state"
  type = object({
    enabled = optional(bool, false)
    origins = optional(map(object({
      dns_name    = string
      state       = optional(string, "off")   # off | canary | on
      canary_path = optional(string, "/use1/api/health")
    })), {})
  })
  default = {}
}

variable "impart_origin_verify_secret" {
  type      = string
  default   = ""
  sensitive = true
}
```

Validation: `state` must be one of `off | canary | on`.

(`enforce_alb_header` lives in `impart.hcl` but is deliberately NOT part of this module's
variable — only `ecs-service` consumes it; the live terragrunt wiring routes each field to
the module that reads it.)

Per-domain behavior inside `aws_cloudfront_distribution.main` (`each.key` = domain):

- **Origin (any state, entry present + `enabled`):** one additional origin, id `impart`,
  `domain_name` = the app's gateway DNS, HTTPS-only, TLS1.2, custom header
  `X-Origin-Region: use1` (parity with ALB origins). A second custom header
  `X-Origin-Verify: <impart_origin_verify_secret>` is rendered via a `dynamic` block
  **only when the secret is non-empty** — empty/missing secret ⇒ no header at all.
- **`state = "off"`:** origin exists, nothing targets it. Inert.
- **`state = "canary"`:** one exact-path `ordered_cache_behavior` for `canary_path`
  targeting `impart`, authored **before** the `/{region}/*` wildcard blocks (CloudFront
  picks the first matching behavior in authored order — this ordering is load-bearing).
  All other traffic stays on the direct ALB path.
- **`state = "on"`:** the app-traffic behaviors retarget from `alb-use1` to `impart`:
  default cache behavior, `/{region}` bare-path, `/{region}/*` wildcard, and for the
  `run` domain the `/use1/assets/theme` covert behavior. S3 asset behaviors
  (`/{region}/assets/*`, `/index.html`, `/favicon.ico`, `/{region}/index.html`, cms media)
  stay direct — static assets bypass Impart deliberately.
- **Origin request policy:** behaviors targeting `impart` use
  `Managed-AllViewerAndCloudFrontHeaders-2022-06` instead of `Managed-AllViewer`, adding
  `CloudFront-Viewer-Address` (true client `ip:port`) and geo headers, all set/overwritten
  by CloudFront so clients cannot pre-spoof them. CloudFront also appends the viewer IP to
  `X-Forwarded-For` as always. Behaviors on the direct ALB path keep `Managed-AllViewer`
  unchanged.
- **Comment fix (drive-by):** correct the `Managed-AllViewerExceptHostHeader` mislabels to
  `Managed-AllViewer`.

Mock-region note: `alb-cac1`/`alb-apse1` origins are inert mock placeholders today; their
behaviors also retarget to `impart` when `on` purely to keep the target computation uniform
(`state == "on" ? "impart" : "alb-${region}"`). They carry no traffic either way.

### 2. `modules/network/v1.0.0`

New variable `impart_ingress_cidrs` (`list(string)`, default `[]`). When non-empty, the
`securemgmt` SG's ingress list gains (via `concat`) one additional 443 rule for those
CIDRs, alongside the existing CloudFront prefix-list rule. Both ingress paths stay open
for the entire toggle period. Empty list ⇒ SG unchanged.

### 3. `modules/ecs-service/v1.0.0`

New optional per-service inputs (wired from `impart.hcl` by the live terragrunt config):
`enforce_impart_header` (bool, default false) and `impart_edge_header_secret`
(string, default "", sensitive). When enforcement is on for a service, its
`aws_lb_listener_rule` gains an `http_header` condition (`X-Impart-Edge` equals the
secret) ANDed with the existing host-header condition.

Failure-mode rules:

- enforce absent/false ⇒ rule identical to today (host header only), regardless of secret.
- enforce true + secret present ⇒ header condition added.
- enforce true + secret empty/missing ⇒ **hard Terraform validation error.** Silently not
  enforcing while config claims enforcement is the worst failure mode.

Enforcement is only valid once that app's CloudFront state is `on` (in `off`/`canary`,
most traffic reaches the ALB directly from CloudFront without the Impart header and would
be 403'd). Rules are per-host, so gpx can enforce while run is still direct. Rolling an
app's origin back to `off` requires flipping its `enforce_alb_header` off first (or in the
same apply).

### 4. Live terragrunt wiring

- `live/site/impart.hcl` — new config file (above).
- `live/site/global/cloudfront/terragrunt.hcl` — read `impart.hcl`, pass `impart` +
  `impart_origin_verify_secret` inputs.
- `live/site/region/us-east-1/network/terragrunt.hcl` — read `impart.hcl`, pass
  `impart_ingress_cidrs` when `enabled`.
- `live/site/region/us-east-1/ecs-service/terragrunt.hcl` — read `impart.hcl`, pass
  per-service enforcement flags + secret.

## Header/trust model summary

| Hop | Header | Source | Empty/absent ⇒ |
|-----|--------|--------|----------------|
| CF → Impart | `X-Forwarded-For`, `CloudFront-Viewer-Address`, geo | CloudFront-managed | always present on impart behaviors |
| CF → Impart | `X-Origin-Verify: <secret>` | CF origin custom header | header omitted; Impart-side rule (their console) left unconfigured until set |
| Impart → ALB | `X-Impart-Edge: <secret>` | Impart gateway config (their side) | apps/logs just don't see it |
| ALB | `http_header` condition on listener rule | `enforce_alb_header` toggle | not enforced; enforce=true with no secret is a plan-time error |

## Rollout

1. **Ship PR** with both apps `state = "off"`, enforcement off. Expected plan: SG ingress
   rule + two inert `impart` origins (gpx, run distros) + nothing else. All other distros:
   no diff. Apply via CI (`deploy.yml`) — this worktree is not terragrunt-initialized.
2. **Pre-flight the gateway directly** (no CloudFront in the loop):
   `curl --connect-to gpx.defcon.run:443:gpx-defconrun-seoks0.impartcloud.net:443 https://gpx.defcon.run/use1/api/health`
   Verifies the gateway cert covers our hostname and the Impart → ALB chain works
   (requires the SG rule from step 1).
3. **gpx → `canary`.** Only `/use1/api/health` flows CF → Impart → ALB. Verify 200 via
   `curl https://gpx.defcon.run/use1/api/health` and traffic visible in the Impart console.
4. **gpx → `on`.** All gpx app traffic via Impart. Soak, UAT (map loads, auth flow,
   Strava sync, file save). Optionally set `impart_origin_verify` + Impart-side rule, then
   `enforce_alb_header = true` after soak.
5. **Repeat 2–4 for `run`.**
6. **Rollback at any point:** flip `state` back (and enforcement off). In-place
   `UpdateDistribution`, ~2–5 min propagation. The direct CF → ALB path is never removed.

## Failure symptoms

- Impart gateway down / cert wrong / their IPs changed → CloudFront 502s on affected
  behaviors. Recovery: state back to `off`.
- Enforcement misconfigured (header mismatch) → ALB fixed-response/403 on that host only.
  Recovery: flip `enforce_alb_header` off.

## Out of scope

- Removing the CloudFront prefix-list SG rule after full cutover (later hardening).
- The AWS `waf` module (`site.hcl waf.enabled`) — untouched.
- mqtt (NLB, not CloudFront), the static-landing wildcard distro (management acct), and
  the q./r./h./b./f./donate redirect distros — no Impart in front of these for now.
- cac1/apse1 real origins (still mocks).

## Testing

- `terraform validate` + `terragrunt plan` with `impart.hcl` absent/empty ⇒ assert zero
  diff on all distros.
- Plan with gpx `off` ⇒ assert only origin+SG additions.
- Each state flip verified by the curl checks in Rollout before proceeding.
