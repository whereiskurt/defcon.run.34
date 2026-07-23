# Impart Terraform Provider — Spike Findings (2026-07-22)

Research spike per Task 3 of `docs/superpowers/plans/2026-07-22-impart-hardcode-refactor.md`.
Provider: [`impart-security/impart`](https://registry.terraform.io/providers/impart-security/impart/latest),
docs read from `github.com/impart-security/terraform-provider-impart` @ main (latest release v0.15.1, April 2026).

## Summary verdict: **Partially feasible**

The provider can carry our rule content and — importantly — owns the **upstream
address** (`impart_api_binding.upstream_origin`), which is exactly where the
Task 1 `origin-use1.defcon.run` alias belongs. What it cannot do is express a
header-inject or header-require rule *declaratively*: rules are opaque
content blobs (JavaScript for `type = "script"`, console-exported JSON for
`type = "recipe"`), so Terraform guarantees the deployed rule matches the
repo, but the rule body itself is still authored in Impart's rule language.
No data sources exist for gateway DNS names or egress IPs, so `impart.hcl`'s
pasted values stay pasted.

An inert scaffold has been created (see "Scaffold" below), excluded by
default pending the `IMPART_TOKEN` Kurt-gate.

## The five questions

### 1. Can the `X-Origin-Verify` require-rule be expressed?

**Structurally yes, as opaque content.** `impart_rule` uploads a rule with
`type = "script"` (JavaScript body) or `type = "recipe"` (JSON body), with
`blocking_effect = "block" | "simulate"`. Docs example (`docs/resources/rule.md`):

```terraform
resource "impart_rule" "example" {
  name            = "example"
  disabled        = false
  description     = "Rule description"
  source_file     = "${path.module}/rule.js"
  source_hash     = "<sha256 hash for the source_file content>"
  blocking_effect = "block"
  type            = "script"
}

resource "impart_rule" "example_rule_recipe" {
  name            = "example"
  disabled        = false
  description     = "Rule description"
  content         = file("${path.module}/rule.json")
  blocking_effect = "block"
  type            = "recipe"
}
```

The provider validates nothing about the body — header-match logic lives in
Impart's rule language, documented in Impart's product docs (not the provider
repo; `docs.impart.security` is not publicly resolvable, console-gated).
**Practical path:** export the existing console-built require-rule as recipe
JSON from the console, commit it, and manage it via `impart_rule` with
`content = file(...)`. Terraform then pins the deployed rule to the repo copy
— which is the guarantee we actually want after the 2026-07-22 hand-paste
outage.

### 2. Can the `X-Impart-Edge` request-header inject be expressed?

**Same story, weaker evidence.** There is no dedicated "header inject"
resource; the inject Kurt configured in the console would also have to be
exported/expressed as rule content (`impart_rule`). Whether Impart's rule
language can set request headers toward the upstream is not evidenced in the
provider docs — the console feature proves the platform can do it, but not
that it is exportable as a recipe. **Must be confirmed by attempting a
console export of the existing inject rule.** If it exports, it is
manageable; if the inject is a gateway-level (not rule-level) setting, it
stays console-only for now.

### 3. Is the gateway upstream address configurable via the provider?

**Yes — this is the headline finding.** `impart_api_binding` (docs
`resources/api_binding.md`) has required `name`, `port`, `hostname`,
`base_path`, `spec_id` and an optional **`upstream_origin`** — "configurable
upstream destination address" — plus `use_forwarded`, `hops`, and
`forwarded_*` header lists. The binding is the hostname/port/base_path entry
point; `upstream_origin` is where traffic is forwarded. This is where
`origin-use1.defcon.run` (Task 1) gets wired as code instead of a console
field. Caveat: adopting it means importing the two existing console-created
bindings (`terraform import` is supported per docs) so Terraform doesn't try
to create duplicates; `api_binding` also requires a `spec_id`, so a minimal
`impart_spec` (OpenAPI stub per app) comes with it.

### 4. Are gateway DNS names / Impart egress IPs available as data sources?

**No.** The complete data-source inventory is `connector` (Slack/Jira
OAuth connectors) and `spec`. Nothing exposes `*.impartcloud.net` gateway DNS
names or gateway egress IPs. The pasted values in `impart.hcl`
(`origins.*.dns_name`, `alb_ingress_cidrs`) cannot become lookups today.
They stay hand-maintained; the derived-map work (Task 2) at least means they
are maintained in exactly one file.

### 5. Provider auth + state exposure

- Auth: an **API token minted in the Impart console** (README: "authenticate
  via an API token generated in the Impart console, then configure the
  provider with the token either through environment variables or explicit
  configuration"). Provider block args are `endpoint` and `token`, both
  optional strings (`docs/index.md`). We would feed it
  `token = local.secret_values.impart_api_token` from SOPS rather than
  relying on the env var, matching how other secrets flow here.
- State exposure: rule content (which embeds the `X-Origin-Verify` /
  `X-Impart-Edge` secret VALUES) and the token would land in the state file
  in `tf-dc34-use1-80a6b349`. That bucket's state already holds the same
  class of secrets (the CloudFront custom-header inject of
  `impart_origin_verify`, ALB listener-rule condition values, SOPS-decrypted
  inputs). **Acceptable — same risk class as today.**

## Recommended resource layout (when enabled)

```
modules/impart/v1.0.0/
  main.tf        # required_providers + impart_rule (recipe JSON from console export)
  variables.tf   # token, upstream map (origin-<region>.defcon.run), secrets
  rules/         # exported recipe JSON / rule JS, committed
live/site/global/impart/terragrunt.hcl   # excluded until impart.provider_managed = true
```

Phase order: (a) import the two `api_binding`s + set `upstream_origin` to the
Task 1 alias — kills the raw-ALB-DNS hardcode; (b) export + adopt the
require/inject rules — kills the hand-paste failure mode; (c) leave
dns_name/egress IPs pasted (no data sources).

## Kurt-gates (in order)

1. In the Impart console: mint an API token (scope: rules + bindings write).
2. `sops set infra/terraform/live/site/.secrets.sops.json '["impart_api_token"]' '"<token>"'`
3. Flip `provider_managed = true` in `infra/terraform/live/site/impart.hcl`.
4. Export the existing require-rule + inject rule from the console (JSON) so
   they can be committed under `modules/impart/v1.0.0/rules/` — this also
   answers the open question in #2.

## Scaffold (created by this spike, inert)

- `infra/terraform/modules/impart/v1.0.0/{main.tf,variables.tf}` — pinned
  `impart-security/impart` provider block, commented example resources copied
  from the docs above.
- `infra/terraform/live/site/global/impart/terragrunt.hcl` — `exclude`-gated
  on `impart.provider_managed` (new flag in `impart.hcl`, default `false`),
  so `plan --all` never inits the provider without a token.
