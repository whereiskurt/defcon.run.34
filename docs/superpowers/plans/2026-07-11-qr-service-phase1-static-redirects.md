# QR Service — Phase 1: Static ALB Redirects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve `r.defcon.run` → YouTube rickroll and `h.defcon.run` → `run.defcon.run` as pure ALB listener-rule redirects (no target group, no ECS, no Lambda), with Route53 records pointing the new hostnames at the existing us-east-1 ALB.

**Architecture:** A new versioned Terraform module `redirect-rules/v1.0.0` creates one `aws_lb_listener_rule` (redirect action) plus one apex-zone `aws_route53_record` (ALIAS A → ALB) per configured host. A new region-level Terragrunt unit `region/us-east-1/redirect-rules` wires it up, mirroring the self-contained `abuse-detection` unit (owns its state key, reads `site.hcl`, depends on `network` for the ALB and `site` for the zone map). The redirect list and an `enabled` gate live in `site.hcl`.

**Tech Stack:** Terraform 1.14, Terragrunt 0.97, AWS ALB listener rules + Route53. No application code.

## Global Constraints

- **Terraform 1.14 / Terragrunt 0.97** — match existing `infra/terraform` units.
- **Module MUST NOT declare its own `provider` or `required_providers`** — the aliased providers (`aws.global-management`, etc.) are generated into the working dir by the `providers/regional.hcl` include. Declaring them causes a "Duplicate required providers configuration" error. (abuse-detection lesson.)
- **Validate via a SCOPED `terragrunt plan`** in the unit directory — NOT bare `terraform validate`, which misses the generated aliased providers the DNS records require.
- **`q./r./h.` are NOT delegated subdomains** — their records live in the apex `defcon.run` zone, which is in the **management** account. Use `zone_id = var.zone_map[var.dns.zonename].zone_id` and `provider = aws.global-management` (see `modules/site/v1.0.0/route35.tf`).
- **Redirect status codes:** `r` → `HTTP_302` (rickroll, keep flexible); `h` → `HTTP_301`.
- **Listener-rule priorities must be unique per listener.** `run.cms` uses `100`; this plan uses `90` (r) and `91` (h). A duplicate priority fails at apply.
- **Module versioning:** create under `v1.0.0/`, matching every other module.

---

## File Structure

- `infra/terraform/modules/redirect-rules/v1.0.0/variables.tf` — input variables (site/region/dns, ALB alias inputs, zone_map, redirects list, tags).
- `infra/terraform/modules/redirect-rules/v1.0.0/main.tf` — the listener rules + Route53 ALIAS records.
- `infra/terraform/modules/redirect-rules/v1.0.0/outputs.tf` — rule ARNs + FQDNs (for verification/debugging).
- `infra/terraform/live/site/site.hcl` — **modify**: add a `redirects` local (enabled gate + rules list).
- `infra/terraform/live/site/region/us-east-1/redirect-rules/terragrunt.hcl` — the region-level unit that sources the module.

---

## Task 1: `redirect-rules` Terraform module

**Files:**
- Create: `infra/terraform/modules/redirect-rules/v1.0.0/variables.tf`
- Create: `infra/terraform/modules/redirect-rules/v1.0.0/main.tf`
- Create: `infra/terraform/modules/redirect-rules/v1.0.0/outputs.tf`

**Interfaces:**
- Consumes (from the live unit, Task 2): `site`, `region`, `dns`, `alb_listener_arn`, `alb_dns_name`, `alb_zone_id`, `zone_map`, `redirects`, `tags`.
- Produces: resources `aws_lb_listener_rule.redirect[<host>]` and `aws_route53_record.redirect_alias[<host>]`; outputs `redirect_rule_arns` (map host→arn), `redirect_fqdns` (list of FQDNs).

- [ ] **Step 1: Create `variables.tf`**

