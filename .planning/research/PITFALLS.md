# Pitfalls Research

**Domain:** MQTT/meshtk infrastructure integration into existing ECS Fargate platform
**Researched:** 2026-03-06
**Confidence:** HIGH (based on existing codebase analysis + AWS documentation + community experience)

## Critical Pitfalls

### Pitfall 1: Proxy Protocol v2 Auto-Enabled by ecs-service Module Breaks Mosquitto

**What goes wrong:**
The existing `ecs-service` module (main.tf line 167) unconditionally enables Proxy Protocol v2 for all NLB TCP target groups:
```hcl
proxy_protocol_v2 = each.value.type == "nlb" && each.value.target_group_protocol == "TCP" ? true : false
```
When the NLB TLS listener terminates TLS and forwards plaintext TCP to mosquitto on port 1883, the target group prepends a Proxy Protocol v2 binary header to every connection. Mosquitto does not understand Proxy Protocol v2 -- it interprets the header bytes as a malformed MQTT CONNECT packet and immediately disconnects the client. NLB health checks also fail because the TCP health check response includes the proxy protocol header that mosquitto does not acknowledge properly.

**Why it happens:**
This logic is invisible in the service.hcl configuration. The developer defines `target_group_protocol = "TCP"` and `type = "nlb"` (both correct), and the module silently injects Proxy Protocol v2. When porting configs from defcon.run.33, the old project's ecs-service module likely did not have this auto-enable behavior, so the service.hcl worked there but silently breaks here.

**How to avoid:**
1. Add a `proxy_protocol_v2` boolean field to the `load_balancers` object in the ecs-service variable definition (variables.tf line 47-77), defaulting to `false`.
2. Replace the auto-enable logic in main.tf line 167 with `proxy_protocol_v2 = each.value.proxy_protocol_v2`.
3. For the mqtt service, explicitly set `proxy_protocol_v2 = false` on all load_balancer entries.
4. If client IP visibility is ever needed, it requires an nginx TCP proxy in front of mosquitto that strips Proxy Protocol v2 headers -- mosquitto itself cannot parse them.

**Warning signs:**
- NLB target group shows all targets as "unhealthy" despite mosquitto process running
- Mosquitto logs show "Socket error on client <unknown>, disconnecting" immediately on connection
- MQTT clients connect successfully via `docker exec` directly to mosquitto but fail through NLB
- `tcpdump` on the task ENI shows 13+ extra bytes prepended to every TCP connection from NLB

**Phase to address:**
Phase 1 (Infrastructure/Terraform module fix) -- must patch ecs-service module before creating mqtt service definition.

---

### Pitfall 2: Security Groups Block NLB Traffic to ECS Tasks on MQTT Ports

**What goes wrong:**
The `security_group_ids` output from the network module (outputs.tf lines 69-75) only includes `sshhttps` and `http_only` security groups. These allow inbound on ports 443, 80, 8080, 3000, and 1337 -- none of the MQTT ports (1883, 8883, 9001, 8443). When the mqtt ECS service is created using the default `security_group_ids`, all NLB health checks fail and no MQTT traffic reaches mosquitto. The NLB security group (`nlb` in the security_groups map, securitygroups.tf line 182-259) exists and has the right ingress rules, but it is only applied to the NLB resource itself -- not to the ECS task ENIs.

**Why it happens:**
All existing services (auth, human, gpx, flash, cms) use ALB and only need port 443. The default security group list was designed for ALB-backed services. The mqtt service is the first NLB-backed service, and the network module was not designed to output a combined security group list for NLB targets.

**How to avoid:**
1. Create a dedicated security group for MQTT ECS tasks OR extend the existing `nlb` SG to be usable on ECS task ENIs.
2. The MQTT task SG must allow inbound on: 1883 (MQTT from NLB), 9001 (WebSocket MQTT from NLB), 8080 (health check from NLB), and any other target ports.
3. The mqtt service.hcl must pass both default SGs AND the MQTT SG via the `security_group_ids` parameter on the ecs-service module.
4. NLB with security groups enabled (nlb.tf line 8 uses `security_groups`) requires that the NLB SG allows outbound to the ECS task SG on target ports. Verify the egress rule on the NLB SG allows all outbound (it does -- securitygroups.tf line 245-251).
5. Add the MQTT SG to the network outputs for consumption by the ecs-service module.

