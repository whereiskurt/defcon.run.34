# Technology Stack: v1.3 Meshtk Integration

**Project:** defcon.run.34 - MQTT/Meshtk Infrastructure
**Researched:** 2026-03-06
**Focus:** NEW stack additions only (existing Next.js/React/Strapi/ECS/CloudFront stack validated)

## Critical DNS Architecture Decision

**The single most important finding: you cannot point `mqtt.defcon.run` to both an NLB and a CloudFront distribution simultaneously.**

Route53 alias A records for the same name can only point to one target type. DNS does not differentiate by port -- a client resolving `mqtt.defcon.run` gets the same IP(s) regardless of whether it connects on port 1883, 8883, or 443.

### Recommended Approach: NLB-only for mqtt.defcon.run

Point `mqtt.defcon.run` Route53 A record alias to the NLB in each region. Serve meshmap on port 443 through the NLB itself (TLS-terminating to nginx). Do NOT create a CloudFront distribution for mqtt.defcon.run.

**Why:** Meshtastic radios connect via raw TCP on ports 1883/8883 -- they cannot traverse CloudFront (which only handles HTTP/HTTPS on port 443). The meshmap web UI is lightweight static content that does not benefit meaningfully from CloudFront edge caching. NLB TLS termination on port 443 with ACM certs provides the same HTTPS experience.

**Alternative considered and rejected:** Separate subdomains (e.g., `broker.mqtt.defcon.run` for NLB, `map.mqtt.defcon.run` for CloudFront). This adds DNS complexity and certificate SANs for marginal caching benefit on a low-traffic admin tool.

**Alternative considered and rejected:** CloudFront with NLB origin. CloudFront only forwards traffic on HTTP/HTTPS (port 443). It cannot proxy raw TCP MQTT traffic on ports 1883/8883. You would still need NLB DNS for MQTT ports, creating the dual-record problem.

### DNS Configuration Per Region

```
mqtt.defcon.run -> Route53 A alias -> NLB (us-east-1)  [latency-based routing]
mqtt.defcon.run -> Route53 A alias -> NLB (ca-central-1) [latency-based routing]
```

All four ports (1883, 8883, 443, 8443) resolve to the same NLB IPs. The NLB routes each port to the correct target group within the 4-container ECS task.

**Confidence:** HIGH -- verified against AWS Route53 documentation on alias records and CloudFront port limitations.

## Recommended Stack

### Container Images (3 new ECR repos per region)

| Image | Base | Version | Purpose | Why |
|-------|------|---------|---------|-----|
| `mqtt-mosquitto` | `eclipse-mosquitto` | `2.0.22-alpine` | MQTT broker | Official image, 4.7MB, production-stable. Pin to 2.0.22 not `latest`. |
| `mqtt-nginx` | `nginx` | `1.28.2-alpine` | Meshmap web server + meshobserv reverse proxy | Stable branch. Serves static meshmap files and proxies meshobserv WebSocket. |
| `mqtt-meshtk` | `golang` build + `alpine` runtime | Go 1.24 | gRPC/MQTT proxy, packet inspection, rate limiting, S3 logging | Multi-stage build: compile in golang:1.24, run in alpine:3.21 for minimal image. |

**Note:** The `ghosts` fleet simulator container uses the same `mqtt-meshtk` image with a different entrypoint/command. No separate ECR repo needed.

### NLB Listeners (4 per region)

| Port | Protocol | TLS Termination | Target Group Protocol | Target Port | Container | Why |
|------|----------|------------------|-----------------------|-------------|-----------|-----|
| 1883 | TCP | None (plaintext) | TCP | 1883 | mqtt-mosquitto | Standard MQTT. Radios on local/trusted networks. |
| 8883 | TLS | NLB terminates via ACM cert | TCP | 1883 | mqtt-mosquitto | Encrypted MQTT. NLB terminates TLS, forwards plaintext to mosquitto. Avoids managing certs inside container. |
| 443 | TLS | NLB terminates via ACM cert | TCP | 80 | mqtt-nginx | Meshmap HTTPS. NLB terminates TLS, forwards HTTP to nginx. |
| 8443 | TLS | NLB terminates via ACM cert | TCP | 9001 | mqtt-mosquitto | WebSocket-over-TLS MQTT. NLB terminates TLS, forwards to mosquitto WebSocket listener. |