```hcl
variable "site" {
  type = object({
    label         = string
    random_suffix = optional(string, "")
  })
}

variable "region" {
  type = object({
    label = string
    full  = string
  })
}

variable "dns" {
  type = object({
    zonename = string
  })
  description = "Apex DNS zone, e.g. defcon.run"
}

variable "alb_listener_arn" {
  type        = string
  description = "ARN of the ALB HTTPS listener to attach redirect rules to."
}

variable "alb_dns_name" {
  type        = string
  description = "DNS name of the ALB (ALIAS record target)."
}

variable "alb_zone_id" {
  type        = string
  description = "Canonical hosted-zone ID of the ALB (ALIAS record target)."
}

variable "zone_map" {
  description = "Route53 zone map from the site unit, keyed by zone name."
  type = map(object({
    zone_id      = string
    name         = string
    name_servers = optional(list(string), [])
  }))
}

variable "redirects" {
  description = "Host-based ALB redirect rules (no compute). host is the subdomain label under dns.zonename."
  type = list(object({
    host         = string
    target_host  = string
    target_path  = optional(string, "/")
    target_query = optional(string, "")
    status_code  = optional(string, "HTTP_302")
    priority     = number
  }))
  default = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
```

- [ ] **Step 2: Create `main.tf`**

```hcl
locals {
  # subdomain label -> redirect object, e.g. "r" => {...}
  redirect_map = { for r in var.redirects : r.host => r }
}

# Host-based redirect rules on the EXISTING ALB HTTPS listener. The ALB answers
# the redirect itself — no target group, no ECS, no Lambda.
resource "aws_lb_listener_rule" "redirect" {
  for_each = local.redirect_map

  listener_arn = var.alb_listener_arn
  priority     = each.value.priority

  condition {
    host_header {
      values = ["${each.key}.${var.dns.zonename}"]
    }
  }

  action {
    type = "redirect"
    redirect {
      host        = each.value.target_host
      path        = each.value.target_path
      query       = each.value.target_query
      port        = "443"
      protocol    = "HTTPS"
      status_code = each.value.status_code
    }
  }

  tags = merge(var.tags, {
    Name   = "redirect-${each.key}"
    Region = var.region.label
    Site   = var.site.label
  })
}

# Apex-zone ALIAS A records for each redirect host -> the ALB.
# r./h. are NOT delegated subdomains, so records live in the apex defcon.run
# zone (management account) — hence provider = aws.global-management.
resource "aws_route53_record" "redirect_alias" {
  for_each = local.redirect_map

  zone_id = var.zone_map[var.dns.zonename].zone_id
  name    = "${each.key}.${var.dns.zonename}"
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = false
  }

  provider = aws.global-management
}
```

- [ ] **Step 3: Create `outputs.tf`**

```hcl
output "redirect_rule_arns" {
  description = "ARNs of the created ALB redirect listener rules, keyed by host label."
  value       = { for k, r in aws_lb_listener_rule.redirect : k => r.arn }
}

output "redirect_fqdns" {
  description = "FQDNs of the created redirect hosts."
  value       = [for k, rec in aws_route53_record.redirect_alias : rec.fqdn]
}
```

- [ ] **Step 4: Format-check the module**

Run:
```bash
cd /Users/khundeck/working/defcon.run.34/.claude/worktrees/qrservice
terraform fmt -recursive infra/terraform/modules/redirect-rules/v1.0.0
```
Expected: exits 0; prints the three filenames only if it reformatted them (no diff on a clean write). No errors.

