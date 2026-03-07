# Architecture Patterns

**Domain:** MQTT broker (mosquitto), meshtk proxy, meshmap, fleet simulator integration into defcon.run.34 multi-region ECS infrastructure
**Researched:** 2026-03-06

## Critical Decision: DNS Routing for mqtt.defcon.run

### The Problem

`mqtt.defcon.run` must serve two fundamentally different protocol types:

1. **MQTT protocol traffic** on ports 1883 (TCP), 8883 (TLS), 8443 (TLS/WSS) -- raw TCP, not HTTP
2. **Meshmap web UI** on port 443 -- standard HTTPS, would benefit from CloudFront caching

A Route53 A record resolves to IP address(es). The client decides which port to connect to. A single A/ALIAS record can only point to ONE target (CloudFront OR NLB, not both).

### Options Evaluated

| Option | How It Works | Verdict |
|--------|-------------|---------|
| 1. mqtt.defcon.run -> NLB for everything | NLB handles 1883, 8883, 8443, and 443 | **RECOMMENDED** |
| 2. Split domains: mqtt.defcon.run -> NLB, meshmap.defcon.run -> CloudFront | Separate DNS for web UI | Viable but adds complexity |
| 3. mqtt.defcon.run -> CloudFront on 443, separate DNS for MQTT | Not possible -- same domain can't resolve to two targets | **IMPOSSIBLE** |
| 4. CloudFront with NLB as origin for MQTT ports | CloudFront only supports HTTP/HTTPS, not raw TCP | **IMPOSSIBLE** |

### Recommendation: Option 1 -- NLB for Everything

**Confidence: HIGH**

`mqtt.defcon.run` -> NLB (Route53 ALIAS record) with listeners on all four ports:

```
mqtt.defcon.run (Route53 A ALIAS -> NLB)
  |
  |-- Port 1883 (TCP)    -> NLB Listener -> Target Group -> mosquitto container :1883
  |-- Port 8883 (TLS)    -> NLB Listener -> Target Group -> mosquitto container :8883
  |-- Port 8443 (TLS)    -> NLB Listener -> Target Group -> nginx container :8443 (WSS)
  |-- Port 443  (TLS)    -> NLB Listener -> Target Group -> nginx container :443  (meshmap)
```

**Why this is correct:**