**Warning signs:**
- NLB targets stuck in "unhealthy" state with no logs appearing in mosquitto CloudWatch logs
- VPC flow logs show REJECT entries on MQTT ports to ECS task ENI IPs
- `aws ecs describe-tasks` shows task is RUNNING but NLB shows "unused" targets

**Phase to address:**
Phase 1 (Infrastructure) -- security group wiring is prerequisite for any NLB-backed service.

---

### Pitfall 3: Multi-Container HEALTHY Dependency Chain Stalls Task in PROVISIONING

**What goes wrong:**
The mqtt task has 4 containers (mosquitto, nginx/meshmap, meshtk, ghosts). If dependencies are chained (mosquitto <- meshtk <- nginx), a slow or flapping health check on mosquitto prevents meshtk from starting, which prevents nginx from starting. The task sits in PROVISIONING for minutes, then ECS gives up and marks it STOPPED. With the deployment circuit breaker enabled (existing default: `enable = true`), this triggers a rollback loop where every new task attempt also fails.

**Why it happens:**
The HEALTHY condition requires the dependent container to pass its Docker health check. The health check is evaluated after `start_period` elapses, then must pass `healthy_threshold` consecutive checks at `interval` spacing. With default values (start_period=0, interval=30, retries=3), the first health check fires immediately at startup when mosquitto may still be loading its password file or ACL. The check fails, starts the retry counter, and the container oscillates between healthy and unhealthy. Meanwhile, dependent containers never start.

**How to avoid:**
1. Use a flat dependency topology, not a chain. All containers depend on mosquitto with HEALTHY; no other dependencies:
   - meshtk: `depends_on = [{ container_name = "mosquitto", condition = "HEALTHY" }]`
   - nginx/meshmap: `depends_on = []` (independent -- serves static files, does not need mosquitto)
   - ghosts: `depends_on = [{ container_name = "mosquitto", condition = "HEALTHY" }]`
2. Set generous `start_period` for mosquitto: 30 seconds minimum (password file loading, ACL parsing).
3. Use a fast, simple health check for mosquitto: `["CMD-SHELL", "mosquitto_sub -h localhost -p 1883 -t '$SYS/broker/uptime' -C 1 -W 3 || exit 1"]` -- subscribes to a system topic, times out after 3 seconds.
4. Mark ghosts as `essential = false` -- if the simulator crashes, the real services (mosquitto, meshtk, meshmap) should keep running.
5. Set `health_check_grace_period_seconds = 120` on the ECS service to give the NLB time to see healthy targets after the HEALTHY dependency chain resolves.

**Warning signs:**
- Task stuck in PROVISIONING for >2 minutes
- Only the mosquitto container shows logs; meshtk and nginx have zero log entries (they never started)
- "Essential container in task exited" error when ghosts crashes (if `essential = true`)
- Deployment circuit breaker rollback loop: new tasks keep failing, old task keeps running

**Phase to address:**
Phase 2 (Container configuration / task definition design).

---

### Pitfall 4: ACM Certificate Not Validated Before NLB TLS Listener Creation

**What goes wrong:**
Terraform creates an `aws_lb_listener` with protocol TLS and a `certificate_arn`. If the ACM certificate has not completed DNS validation, the API call fails with `CertificateNotFound`. The existing certs module creates certificates, but for a new subdomain (`mqtt.defcon.run`), the DNS validation CNAME may not yet be propagated. ACM certificate validation can take 1-60 minutes after the CNAME record is created.

**Why it happens:**
The ecs-service module creates NLB listeners (main.tf lines 216-240) with `certificate_arn` passed from service.hcl. There is no `depends_on` relationship between the listener and the certificate validation. The existing wildcard cert (`*.defcon.run`) should cover `mqtt.defcon.run`, but the cert must exist in BOTH regions. ACM certs are regional -- the us-east-1 cert cannot be used for a ca-central-1 NLB.