**Confidence:** HIGH -- the existing `ecs-service` module (line 216-240 of `ecs-service/v1.0.0/main.tf`) already supports NLB listeners with TLS termination, ACM certs, and TCP target groups. The `proxy_protocol_v2` flag is already wired for NLB TCP targets (line 167).

### ACM Certificates for NLB

| Certificate | Region | Purpose | How Created |
|-------------|--------|---------|-------------|
| `mqtt.defcon.run` | us-east-1 | NLB TLS listeners (8883, 443, 8443) | Existing `certs` module -- add `"mqtt"` to `dns.subdomains` |
| `mqtt.defcon.run` | ca-central-1 | NLB TLS listeners (8883, 443, 8443) | Existing `certs` module -- add `"mqtt"` to `dns.subdomains` |

**Key constraint:** NLB requires ACM certificates in the same region as the NLB. This is already how the `certs` module works -- `subdomain_certs` are created per-region via the `aws.application` provider. The same ACM cert ARN is reused across all three TLS listeners on the same NLB.

**No us-east-1 global cert needed** because there is no CloudFront distribution for mqtt.defcon.run.

**Confidence:** HIGH -- verified against existing `certs/v1.0.0/acm.tf` which creates per-subdomain certs with wildcard SANs.

### Proxy Protocol v2

**Use it on MQTT ports where meshtk needs source IP; skip it on meshmap port 443.**

| Port | Proxy Protocol v2 | Why |
|------|--------------------|-----|
| 1883 | YES | Meshtk needs source IP for rate limiting and ACL enforcement |
| 8883 | YES | Same reason -- meshtk inspects packets after NLB TLS termination |
| 443 | NO | Nginx does not need source IP for meshmap (static content serving) |
| 8443 | YES | Meshtk rate-limits WebSocket MQTT connections by source IP |

**Critical caveat:** Mosquitto does NOT natively parse PROXY protocol v2 headers. If proxy_protocol_v2 is enabled on a target group pointing directly to mosquitto, it will see PROXY header bytes as invalid MQTT data and disconnect clients.

**Solution (from defcon.run.33 architecture):** Route ports 1883/8883/8443 through meshtk first. Meshtk parses the PROXY protocol header, extracts the source IP for rate limiting, then forwards clean MQTT to mosquitto via localhost. The ECS task definition connects containers via `localhost` within the same network namespace.

**Implementation note:** The existing `ecs-service` module auto-enables `proxy_protocol_v2 = true` when `type == "nlb" && target_group_protocol == "TCP"` (line 167). For the port 443 nginx target group, set `target_group_protocol = "HTTP"` or handle it explicitly to avoid proxy protocol on that path.

### ECS Task Definition (4-container task)

| Container | CPU | Memory | Essential | Ports | Notes |
|-----------|-----|--------|-----------|-------|-------|
| mqtt-mosquitto | 256 | 512MB | Yes | 1883, 9001 | Broker with auth, ACL, persistence. Listens localhost only (meshtk fronts it). |
| mqtt-meshtk | 256 | 512MB | Yes | 1883 (external), 8883, 8443 | gRPC proxy, rate limiter, S3 logger. Receives NLB traffic, forwards to mosquitto. |
| mqtt-nginx | 128 | 256MB | Yes | 80 | Meshmap static files + meshobserv WebSocket reverse proxy |
| mqtt-ghosts | 128 | 256MB | No | None | Fleet simulator. Non-essential -- task continues if ghosts crashes. |

**Total task resources:** 768 CPU units / 1536MB memory. Fits the Fargate 1 vCPU / 2GB tier (1024 CPU / 2048 MB).

**Confidence:** HIGH -- follows exact pattern of existing 2-container tasks (nginx + app) in service.hcl files.

### Infrastructure (Terraform modules -- existing, reused)