1. **CloudFront cannot proxy MQTT.** CloudFront only handles HTTP/HTTPS at the application layer. MQTT is a distinct protocol over TCP. This eliminates Options 3 and 4 entirely. (Source: [CloudFront supported protocols](https://repost.aws/knowledge-center/cloudfront-supported-protocols), [CloudFront MQTT support](https://support.skax.co.kr/en/support/solutions/articles/42000098157--cloudfront-mqtt-protocol-support))

2. **NLB handles all four ports natively.** NLB operates at Layer 4 (TCP/TLS), which is exactly what MQTT needs. It can also terminate TLS for port 443 and forward to the meshmap nginx container. (Source: [NLB MQTT support](https://repost.aws/questions/QU1jC47iEFRYiQQLIFkwcZHg/does-nlb-support-mqtt))

3. **Meshmap does not need CloudFront.** The meshmap web UI is a lightweight nginx-served page with WebSocket connections to the MQTT broker. It is not a content-heavy site that benefits from CDN edge caching. The live data comes via WebSocket, which cannot be cached anyway.

4. **One domain, one DNS record, four listeners.** This is the simplest architecture. No split-brain DNS, no extra ACM certs, no additional CloudFront distributions.

5. **Existing NLB infrastructure is ready.** The network module already defines `aws_lb.nlb_public` with conditional creation (`var.nlb.enabled`), security groups for MQTT ports (1883, 8883, 8443, 443), and S3 access logging. The ecs-service module already supports `type = "nlb"` load balancers with NLB listeners.

**What you give up:** CloudFront WAF protection and caching for the meshmap web UI. This is acceptable because:
- Meshmap is a visualization page, not a transaction-processing endpoint
- MQTT traffic cannot go through WAF anyway (not HTTP)
- NLB security group already restricts ingress to MQTT ports
- The NLB SG can be further restricted if needed

### Why NOT Option 2 (Split Domains)

Option 2 (meshmap.defcon.run for web UI) works technically but adds:
- Another subdomain to manage (DNS, ACM cert, CloudFront distribution, WAF WebACL)
- Another entry in `site.hcl` dns.subdomains
- Another CloudFront behavior set with regional path routing
- Cognitive overhead: "which domain do I use for what?"

The value of CloudFront for meshmap is near-zero (dynamic WebSocket content, small static footprint). The cost is real infrastructure complexity. Not worth it.

## Recommended Architecture

### System Diagram

```
                    Internet
                       |
              mqtt.defcon.run
              (Route53 ALIAS -> NLB)
                       |
            NLB (per region, public)
            |-- :1883  TCP  listener
            |-- :8883  TLS  listener (ACM cert)
            |-- :443   TLS  listener (ACM cert)
            |-- :8443  TLS  listener (ACM cert)
                       |
            ECS Fargate Task (4 containers)
            |-- mosquitto    (:1883, :8883)
            |-- meshtk-grpc  (:4403)
            |-- meshmap-nginx (:443, :8443)
            |-- ghosts       (no ports, optional)
```

### Component Boundaries

| Component | Container | Responsibility | Ports | Communicates With |
|-----------|-----------|---------------|-------|-------------------|
| **mosquitto** | run-mqtt-mosquitto | MQTT broker with auth plugin, ACL, persistence | 1883 (TCP), 8883 (TLS) | NLB listeners, meshtk-grpc (internal) |
| **meshtk-grpc** | run-mqtt-meshtk | Meshtastic packet proxy: inspects, rate-limits, logs to S3 | 4403 (internal gRPC) | mosquitto (MQTT client), S3 (packet logs) |
| **meshmap-nginx** | run-mqtt-nginx | Serves meshmap web UI + WebSocket proxy to mosquitto | 443 (HTTPS), 8443 (WSS) | NLB listeners, mosquitto (WebSocket proxy) |
| **ghosts** | run-mqtt-ghosts | Fleet simulator -- generates fake Meshtastic nodes for testing | None (outbound only) | mosquitto (MQTT publish) |

### Data Flow

```
Meshtastic Radio
  -> MQTT publish to mqtt.defcon.run:8883 (TLS)
  -> NLB TLS listener (terminates or passes through)
  -> mosquitto container :8883
  -> mosquitto publishes to internal topic
  -> meshtk-grpc subscribes, inspects packet, logs to S3
  -> mosquitto forwards to other subscribers

Web Browser (meshmap)
  -> https://mqtt.defcon.run/ (port 443)
  -> NLB TLS listener
  -> meshmap-nginx container :443 (serves static HTML/JS)
  -> Browser opens WSS to mqtt.defcon.run:8443
  -> NLB TLS listener
  -> meshmap-nginx :8443 (WebSocket proxy to mosquitto :9001)
  -> Live node positions displayed on map
```

### NLB Listener Configuration

| Port | Protocol | TLS Termination | Target | Health Check |
|------|----------|----------------|--------|--------------|
| 1883 | TCP | None (plaintext MQTT) | mosquitto:1883 | TCP connect |
| 8883 | TLS | NLB terminates, forwards TCP to container | mosquitto:1883 | TCP connect |
| 443 | TLS | NLB terminates, forwards TCP to container | nginx:80 or nginx:443 | TCP connect or HTTP /health |
| 8443 | TLS | NLB terminates, forwards TCP to container | nginx:8443 or nginx:9001 | TCP connect |

**TLS termination decision:** NLB can either terminate TLS (using ACM cert) or pass through to container-managed TLS. For this deployment:
- **Ports 8883, 443, 8443: NLB terminates TLS** using the `*.defcon.run` ACM certificate. This simplifies container configuration (no cert management inside containers) and matches the existing ALB pattern.
- **Port 1883: TCP passthrough.** Plaintext MQTT for internal/testing use. Can be restricted via security group to VPC-only if desired.

**ACM Certificate:** The existing `*.defcon.run` wildcard cert (already in ACM for CloudFront/ALB) covers `mqtt.defcon.run`. No new cert needed. The NLB TLS listeners reference this cert ARN via `certificate_arn` in the service.hcl listener config.

### DNS Configuration

New Route53 A record:
```hcl
# In a new module or added to existing cloudfront module's route53.tf
resource "aws_route53_record" "mqtt_nlb" {
  for_each = { for r in var.nlb_regions : r.label => r }

  zone_id = var.zone_map["mqtt.defcon.run"].zone_id
  name    = "mqtt.defcon.run"
  type    = "A"

  alias {
    name                   = var.nlb_dns_names[each.key]
    zone_id                = var.nlb_zone_ids[each.key]
    evaluate_target_health = true
  }

  # Latency-based routing for multi-region
  set_identifier = each.key
  latency_routing_policy {
    region = var.nlb_regions[each.key].full
  }
}
```

This uses **latency-based routing** so Meshtastic radios connect to the nearest regional NLB, matching the existing CloudFront multi-region pattern but at the DNS level.

### ECS Task Definition Pattern

The mqtt service uses a **4-container ECS task** -- the most containers of any service in this platform. This follows the existing multi-container pattern (run.auth has 2, run.cms has 2) but extends it.

```hcl
# In services/run.mqtt/service.hcl
task = {
  name         = "run-mqtt"
  regions      = ["us-east-1", "ca-central-1"]
  cluster_name = "app"
  task_cpu     = 1024
  task_memory  = 2048

  containers = [
    {
      name      = "run-mqtt-mosquitto"
      image     = "run-mqtt-mosquitto:${local.versions.mosquitto}"
      cpu       = 256
      memory    = 512
      essential = true

      port_mappings = [
        { container_port = 1883, host_port = 1883 },
        { container_port = 9001, host_port = 9001 }  # WebSocket for meshmap
      ]

      health_check = {
        command      = ["CMD-SHELL", "mosquitto_sub -t '$SYS/broker/uptime' -C 1 -W 5 || exit 1"]
        interval     = 30
        timeout      = 10
        retries      = 3
        start_period = 30
      }
    },
    {
      name      = "run-mqtt-meshtk"
      image     = "run-mqtt-meshtk:${local.versions.meshtk}"
      cpu       = 256
      memory    = 512
      essential = true

      port_mappings = [
        { container_port = 4403, host_port = 4403 }
      ]

      # meshtk connects to mosquitto via localhost
      environment = [
        { name = "MQTT_HOST", value = "localhost" },
        { name = "MQTT_PORT", value = "1883" }
      ]
    },
    {
      name      = "run-mqtt-nginx"
      image     = "run-mqtt-nginx:${local.versions.nginx}"
      cpu       = 256
      memory    = 512
      essential = true

      port_mappings = [
        { container_port = 443,  host_port = 443  },
        { container_port = 8443, host_port = 8443 }
      ]

      # nginx proxies WebSocket to mosquitto on localhost:9001
      environment = [
        { name = "MQTT_WS_UPSTREAM", value = "localhost:9001" }
      ]

      health_check = {
        command      = ["CMD-SHELL", "curl -f http://localhost:80/health || exit 1"]
        interval     = 30
        timeout      = 5
        retries      = 3
        start_period = 30
      }
    },
    {
      name      = "run-mqtt-ghosts"
      image     = "run-mqtt-ghosts:${local.versions.ghosts}"
      cpu       = 256
      memory    = 512
      essential = false  # Non-essential: task continues if ghosts crashes

      environment = [
        { name = "MQTT_HOST", value = "localhost" },
        { name = "MQTT_PORT", value = "1883" }
      ]
    }
  ]
}
```

**Key patterns from existing services applied here:**

1. **VERSION files per container**: `apps/mqtt/mosquitto/VERSION`, `apps/mqtt/nginx/VERSION`, `apps/mqtt/grpc/VERSION`, `apps/mqtt/ghosts/VERSION`
2. **ECR repos per container**: `run-mqtt-mosquitto`, `run-mqtt-meshtk`, `run-mqtt-nginx`, `run-mqtt-ghosts`
3. **Image naming**: `{site_label}-{image}` -> `dc34-run-mqtt-mosquitto:1.0.0`
4. **Inter-container communication**: Containers in the same ECS task share a network namespace. `localhost` works for mosquitto<->meshtk and mosquitto<->nginx.
5. **Essential flag**: ghosts is `essential = false` so the task stays running if the simulator crashes

### ECS Service Definition Pattern

```hcl
service = {
  name          = "run-mqtt"
  regions       = ["us-east-1", "ca-central-1"]
  cluster_name  = "app"
  task_family   = "run-mqtt"
  desired_count = 1

  # MQTT needs public IP for NLB target registration
  assign_public_ip = true

  service_discovery = {
    name           = "run-mqtt"
    container_name = "run-mqtt-mosquitto"
  }

  load_balancers = [
    # Port 1883 - Plaintext MQTT
    {
      type                  = "nlb"
      container_name        = "run-mqtt-mosquitto"
      container_port        = 1883
      target_group_protocol = "TCP"
      health_check_protocol = "TCP"
      health_check = {
        healthy_threshold   = 2
        unhealthy_threshold = 2
        timeout             = 10
        interval            = 30
      }
      listener = {
        port     = 1883
        protocol = "TCP"
      }
    },
    # Port 8883 - TLS MQTT (NLB terminates TLS)
    {
      type                  = "nlb"
      container_name        = "run-mqtt-mosquitto"
      container_port        = 1883
      target_group_port     = 1883
      target_group_protocol = "TCP"
      health_check_protocol = "TCP"
      health_check = {
        healthy_threshold   = 2
        unhealthy_threshold = 2
        timeout             = 10
        interval            = 30
      }
      listener = {
        port            = 8883
        protocol        = "TLS"
        ssl_policy      = "ELBSecurityPolicy-TLS13-1-0-2021-06"
        certificate_arn = "{{CERT_ARN}}"  # *.defcon.run ACM cert
      }
    },
    # Port 443 - Meshmap HTTPS (NLB terminates TLS)
    {
      type                  = "nlb"
      container_name        = "run-mqtt-nginx"
      container_port        = 443
      target_group_protocol = "TCP"
      health_check_protocol = "TCP"
      health_check = {
        healthy_threshold   = 2
        unhealthy_threshold = 2
        timeout             = 5
        interval            = 30
      }
      listener = {
        port            = 443
        protocol        = "TLS"
        ssl_policy      = "ELBSecurityPolicy-TLS13-1-0-2021-06"
        certificate_arn = "{{CERT_ARN}}"
      }
    },
    # Port 8443 - WebSocket MQTT (NLB terminates TLS)
    {
      type                  = "nlb"
      container_name        = "run-mqtt-nginx"
      container_port        = 8443
      target_group_protocol = "TCP"
      health_check_protocol = "TCP"
      health_check = {
        healthy_threshold   = 2
        unhealthy_threshold = 2
        timeout             = 5
        interval            = 30
      }
      listener = {
        port            = 8443
        protocol        = "TLS"
        ssl_policy      = "ELBSecurityPolicy-TLS13-1-0-2021-06"
        certificate_arn = "{{CERT_ARN}}"
      }
    }
  ]
}
```

**Note on `assign_public_ip`:** NLB targets must be reachable. Since tasks run in public subnets (matching existing pattern for ECS services), `assign_public_ip = true` ensures NLB can route to them. The existing ecs-service module already supports this via `service.assign_public_ip`.

### Security Group Updates

The existing `aws_security_group.nlb` in the network module already has the correct ingress rules:
- Port 1883 (MQTT) -- 0.0.0.0/0
- Port 8883 (TLS MQTT) -- 0.0.0.0/0
- Port 8443 (TLS WebSocket MQTT) -- 0.0.0.0/0
- Port 443 (HTTPS) -- 0.0.0.0/0
- Port 9001 (WebSocket MQTT) -- VPC only (self)
- Egress: all outbound

**No security group changes needed.** The NLB SG is already configured for MQTT use. However, the ECS tasks need the NLB security group added to their `security_group_ids`. Currently, ecs-service uses `var.security_group_ids` which defaults to `[sshhttps, http_only]`. The mqtt service needs `[sshhttps, http_only, nlb]`.

This can be handled by:
1. Adding a `security_group_ids` override to the service definition, or
2. Passing the NLB SG as an additional parameter to ecs-service for NLB-type services

The simplest approach: add the NLB SG ID to the `security_group_ids` variable when the mqtt service is deployed. This may require a small enhancement to how ecs-service receives security groups per service (currently it's a single list for all services).

### ECR Repository Configuration

```hcl
ecr_repositories = [
  {
    name                 = "run-mqtt-mosquitto"
    regions              = ["us-east-1", "ca-central-1"]
    image_tag_mutability = "IMMUTABLE"
    lifecycle_policy     = { max_image_count = 10, expire_days = 30 }
  },
  {
    name                 = "run-mqtt-meshtk"
    regions              = ["us-east-1", "ca-central-1"]
    image_tag_mutability = "IMMUTABLE"
    lifecycle_policy     = { max_image_count = 10, expire_days = 30 }
  },
  {
    name                 = "run-mqtt-nginx"
    regions              = ["us-east-1", "ca-central-1"]
    image_tag_mutability = "IMMUTABLE"
    lifecycle_policy     = { max_image_count = 10, expire_days = 30 }
  },
  {
    name                 = "run-mqtt-ghosts"
    regions              = ["us-east-1", "ca-central-1"]
    image_tag_mutability = "IMMUTABLE"
    lifecycle_policy     = { max_image_count = 10, expire_days = 30 }
  }
]
```

Note: Only 2 regions (not 3) since `ap-southeast-1` is in `skip_regions`.

### Build/Deploy Pipeline Adaptation

The existing `build.sh` and `deploy.sh` need adaptation for mqtt's different structure:

**Current pattern:**
- `build.sh nginx run.auth` -> builds `apps/run.auth/nginx/` -> pushes to `dc34-run-auth-nginx`
- `build.sh webapp run.auth` -> builds `apps/run.auth/webapp/` -> pushes to `dc34-run-auth-app`

**MQTT needs:**
- `build.sh mosquitto run.mqtt` -> builds `apps/mqtt/mosquitto/` -> pushes to `dc34-run-mqtt-mosquitto`
- `build.sh meshtk run.mqtt` -> builds `apps/mqtt/grpc/` -> pushes to `dc34-run-mqtt-meshtk`
- `build.sh nginx run.mqtt` -> builds `apps/mqtt/nginx/` -> pushes to `dc34-run-mqtt-nginx`
- `build.sh ghosts run.mqtt` -> builds `apps/mqtt/ghosts/` -> pushes to `dc34-run-mqtt-ghosts`

**Changes required to build.sh:**
1. Add `run.mqtt` to the valid apps list
2. Add new component types: `mosquitto`, `meshtk`, `ghosts`
3. Skip S3 static asset sync (mqtt has no Next.js static assets)
4. Map components to Dockerfile paths within `apps/mqtt/`

**Changes required to deploy.sh:**
1. Add `run.mqtt` to valid apps list
2. Handle 4 VERSION files instead of 2 (mosquitto, meshtk, nginx, ghosts)
3. Copy all VERSION files to `infra/terraform/live/site/services/run.mqtt/`

**Changes required to release-all.sh:**
1. Add `run.mqtt` to default APPS list
2. Handle mqtt's 4-component build (vs 2-component for other apps)

### Infrastructure Changes Summary

| What | Change Type | Module/File |
|------|------------|-------------|
| Enable NLB | Modify | `network.hcl` in both regions: `nlb.enabled = true` |
| Add mqtt subdomain | Modify | `site.hcl`: add `"mqtt"` to `dns.subdomains` |
| Add mqtt service config | New | `services/run.mqtt/service.hcl` |
| Add mqtt Route53 records | New or Modify | Route53 A ALIAS to NLB (latency-based) |
| Add ACM cert for mqtt | Verify | `*.defcon.run` wildcard already covers `mqtt.defcon.run` |
| Register mqtt service | Modify | `site.hcl`: add `mqtt = read_terragrunt_config(...)` |
| NLB SG for mqtt tasks | Modify | ecs-service module or service config |
| ECR repos | Defined in service.hcl | Standard pattern |
| VERSION files | New | 4 files in `apps/mqtt/` subdirectories |
| Build scripts | Modify | `build.sh`, `deploy.sh`, `release-all.sh` |

## Patterns to Follow

### Pattern 1: Multi-Container ECS Task with Shared Network
**What:** All containers in an ECS Fargate task share a network namespace (localhost)
**When:** Services that need low-latency inter-process communication
**Why it fits mqtt:** mosquitto, meshtk, nginx, and ghosts all need to communicate. Containers within the same task can reach each other on localhost, avoiding network hops.

### Pattern 2: NLB TLS Termination with ACM
**What:** NLB listener handles TLS using an ACM certificate, forwards unencrypted TCP to containers
**When:** Services need TLS on non-HTTP protocols
**Why it fits mqtt:** Meshtastic radios connect via TLS MQTT. NLB terminates TLS so mosquitto receives plaintext TCP, simplifying container config.

### Pattern 3: Essential vs Non-Essential Containers
**What:** ECS `essential = false` allows a container to crash without killing the task
**When:** Optional sidecar containers (logging, simulation, monitoring)
**Why it fits mqtt:** The ghosts simulator is non-essential. If it crashes, MQTT broker and meshmap continue running.

### Pattern 4: Service.hcl with VERSION Files
**What:** Each container has a VERSION file; service.hcl reads them to construct image tags
**When:** All ECS services in this platform
**Why it fits mqtt:** 4 VERSION files (one per container) follow the same pattern as run.auth (2 VERSION files) and run.cms (2 VERSION files).

## Anti-Patterns to Avoid

### Anti-Pattern 1: CloudFront for Non-HTTP Traffic
**What:** Attempting to route MQTT through CloudFront
**Why bad:** CloudFront only understands HTTP/HTTPS. MQTT packets would be rejected or corrupted.
**Instead:** Use NLB for all MQTT traffic. Accept that meshmap loses CDN caching (it doesn't need it).

### Anti-Pattern 2: Separate ECS Tasks per Container
**What:** Running mosquitto, meshtk, nginx as separate ECS services
**Why bad:** Adds service discovery overhead, network latency, and complexity. These containers are tightly coupled -- they must communicate at sub-millisecond latency.
**Instead:** Single ECS task with 4 containers sharing localhost.

### Anti-Pattern 3: Container-Managed TLS Certificates
**What:** Baking TLS certs into Docker images or mounting them as volumes
**Why bad:** Certificate rotation becomes a manual process. ACM auto-renews. Volume mounts in Fargate are limited.
**Instead:** NLB terminates TLS using ACM certificates. Containers handle plaintext only.

### Anti-Pattern 4: Skipping NLB Security Groups
**What:** Using only the default ALB security groups for mqtt ECS tasks
**Why bad:** The ALB SG restricts port 443 to CloudFront prefix list only. NLB traffic comes from different source IPs.
**Instead:** Ensure mqtt ECS tasks have the NLB security group attached.

## Scalability Considerations

| Concern | At 100 radios | At 1K radios | At 10K radios |
|---------|---------------|--------------|---------------|
| MQTT connections | Single mosquitto handles easily | Still fine (mosquitto handles 100K+ connections) | May need mosquitto clustering or bridge |
| Packet throughput | meshtk processes inline | meshtk may lag | meshtk needs async processing or multiple instances |
| NLB | Transparent | Transparent | Transparent (NLB scales automatically) |
| Task sizing | 1024 CPU / 2048 MB sufficient | Monitor memory | May need 2048 CPU / 4096 MB |
| Multi-region | Latency routing works | Works | May need MQTT bridge between regions |

**For DEF CON 34 (event scale: ~500-2000 radios):** Single task per region with 1024 CPU / 2048 MB is more than sufficient. No clustering needed.

## Build Order (Dependency Chain)

```
1. Enable NLB (network.hcl)        -- prerequisite for all NLB listeners
2. ACM cert verification           -- verify *.defcon.run covers mqtt.defcon.run
3. ECR repos (service.hcl)         -- prerequisite for image push
4. Container images (build.sh)     -- 4 Docker images
5. Service.hcl (task + service)    -- task definition + service definition
6. Route53 DNS record              -- point mqtt.defcon.run at NLB
7. Deploy (terragrunt apply)       -- registers tasks, creates listeners, starts containers
```

## Sources

- [CloudFront supported protocols](https://repost.aws/knowledge-center/cloudfront-supported-protocols) -- confirms HTTP/HTTPS only
- [CloudFront MQTT protocol support](https://support.skax.co.kr/en/support/solutions/articles/42000098157--cloudfront-mqtt-protocol-support) -- confirms MQTT not supported
- [NLB MQTT support](https://repost.aws/questions/QU1jC47iEFRYiQQLIFkwcZHg/does-nlb-support-mqtt) -- confirms NLB handles MQTT over TCP
- Existing codebase: `infra/terraform/modules/network/v1.0.0/nlb.tf`, `securitygroups.tf`, `ecs-service/v1.0.0/main.tf`
- Existing codebase: `infra/terraform/live/site/services/run.auth/service.hcl` (reference service.hcl pattern)
