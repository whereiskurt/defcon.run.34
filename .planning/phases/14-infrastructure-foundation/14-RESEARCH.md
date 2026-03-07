# Phase 14: Infrastructure Foundation - Research

**Researched:** 2026-03-06
**Domain:** AWS Infrastructure (Terraform/Terragrunt) -- NLB, Route53, ECR, S3, SSM, Security Groups
**Confidence:** HIGH

## Summary

Phase 14 provisions all AWS infrastructure for mqtt.defcon.run across both production regions (us-east-1, ca-central-1). The codebase already has well-established Terraform modules for every component needed: network module with NLB support (currently disabled), ECR module for container repos, certs module for ACM, site module for Route53 zone delegation, secrets module for SSM parameters, and ecs-service module for target groups/listeners.

The work is primarily configuration and wiring -- enabling NLB in both regions' `network.hcl`, adding `"mqtt"` to `dns.subdomains` in `site.hcl`, creating a new `services/run.mqtt/service.hcl`, creating S3 buckets for meshtk blocklist/logging, adding MQTT SSM parameters, and patching the ecs-service module's Proxy Protocol v2 auto-enable behavior. A new lightweight `nlb-dns` module is needed for latency-based Route53 alias records since the existing cloudfront module's route53.tf pattern only handles CloudFront distributions, not NLBs.

**Primary recommendation:** Work wave-by-wave from foundational config changes (site.hcl, network.hcl) through module patches (PP2 fix, nlb-dns module) to service-specific resources (service.hcl, S3 buckets, SSM params). Each wave should be independently `terragrunt plan`-able.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- PP2 fix: Add optional `proxy_protocol_v2` boolean to each `load_balancer` entry in service.hcl (per-LB toggle), default `false`
- NLB Target Group Mapping: 1883(TCP)->meshtk:1883(PP2), 8883(TLS)->meshtk:1883(PP2), 443(TLS)->nginx:443, 8443(TLS)->mosquitto:9001
- Route53: New standalone module `modules/nlb-dns/v1.0.0/` for latency-based A alias records
- Cross-account Route53 uses `provider = aws.global-management` (same as CloudFront route53.tf)
- Zone auto-created when `"mqtt"` added to `dns.subdomains`
- SSM path convention: `/dc34/secrets/{region_label}/mqtt/{key}`
- Phase 14 creates infrastructure-level SSM params only (S3 bucket names, logging config)
- MQTT credential params deferred to Phase 15
- All ports (1883/8883/443/8443) open to internet (0.0.0.0/0) -- matches DC33 security posture
- meshtk handles abuse via rate limiting + S3 blocklist

### Claude's Discretion
- Exact S3 bucket naming (follow DC34 conventions with random suffix)
- NLB access log S3 lifecycle policies
- ECR repository lifecycle policies (image retention count)
- Security group rule ordering and descriptions
- Terraform module directory structure for nlb-dns

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-01 | NLB enabled in both regions with access logging to S3 | Set `nlb.enabled = true` in both `network.hcl` files. NLB module (`modules/network/v1.0.0/nlb.tf`) already creates NLB + S3 log bucket with lifecycle when enabled. |
| INFRA-02 | NLB listeners for 4 ports (1883/8883/443/8443) | Listeners created by ecs-service module via `load_balancers` list in `service.hcl`. Each entry with a `listener` block creates an `aws_lb_listener`. |
| INFRA-03 | ACM certificates for mqtt.defcon.run in both regions | Adding `"mqtt"` to `dns.subdomains` in site.hcl triggers certs module to create `aws_acm_certificate.subdomain_certs["mqtt"]` with DNS validation. |
| INFRA-04 | Route53 latency-based alias records for mqtt.defcon.run | New `modules/nlb-dns/v1.0.0/` module creates per-region A alias records with `set_identifier` and `latency_routing_policy`. |
| INFRA-05 | ECR repos for mqtt-mosquitto, mqtt-nginx, mqtt-meshtk in both regions | Add 3 ECR repo entries to `ecr_repositories` in service.hcl, aggregated into site.hcl `ecr.repositories`. ECR module handles per-region filtering. |
| INFRA-06 | S3 blocklist bucket for meshtk | New S3 bucket resource (standalone or in service.hcl context). Follow naming: `mqtt-blocklist-{region_label}-dc34-{random_suffix}`. |
| INFRA-07 | SSM parameters for infrastructure-level config | Use existing secrets module pattern. Phase 14 scope: S3 bucket names, logging config only. MQTT credentials deferred to Phase 15. |
| INFRA-08 | Security group for MQTT service allowing NLB traffic on ports 1883/8883/443/8443/9001 | NLB security group already exists in `securitygroups.tf` (lines 181-259) with all required ports. Must be added to ECS service's security group list. |
| INFRA-09 | ecs-service module PP2 fix | Patch `variables.tf` to add optional `proxy_protocol_v2` field to `load_balancer` object. Patch `main.tf` line 167 to use per-LB toggle instead of auto-detect. |
| INFRA-10 | S3 logging bucket for meshtk packet inspection | New S3 bucket for meshtk log rotation. Follow naming: `mqtt-logs-{region_label}-dc34-{random_suffix}`. |
</phase_requirements>

