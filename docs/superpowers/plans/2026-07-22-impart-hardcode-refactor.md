# Impart Hardcode Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove fragile hardcoded values from the Impart integration: stable DNS alias for the ALB (so Impart upstreams survive ALB rebuilds), derive the CloudFront-domain→ECS-service map from existing service config, and investigate/scaffold the Impart Terraform provider so console-side config (rules, header inject) can become code.

**Architecture:** Task 1 adds `origin-{region}.defcon.run` alias records (apex zone, management account) inside the existing cloudfront module, which already has the ALB outputs, zone map, and `aws.global-management` provider. Task 2 replaces the literal `impart_domain_to_service` map in the ecs-service terragrunt wiring with a derivation from `site.hcl`'s `ecs_services.services` list (each service already declares its `host_headers`). Task 3 is a research spike on the `impart-security/impart` Terraform provider, producing a findings doc and (only if feasible) an inert scaffold unit.

**Tech Stack:** Terraform 1.14 / Terragrunt 0.97, AWS Route53/ELBv2, GitHub Actions CI applies, SOPS secrets.

## Global Constraints

- Work in the `impart` worktree: `/Users/khundeck/working/defcon.run.34/.claude/worktrees/impart`. Branch from `origin/main` per task; NEVER commit to main directly.
- **User authorization (2026-07-22):** Kurt approved autonomous execution of THIS plan including PR merges (`gh pr merge --squash --delete-branch --admin`; a `'main' is already used by worktree` error from local git is cosmetic — check `gh pr view N --json state` for truth) and CI applies. Anything outside this plan's scope: stop and ask.
- **Run all git commands from the worktree root.** A prior incident: `git add` with a relative path from a subdirectory silently failed and a `;`-chained workflow dispatch ran a no-op apply. After every apply, verify the run's `headSha` matches `git ls-remote origin main`.
- Local plans are read-only and safe; **applies go through CI**: `gh workflow run terragrunt-apply.yml --ref main -f modules=global/cloudfront` (path-style for global units) or `-f region=us-east-1 -f modules=ecs-service` (bare names need region). Watch with `gh run watch <id> --exit-status`. Check the log for the per-unit `Apply complete!` line — the workflow can mask unit failures.
- **Local plan env recipe** (needed for every verification step; sops decryption requires AWS_PROFILE):

  ```bash
  export AWS_PROFILE=dc34-application TF_VAR_profile_prefix=dc34 \
    TF_VAR_MANAGEMENT_ACCOUNT_ID=481723467561 SGUID=80a6b349 \
    TG_BUCKET_USE1=tf-dc34-use1-80a6b349 TG_TABLE_USE1=tf-dc34-use1-80a6b349 \
    TG_BUCKET_CAC1=tf-dc34-cac1-80a6b349 TG_TABLE_CAC1=tf-dc34-cac1-80a6b349 \
    TG_BUCKET_APSE1=tf-dc34-apse1-80a6b349 TG_TABLE_APSE1=tf-dc34-apse1-80a6b349
  ```

  If a dependency unit errors with "Required plugins are not installed", run `terragrunt init` in that unit's directory first (site root, `region/us-east-1/{certs,cloudfront,network,s3-uploads}` were needed last time).
- Do not touch: the `waf` module/toggle, `state`/`enforce_alb_header` values in `impart.hcl` (both apps are `on`+enforced and soaking), the SOPS secret values.
- Known pre-existing drift, NOT ours to fix here: `bib-secrets` plans 0/9/0, `abuse-detection` plans 1 add.

---

### Task 1: Stable origin alias DNS records (`origin-use1.defcon.run` → ALB)

**Why:** Impart gateway upstreams are hand-configured with the raw ALB DNS `alb-use1-defcon-run-375003670.us-east-1.elb.amazonaws.com`. The numeric suffix changes if the ALB is rebuilt → every gateway breaks silently. A Terraform-managed alias gives Impart a stable name.

**Files:**
- Modify: `infra/terraform/modules/cloudfront/v1.0.0/route53.tf` (append)
- No live wiring changes needed — `global/cloudfront` already passes `regional_origins_by_domain` and `zone_map`, and its generated providers include `aws.global-management`.

