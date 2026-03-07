# Phase 14: Infrastructure Foundation - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Provision all AWS infrastructure for mqtt.defcon.run in both regions (us-east-1 + ca-central-1). NLB with 4 listeners, security groups, ECR repos, ACM certs, Route53 latency-based DNS, S3 buckets, SSM parameters, and ecs-service module PP2 fix. No application code or containers — pure infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Proxy Protocol v2 Module Patch
- Add optional `proxy_protocol_v2` boolean to each `load_balancer` entry in service.hcl (per-LB toggle)
- Default `false` — existing ALB-backed services unchanged
- meshtk's 1883 TCP target group gets `proxy_protocol_v2 = true` (meshtk handles PP2 headers from NLB)
- Mosquitto (1884) and nginx (443) targets don't get PP2 — they're internal-only or handle TLS

### NLB Target Group Mapping (Match DC33)
- NLB listener 1883 (TCP) → meshtk container port 1883 (PP2 enabled)
- NLB listener 8883 (TLS) → meshtk container port 1883 (PP2 enabled, NLB terminates TLS)
- NLB listener 443 (TLS) → nginx container port 443 (NLB terminates TLS)
- NLB listener 8443 (TLS) → mosquitto container port 9001 (WebSocket, NLB terminates TLS)
- Mosquitto port 1884 is internal-only (meshtk forwards to it via localhost)

### Route53 NLB DNS
- New standalone module: `modules/nlb-dns/v1.0.0/` — creates latency-based A alias records
- One A record per region pointing mqtt.defcon.run to that region's NLB
- Cross-account Route53 uses `provider = aws.global-management` (same pattern as CloudFront route53.tf)
- Zone created automatically by site module when `"mqtt"` added to `dns.subdomains`

### SSM Parameter Structure
- Follow DC34 naming convention: `/dc34/secrets/{region_label}/mqtt/{key}`
- Phase 14 creates core infrastructure-level params only: S3 bucket names, logging config
- MQTT credential params (channel PSK, user passwords, meshobserv creds, OpenAI key) added in Phase 15 when containers need them
- meshtk config or env vars adapted to read DC34-style paths (not DC33 paths)

### Port 1883 Exposure
- Both 1883 (plaintext) and 8883 (TLS) open to internet (0.0.0.0/0)
- flash.defcon.run configured to push 8883 as primary MQTT server to radios
- 1883 remains available as fallback for compatibility
- All ports open from all sources — meshtk handles abuse via rate limiting + S3 blocklist
- Matches DC33 security posture

### Claude's Discretion
- Exact S3 bucket naming (follow DC34 conventions with random suffix)
- NLB access log S3 lifecycle policies
- ECR repository lifecycle policies (image retention count)
- Security group rule ordering and descriptions
- Terraform module directory structure for nlb-dns

</decisions>

<specifics>
## Specific Ideas

- Replicate DC33 NLB listener setup exactly (4 listeners, 3 target groups)
- NLB security group already has all MQTT ports defined in securitygroups.tf — just needs to be wired to ECS tasks
- ACM cert auto-provisions when "mqtt" added to dns.subdomains in site.hcl
- ECR repos named mqtt-mosquitto, mqtt-nginx, mqtt-meshtk (3 repos per region)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `modules/network/v1.0.0/nlb.tf`: NLB resource with conditional enable, S3 logging — just set `nlb.enabled = true`
- `modules/network/v1.0.0/securitygroups.tf` (lines 181-259): MQTT security group with ports 1883/8883/9001/8443/443 already defined
- `modules/ecs-service/v1.0.0/main.tf`: NLB listener creation with `for_each`, health checks, target groups
- `modules/certs/v1.0.0/acm.tf`: ACM cert creation with Route53 DNS validation
- `modules/site/v1.0.0/route35.tf`: Route53 zone delegation — auto-creates mqtt.defcon.run zone
- `modules/ecr/v1.0.0/main.tf`: ECR repo creation per-service per-region

### Established Patterns
- `service.hcl` pattern: ECR repos, task def, service config, load_balancers list — see `services/run.auth/service.hcl`
- Conditional provisioning: `count = var.nlb.enabled ? 1 : 0`
- Cross-account Route53: `provider = aws.global-management` for management account DNS
- Template substitution: `{{SITE_DOMAIN}}`, `{{REGION_LABEL}}`, `{{SITE_LABEL}}`
- SSM secrets path: `/dc34/secrets/{region_label}/{provider}/{key}`

### Integration Points
- `site.hcl` → add `"mqtt"` to `dns.subdomains` array
- `network.hcl` → set `nlb.enabled = true` in both region configs
- `ecs-service/main.tf` line 167 → modify PP2 logic to check per-LB toggle
- `services/run.mqtt/service.hcl` → new file defining ECR repos, task, service, load balancers
- NLB outputs (`nlb_arn`, `nlb_dns_name`, `nlb_zone_id`) flow to ecs-service module

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 14-infrastructure-foundation*
*Context gathered: 2026-03-06*