## Standard Stack

### Core
| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| Terraform | 1.14 | Infrastructure as code | Project standard |
| Terragrunt | 0.97 | DRY Terraform orchestration | Project standard, all infra uses it |
| AWS Provider | (project-pinned) | AWS resource management | Already configured in providers |

### Modules (Existing)
| Module | Path | Purpose | Changes Needed |
|--------|------|---------|----------------|
| network | `modules/network/v1.0.0/` | VPC, subnets, NLB, security groups | None (NLB already implemented, just disabled) |
| ecs-service | `modules/ecs-service/v1.0.0/` | ECS services, target groups, listeners | PP2 variable + logic patch |
| ecr | `modules/ecr/v1.0.0/` | ECR repository creation | None |
| certs | `modules/certs/v1.0.0/` | ACM certificate creation + DNS validation | None |
| site | `modules/site/v1.0.0/` | Route53 zone delegation | None (auto-creates zone for new subdomains) |
| secrets | `modules/secrets/v1.0.0/` | SSM Parameter Store | None |

### Modules (New)
| Module | Path | Purpose |
|--------|------|---------|
| nlb-dns | `modules/nlb-dns/v1.0.0/` | Latency-based Route53 A alias records for NLB |

## Architecture Patterns

### Project Structure (Existing Pattern)
```
infra/terraform/
├── live/site/
│   ├── site.hcl                          # Central config: dns, ecr, ecs aggregation
│   ├── services/
│   │   ├── run.auth/service.hcl          # Existing pattern to follow
│   │   └── run.mqtt/service.hcl          # NEW: MQTT service definition
│   └── region/
│       ├── us-east-1/
│       │   └── network/network.hcl       # Set nlb.enabled = true
│       └── ca-central-1/
│           └── network/network.hcl       # Set nlb.enabled = true
└── modules/
    ├── nlb-dns/v1.0.0/                   # NEW: Latency-based DNS for NLB
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    └── ecs-service/v1.0.0/               # PATCH: PP2 toggle
        ├── main.tf
        └── variables.tf
```

### Pattern 1: Service Definition (service.hcl)
**What:** Each service defines its ECR repos, task definition, and ECS service in a single `service.hcl` file under `services/`.
**When to use:** For every new ECS service.
**Example:** (from `services/run.auth/service.hcl` -- follow this exact pattern)
```hcl
locals {
  ecr_repositories = [
    {
      name                 = "mqtt-mosquitto"
      regions              = ["us-east-1", "ca-central-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = { max_image_count = 10, expire_days = 30 }
    },
    # ... more repos
  ]

  service = {
    name         = "run-mqtt"
    regions      = ["us-east-1", "ca-central-1"]
    cluster_name = "app"
    task_family  = "run-mqtt"
    # ...
    load_balancers = [
      {
        type                  = "nlb"
        container_name        = "mqtt-meshtk"
        container_port        = 1883
        target_group_protocol = "TCP"
        proxy_protocol_v2     = true  # NEW FIELD (Phase 14 adds this)
        listener = {
          port     = 1883
          protocol = "TCP"
        }
      },
      # ... more listeners
    ]
  }
}
```

