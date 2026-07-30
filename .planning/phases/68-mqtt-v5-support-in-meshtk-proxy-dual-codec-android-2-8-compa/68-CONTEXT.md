# Phase 68: MQTT v5 Support in meshtk Proxy (dual-codec — Android 2.8 compatibility) - Context

**Gathered:** 2026-07-29
**Status:** Ready for planning
**Source:** Live working session with Kurt (2026-07-28/29) — root-cause investigation, interim fix shipped (meshtk#23 / run.mqtt v0.0.70), and design assessment all confirmed in-conversation. Execution will run in a FRESH AUTONOMOUS session after /clear.

<domain>
## Phase Boundary

Make MQTT v5 clients — specifically Meshtastic-Android 2.8.0's mqttastic phone-proxy — fully functional through the meshtk reverse proxy at mqtt.defcon.run:4433, with every existing security/inspection feature (cred verify+swap, PacketDecider rules, hop clamp, payload rewrite, downlink self-echo suppression) working identically on v5 connections, while leaving the working 3.1.1 path byte-for-byte unchanged.

IN scope: meshtk proxy dual-codec (upstream repo + vendor-sync), tests, local mosquitto verification, prod release + verification.
OUT of scope: MQTT v5 feature adoption beyond compatibility (no-local subscriptions, session expiry semantics, topic aliases as an optimization), the radio↔profile binding design (separate proposed phase), Android app changes (upstream's problem), region mirror work.

</domain>

<decisions>
## Implementation Decisions

### Evidence base (do not re-derive)
- Android 2.8.0 uses `org.meshtastic:mqtt-client` ("mqttastic" 0.7.0) = MQTTastic-Client-KMP, a Kotlin Multiplatform **MQTT 5.0** client. iOS still speaks 3.1.1.
- mqttastic does NOT fall back to 3.1.1 after CONNACK 0x84 — confirmed live: `MQTT5_REJECT` telemetry retry-loops every 5–25s with zero interleaved 3.1.1 successes from that client. Full v5 support is therefore required, not optional.
- Before v0.0.70 the paho 3.1.1 codec MISPARSED v5 CONNECTs (the v5 properties block bleeds into clientId/username/password — with empty properties the clientId gets read as the username), yielding a bogus "check credentials" reject. This is upstream issue Meshtastic-Android#6505 from the user side.
- v0.0.70 (meshtk#23, LIVE) added `peekConnectProtocolVersion` — a non-consuming bufio peek of the first packet's protocol name/version before the backend dial — and rejects ver>=5 with v5 CONNACK 0x84 + `action=MQTT5_REJECT` log line. This preflight is the natural place to stamp the connection's protocol version.

### Architecture (locked)
- **Dual codec, per-connection**: version stamped once at the existing preflight; the connection's lifetime (both directions) uses the matching codec. v5 = `github.com/eclipse/paho.golang/packets` (official Eclipse v5 wire codec). 3.1.1 = existing `github.com/eclipse/paho.mqtt.golang/packets`, untouched.
- **No protocol translation**: mosquitto 2.x speaks v5 natively; connections are 1:1 client↔backend (proxy dials a fresh backend conn per client), so forward v5 as v5. The version is a per-connection-pair property shared between `handleProxy` (client→backend) and `handleBackend` (backend→client) — likely via `ConnectionInfo`.
- **Stability is a HARD requirement** (Kurt verbatim: "I don't want to destabilize the meshtk code too much"): the 3.1.1 code path must be byte-for-byte unchanged in behavior. Prefer additive code (new v5 functions/files) over refactoring shared paths. A wire-level regression test should prove a v4 session's proxy behavior is identical pre/post.
- **Unknown/unhandled v5 packet types**: forward raw bytes rather than drop — the proxy only needs to *inspect* CONNECT/PUBLISH; everything else can pass through opaquely if parsing is not needed.
- Version-correct failure modes: v5 bad creds → CONNACK reason 0x87 (Not authorized); enhanced auth (Authentication Method property present) → 0x8C (Bad authentication method); 0x84 stays only for protocol levels the proxy genuinely does not speak (>5).

### Codec parity points (all must work on v5)
1. CONNECT: extract username/password → existing `Authenticator.Verify` (cache/backend lookup unchanged) → swap to mosquitto proxy creds → re-encode preserving the properties block. Client creds must never reach mosquitto.
2. PUBLISH uplink: ServiceEnvelope protobuf decode → `InspectorPacket` → `PacketDecider` rules (rules engine itself is codec-agnostic, needs no change).
3. Rewrites: `RemarshalEnvelope` (hop clamp, meshtk#22) and `RewritePayloadString` must re-encode v5 PUBLISH preserving topic, QoS bits, packet id, and properties. ⚠ Lesson from meshtk#22: a rewrite that mutates the parsed struct without re-marshaling onto the wire is a silent no-op — wire-level tests required.
4. Downlink: `logDownlink` + self-echo suppression per gateway id — identical semantics for v5 connections.
5. Keepalive→read-deadline mapping (`proxyReadTimeout`) applies to v5 CONNECTs too.

### Workflow (locked — repo/release mechanics)
- **Upstream-first**: ALL meshtk code changes land in `~/working/meshtk` (github whereiskurt/meshtk) on a feature branch → PR → merge. THEN copy only the changed files to `apps/run.mqtt/meshtk/` in the monorepo (tracked vendored snapshot). NEVER touch `apps/run.mqtt/meshtk/**/embedded.go` (go:embed con routes — vendor-sync clobbered it once; always verify untouched before committing).
- Use ABSOLUTE paths in multi-repo shell pipelines (a chained `cd && git checkout -b` once created a branch in the wrong repo).
- Release: `gh workflow run buildpub.yml -f apps=run.mqtt -f regions=use1` (builds, pushes ECR, auto-merges the Release PR) → `gh workflow run deploy.yml -f region=us-east-1 -f pr_number=skip -f invalidate_cache=false` → `aws ecs wait services-stable --cluster app-use1-dc34 --services run-mqtt-use1`. ECS cluster is `app-use1-dc34` (NOT a mqtt-named cluster). meshtk container log group: `/ecs/run-mqtt-meshtk-run-mqtt-use1-dc34`.
- AWS access: `source env.local.sh; export AWS_PROFILE=dc34-application AWS_REGION=us-east-1`. Monorepo PRs need `gh pr merge --admin` (branch policy). Go toolchain available; `go build ./... && go test ./...` from the meshtk repo root is the arbiter (LSP shows phantom BrokenImport noise in this workspace — ignore it).

### Verification (locked)
- Wire-level unit tests in `internal/app/server` (style precedent: `proxy_mqtt5_test.go`, `rules_hopclamp_test.go` — hex-exact byte assertions).
- Local end-to-end: real mosquitto (docker) behind the proxy; a v5 client and a 3.1.1 client in the same run; v5 client publishes a ServiceEnvelope and receives downlink. A meshtasticd sim recipe exists in prior session notes if needed.
- Prod verification recipe (already proven for v0.0.70): raw v5 CONNECT via python3 ssl socket to mqtt.defcon.run:4433 — under this phase it must complete auth (with real creds) instead of returning `2003008400`; then check `MQTT5_REJECT` disappears for v5 attempts while 3.1.1 fleet traffic (`action=ALLOW` lines) continues uninterrupted across the deploy.
- Final UAT is human: Kurt connects the Android 2.8.0-open.6 APK and sees the ghost/sim fleet. Everything before that must be machine-verified.

### Claude's Discretion
- Exact seam shape (interface vs switch at the two ReadPacket call sites), file layout for the v5 path, how ConnectionInfo carries the version, and how the peeked CONNECT is replayed into the v5 codec.
- Whether to normalize both codecs into a shared internal packet view or keep two explicit branches — pick whichever keeps the 3.1.1 diff smallest.
- paho.golang version pin (research current stable; it is a separate module from paho.mqtt.golang).
- QoS>0 handling detail on v5 (packet ids/PUBACK pass-through) — proxy today forwards these opaquely for 3.1.1; match that.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### meshtk proxy (upstream repo ~/working/meshtk — the code under change)
- `internal/app/server/proxy.go` — handleProxy/handleBackend read loops, `peekConnectProtocolVersion` preflight (v0.0.70), `writeMqtt5UnsupportedConnack`, `proxyReadTimeout`
- `internal/app/server/inspect.go` — `InspectorPacket`, `inspectRawPacket` CONNECT/PUBLISH handling, cred swap, `ConnectionInfo`, `RemarshalEnvelope`, gateway tracking
- `internal/app/server/rules.go` — `PacketDecider`, per-type allowlist, RewriteHopLimit/RewritePayloadString
- `internal/app/server/authenticator.go` — `Authenticator.Verify` contract + 3.1.1 CONNACK reject
- `internal/app/server/proxy_mqtt5_test.go`, `internal/app/server/rules_hopclamp_test.go` — wire-level test style precedent
- `internal/mqtt/publish.go` — fleet-side Data.bitfield/hop_start stamping (context for what valid envelopes look like)

### Monorepo (vendor + release)
- `apps/run.mqtt/meshtk/` — tracked vendored snapshot (sync target; embedded.go is OFF-LIMITS)
- `AGENTS.md` — release/deploy rules (deploy ONLY via GitHub Actions)

### Protocol references
- MQTT v5 spec §3.1/§3.2/§3.3 (CONNECT/CONNACK/PUBLISH wire format, properties, reason codes) — oasis-open.org
- `github.com/eclipse/paho.golang/packets` — v5 codec API (research current stable release)

</canonical_refs>

<specifics>
## Specific Ideas

- The preflight peek already proves the first bytes are identical across versions up through keepalive — reuse it as the version-stamp point; don't parse CONNECT twice.
- Reject-before-backend-dial behavior (v0.0.70) should be preserved for unsupported versions; supported v5 continues to dial.
- `MQTT5_REJECT` log line should remain for genuinely unsupported versions; consider an `action=MQTT5_CONNECT` info line for successful v5 auths so the Android adoption rate is greppable.
- All log lines follow the existing `action=..., ip=..., username=...` format so ops greps keep working.

</specifics>

<deferred>
## Deferred Ideas

- v5 no-local subscription option to replace manual self-echo suppression (nice simplification, separate change)
- Radio↔profile binding at the proxy (uplink "From ∈ user's radio list" rule) — separately proposed, needs its own phase
- Re-enabling the rate limiter (disabled 2026-07-19 for con debug) — unrelated to this phase
- cac1 region release (S3 asset sync broken for run.mqtt cac1; use1-only is standing practice)

</deferred>

---

*Phase: 68-mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa*
*Context gathered: 2026-07-29 via live working-session express path*