**How to avoid:**
1. Verify the existing wildcard cert (`*.defcon.run`) is already validated in BOTH us-east-1 and ca-central-1. If it is, no new cert is needed.
2. If a new cert is needed: run `terragrunt apply` on the certs module first, wait for validation (check ACM console shows "Issued"), then apply the network/ecs-service modules.
3. In the Terragrunt dependency graph, ensure certs module is a dependency of the ecs-service module with `mock_outputs` for initial plan.
4. The cert_map variable in the network module (variables.tf line 26-35) should already pass validated cert ARNs. Verify the mqtt NLB listeners reference the correct cert from this map.

**Warning signs:**
- Terraform error: `CertificateNotFound` or `UnsupportedCertificate` during NLB listener creation
- ACM console shows certificate in "Pending validation" state
- `terragrunt apply` succeeds in us-east-1 but fails in ca-central-1 (cert exists in one region but not the other)

**Phase to address:**
Phase 1 (Infrastructure) -- verify cert availability before NLB listener creation.

---

### Pitfall 5: Port Conflict in awsvpc Network Mode with 4 Containers

**What goes wrong:**
In Fargate's `awsvpc` mode, all containers in a task share the same network namespace (same IP, same port space). If two containers try to bind the same port -- for example, both nginx (meshmap) and meshtk listen on port 443, or both mosquitto and nginx use port 8080 for health checks -- one fails with "bind: address already in use" and the container exits. Since both are likely `essential = true`, the entire task stops.

**Why it happens:**
When porting from defcon.run.33, the original deployment may have used separate tasks per container (each with its own ENI) or EC2 launch type with host networking where port mapping is different. Consolidating into a single 4-container Fargate task requires all port bindings to be unique across all containers.

**How to avoid:**
1. Document and enforce the port allocation for the mqtt task:
   - mosquitto: 1883 (MQTT plain), 9001 (WebSocket MQTT)
   - nginx/meshmap: 443 (HTTPS for meshmap web UI), 8080 (health check HTTP)
   - meshtk: 4403 (gRPC) -- or whatever port meshtk uses; must not collide
   - ghosts: no listening ports (client-only, publishes to mosquitto)
2. NLB TLS termination on port 8883 forwards to mosquitto on port 1883. The container does NOT bind 8883.
3. NLB TLS termination on port 8443 (WSS) forwards to mosquitto on port 9001 (WS). The container does NOT bind 8443.
4. CloudFront for meshmap routes to nginx on port 443 via the ALB. MQTT traffic bypasses CloudFront entirely.
5. In the task definition, every `port_mappings` entry must have a unique `host_port` (which equals `container_port` in awsvpc mode).

**Warning signs:**
- One container fails to start with "bind: address already in use" in CloudWatch logs
- Task reaches RUNNING but one container keeps restarting (CrashLoopBackOff equivalent)
- Only 3 of 4 containers show healthy in ECS task detail

**Phase to address:**
Phase 2 (Container configuration / task definition design).

---

### Pitfall 6: NLB Health Checks Flood Mosquitto Logs with Connection Resets

**What goes wrong:**
NLB TCP health checks complete a TCP handshake (SYN -> SYN-ACK -> ACK) then immediately send RST. At 10-second intervals across 2 AZs, this generates 12 connection-reset events per minute. Mosquitto's default `connection_messages true` logs each as a new client connection and disconnection, creating massive log noise in CloudWatch that obscures real operational issues and increases CloudWatch costs.

**Why it happens:**
NLB cannot perform HTTP-style health checks against TCP target groups. It can only do TCP connect checks (or HTTP/HTTPS health checks if configured with an HTTP health check protocol). Mosquitto on port 1883 speaks MQTT, not HTTP. The default TCP health check is the only option for direct MQTT port health checking.

**How to avoid:**
1. Use the nginx/meshmap container's HTTP health endpoint (port 8080) as the health check target for ALL NLB target groups. Set `health_check_protocol = "HTTP"` and `health_check_path = "/health"` in the service.hcl load_balancer config, with the health check port set to 8080.
2. The ecs-service module already supports separate health check protocols (main.tf lines 139-165 with dynamic blocks for HTTP vs TCP).
3. In mosquitto.conf, set `connection_messages false` to suppress connection/disconnection log entries.
4. Set `log_type error` and `log_type warning` instead of `log_type all` to reduce log volume.
5. Increase health check interval to 30 seconds to reduce connection churn.

**Warning signs:**
- CloudWatch Logs for mosquitto dominated by connection/disconnection messages from NLB IPs
- Difficulty finding real client issues in log noise
- CloudWatch Logs costs unexpectedly high for the mqtt service