### Pattern 2: Aggregation in site.hcl
**What:** `site.hcl` reads all service configs and concatenates their ECR repos, tasks, and services into aggregate lists.
**When to use:** When adding a new service.
**Key addition needed:**
```hcl
service_conf = {
  # ... existing services ...
  mqtt = read_terragrunt_config("./services/run.mqtt/service.hcl")
}

ecr = {
  enabled = true
  repositories = concat(
    # ... existing repos ...
    local.service_conf.mqtt.locals.ecr_repositories,
  )
}

ecs_services = {
  enabled = true
  services = [
    # ... existing services ...
    local.service_conf.mqtt.locals.service,
  ]
}
```

### Pattern 3: NLB Enabling (Conditional Provisioning)
**What:** NLB resources use `count = var.nlb.enabled ? 1 : 0`. Enabling NLB only requires setting `nlb.enabled = true` in `network.hcl`.
**Key detail:** NLB log bucket, public access block, lifecycle policy, and bucket policy are all conditional on `nlb.enabled`. No additional S3 config needed for NLB access logs.

### Pattern 4: Cross-Account Route53 DNS
**What:** Route53 records in the management account use `provider = aws.global-management`. Subdomain zones in the application account use `provider = aws.global-application`.
**Key detail:** The site module creates the `mqtt.defcon.run` zone in the application account and delegates NS records to the management account. The nlb-dns module needs to create A alias records in the subdomain zone using the correct provider.

### Pattern 5: Security Group Assignment
**What:** Network module outputs `security_group_ids` (currently only `sshhttps` + `http_only`). ECS service module receives this as input.
**Critical gap:** The NLB security group is already defined but NOT included in `security_group_ids` output. The MQTT service needs the NLB security group.
**Solution options:**
1. Add NLB SG to `security_group_ids` output conditionally when `nlb.enabled = true`
2. Create a separate output like `nlb_security_group_id` and add it in the ecs-service terragrunt wiring
3. Output all security groups (already done via `security_groups` map output) and select in terragrunt

### Anti-Patterns to Avoid
- **Do not create separate NLB resources in service.hcl:** The NLB itself is managed by the network module, not the service. Services only define listeners and target groups via `load_balancers`.
- **Do not hardcode certificate ARNs in service.hcl:** Use template variables like `{{CERT_ARN_MQTT}}` or wire through terragrunt dependency on certs module output.
- **Do not put MQTT credential SSM params in Phase 14:** Context explicitly defers these to Phase 15.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| NLB + S3 logging | Custom NLB resources | `nlb.enabled = true` in network.hcl | Already implemented in nlb.tf with full S3 logging pipeline |
| ACM certificates | Manual cert creation | Add `"mqtt"` to `dns.subdomains` | certs module auto-creates per-subdomain certs with DNS validation |
| ECR repositories | Manual ECR resources | Add repos to `ecr_repositories` in service.hcl | ECR module handles per-region filtering, lifecycle policies, repo policies |
| Route53 zone delegation | Manual NS records | Add `"mqtt"` to `dns.subdomains` | site module auto-creates zone and delegates NS records |
| SSM parameters | Manual aws_ssm_parameter | Use secrets module | Handles KMS encryption, path templating, tagging |

## Common Pitfalls