> Note: do NOT run bare `terraform validate` on this module — it references the `aws.global-management` aliased provider that only exists once Terragrunt generates `provider.tf` into the working dir (see Task 2's scoped plan). Bare validate would error on the missing provider config.

- [ ] **Step 5: Commit**

```bash
cd /Users/khundeck/working/defcon.run.34/.claude/worktrees/qrservice
git add infra/terraform/modules/redirect-rules/v1.0.0/
git commit -m "feat(infra): redirect-rules module for host-based ALB redirects"
```

---

## Task 2: `site.hcl` redirect config + `redirect-rules` live unit

**Files:**
- Modify: `infra/terraform/live/site/site.hcl` (add a `redirects` local inside the existing `locals { ... }` block)
- Create: `infra/terraform/live/site/region/us-east-1/redirect-rules/terragrunt.hcl`

**Interfaces:**
- Consumes: `dependency.network.outputs.{alb_listener_arn,alb_dns_name,alb_zone_id}`, `dependency.site.outputs.zone_map`, `local.site_vars.locals.{site,dns,redirects}`.
- Produces: the wired unit that the Task 1 module renders into a plan of 4 resources (2 listener rules + 2 ALIAS records).

- [ ] **Step 1: Add the `redirects` local to `site.hcl`**

Open `infra/terraform/live/site/site.hcl`, find the top-level `locals {` block (the one holding `dns = { zonename = "defcon.run" ... }`), and add this local alongside the others:

```hcl
  # Static host-based ALB redirects (QR service Phase 1). Pure ALB redirect
  # actions + apex-zone ALIAS records — no target group, no ECS. Consumed by
  # region/us-east-1/redirect-rules. Set enabled=false to ship dark.
  redirects = {
    enabled = true
    rules = [
      {
        host         = "r"
        target_host  = "www.youtube.com"
        target_path  = "/watch"
        target_query = "v=dQw4w9WgXcQ"
        status_code  = "HTTP_302"
        priority     = 90
      },
      {
        host         = "h"
        target_host  = "run.defcon.run"
        target_path  = "/"
        target_query = ""
        status_code  = "HTTP_301"
        priority     = 91
      },
    ]
  }
```

- [ ] **Step 2: Confirm priorities 90/91 are unused on the ALB listener**

Run:
```bash
cd /Users/khundeck/working/defcon.run.34/.claude/worktrees/qrservice
grep -rn "priority" infra/terraform/live/site/services/*/service.hcl infra/terraform/live/site/region/us-east-1/ 2>/dev/null | grep -iE "priority *= *(90|91)\b" || echo "90/91 free"
```
Expected: prints `90/91 free`. If it prints a match, pick two other unused values and update Step 1.

- [ ] **Step 3: Create the live unit `terragrunt.hcl`**

Create `infra/terraform/live/site/region/us-east-1/redirect-rules/terragrunt.hcl`:

```hcl
# Static host-based ALB redirects (QR service Phase 1): r.defcon.run -> YouTube
# rickroll, h.defcon.run -> run.defcon.run. Pure ALB redirect actions + apex-zone
# ALIAS records; no target group, no ECS. Mirrors abuse-detection's region-level,
# self-contained wiring: owns its state key, reads site.hcl, sources the versioned
# module, depends on network (ALB) and site (zone map).
#
# SHIPS DARK when site.hcl redirects.enabled = false (exclude below -> no rules,
# no records).
#
# VALIDATION: scoped `terragrunt plan` in THIS directory — NOT bare
# `terraform validate` (which misses the generated aliased providers the DNS
# records require).

locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
}

exclude {
  if      = !try(local.site_vars.locals.redirects.enabled, false)
  actions = ["all"]
}

dependency "network" {
  config_path = "../network"

  mock_outputs = {
    alb_listener_arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/mock/0000000000000000/0000000000000000"
    alb_dns_name     = "mock-alb-1234567890.us-east-1.elb.amazonaws.com"
    alb_zone_id      = "Z35SXDOTRQ7X7K"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "site" {
  config_path = dirname(find_in_parent_folders("site.hcl"))

  mock_outputs = {
    zone_map = {
      (local.site_vars.locals.dns.zonename) = {
        zone_id      = "Z00000000000000000000"
        name         = local.site_vars.locals.dns.zonename
        name_servers = []
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${dirname(find_in_parent_folders("AGENTS.md"))}/infra/terraform/modules/redirect-rules/v1.0.0"
}

inputs = {
  site = local.site_vars.locals.site
  region = {
    label = "use1"
    full  = "us-east-1"
  }
  dns = {
    zonename = local.site_vars.locals.dns.zonename
  }

  alb_listener_arn = dependency.network.outputs.alb_listener_arn
  alb_dns_name     = dependency.network.outputs.alb_dns_name
  alb_zone_id      = dependency.network.outputs.alb_zone_id
  zone_map         = dependency.site.outputs.zone_map

  redirects = local.site_vars.locals.redirects.rules

  tags = {
    Site      = local.site_vars.locals.site.label
    Component = "redirect-rules"
    ManagedBy = "terragrunt"
  }
}
```

- [ ] **Step 4: Scoped plan — verify the unit renders 4 resources to create**

Run:
```bash
cd /Users/khundeck/working/defcon.run.34/.claude/worktrees/qrservice/infra/terraform/live/site/region/us-east-1/redirect-rules
terragrunt plan
```
Expected: plan succeeds and shows **4 resources to add**:
- `aws_lb_listener_rule.redirect["r"]`
- `aws_lb_listener_rule.redirect["h"]`
- `aws_route53_record.redirect_alias["r"]`
- `aws_route53_record.redirect_alias["h"]`

with `["r"]` redirect `host = "www.youtube.com"`, `status_code = "HTTP_302"`, and `["h"]` redirect `host = "run.defcon.run"`, `status_code = "HTTP_301"`. No errors, no changes to other resources.

> If plan errors on a provider/alias, re-check that the module declares NO `provider`/`required_providers` block (Global Constraints). If it errors resolving `dependency.network`/`dependency.site`, the mock_outputs above let plan render before those units are applied.

- [ ] **Step 5: Commit**

```bash
cd /Users/khundeck/working/defcon.run.34/.claude/worktrees/qrservice
git add infra/terraform/live/site/site.hcl infra/terraform/live/site/region/us-east-1/redirect-rules/terragrunt.hcl
git commit -m "feat(infra): wire r./h. static redirects via redirect-rules unit"
```

---

## Task 3: Apply and verify live redirects

> Requires AWS credentials for the application/management accounts. This is the acceptance test — run it once the two commits above are pushed and reviewed.

**Files:** none (deploy + verification only).

- [ ] **Step 1: Apply the unit**

Run:
```bash
cd /Users/khundeck/working/defcon.run.34/.claude/worktrees/qrservice/infra/terraform/live/site/region/us-east-1/redirect-rules
terragrunt apply
```
Expected: `Apply complete! Resources: 4 added, 0 changed, 0 destroyed.` Outputs `redirect_rule_arns` (r, h) and `redirect_fqdns` (`r.defcon.run`, `h.defcon.run`).

- [ ] **Step 2: Verify `r.defcon.run` rickroll (302)**

Wait ~60s for DNS, then run:
```bash
curl -sSI https://r.defcon.run | grep -iE '^HTTP|^location'
```
Expected:
```
HTTP/2 302
location: https://www.youtube.com:443/watch?v=dQw4w9WgXcQ
```
(ALB emits the explicit `:443`; that is correct and browsers handle it.)

- [ ] **Step 3: Verify `h.defcon.run` → run.defcon.run (301)**

Run:
```bash
curl -sSI https://h.defcon.run | grep -iE '^HTTP|^location'
```
Expected:
```
HTTP/2 301
location: https://run.defcon.run:443/
```

- [ ] **Step 4: Confirm no regression on an existing host**

Run:
```bash
curl -sSI https://run.defcon.run | grep -iE '^HTTP'
```
Expected: a normal `HTTP/2 200` or the existing `302 -> /use1` behavior — unchanged (our rules only match `r.`/`h.` host headers).

---

## Self-Review

**Spec coverage (Phase 1 row of §11):** "static `r./h.` redirect listener rules + DNS + new `redirect-rule` terraform" — covered by Task 1 (module), Task 2 (site.hcl + live unit), Task 3 (apply/verify). The spec's "no CloudFront in front of q./r./h." is honored: records ALIAS straight to the ALB. The spec's "302 for dynamic, 301 acceptable for h" is honored in the `redirects` local.

**Placeholder scan:** none — every step has concrete HCL or a concrete command with expected output.

**Type consistency:** `redirects` object shape in `site.hcl` (Task 2) exactly matches `variable "redirects"` in the module (Task 1): `host`, `target_host`, `target_path`, `target_query`, `status_code`, `priority`. `zone_map` object shape (`zone_id`/`name`/`name_servers`) matches the site unit's output and the module variable. `alb_listener_arn`/`alb_dns_name`/`alb_zone_id` match the `network` module outputs verified in `modules/network/v1.0.0/outputs.tf`.

**Out of scope (later phases):** the `q.defcon.run` DNS record and resolver Lambda are Phase 2 — deliberately excluded here (no target yet). This unit's `redirects` list can add `q` later, or Phase 2 can own it.
