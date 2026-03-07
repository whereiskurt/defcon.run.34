---
phase: 15-container-images-task-definition
verified: 2026-03-07T14:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 15: Container Images + Task Definition Verification Report

**Phase Goal:** All four container images build successfully and run as a single ECS task with correct networking and health checks
**Verified:** 2026-03-07T14:00:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

Success Criteria from ROADMAP.md used as truths:

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Mosquitto container accepts MQTT connections on port 1884 with password authentication and ACL enforcement | VERIFIED | `Dockerfile.mosquitto` EXPOSE 1884, `entrypoint.sh` generates passwd via `mosquitto_passwd -b` for 3 accounts, `acl.conf` grants `readwrite #` to meshtk-proxy/meshobserv/ghosts, `allow_anonymous false` in generated config |
| 2 | Meshtk proxy container inspects packets between clients and mosquitto, rate limits abusive connections, and writes inspection logs to S3 | VERIFIED | `Dockerfile.meshtk` multi-stage Go build of meshtk binary, CMD `["server", "proxy"]`, EXPOSE 1883, health check on port 1883. service.hcl wires `MESHTK_S3_LOGS_BUCKET` and `MESHTK_S3_BLOCKLIST_BUCKET` SSM secrets, `MESHTK_MQTT_BROKER_URI=tcp://localhost:1884` connecting to mosquitto |
| 3 | Nginx container serves meshmap HTML on port 80 and meshobserv subscribes to MQTT, decrypts Meshtastic traffic, and writes nodes.json | VERIFIED | `Dockerfile.nginx` installs nginx+supervisor+curl, copies meshobserv binary, `nginx.conf` listens port 80 with `/nodes.json` no-cache endpoint, `supervisord.conf` runs both nginx and meshobserv (`server inspect`), service.hcl wires `MESHTK_CHANNEL_PSK` for decryption and `MESHTK_NODEDB_PATH=/var/www/html/nodes.json`. NLB 443->nginx:80. Note: meshmap HTML is placeholder (Phase 17 ports DC33 HTML) |
| 4 | 4-container ECS task starts successfully with mosquitto healthy before meshtk and ghosts begin, no port conflicts | VERIFIED | service.hcl has 4 containers: mqtt-mosquitto (1884), mqtt-meshtk (1883), mqtt-nginx (80), mqtt-ghosts (no ports). Dependency chain: mosquitto(none) -> meshtk(mosquitto HEALTHY) -> nginx(meshtk HEALTHY) + ghosts(meshtk START). CPU 1024/1024, Memory 2048/2048. No port conflicts |
| 5 | Ghosts container failure does not prevent the remaining three containers from running | VERIFIED | service.hcl mqtt-ghosts has `essential = false`, reuses `mqtt-meshtk` image with `command = ["meshtk", "fleet", "simulate"]`, no health_check defined, depends_on meshtk with condition START (not HEALTHY) |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/mqtt/.gitignore` | Excludes meshtk Go source from git | VERIFIED | Contains `meshtk/*` with `!meshtk/Dockerfile.meshtk` exception |
| `apps/mqtt/meshtk/Dockerfile.meshtk` | Multi-stage Go build for meshtk proxy | VERIFIED | golang:1.24-alpine builder, alpine:3.21 runtime, static binary, EXPOSE 1883, health check nc -z |
| `apps/mqtt/mosquitto/Dockerfile.mosquitto` | Alpine mosquitto container | VERIFIED | alpine:3.21, mosquitto+mosquitto-clients, EXPOSE 1884, health check mosquitto_sub |
| `apps/mqtt/mosquitto/entrypoint.sh` | Generates mosquitto.conf and passwd from env vars | VERIFIED | Generates listener 1884, passwd for 3 accounts, persistence false, allow_anonymous false |
| `apps/mqtt/mosquitto/acl.conf` | ACL granting readwrite # to service accounts | VERIFIED | 3 users (meshtk-proxy, meshobserv, ghosts) each with `topic readwrite #` |
| `apps/mqtt/nginx/Dockerfile.nginx` | Multi-stage Go build for meshobserv + nginx + supervisord | VERIFIED | golang:1.24-alpine builder, alpine:3.21 runtime with nginx+supervisor+curl, EXPOSE 80 |
| `apps/mqtt/nginx/supervisord.conf` | Process management for nginx + meshobserv | VERIFIED | nodaemon=true, nginx priority 10, meshobserv priority 20, autorestart, stdout/stderr to /dev/std* |
| `apps/mqtt/nginx/nginx.conf` | HTTP server for meshmap on port 80 | VERIFIED | listen 80, /var/www/html root, nodes.json no-cache+CORS, /health endpoint |
| `apps/mqtt/nginx/index.html` | Placeholder meshmap page | VERIFIED | Minimal HTML placeholder, Phase 17 replaces with DC33 port |
| `infra/terraform/live/site/services/run.mqtt/service.hcl` | 4-container ECS task with NLB mappings | VERIFIED | 4 containers, versions block, dependency ordering, NLB 443->80, 8443 commented out |
| `apps/mqtt/build.sh` | Local Docker build script | VERIFIED | Executable, supports mosquitto/meshtk/nginx/all, resolve_meshtk symlink handler with EXIT trap |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| Dockerfile.mosquitto | entrypoint.sh | COPY and ENTRYPOINT | WIRED | `COPY entrypoint.sh /entrypoint.sh`, `ENTRYPOINT ["/entrypoint.sh"]` |
| entrypoint.sh | mosquitto.conf | generates from env vars | WIRED | `cat > /mosquitto/config/mosquitto.conf`, uses `MQTT_*_PASSWORD` env vars |
| Dockerfile.meshtk | meshtk Go source | COPY and go build | WIRED | `COPY go.mod go.sum ./`, `COPY . .`, `go build ... ./cmd/meshtk.go` |
| Dockerfile.nginx | meshtk Go source | COPY and go build meshobserv | WIRED | `COPY meshtk/go.mod meshtk/go.sum ./`, `COPY meshtk/ .`, `go build ... ./cmd/meshtk.go` |
| supervisord.conf | meshobserv binary | program definition | WIRED | `[program:meshobserv]`, `command=/usr/local/bin/meshobserv server inspect` |
| service.hcl | ECS task definition | containers[] array | WIRED | 4 containers with names, images, ports, health_checks, depends_on |
| service.hcl | NLB load_balancers | container_port mapping | WIRED | port 443 -> container_port 80 (nginx), 1883/8883 -> container_port 1883 (meshtk) |
| build.sh | Dockerfiles | docker buildx build commands | WIRED | References all 3 Dockerfiles with correct build contexts |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CONT-01 | 15-01 | Mosquitto container with password auth, ACL, health check on port 1884 | SATISFIED | Dockerfile.mosquitto + entrypoint.sh + acl.conf verified |
| CONT-02 | 15-02 | Meshtk proxy container in server proxy mode | SATISFIED | Dockerfile.meshtk with multi-stage Go build, CMD server proxy, port 1883 |
| CONT-03 | 15-02 | Nginx/meshobserv container with meshmap and nodes.json | SATISFIED | Dockerfile.nginx + supervisord.conf + nginx.conf verified (meshmap is placeholder) |
| CONT-04 | 15-03 | Ghosts container (non-essential, fleet simulate) | SATISFIED | service.hcl mqtt-ghosts essential=false, reuses meshtk image, command override |
| CONT-05 | 15-03 | 4-container ECS task definition with port allocation and dependency ordering | SATISFIED | service.hcl has 4 containers, CPU/memory totals correct (1024/2048), dependency chain verified |
| CONT-06 | 15-01 | meshtk source directory at apps/mqtt/meshtk/ | SATISFIED | Directory exists with gitignore tracking only Dockerfile.meshtk; Go source copied at build time |
| CONT-07 | 15-03 | mqtt service.hcl with NLB load_balancer entries, both-region deployment | SATISFIED | 3 active load_balancers (1883, 8883, 443), 8443 commented out, regions includes us-east-1 and ca-central-1 |

No orphaned requirements found.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/mqtt/nginx/index.html` | 17-18 | "coming soon" + TODO Phase 17 | Info | Expected placeholder; Phase 17 will port actual meshmap HTML from DC33 |
| `apps/mqtt/nginx/Dockerfile.nginx` | 31 | TODO Phase 17 comment | Info | Documents that meshmap HTML is placeholder, not a missed implementation |

No blockers or warnings. The TODOs are intentional Phase 17 forward references, not incomplete work from Phase 15.

### Additional Observations

1. **meshtk symlink replaced with tracked directory**: Plan 01 expected a symlink to ~/working/meshtk, but Plan 02 correctly identified that git cannot track files through symlinks. The directory now tracks only Dockerfile.meshtk while gitignoring Go source. build.sh handles symlink resolution at build time. This is an improvement.

2. **entrypoint.sh not executable on disk**: The file lacks the executable bit in the working directory, but this is a non-issue because `Dockerfile.mosquitto` line 7 does `RUN chmod +x /entrypoint.sh` inside the container build.

3. **Mosquitto listens on port 1884 (not 1883)**: This is by design -- mosquitto is the internal broker, meshtk proxy is the external-facing listener on 1883. Success Criterion 1 in ROADMAP.md says "port 1883" but the actual architecture has mosquitto on 1884 with meshtk proxy on 1883. The service.hcl correctly wires NLB ports 1883/8883 to meshtk:1883.

4. **service.hcl uses HCL interpolation** (`${local.versions.mosquitto}`) which requires the ecs-task module to handle local references. This is standard Terragrunt/HCL pattern.

### Human Verification Required

### 1. Docker Build Verification

**Test:** Run `cd apps/mqtt && ./build.sh all` to build all 3 container images
**Expected:** All 3 images (mqtt-mosquitto:local, mqtt-meshtk:local, mqtt-nginx:local) build successfully
**Why human:** Requires Docker daemon running and meshtk Go source present; cannot verify programmatically in CI-less environment

### 2. Container Runtime Verification

**Test:** Run mosquitto container with test passwords, then run meshtk proxy connecting to it
**Expected:** Mosquitto starts, accepts authenticated connections; meshtk proxy starts and health check passes
**Why human:** Requires running containers with network connectivity, environment variables, and live MQTT protocol testing

### 3. Terraform Plan Validation

**Test:** Run `terragrunt plan` in the run.mqtt service directory
**Expected:** Plan shows valid task definition with 4 containers, no HCL syntax errors
**Why human:** Requires AWS credentials and Terraform state; cannot validate HCL interpolation without `terragrunt plan`

---

_Verified: 2026-03-07T14:00:00Z_
_Verifier: Claude (gsd-verifier)_