### Pitfall 1: NLB Security Group Not Attached to ECS Tasks
**What goes wrong:** MQTT traffic reaches NLB but ECS tasks reject it because their security group doesn't allow NLB source traffic on MQTT ports.
**Why it happens:** The `security_group_ids` output from network module only includes `sshhttps` and `http_only` (line 71-74 of outputs.tf). The NLB security group exists but isn't in the default list.
**How to avoid:** Either modify the network module output to conditionally include the NLB SG, or pass it separately through terragrunt wiring to ecs-service.
**Warning signs:** `terragrunt plan` shows ECS service with only 2 security groups when MQTT needs 3.

### Pitfall 2: PP2 Breaking Existing Services
**What goes wrong:** Changing the PP2 logic in ecs-service module affects ALL existing services, not just MQTT.
**Why it happens:** The module is shared across all services. A bad default change could flip PP2 behavior.
**How to avoid:** Default `proxy_protocol_v2` to `null` (not `false`), and fall back to the current auto-detect behavior when null. This way existing services without the field behave identically to today.
**Warning signs:** Run `terragrunt plan` on ALL services after the PP2 patch -- expect zero changes for existing services.

### Pitfall 3: Certificate ARN Wiring for NLB TLS Listeners
**What goes wrong:** NLB TLS listeners (8883, 443, 8443) need the ACM certificate ARN for mqtt.defcon.run, but the cert is created by the certs module and must flow through to ecs-service.
**Why it happens:** The cert_map output is keyed by domain name. The MQTT cert needs to be looked up and passed to the service.hcl's listener configuration.
**How to avoid:** Wire `dependency.certs.outputs.cert_map["mqtt.defcon.run"].arn` through to the service's `certificate_arn` field, or use template substitution.
**Warning signs:** TLS listeners in `terragrunt plan` show empty or placeholder certificate ARNs.

### Pitfall 4: Latency-Based DNS Requires set_identifier
**What goes wrong:** Route53 alias records for NLB fail to create because latency-based routing requires `set_identifier` (unique per record set).
**Why it happens:** Standard A alias records don't need identifiers, but routing policy records do.
**How to avoid:** The nlb-dns module must include `set_identifier` (e.g., region label) and `latency_routing_policy { region = var.region.full }` on each record.

### Pitfall 5: NLB Log Bucket Policy Race Condition
**What goes wrong:** NLB creation fails because the S3 log bucket policy hasn't propagated.
**Why it happens:** S3 bucket policies have eventual consistency. The NLB tries to write logs before the policy allows it.
**How to avoid:** The retry logic in `terragrunt.hcl` already handles this with `"(?s).*bucket must exist.*"`. Ensure this retry config covers the network module's terragrunt.hcl.

### Pitfall 6: ap-southeast-1 Skip Region
**What goes wrong:** MQTT resources accidentally deployed to ap-southeast-1.
**Why it happens:** site.hcl has `skip_regions = ["ap-southeast-1"]` but MQTT service regions must explicitly exclude it.
**How to avoid:** Set `regions = ["us-east-1", "ca-central-1"]` in MQTT service/task/ECR definitions (not 3 regions like auth service).

## Code Examples

### PP2 Fix in ecs-service module

**variables.tf** -- add `proxy_protocol_v2` to load_balancer object:
```hcl
load_balancers = optional(list(object({
  type                  = string
  container_name        = string
  container_port        = number
  target_group_port     = optional(number, null)
  target_group_protocol = optional(string, "TCP")
  proxy_protocol_v2     = optional(bool, null)  # NEW: explicit PP2 toggle
  health_check_path     = optional(string, "/")
  health_check_protocol = optional(string, null)
  health_check          = optional(object({...}), {})
  listener              = optional(object({...}), null)
})), [])
```

**main.tf** line 167 -- replace auto-detect with per-LB toggle:
```hcl
# Before (current):
proxy_protocol_v2 = each.value.type == "nlb" && each.value.target_group_protocol == "TCP" ? true : false

# After (fixed):
proxy_protocol_v2 = each.value.proxy_protocol_v2 != null ? each.value.proxy_protocol_v2 : (each.value.type == "nlb" && each.value.target_group_protocol == "TCP" ? true : false)
```
This preserves backward compatibility: existing services without `proxy_protocol_v2` set get the old auto-detect behavior. New services can explicitly override.