**Phase to address:**
Phase 1 (Infrastructure for target group health check config) + Phase 2 (mosquitto.conf tuning).

---

### Pitfall 7: DNS Split Between CloudFront and NLB Not Configured Correctly

**What goes wrong:**
`mqtt.defcon.run` needs to serve two distinct traffic types: HTTP/HTTPS for meshmap web UI (via CloudFront + ALB) and raw TCP for MQTT protocols (via NLB direct). If DNS points `mqtt.defcon.run` to CloudFront, MQTT clients (Meshtastic radios) trying to connect on port 8883 hit CloudFront, which does not proxy TCP/MQTT. If DNS points to the NLB, meshmap web UI loses CloudFront caching and WAF protection.

**Why it happens:**
All existing services (auth, human, gpx, flash, cms) use a simple pattern: DNS -> CloudFront -> ALB -> ECS. The mqtt service is the first to need split routing where some ports go through CloudFront and others bypass it entirely.

**How to avoid:**
1. Use a single DNS record (`mqtt.defcon.run`) pointing to CloudFront for web traffic (port 443).
2. Use NLB DNS names directly for MQTT traffic. Meshtastic radios are configured at flash time with the NLB endpoint, not the CloudFront domain. The flash service can inject the regional NLB DNS name (e.g., `nlb-use1-defcon-run.elb.us-east-1.amazonaws.com`) as the MQTT server address.
3. Alternatively, create a separate DNS record for MQTT (e.g., `broker.defcon.run` or `mqtt-use1.defcon.run`) pointing directly to the regional NLB. This is cleaner than using raw NLB DNS names.
4. CloudFront distribution for `mqtt.defcon.run` handles ONLY the meshmap web UI paths (`/{region}/meshmap/*`). MQTT ports are not routed through CloudFront.
5. Ensure WAF rules on CloudFront do not interfere with meshmap WebSocket connections if meshmap uses WebSockets for live updates.

**Warning signs:**
- MQTT clients get connection refused or TLS handshake failures when connecting to `mqtt.defcon.run:8883`
- meshmap loads but MQTT connections from JavaScript WebSocket client fail (if using same domain)
- `dig mqtt.defcon.run` returns CloudFront IPs instead of NLB IPs

**Phase to address:**
Phase 1 (Infrastructure) -- DNS and CloudFront configuration.

---

### Pitfall 8: Go Binary Cross-Compilation for meshtk Produces Wrong Architecture

**What goes wrong:**
The meshtk binary is compiled on macOS (darwin/arm64 for Apple Silicon or darwin/amd64) but needs to run in a Fargate container (linux/amd64). If `GOOS` and `GOARCH` are not explicitly set during `go build`, the binary is compiled for the build machine's architecture. The Docker image builds successfully (the binary is just a file being copied), but the container crashes at startup with "exec format error" or "no such file or directory" (the latter when the binary is dynamically linked against missing libc).

**Why it happens:**
Go's `go build` defaults to the host OS and architecture. In a multi-stage Docker build, if the build stage uses `FROM golang:1.xx` (which runs under Docker's emulation or buildx cross-compilation), the architecture may or may not match the runtime stage. Without explicit `CGO_ENABLED=0 GOOS=linux GOARCH=amd64`, the binary may be dynamically linked or compiled for the wrong target.

**How to avoid:**
1. In the meshtk Dockerfile build stage, always set:
   ```dockerfile
   ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64
   RUN go build -o /meshtk .
   ```
2. If meshtk uses any CGO dependencies (C libraries, SQLite bindings), `CGO_ENABLED=0` will not work. In that case, use `golang:alpine` as the build base and install `musl-dev gcc` for static linking.
3. In the runtime stage, use `FROM alpine:3.x` (not `scratch`) if the binary needs CA certificates for TLS connections. Copy `/etc/ssl/certs/ca-certificates.crt` from the build stage if using `scratch`.
4. Verify the binary after build: `RUN file /meshtk` should show "ELF 64-bit LSB executable, x86-64, statically linked".
5. Test the Docker image locally with `docker run --platform linux/amd64` before pushing to ECR.