| Component | Module | Action | Notes |
|-----------|--------|--------|-------|
| NLB | `network/v1.0.0` | Set `nlb.enabled = true` in both region network.hcl files | NLB resource already defined but currently disabled |
| NLB security group | `network/v1.0.0` | No changes needed | Ports 1883, 8883, 9001, 8443, 443 already configured in `aws_security_group.nlb` |
| ECR repos | `ecr/v1.0.0` | Add 3 repos to ecr.hcl: mqtt-mosquitto, mqtt-nginx, mqtt-meshtk | Same pattern as run-auth-nginx, run-auth-app |
| ACM certs | `certs/v1.0.0` | Add "mqtt" to `dns.subdomains` list | Creates `mqtt.defcon.run` cert in each region |
| ECS task | `ecs-task/v1.0.0` | Add mqtt task definition in new `services/mqtt/service.hcl` | 4-container task definition |
| ECS service | `ecs-service/v1.0.0` | Add mqtt service with 4 NLB `load_balancers` entries | Existing NLB listener creation code handles this |
| Route53 | New resources needed | A alias records for `mqtt.defcon.run` -> NLB per region | Latency-based routing. Not in cloudfront module -- need new Route53 records. |
| S3 logging | New bucket or reuse pattern | meshtk packet logs | Same pattern as NLB access logs bucket |
| SSM params | `secrets/v1.0.0` | MQTT credentials, PSK, mosquitto passwd file | Same SSM parameter pattern as auth secrets |

### New Terraform Resources Required

The existing modules cover 90% of needs. New resources needed:

1. **Route53 A alias records for mqtt.defcon.run** -- Currently, Route53 records are only created in the `cloudfront/v1.0.0/route53.tf` module (pointing to CloudFront distributions). For mqtt.defcon.run, records must point to NLB instead. Options:
   - Add NLB alias record support to the `network` module (cleanest)
   - Create in the `cloudfront` module with a conditional (hacky)
   - New standalone `dns` module for non-CloudFront records

2. **S3 bucket for meshtk packet logs** -- One bucket per region for meshtk to write packet inspection logs. Follow the existing `nlb_logs` bucket pattern in `network/v1.0.0/nlb.tf`.

### Supporting Configuration

| Config | Format | Where Stored | Notes |
|--------|--------|--------------|-------|
| mosquitto.conf | INI-style | Baked into Docker image | Listener ports, auth plugin, ACL, persistence |
| mosquitto passwd | hashed file | SSM Parameter -> container env -> file | Generated with `mosquitto_passwd` at build time |
| mosquitto ACL | text file | Baked into Docker image or SSM | Topic-level access control |
| meshtk config | YAML/env vars | ECS task env vars + SSM secrets | S3 bucket, rate limits, MQTT upstream |
| nginx.conf | nginx conf | Baked into Docker image | Meshmap static serving, meshobserv proxy_pass |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| MQTT Broker | Eclipse Mosquitto 2.0.22 | EMQX, HiveMQ, VerneMQ | Mosquitto proven from defcon.run.33. Single-node sufficient for event scale (~500 devices). Dramatically simpler deployment. |
| Meshmap server | nginx 1.28-alpine | Caddy, Traefik | nginx matches existing pattern (all other apps use nginx sidecar). Team knows it. |
| NLB TLS termination | ACM on NLB | Self-signed certs in container | ACM auto-renews, no cert management in containers, existing module supports it |
| DNS strategy | NLB-only (no CloudFront) | CloudFront + split subdomains | Simpler DNS, one fewer CloudFront distribution, meshmap doesn't need edge caching |
| Multi-region MQTT | Independent brokers per region | MQTT bridge between regions | Bridging adds complexity. Radios connect to nearest region via latency-based DNS routing. No cross-region message sync needed for this use case. |
| Container orchestration | ECS Fargate (existing) | EKS, EC2 | Fargate matches all other services. No new infrastructure patterns to learn. |
| Go version | 1.24 | 1.23, 1.22 | 1.24 is current stable. meshtk compiles fine on it. |

## What NOT to Add

| Technology | Why Not |
|------------|---------|
| **CloudFront distribution for mqtt.defcon.run** | NLB handles all ports directly. CloudFront cannot proxy raw TCP MQTT. Creates unsolvable DNS conflict. |
| **Application Load Balancer for MQTT** | MQTT is raw TCP on ports 1883/8883, not HTTP. ALB only handles HTTP/HTTPS. |
| **AWS IoT Core** | Overkill for a 4-day event with ~500 Meshtastic devices. Mosquitto is simpler, cheaper, and proven. |
| **VPC peering / PrivateLink** | Devices connect from the public internet, not from within AWS. NLB is public-facing. |
| **Global Accelerator** | Adds $18/month + data charges with minimal benefit over Route53 latency-based routing for two regions. |
| **Separate ECS tasks per container** | All 4 containers MUST communicate over localhost (meshtk proxies to mosquitto). Single task = shared network namespace. Separate tasks = separate IPs = broken architecture. |
| **mosquitto-go-auth plugin** | Static passwd file and ACL are sufficient for ~500 devices. Dynamic auth adds deployment complexity for no benefit. |
| **EFS or EBS for mosquitto persistence** | Mosquitto persistent messages can use the ephemeral Fargate storage (20GB default). Messages are transient mesh data, not long-term state. |