### nlb-dns Module (New)

**modules/nlb-dns/v1.0.0/main.tf:**
```hcl
resource "aws_route53_record" "nlb_alias" {
  provider = aws.global-application

  zone_id = var.zone_id
  name    = var.domain_name
  type    = "A"

  set_identifier = var.region.label

  alias {
    name                   = var.nlb_dns_name
    zone_id                = var.nlb_zone_id
    evaluate_target_health = true
  }

  latency_routing_policy {
    region = var.region.full
  }
}
```

**modules/nlb-dns/v1.0.0/variables.tf:**
```hcl
variable "zone_id"       { type = string }
variable "domain_name"   { type = string }
variable "nlb_dns_name"  { type = string }
variable "nlb_zone_id"   { type = string }
variable "region" {
  type = object({
    label = string
    full  = string
  })
}
```

### NLB Listener Definitions in service.hcl

```hcl
load_balancers = [
  # Port 1883: TCP MQTT -> meshtk (PP2 enabled)
  {
    type                  = "nlb"
    container_name        = "mqtt-meshtk"
    container_port        = 1883
    target_group_protocol = "TCP"
    proxy_protocol_v2     = true
    health_check_protocol = "TCP"
    health_check = {
      healthy_threshold   = 2
      unhealthy_threshold = 2
      interval            = 30
    }
    listener = {
      port     = 1883
      protocol = "TCP"
    }
  },
  # Port 8883: TLS MQTT -> meshtk (PP2 enabled, NLB terminates TLS)
  {
    type                  = "nlb"
    container_name        = "mqtt-meshtk"
    container_port        = 1883
    target_group_port     = 1883
    target_group_protocol = "TCP"
    proxy_protocol_v2     = true
    health_check_protocol = "TCP"
    health_check = {
      healthy_threshold   = 2
      unhealthy_threshold = 2
      interval            = 30
    }
    listener = {
      port            = 8883
      protocol        = "TLS"
      certificate_arn = ""  # Wired via terragrunt dependency
    }
  },
  # Port 443: TLS HTTPS -> nginx (NLB terminates TLS)
  {
    type                  = "nlb"
    container_name        = "mqtt-nginx"
    container_port        = 443
    target_group_protocol = "TCP"
    proxy_protocol_v2     = false
    health_check_protocol = "TCP"
    health_check = {
      healthy_threshold   = 2
      unhealthy_threshold = 2
      interval            = 30
    }
    listener = {
      port            = 443
      protocol        = "TLS"
      certificate_arn = ""  # Wired via terragrunt dependency
    }
  },
  # Port 8443: TLS WebSocket -> mosquitto (NLB terminates TLS)
  {
    type                  = "nlb"
    container_name        = "mqtt-mosquitto"
    container_port        = 9001
    target_group_protocol = "TCP"
    proxy_protocol_v2     = false
    health_check_protocol = "TCP"
    health_check = {
      healthy_threshold   = 2
      unhealthy_threshold = 2
      interval            = 30
    }
    listener = {
      port            = 8443
      protocol        = "TLS"
      certificate_arn = ""  # Wired via terragrunt dependency
    }
  }
]
```

### Security Group Wiring

The network module output `security_groups` already exposes all SGs as a map:
```hcl
output "security_groups" {
  value = {
    sshhttps  = aws_security_group.sshhttps.id
    http_only = aws_security_group.http_only.id
    postgres  = aws_security_group.postgres.id
    etherpad  = aws_security_group.etherpad.id
    nlb       = aws_security_group.nlb.id
  }
}
```

Option to conditionally extend `security_group_ids` when NLB is enabled:
```hcl
output "security_group_ids" {
  value = concat(
    [aws_security_group.sshhttps.id, aws_security_group.http_only.id],
    var.nlb.enabled ? [aws_security_group.nlb.id] : []
  )
}
```