**Interfaces:**
- Consumes: `var.regional_origins_by_domain` (map domain→region→`{alb_dns_name, alb_zone_id, …}`), `var.zone_map[var.dns.zonename].zone_id` (apex zone, management account — the site module's NS-forwarding records prove CI can write there via the same provider alias).
- Produces: DNS name `origin-use1.defcon.run` (A alias → ALB). External consumers only; no Terraform outputs needed.

- [ ] **Step 1: Branch**

```bash
cd /Users/khundeck/working/defcon.run.34/.claude/worktrees/impart
git fetch origin main --quiet && git checkout -b impart/origin-alias origin/main
```

- [ ] **Step 2: Append to `route53.tf`**

```hcl
# Stable origin alias records: origin-<region>.<zonename> -> that region's ALB.
# External systems (Impart gateway upstreams) point at these instead of the raw
# ALB DNS name, so an ALB rebuild (whose DNS suffix changes) requires no
# external reconfiguration. Records live in the APEX zone, which is hosted in
# the management account — hence the aws.global-management provider, the same
# one the site module uses for its NS-forwarding records.
# ALB info is identical across domains; read it from the first domain and skip
# empty/mock placeholders (cac1/apse1 are mocks today).
locals {
  origin_alias_albs = {
    for region_label, origin in var.regional_origins_by_domain[var.cloudfront.domains[0]] :
    region_label => {
      alb_dns_name = origin.alb_dns_name
      alb_zone_id  = origin.alb_zone_id
    }
    if origin.alb_dns_name != "" && !startswith(origin.alb_dns_name, "mock-")
  }
}

resource "aws_route53_record" "origin_alias" {
  for_each = local.origin_alias_albs

  zone_id = var.zone_map[var.dns.zonename].zone_id
  name    = "origin-${each.key}.${var.dns.zonename}"
  type    = "A"

  alias {
    name                   = each.value.alb_dns_name
    zone_id                = each.value.alb_zone_id
    evaluate_target_health = false
  }

  provider = aws.global-management
}
```

- [ ] **Step 3: Validate offline**

```bash
terraform fmt infra/terraform/modules/cloudfront/v1.0.0/
S=$(mktemp -d) && cp infra/terraform/modules/cloudfront/v1.0.0/*.tf $S/
cat > $S/zz_shim.tf <<'EOF'
provider "aws" {}
provider "aws" { alias = "global-application" }
provider "aws" { alias = "global-management" }
provider "aws" { alias = "use1" }
provider "aws" { alias = "cac1" }
provider "aws" { alias = "apse1" }
EOF
(cd $S && terraform init -backend=false -input=false >/dev/null && terraform validate)
```

Expected: `Success! The configuration is valid.`
NOTE: the module also references `aws.global-management` now — if validate complains about a missing provider config, the shim above is missing an alias line.

- [ ] **Step 4: Local plan of `global/cloudfront`**

```bash
cd infra/terraform/live/site/global/cloudfront
terragrunt plan --no-color 2>&1 | grep -E "will be created|will be updated|will be destroyed|^.*Plan:"
cd /Users/khundeck/working/defcon.run.34/.claude/worktrees/impart
```

Expected: exactly `aws_route53_record.origin_alias["use1"] will be created` and `Plan: 1 to add, 0 to change, 0 to destroy.` Distros MUST show no changes. If distros show changes, STOP — something else drifted; investigate before proceeding.

- [ ] **Step 5: Commit, PR, merge**

```bash
git add infra/terraform/modules/cloudfront/v1.0.0/route53.tf
git commit -m "feat(infra): stable origin-<region> alias records for ALB (Impart upstream stability)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin impart/origin-alias
gh pr create --title "feat(infra): origin-use1.defcon.run alias -> ALB (stable Impart upstream)" --body "Adds Terraform-managed apex alias records origin-<region>.defcon.run -> regional ALB so Impart gateway upstreams survive ALB rebuilds. Plan verified: +1 route53 record, zero distro changes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr merge --squash --delete-branch --admin
gh pr view impart/origin-alias --json state 2>/dev/null || gh pr list --state merged --limit 1
```

- [ ] **Step 6: CI apply + verify DNS**

```bash
gh workflow run terragrunt-apply.yml --ref main -f modules=global/cloudfront
sleep 6 && RID=$(gh run list --workflow=terragrunt-apply.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch $RID --exit-status
gh run view $RID --log | grep -E "Apply complete|origin_alias"
dig +short origin-use1.defcon.run
dig +short alb-use1-defcon-run-375003670.us-east-1.elb.amazonaws.com
```

Expected: apply log shows `origin_alias["use1"]: Creation complete`; both digs return the SAME set of IPs (allow a minute for DNS propagation; NXDOMAIN right after apply = wait and retry).

- [ ] **Step 7: Record the Kurt-gate**

The console switch is Kurt's (do NOT attempt): in the Impart console, change BOTH gateways' upstream from the raw ALB DNS to `origin-use1.defcon.run`. Add to the final report: the exact old value, new value, and the verification curl `curl https://gpx.defcon.run/use1/api/health` (expect 200 after each gateway edit — Impart does not validate upstream cert hostnames today, evidenced by the raw ELB DNS working against a `*.defcon.run` cert, so this swap is TLS-safe).

---

### Task 2: Derive `impart_domain_to_service` from service config

**Why:** `live/site/region/us-east-1/ecs-service/terragrunt.hcl` hardcodes `{ gpx = "run-gpx", run = "run-human" }`, duplicating knowledge already in each `service.hcl` (`host_headers = ["gpx.{{SITE_DOMAIN}}"]`). Derive it so future Impart onboarding needs zero edits here.

**Files:**
- Modify: `infra/terraform/live/site/region/us-east-1/ecs-service/terragrunt.hcl` (the `locals` block added for impart, currently containing `impart_domain_to_service = { gpx = "run-gpx", run = "run-human" }`)

**Interfaces:**
- Consumes: `local.site_vars.locals.ecs_services.services` — the already-flattened list from `site.hcl:240` (each entry: `name` like `"run-gpx"`, `load_balancers[]` with `type` and optional `listener.host_headers` like `["gpx.{{SITE_DOMAIN}}"]` or `["run.{{SITE_DOMAIN}}", "*.run.{{SITE_DOMAIN}}"]`).
- Produces: same-named local `impart_domain_to_service`, now derived; `impart_enforced_services` comprehension is unchanged and must produce identical output.

- [ ] **Step 1: Branch**

```bash
cd /Users/khundeck/working/defcon.run.34/.claude/worktrees/impart
git fetch origin main --quiet && git checkout -b impart/derived-service-map origin/main
```

- [ ] **Step 2: Check for host-header collisions first**

```bash
grep -rn "host_headers" infra/terraform/live/site/services/*/service.hcl
```

Expected: each first host_header has a distinct subdomain prefix (gpx, run, auth, cms, flash, bib; mqtt is NLB-only). If `service_master` and `service_worker` in `run.cms/service.hcl` BOTH declare ALB listeners with `cms.*` host headers, note which one wins under `merge()` (later in the services list wins — worker) and add an inline comment; cms is not Impart-onboarded so behavior is unaffected either way.

- [ ] **Step 3: Replace the literal map**

In `infra/terraform/live/site/region/us-east-1/ecs-service/terragrunt.hcl`, replace:

```hcl
  # CloudFront domain label -> ECS service name. Extend when onboarding more
  # apps to Impart; lookup() without a default fails the plan loudly for a
  # domain missing here rather than silently skipping enforcement.
  impart_domain_to_service = {
    gpx = "run-gpx"
    run = "run-human"
  }
```

with:

```hcl
  # CloudFront domain label -> ECS service name, derived from each service's
  # ALB host_headers (first entry, e.g. "gpx.{{SITE_DOMAIN}}" -> "gpx").
  # Derivation means onboarding another app to Impart needs no edit here;
  # lookup() without a default still fails the plan loudly for a domain that
  # has no matching service.
  impart_domain_to_service = merge([
    for svc in local.site_vars.locals.ecs_services.services : {
      for lb in try(svc.load_balancers, []) :
      split(".", lb.listener.host_headers[0])[0] => svc.name
      if lb.type == "alb" && try(length(lb.listener.host_headers), 0) > 0
    }
  ]...)
```

- [ ] **Step 4: Verify the derivation with a render**

```bash
cd infra/terraform/live/site/region/us-east-1/ecs-service
terragrunt render --json 2>/dev/null | jq '.inputs.impart_header_enforced_services' || terragrunt plan --no-color 2>&1 | tail -5
cd /Users/khundeck/working/defcon.run.34/.claude/worktrees/impart
```

(If `terragrunt render` is unavailable in 0.97, the plan in Step 5 is the authoritative check.)

- [ ] **Step 5: Local plan — MUST be a no-op**

```bash
cd infra/terraform/live/site/region/us-east-1/ecs-service
terragrunt plan --no-color 2>&1 | grep -E "No changes|^.*Plan:"
cd /Users/khundeck/working/defcon.run.34/.claude/worktrees/impart
```

Expected: `No changes. Your infrastructure matches the configuration.` Both listener rules (gpx + run, currently enforced with the X-Impart-Edge condition) must be untouched. ANY diff here means the derived map differs from the literal one — STOP and fix the comprehension (dump it via a temporary `output`/render, compare against `{gpx="run-gpx", run="run-human", auth="run-auth", cms="run-cms-…", flash="run-flash", bib="run-bib"}`-shaped expectations).

- [ ] **Step 6: hclfmt check, commit, PR, merge, reconcile apply**

```bash
(cd infra/terraform/live/site/region/us-east-1/ecs-service && terragrunt hcl format --check --file terragrunt.hcl) || (cd infra/terraform/live/site/region/us-east-1/ecs-service && terragrunt hcl format --file terragrunt.hcl)
git add infra/terraform/live/site/region/us-east-1/ecs-service/terragrunt.hcl
git commit -m "refactor(infra): derive impart domain->service map from service host_headers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin impart/derived-service-map
gh pr create --title "refactor(infra): derive Impart domain->service map from service config" --body "Replaces the literal {gpx, run} map in ecs-service wiring with a derivation from ecs_services[].load_balancers[].listener.host_headers. Local plan verified as a strict no-op (both enforced listener rules untouched).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr merge --squash --delete-branch --admin
```

No CI apply strictly needed (no-op), but run one anyway so the next real apply has no surprises:

```bash
gh workflow run terragrunt-apply.yml --ref main -f region=us-east-1 -f modules=ecs-service
sleep 6 && RID=$(gh run list --workflow=terragrunt-apply.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch $RID --exit-status && gh run view $RID --log | grep "Apply complete"
```

Expected: `Apply complete! Resources: 0 added, 0 changed, 0 destroyed.`
Then immediately verify no service impact: `curl -sS -o /dev/null -w '%{http_code}\n' https://gpx.defcon.run/use1/api/health` and same for `https://run.defcon.run/hello` — both 200.

---

### Task 3: Impart Terraform provider — research spike + findings doc (+ scaffold only if feasible)

**Why:** The `X-Origin-Verify` require-rules and `X-Impart-Edge` injects live only in the Impart console today. A hand-pasted wrong value there caused a ~90s production 404 outage on run (2026-07-22). The [impart-security/impart provider](https://registry.terraform.io/providers/impart-security/impart/latest) has `spec`, `api_binding`, `rule`, `rule_script`, `list`, `monitor` resources — if rules/injects are expressible, both sides can read the same SOPS secret and that failure mode disappears.

**Files:**
- Create: `docs/superpowers/specs/2026-07-22-impart-terraform-provider-findings.md`
- Create (ONLY if findings say feasible): `infra/terraform/modules/impart/v1.0.0/{main.tf,variables.tf}` + `infra/terraform/live/site/global/impart/terragrunt.hcl` — scaffold, excluded/inert.

**Interfaces:**
- Consumes: provider docs at `https://github.com/impart-security/terraform-provider-impart/tree/main/docs` (WebFetch each relevant resource page: `rule.md` or `rule_script.md`, `spec.md`, `api_binding.md`, plus `data-sources/` listing).
- Produces: findings doc answering the five questions below; optional inert scaffold.

- [ ] **Step 1: Research (WebFetch, no cloning needed)**

Fetch and read:
- `https://github.com/impart-security/terraform-provider-impart/tree/main/docs` (index: resources AND data-sources)
- `https://raw.githubusercontent.com/impart-security/terraform-provider-impart/main/docs/index.md` (provider auth: confirm `IMPART_TOKEN` env var)
- `https://raw.githubusercontent.com/impart-security/terraform-provider-impart/main/docs/resources/rule_script.md` and `rule.md`
- `https://raw.githubusercontent.com/impart-security/terraform-provider-impart/main/docs/resources/spec.md` and `api_binding.md`

Answer in the findings doc, with evidence quotes:
1. Can a header-match block rule (our `X-Origin-Verify` require-rule) be expressed as `impart_rule`/`impart_rule_script`? Show the closest example.
2. Can a request-header inject toward the upstream (`X-Impart-Edge`) be expressed? In which resource?
3. Is the **cloud gateway / upstream address** configurable via the provider (this is where `origin-use1.defcon.run` from Task 1 would be wired), or console-only?
4. Are gateway DNS names / Impart egress IPs available as data sources (could `impart.hcl`'s pasted values become lookups)?
5. What does provider auth need (`IMPART_TOKEN` scope/creation path) and is Terraform state exposure of rule content acceptable (rules contain the secret VALUES → the state file in `tf-dc34-use1-80a6b349` already holds sensitive values, same risk class as today).

- [ ] **Step 2: Write the findings doc**

`docs/superpowers/specs/2026-07-22-impart-terraform-provider-findings.md` — structure: Summary verdict (Feasible / Partially / Not now), the five answers with evidence, recommended resource layout, and the Kurt-gate list (mint `IMPART_TOKEN` in console → `sops set .secrets.sops.json '["impart_api_token"]' '"<token>"'` → enable unit).

- [ ] **Step 3 (conditional — only if verdict is Feasible or Partially): scaffold inert unit**

`infra/terraform/live/site/global/impart/terragrunt.hcl` with an exclude gate reading a new `provider_managed = false` flag added to `impart.hcl` locals (same pattern as `global/cloudfront`'s `exclude` block), and `modules/impart/v1.0.0` containing only the `required_providers` block for `impart-security/impart` and commented-out example resources copied from the findings. It must be excluded by default so `terragrunt plan --all` does not attempt to init a provider that lacks a token. Verify: local `terragrunt plan` in `global/impart` reports the unit is excluded; `terragrunt run plan --all` from a sibling unit is unaffected.

- [ ] **Step 4: Commit, PR, merge (docs + optional scaffold)**

```bash
git fetch origin main --quiet && git checkout -b impart/provider-spike origin/main
git add docs/superpowers/specs/2026-07-22-impart-terraform-provider-findings.md infra/terraform/modules/impart infra/terraform/live/site/global/impart 2>/dev/null || git add docs/superpowers/specs/2026-07-22-impart-terraform-provider-findings.md
git commit -m "docs(infra): Impart terraform provider findings (+ inert scaffold if feasible)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin impart/provider-spike
gh pr create --title "docs: Impart terraform provider spike findings" --body "Research spike per the 2026-07-22 refactor plan Task 3. No live changes; scaffold (if present) is excluded by default pending IMPART_TOKEN.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr merge --squash --delete-branch --admin
```

---

### Final step (all tasks): memory + report

- [ ] Update `/Users/khundeck/.claude/projects/-Users-khundeck-working-defcon-run-34/memory/project_impart_cloudfront_origins.md` (and its `MEMORY.md` index line): tasks done, PR numbers, the Kurt-gates (Impart console upstream swap to `origin-use1.defcon.run`; `IMPART_TOKEN` if Task 3 feasible).
- [ ] Final message to Kurt: lead with what changed and the two console actions only he can do; include the verification curls.