**Warning signs:**
- Container exits immediately with "exec format error" in CloudWatch logs
- Container exits with "no such file or directory" despite the binary existing in the image
- `docker run` works on macOS but fails in Fargate

**Phase to address:**
Phase 2 (Build scripts / Dockerfile creation).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Single mosquitto instance per region (no clustering) | Much simpler architecture, single task definition | No HA within a region; broker restart = brief MQTT outage | Always acceptable -- 4-day event, devices auto-reconnect |
| Flat-file password auth (password_file) | No external auth service dependency | Password rotation requires image rebuild and redeploy | Acceptable -- passwords are per-device, generated once at flash time |
| Disabling mosquitto persistence | Simpler Fargate deployment, no EFS needed | Retained messages and QoS 1/2 queues lost on restart | Acceptable -- Meshtastic radios republish state on reconnect |
| Gitignored meshtk source instead of submodule | No submodule pain, simple `cp -r` update | Manual sync required, version drift possible | Acceptable with discipline -- document the update process |
| Hardcoding MQTT port numbers in service.hcl | Fewer variables, clearer configuration | Must update multiple places if ports change | Always acceptable -- MQTT ports are industry standard |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| NLB TLS -> mosquitto | Expecting mosquitto to handle TLS termination (bind 8883 with certs) | NLB terminates TLS on 8883, forwards plaintext TCP to mosquitto on 1883. Mosquitto needs NO TLS configuration |
| NLB WSS -> mosquitto | Expecting mosquitto to handle WebSocket TLS | NLB terminates TLS on 8443, forwards to mosquitto WebSocket listener on 9001 (plain WS) |
| ecs-service module -> NLB | Assuming ALB-style host-header routing works | NLB does not support host-header routing. Each NLB listener is 1:1 with a target group. Use port-based routing only |
| meshtk -> mosquitto | Using DNS hostname for inter-container MQTT connection | In awsvpc mode, all containers share localhost. meshtk connects to `127.0.0.1:1883`, not a DNS name |
| CloudFront -> meshmap | Routing ALL mqtt.defcon.run traffic through CloudFront | Only route meshmap HTTP traffic. MQTT/WSS ports must bypass CloudFront entirely (NLB direct) |
| ACM certs -> NLB | Using us-east-1 ACM cert for ca-central-1 NLB | ACM certs are regional. Each NLB needs a cert in its own region. Unlike CloudFront (which requires us-east-1 only) |
| mosquitto ACL -> meshtk | Forgetting meshtk needs its own MQTT credentials | meshtk connects to mosquitto as a client. It needs a username/password in the password_file and topic permissions in the ACL file |
| build.sh -> ECR | Using existing build.sh pattern for 3 new images | The mqtt service has 3 separate Docker images (mosquitto, nginx/meshmap, meshtk). Each needs its own ECR repo, build step, and VERSION file |
| Security groups -> ECS task | Using default `security_group_ids` output | Default SGs only allow ALB ports (443, 80). MQTT task needs additional SG allowing 1883, 9001, 8080 |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Single-threaded mosquitto bottleneck | High CPU on one core, message latency spikes, subscriber backlog | Accept for event scale (~500 devices). Only consider EMQX if 5000+ concurrent connections needed | >2000 concurrent connections |
| CloudWatch log volume from verbose MQTT logging | High CloudWatch Logs costs, slow log search | Set `log_type error warning` in mosquitto.conf, disable `connection_messages` | 100+ devices publishing at 30-second intervals |
| NLB cross-AZ data transfer charges | Unexpected AWS bill line items for inter-AZ transfer | Minor at event scale. Enable cross-zone load balancing but accept the cost (pennies) | Never a real problem at this scale |
| Large password file slows mosquitto startup | Container health check fails before password file loaded, dependency chain stalls | Keep password file under 1000 entries. Set `start_period = 30` on health check | >5000 password entries |
| WebSocket connection limits on meshmap | Browser tab crashes or meshmap freezes with many nodes | Limit meshmap to displaying 200 most-recent nodes. Paginate or cluster markers | >500 simultaneous nodes on map |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Exposing port 1883 (plaintext MQTT) publicly via NLB | MQTT credentials transmitted in cleartext; anyone can sniff traffic | Only expose 8883 (TLS) and 8443 (WSS/TLS) publicly. If 1883 is needed for internal testing, restrict NLB SG to VPC CIDR only. The existing NLB SG (securitygroups.tf line 205) allows 1883 from 0.0.0.0/0 -- restrict this |
| Baking MQTT passwords into Docker image layers | Passwords visible via `docker history` or ECR image pull | Generate password_file at container startup from SSM Parameter Store secrets injected as env vars. Use an entrypoint script that runs `mosquitto_passwd` to create the file at runtime |
| Using `allow_anonymous true` in mosquitto.conf | Any device can connect and publish/subscribe without authentication | Always `allow_anonymous false` with `password_file` and `acl_file` |
| Wildcard ACL (`topic readwrite #`) for device users | Compromised device can read/write ALL topics including admin channels | Per-device ACL scoped to Meshtastic topic patterns. Admin/meshtk user gets broader permissions |
| Storing meshtk source code in public ECR image | Proprietary code exposed if ECR is public | Use private ECR repos (already the pattern). Verify ECR repos have `image_tag_mutability = "IMMUTABLE"` to prevent tag overwriting |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Meshmap shows stale node positions after broker restart | Participants see phantom nodes that left hours ago | Clear retained messages on broker restart; meshmap should show "last seen" timestamp and age-color markers |
| Fleet simulator ghosts appear on production meshmap | Real participants confused by fake nodes mixed with real ones | Prefix ghost names clearly (e.g., "GHOST-") and add a filter toggle in meshmap. Or run ghosts only in a test environment |
| No visual MQTT connection status in meshmap | Users cannot tell if map is live or frozen | Add WebSocket connection status indicator (green/red dot) to meshmap header |
| MQTT broker restart drops all WebSocket connections | meshmap goes blank with no auto-reconnect | Implement WebSocket reconnect with exponential backoff in meshmap JavaScript client |