### S3 Buckets for MQTT

```hcl
# Blocklist bucket (INFRA-06)
resource "aws_s3_bucket" "mqtt_blocklist" {
  bucket = "mqtt-blocklist-${var.region.label}-${var.site.label}-${var.site.random_suffix}"
  # ...lifecycle, public access block, etc.
}

# Logging bucket (INFRA-10)
resource "aws_s3_bucket" "mqtt_logs" {
  bucket = "mqtt-logs-${var.region.label}-${var.site.label}-${var.site.random_suffix}"
  # ...lifecycle with expiration for log rotation
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded PP2 auto-enable | Per-LB `proxy_protocol_v2` toggle | Phase 14 (new) | Enables mixed PP2/non-PP2 on same NLB |
| CloudFront-only DNS | NLB latency-based DNS for TCP | Phase 14 (new) | MQTT gets nearest-region routing without CloudFront |
| Manual security group lists | Conditional SG inclusion | Phase 14 (new) | NLB SG auto-included when NLB enabled |

## Key Implementation Details

### Target Group Naming
The ecs-service module names target groups as `${service_name}-${container_port}`. With 4 load_balancer entries, two map to the same container port 1883 (listeners 1883 and 8883 both target meshtk:1883). This may cause a naming collision since both would get name `run-mqtt-use1-1883`.

**Solution:** The `target_group_port` field exists for this purpose. Set different `target_group_port` values, or verify that the `lb_idx` in the key (`${service_name}-lb-${lb_idx}`) provides sufficient uniqueness. Looking at the code, the target group name uses `${each.value.service_name}-${each.value.container_port}` which WILL collide. The `key` uses `lb_idx` so `for_each` works, but the `name` attribute will fail.

**Fix needed:** Use `target_group_port` to differentiate, or modify the target group naming to include the listener port or lb_idx. Since `target_group_port` defaults to `container_port`, setting `target_group_port = 8883` for the 8883 listener would create a distinct target group name `run-mqtt-use1-8883` while still targeting container port 1883.

### NLB TLS Termination
NLB terminates TLS on ports 8883, 443, and 8443. The target group protocol remains TCP (NLB forwards decrypted TCP to containers). The ACM cert for `mqtt.defcon.run` is used on all three TLS listeners.

### Terragrunt Dependency Chain
```
site (creates mqtt.defcon.run zone)
  -> certs (creates ACM cert for mqtt.defcon.run)
    -> network (creates NLB, SGs)
      -> ecr (creates repos)
      -> ecs-task (creates task definition) -- Phase 15
        -> ecs-service (creates service, TGs, listeners) -- Phase 15
      -> nlb-dns (creates latency A records) -- needs NLB outputs