## Integration Points with Existing Stack

| Integration | Mechanism | Status |
|-------------|-----------|--------|
| MQTT credentials from run.flash | run.flash calls run.human internal API to get MQTT username/password, provisions to device | Already implemented in v1.0 |
| SSM parameters | Same `/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/mqtt/*` pattern | New params needed |
| ECR push/deploy | Same `build.sh` / `deploy.sh` / `release-all.sh` scripts | Add mqtt service to release pipeline |
| NLB ARN passthrough | `network` module outputs `nlb_arn` -> `ecs-service` module input `nlb_arn` | Already wired in module variables |
| NLB security group | `network` module outputs `security_groups.nlb` | Already exists with correct port rules |
| CloudWatch Logs | Same log group pattern as other services | `/ecs/mqtt-{container}-{region}` |
| Meshtk checkout | Gitignored at `apps/mqtt/grpc/site-tld/meshtk/` | Manual copy from `~/working/meshtk` |

## Build & Deploy

```bash
# No npm packages -- this milestone is infrastructure + Docker images only

# ECR repos created by Terraform after adding to ecr.hcl

# Build mosquitto image
cd apps/mqtt/mosquitto && docker build -t mqtt-mosquitto .

# Build nginx/meshmap image (meshobserv bundled)
cd apps/mqtt/nginx && docker build -t mqtt-nginx .

# Build meshtk image (requires meshtk Go source checkout)
cp -r ~/working/meshtk apps/mqtt/grpc/site-tld/meshtk/
cd apps/mqtt/grpc && docker build -t mqtt-meshtk .

# Deploy uses existing patterns
./apps/build.sh mqtt-mosquitto
./apps/build.sh mqtt-nginx
./apps/build.sh mqtt-meshtk
./apps/deploy.sh mqtt
```

## Sources

- [Eclipse Mosquitto Docker Hub](https://hub.docker.com/_/eclipse-mosquitto) -- v2.0.22-alpine confirmed (HIGH confidence)
- [nginx Docker Hub](https://hub.docker.com/_/nginx) -- v1.28.2-alpine stable branch (HIGH confidence)
- [AWS NLB TLS Listeners Documentation](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/create-tls-listener.html) -- ACM cert requirement, TLS termination (HIGH confidence)
- [AWS CloudFront HTTPS Requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html) -- us-east-1 cert, HTTP-only proxying (HIGH confidence)
- [AWS Route53 Alias Records](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-values-alias.html) -- single-target constraint per record name+type (HIGH confidence)
- [AWS Route53 Latency-Based Routing](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-weighted.html) -- multi-region DNS pattern (HIGH confidence)
- Existing codebase `infra/terraform/modules/network/v1.0.0/nlb.tf` -- NLB already defined with SG (HIGH confidence)
- Existing codebase `infra/terraform/modules/ecs-service/v1.0.0/main.tf` -- NLB listener + proxy_protocol_v2 support (HIGH confidence)
- Existing codebase `infra/terraform/modules/certs/v1.0.0/acm.tf` -- per-subdomain per-region ACM certs (HIGH confidence)
- Existing codebase `infra/terraform/modules/network/v1.0.0/securitygroups.tf` -- NLB SG with MQTT ports (HIGH confidence)
- [Mosquitto Docker Configuration Guide](https://cedalo.com/blog/mosquitto-docker-configuration-ultimate-guide/) -- config/data/log paths (MEDIUM confidence)
- [AWS ECS Mosquitto Deployment](https://www.atom8.ai/blog/how-to-deploy-mqtt-broker-using-eclipse-mosquitto-on-amazon-ecs) -- ECS-specific patterns (MEDIUM confidence)