## "Looks Done But Isn't" Checklist

- [ ] **NLB listeners:** All listeners created (8883 TLS, 8443 TLS, 443 TLS) -- but verify target groups have healthy targets registered and proxy_protocol_v2 is disabled
- [ ] **Security groups:** NLB SG has MQTT ingress rules -- but verify ECS task SG also allows inbound from NLB on target ports (1883, 9001, 8080)
- [ ] **ACM certificates:** Cert exists in ACM -- but verify it is ISSUED (not Pending) in BOTH regions (us-east-1 and ca-central-1)
- [ ] **ECR repos:** Three repos created (mosquitto, meshmap, meshtk) -- but verify images are pushed with correct tags matching VERSION files
- [ ] **DNS records:** mqtt.defcon.run resolves -- but verify MQTT clients use NLB endpoint (not CloudFront) for ports 8883/8443
- [ ] **mosquitto.conf:** Config exists -- but verify `password_file` and `acl_file` paths are correct inside the container and files are populated at runtime
- [ ] **Inter-container networking:** meshtk connects to mosquitto on localhost:1883 -- but verify credentials are correct and ACL permits the meshtk user's topic patterns
- [ ] **Build scripts:** build.sh builds images -- but verify Go binary in meshtk image is `ELF 64-bit LSB, x86-64, statically linked`
- [ ] **CloudFront:** Distribution routes meshmap web traffic -- but verify it does NOT attempt to proxy MQTT TCP connections
- [ ] **Both regions:** Services deploy to us-east-1 -- but verify ca-central-1 has NLB enabled (`nlb.enabled = true`), certs validated, and services running
- [ ] **Container dependencies:** meshtk depends on mosquitto HEALTHY -- but verify mosquitto health check passes within `start_period` and does not flap
- [ ] **Ghosts container:** Runs and publishes fake data -- but verify it is `essential = false` so crashes do not kill the whole task

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Proxy Protocol v2 enabled | LOW | Patch ecs-service module variable, `terragrunt apply` to update target group, no service restart needed |
| Wrong security groups | LOW | Update SG rules via Terraform, changes take effect immediately, no service restart |
| ACM cert not validated | MEDIUM | Wait for DNS propagation (up to 60 min), re-run `terragrunt apply`. Cannot be forced faster |
| Container dependency stall | MEDIUM | Update task definition with correct health check timing, force new deployment |
| Port conflict in task | MEDIUM | Update task definition port mappings, force new deployment. Must identify which containers collide |
| DNS misconfiguration | LOW | Update Route53 records via Terraform. DNS propagation takes 60-300 seconds |
| Go binary wrong arch | LOW | Rebuild with correct GOOS/GOARCH, push new image to ECR, force new deployment |
| mosquitto.conf errors | MEDIUM | Fix config, rebuild image, push, redeploy. All MQTT sessions lost during restart |
| S3 bucket name collision | LOW | Change naming variables in Terraform, re-run apply. Old bucket is unaffected |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Proxy Protocol v2 auto-enable (#1) | Phase 1: Terraform module fix | `terraform plan` shows `proxy_protocol_v2 = false` for MQTT target groups |
| Security group mismatch (#2) | Phase 1: Infrastructure | NLB targets show "healthy" in AWS console after deployment |
| Container dependency stalls (#3) | Phase 2: Task definition | Task reaches RUNNING within 90 seconds in test deployment |
| ACM cert timing (#4) | Phase 1: Infrastructure | ACM console shows ISSUED in both regions before NLB listener apply |
| Port conflicts (#5) | Phase 2: Container config | All 4 containers start and show logs within 60 seconds |
| Health check log noise (#6) | Phase 1 + Phase 2 | Health check uses HTTP on nginx:8080, mosquitto logs show no connection spam |
| DNS split (#7) | Phase 1: Infrastructure | MQTT client connects to NLB on 8883; browser loads meshmap via CloudFront on 443 |
| Go cross-compilation (#8) | Phase 2: Build scripts | `file` command on binary in image shows "statically linked, x86-64" |
| S3 bucket naming | Phase 1: Infrastructure | `aws s3api head-bucket` returns 404 for new bucket names before apply |
| mosquitto ACL for meshtk | Phase 2: Container config | meshtk successfully subscribes and publishes through mosquitto |

## Sources

- [AWS NLB Health Check Troubleshooting for Fargate](https://repost.aws/knowledge-center/fargate-nlb-health-checks)
- [NLB ECS Health Check Behavior](https://repost.aws/questions/QUkk0vZKI-SR2IBwl6atxWbQ/nlb-ecs-health-check)
- [AWS NLB MQTT Support](https://repost.aws/questions/QU1jC47iEFRYiQQLIFkwcZHg/does-nlb-support-mqtt)
- [ECS Container Dependency API Reference](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDependency.html)
- [ECS Task Definition Parameters (Fargate)](https://docs.amazonaws.cn/en_us/AmazonECS/latest/developerguide/task_definition_parameters.html)
- [ACM Certificate Eventual Consistency in Terraform](https://github.com/hashicorp/terraform-provider-aws/issues/4687)
- [ACM Certificate Validation Resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/acm_certificate_validation)
- [Terraform NLB Listener CertificateNotFound](https://discuss.hashicorp.com/t/adding-a-default-certificate-to-aws-network-load-balancer-error-certificate-not-found/6351)
- [Eclipse Mosquitto Docker Image](https://hub.docker.com/_/eclipse-mosquitto)
- [Mosquitto Configuration Reference](https://mosquitto.org/man/mosquitto-conf-5.html)
- [Deploying Mosquitto on AWS ECS](https://www.atom8.ai/blog/how-to-deploy-mqtt-broker-using-eclipse-mosquitto-on-amazon-ecs)
- [Go Static Binary for Docker Scratch](https://chemidy.medium.com/create-the-smallest-and-secured-golang-docker-image-based-on-scratch-4752223b7324)
- [NLB Proxy Protocol v2 with Ingress](https://github.com/kubernetes/ingress-nginx/issues/7905)
- Existing codebase: `infra/terraform/modules/ecs-service/v1.0.0/main.tf` line 167 (proxy_protocol_v2 auto-enable)
- Existing codebase: `infra/terraform/modules/network/v1.0.0/securitygroups.tf` lines 182-259 (NLB security group)
- Existing codebase: `infra/terraform/modules/network/v1.0.0/outputs.tf` lines 69-75 (security_group_ids excludes NLB SG)
- Existing codebase: `infra/terraform/modules/ecs-service/v1.0.0/variables.tf` lines 47-77 (load_balancer config)

---
*Pitfalls research for: MQTT/meshtk infrastructure integration into ECS Fargate platform*
*Researched: 2026-03-06*