```

Phase 14 handles: site.hcl change, network.hcl changes, ecr additions, nlb-dns module creation, ecs-service PP2 patch, S3 buckets, SSM params.
Phase 15 handles: service.hcl task definition, ecs-service deployment with listeners.

**Important:** The NLB listeners are created by the ecs-service module (not the network module). Since Phase 14 is "no containers," the listeners will be defined in service.hcl but won't be applied until Phase 15 deploys the ECS service. The service.hcl file is created in Phase 14 for planning/validation but the actual `terragrunt apply` of ecs-service happens in Phase 15.

### What Phase 14 Can Actually Apply
1. `site` module -- add `"mqtt"` to subdomains (creates Route53 zone)
2. `certs` module -- auto-creates mqtt.defcon.run ACM cert
3. `network` module -- enable NLB in both regions (creates NLB + log buckets)
4. `ecr` module -- create 3 new repos per region
5. `secrets` module -- add MQTT infrastructure SSM params
6. `nlb-dns` module -- create latency-based DNS records (new terragrunt unit)
7. S3 buckets for blocklist/logging (need a home -- could be standalone or in a new module)
8. `ecs-service` module patch -- code change only, no apply needed yet

### S3 Bucket Placement Decision
The MQTT-specific S3 buckets (blocklist, logs) don't fit neatly into existing modules. Options:
1. **New `mqtt-s3` terragrunt unit** with inline resources -- simple but ad-hoc
2. **Extend network module** -- these aren't network resources, poor fit
3. **New `mqtt-storage` module** -- clean but possibly over-engineered for 2 buckets
4. **Inline in a regional `mqtt/` terragrunt unit** alongside nlb-dns

**Recommendation:** Create a single `region/{region}/mqtt/` terragrunt unit that contains both S3 buckets and the nlb-dns module call. This keeps MQTT-specific regional resources together and follows the pattern of other regional units.

## Open Questions

1. **Target group name collision for shared container ports**
   - What we know: Two NLB listeners (1883, 8883) target the same container port 1883. Target group names use `${service_name}-${container_port}`.
   - What's unclear: Whether the existing `lb_idx`-based key prevents name collision in the `name` attribute.
   - Recommendation: Use `target_group_port` differentiation (set 8883 listener's `target_group_port = 8883`) so the target group gets a unique name while still forwarding to container port 1883.

2. **Certificate ARN wiring to service.hcl**
   - What we know: The certs module outputs `cert_map` keyed by domain name. service.hcl uses template variables like `{{SITE_DOMAIN}}`.
   - What's unclear: Whether the cert ARN can be templated in service.hcl or must be wired through terragrunt.
   - Recommendation: Wire via terragrunt dependency in ecs-service/terragrunt.hcl, not template substitution. Add `dependency.certs.outputs.cert_map["mqtt.defcon.run"].arn` and pass it as an input.

3. **nlb-dns Terragrunt wiring**
   - What we know: The module needs NLB outputs (dns_name, zone_id) and the Route53 zone_id for mqtt.defcon.run.
   - What's unclear: Whether to create a new regional terragrunt unit or extend an existing one.
   - Recommendation: New `region/{region}/mqtt/` terragrunt unit with dependencies on `network` and `site`.

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `modules/network/v1.0.0/nlb.tf` -- NLB resource with conditional enable and S3 logging
- Codebase inspection: `modules/network/v1.0.0/securitygroups.tf` (lines 181-259) -- NLB security group with all MQTT ports
- Codebase inspection: `modules/ecs-service/v1.0.0/main.tf` (line 167) -- PP2 auto-enable logic
- Codebase inspection: `modules/ecs-service/v1.0.0/variables.tf` -- load_balancer type definition
- Codebase inspection: `modules/ecr/v1.0.0/main.tf` -- ECR repo creation pattern
- Codebase inspection: `modules/certs/v1.0.0/acm.tf` -- ACM cert creation per subdomain
- Codebase inspection: `modules/site/v1.0.0/route35.tf` -- Route53 zone delegation
- Codebase inspection: `modules/secrets/v1.0.0/ssm.tf` -- SSM parameter creation
- Codebase inspection: `modules/cloudfront/v1.0.0/route53.tf` -- Cross-account Route53 A alias pattern
- Codebase inspection: `live/site/site.hcl` -- Service config aggregation pattern
- Codebase inspection: `live/site/services/run.auth/service.hcl` -- Service definition pattern
- Codebase inspection: `live/site/region/us-east-1/network/network.hcl` -- NLB config (currently disabled)
- Codebase inspection: `live/site/region/us-east-1/ecs-service/terragrunt.hcl` -- Dependency wiring

### Secondary (MEDIUM confidence)
- AWS NLB latency-based routing with Route53 -- standard AWS pattern, well-documented

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all modules exist and are verified in codebase
- Architecture: HIGH -- follows established patterns exactly
- Pitfalls: HIGH -- identified from direct code inspection (PP2 auto-enable, SG exclusion, TG naming)
- NLB-DNS module: MEDIUM -- new module follows cloudfront route53.tf pattern but needs validation

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable infrastructure, no external dependency changes expected)
