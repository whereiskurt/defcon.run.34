# Phase 19: Bib Infrastructure Foundation - Context

**Gathered:** 2026-06-30
**Status:** Ready for execution

<domain>
## Phase Boundary

Provision all AWS infrastructure for bib.defcon.run in both regions (us-east-1 + ca-central-1), mirroring the flash.defcon.run footprint exactly: subdomain + ACM cert + CloudFront, two ECR repos (nginx + app), a two-container ECS service definition (`service.hcl`), SSM parameter placeholders for OIDC and Stripe secrets, and `site.hcl` wiring. No application code, no containers built, no payment logic — pure infrastructure scaffolding. bib is an ordinary HTTP service (ALB + CloudFront), **not** an mqtt-style raw-TCP NLB service.

</domain>

<decisions>
## Implementation Decisions

### Service Layout (mirror run.flash)
- `services/run.bib/service.hcl` is a near-copy of `services/run.flash/service.hcl`
- Two containers: `run-bib-nginx` (TLS reverse proxy on 443) + `run-bib-app` (Next.js on 3000)
- ECR repos: `dc34-run-bib-nginx`, `dc34-run-bib-app` (IMMUTABLE, max_image_count 10, expire 30d)
- ALB load_balancer entry with `host_headers = ["bib.{{SITE_DOMAIN}}"]`, HTTPS target group, `/hello` health check (identical to flash nginx)
- Service discovery name `run-bib`, cluster `app`, task cpu 256 / memory 512 (same as flash)
- Regions list: `["us-east-1", "ca-central-1", "ap-southeast-1"]` to match flash (apse1 included in repo/task/service blocks even though active deploy targets are use1 + cac1)

### Subdomain + CloudFront + ACM
- Add `"bib"` to `dns.subdomains` in `site.hcl` — this auto-provisions the ACM cert and the Route53 zone the same way flash/cms/gpx do
- CloudFront distribution + behaviors for bib.defcon.run follow the existing flash pattern (HTTP service behind CloudFront, ALB origin)
- No NLB, no latency routing, no Proxy Protocol — this is the standard HTTP path

### Persistence
- Reuse the shared `run-human-electro` DynamoDB table via a new `Bib` ElectroDB entity (Phase 20). No new table is created in Phase 19.
- service.hcl wires the same `RUN_ELECTRO_*` env/secret pattern run.human uses so the app container can reach the electro table

### Secrets (SSM placeholders only in Phase 19)
- Path convention: `/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/bib/{key}`
- Keys created as placeholders this phase: `client_id`, `client_secret` (OIDC); `stripe_secret_key`, `stripe_webhook_secret` (Stripe); `paypal_client_id`, `paypal_client_secret`, `paypal_webhook_id` (PayPal/Venmo)
- v1.4 supports **cash + Stripe + PayPal/Venmo at launch**, so both processors' secret slots are created now; crypto (deferred) adds its own keys later
- Real/live values are populated out-of-band; dev uses Stripe test-mode + PayPal sandbox creds. Phase 19 only ensures the parameters exist and are referenced by service.hcl `secrets`

### Auth (follow the run.gpx pattern, not flash)
- Login is REQUIRED to get a bib. bib uses the **run.gpx Auth.js wiring**: full-path `AUTH_URL` (`/{region}/api/auth`), `AUTH_SERVICE_URL` / `AUTH_PUBLIC_URL` / `AUTH_INTERNAL_URL`, live claim re-validation against the internal auth server, and service-scoped cookies
- OIDC client to auth.defcon.run with a `bib` **service claim**; secrets `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `AUTH_INTERNAL_SECRET`, `AUTH_JWT_SECRET`
- The auth server must register a `bib` OIDC client and grant the `bib` service claim; that registration is a Phase 20 dependency, but the SSM `/bib/client_id` + `/bib/client_secret` slots are created here
- service.hcl auth env block is copied from `services/run.gpx/service.hcl` (gpx form), not flash

### Claude's Discretion
- Exact CloudFront cache-behavior tuning (copy flash defaults)
- ECR lifecycle policy specifics (match flash)
- Ordering of env/secret blocks in service.hcl
- Whether to include apse1 in active CloudFront behaviors or only use1/cac1 (follow whatever flash currently does)

</decisions>

<specifics>
## Specific Ideas

- bib.defcon.run is functionally a sibling of flash.defcon.run — copy, rename, swap domain/secrets, delete flash-only env vars (FLASH_PUBLIC_URL, RUN_HUMAN_INTERNAL_URL kept only if bib needs profile lookups — default: drop RUN_HUMAN_INTERNAL_URL unless needed)
- Add `BIB_PUBLIC_URL = https://bib.{{SITE_DOMAIN}}/{{REGION_LABEL}}` env var (parallel to FLASH_PUBLIC_URL)
- Stripe secrets are referenced in service.hcl now (so Phase 21 needs no infra change) but resolve to placeholder values until populated

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets (copy / adapt)
- `infra/terraform/live/site/services/run.flash/service.hcl` — full template for the two-container HTTP service
- `infra/terraform/live/site/services/run.flash/VERSION.app`, `VERSION.nginx` — version pin files
- `infra/terraform/live/site/site.hcl` lines 23 (`dns.subdomains`) and 57-62 (`read_terragrunt_config` service map)
- `modules/certs/v1.0.0/acm.tf` — ACM auto-provision when subdomain added
- `modules/cloudfront/v1.0.0/` — CloudFront + route53 alias pattern for HTTP services
- `modules/ecr/v1.0.0/main.tf` — per-service per-region ECR repos
- run.human electro env wiring (`RUN_ELECTRO_*`) for shared table access

### Established Patterns
- Template substitution tokens: `{{SITE_DOMAIN}}`, `{{REGION_LABEL}}`, `{{SITE_LABEL}}`, `{{REGION}}`
- SSM secrets path: `/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/{provider}/{key}`
- service.hcl read into site.hcl `services` local via `read_terragrunt_config("./services/run.<name>/service.hcl")`
- Subdomain → ACM + zone auto-provision by adding to `dns.subdomains`

### Integration Points
- `site.hcl` → add `"bib"` to `dns.subdomains`, add `bib = read_terragrunt_config("./services/run.bib/service.hcl")` to services map
- `services/run.bib/service.hcl` → new file (copy of run.flash)
- ECR / CloudFront / ACM modules pick up the new service via the services map + subdomains list
- SSM params for bib created (placeholder) so service.hcl `secrets` resolve at plan time

</code_context>

<deferred>
## Deferred Ideas

- Actual container images and Next.js code → Phase 20
- Stripe wiring and real secret values → Phase 21
- build.sh/deploy.sh/CI integration → Phase 22

</deferred>

---

*Phase: 19-bib-infrastructure-foundation*
*Context gathered: 2026-06-30*
