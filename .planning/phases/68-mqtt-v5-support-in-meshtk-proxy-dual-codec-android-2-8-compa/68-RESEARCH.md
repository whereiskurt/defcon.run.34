# Phase 68: MQTT v5 Support in meshtk Proxy (dual-codec) - Research

**Researched:** 2026-07-29
**Domain:** MQTT 5.0 wire protocol / Go MQTT codecs / reverse-proxy packet inspection
**Confidence:** HIGH (every load-bearing claim was executed against real code and a real mosquitto broker in this session)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Evidence base (do not re-derive)**
- Android 2.8.0 uses `org.meshtastic:mqtt-client` ("mqttastic" 0.7.0) = MQTTastic-Client-KMP, a Kotlin Multiplatform **MQTT 5.0** client. iOS still speaks 3.1.1.
- mqttastic does NOT fall back to 3.1.1 after CONNACK 0x84 — confirmed live: `MQTT5_REJECT` telemetry retry-loops every 5–25s with zero interleaved 3.1.1 successes from that client. Full v5 support is therefore required, not optional.
- Before v0.0.70 the paho 3.1.1 codec MISPARSED v5 CONNECTs (the v5 properties block bleeds into clientId/username/password — with empty properties the clientId gets read as the username), yielding a bogus "check credentials" reject. This is upstream issue Meshtastic-Android#6505 from the user side.
- v0.0.70 (meshtk#23, LIVE) added `peekConnectProtocolVersion` — a non-consuming bufio peek of the first packet's protocol name/version before the backend dial — and rejects ver>=5 with v5 CONNACK 0x84 + `action=MQTT5_REJECT` log line. This preflight is the natural place to stamp the connection's protocol version.

**Architecture (locked)**
- **Dual codec, per-connection**: version stamped once at the existing preflight; the connection's lifetime (both directions) uses the matching codec. v5 = `github.com/eclipse/paho.golang/packets` (official Eclipse v5 wire codec). 3.1.1 = existing `github.com/eclipse/paho.mqtt.golang/packets`, untouched.
- **No protocol translation**: mosquitto 2.x speaks v5 natively; connections are 1:1 client↔backend (proxy dials a fresh backend conn per client), so forward v5 as v5. The version is a per-connection-pair property shared between `handleProxy` (client→backend) and `handleBackend` (backend→client) — likely via `ConnectionInfo`.
- **Stability is a HARD requirement** (Kurt verbatim: "I don't want to destabilize the meshtk code too much"): the 3.1.1 code path must be byte-for-byte unchanged in behavior. Prefer additive code (new v5 functions/files) over refactoring shared paths. A wire-level regression test should prove a v4 session's proxy behavior is identical pre/post.
- **Unknown/unhandled v5 packet types**: forward raw bytes rather than drop — the proxy only needs to *inspect* CONNECT/PUBLISH; everything else can pass through opaquely if parsing is not needed.
- Version-correct failure modes: v5 bad creds → CONNACK reason 0x87 (Not authorized); enhanced auth (Authentication Method property present) → 0x8C (Bad authentication method); 0x84 stays only for protocol levels the proxy genuinely does not speak (>5).

**Codec parity points (all must work on v5)**
1. CONNECT: extract username/password → existing `Authenticator.Verify` (cache/backend lookup unchanged) → swap to mosquitto proxy creds → re-encode preserving the properties block. Client creds must never reach mosquitto.
2. PUBLISH uplink: ServiceEnvelope protobuf decode → `InspectorPacket` → `PacketDecider` rules (rules engine itself is codec-agnostic, needs no change).
3. Rewrites: `RemarshalEnvelope` (hop clamp, meshtk#22) and `RewritePayloadString` must re-encode v5 PUBLISH preserving topic, QoS bits, packet id, and properties. ⚠ Lesson from meshtk#22: a rewrite that mutates the parsed struct without re-marshaling onto the wire is a silent no-op — wire-level tests required.
4. Downlink: `logDownlink` + self-echo suppression per gateway id — identical semantics for v5 connections.
5. Keepalive→read-deadline mapping (`proxyReadTimeout`) applies to v5 CONNECTs too.

**Workflow (locked — repo/release mechanics)**
- **Upstream-first**: ALL meshtk code changes land in `~/working/meshtk` (github whereiskurt/meshtk) on a feature branch → PR → merge. THEN copy only the changed files to `apps/run.mqtt/meshtk/` in the monorepo (tracked vendored snapshot). NEVER touch `apps/run.mqtt/meshtk/**/embedded.go` (go:embed con routes — vendor-sync clobbered it once; always verify untouched before committing).
- Use ABSOLUTE paths in multi-repo shell pipelines (a chained `cd && git checkout -b` once created a branch in the wrong repo).
- Release: `gh workflow run buildpub.yml -f apps=run.mqtt -f regions=use1` (builds, pushes ECR, auto-merges the Release PR) → `gh workflow run deploy.yml -f region=us-east-1 -f pr_number=skip -f invalidate_cache=false` → `aws ecs wait services-stable --cluster app-use1-dc34 --services run-mqtt-use1`. ECS cluster is `app-use1-dc34` (NOT a mqtt-named cluster). meshtk container log group: `/ecs/run-mqtt-meshtk-run-mqtt-use1-dc34`.
- AWS access: `source env.local.sh; export AWS_PROFILE=dc34-application AWS_REGION=us-east-1`. Monorepo PRs need `gh pr merge --admin` (branch policy). Go toolchain available; `go build ./... && go test ./...` from the meshtk repo root is the arbiter (LSP shows phantom BrokenImport noise in this workspace — ignore it).

**Verification (locked)**
- Wire-level unit tests in `internal/app/server` (style precedent: `proxy_mqtt5_test.go`, `rules_hopclamp_test.go` — hex-exact byte assertions).
- Local end-to-end: real mosquitto (docker) behind the proxy; a v5 client and a 3.1.1 client in the same run; v5 client publishes a ServiceEnvelope and receives downlink. A meshtasticd sim recipe exists in prior session notes if needed.
- Prod verification recipe (already proven for v0.0.70): raw v5 CONNECT via python3 ssl socket to mqtt.defcon.run:4433 — under this phase it must complete auth (with real creds) instead of returning `2003008400`; then check `MQTT5_REJECT` disappears for v5 attempts while 3.1.1 fleet traffic (`action=ALLOW` lines) continues uninterrupted across the deploy.
- Final UAT is human: Kurt connects the Android 2.8.0-open.6 APK and sees the ghost/sim fleet. Everything before that must be machine-verified.

### Claude's Discretion
- Exact seam shape (interface vs switch at the two ReadPacket call sites), file layout for the v5 path, how ConnectionInfo carries the version, and how the peeked CONNECT is replayed into the v5 codec.
- Whether to normalize both codecs into a shared internal packet view or keep two explicit branches — pick whichever keeps the 3.1.1 diff smallest.
- paho.golang version pin (research current stable; it is a separate module from paho.mqtt.golang).
- QoS>0 handling detail on v5 (packet ids/PUBACK pass-through) — proxy today forwards these opaquely for 3.1.1; match that.

### Deferred Ideas (OUT OF SCOPE)
- v5 no-local subscription option to replace manual self-echo suppression (nice simplification, separate change)
- Radio↔profile binding at the proxy (uplink "From ∈ user's radio list" rule) — separately proposed, needs its own phase
- Re-enabling the rate limiter (disabled 2026-07-19 for con debug) — unrelated to this phase
- cac1 region release (S3 asset sync broken for run.mqtt cac1; use1-only is standing practice)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MQV5-01 | Per-connection version stamped in `ConnectionInfo` at the preflight; both read loops dispatch to the matching codec; 3.1.1 byte-for-byte unchanged | § Seam Recommendation — `ConnectionInfo.ProtocolVersion` + **explicit `protoVer` param to `handleBackend`** (ConnTrack alone races: the map entry is not created until the CONNECT is inspected, but `handleBackend` starts before that). Baseline `go test ./internal/app/server/...` passes today (verified). |
| MQV5-02 | v5 codec parses/re-encodes CONNECT/CONNACK/PUBLISH/…; unknown/unhandled types forwarded raw | § Library API + § Seam Recommendation — **frame-capture relay**: capture the raw frame first, parse only CONNECT/CONNACK/PUBLISH, forward everything else byte-exact. Proven end-to-end against mosquitto 2.0.22 in this session. Fixes three re-encode drift bugs (see § Wire Format Notes). |
| MQV5-03 | v5 CONNECT auth: verify, swap creds, preserve properties; 0x87 bad creds; 0x8C enhanced auth | § Library API code sketch + verified wire bytes `2003008700` / `2003008c00`. Cred swap + property preservation verified byte-for-byte; mosquitto logged the swapped identity `u'public'`. |
| MQV5-04 | v5 PUBLISH parity: envelope decode → PacketDecider; RemarshalEnvelope/RewritePayloadString re-encode preserving topic/QoS/properties; downlink logDownlink + self-echo | § Seam Recommendation — `RawPacket.MQTT5` field, `setPublishPayload` helper, `logDownlinkEnvelope` extraction, **`rules.go` nil-guard (required — `AllowMQTTControl` nil-derefs on a v5 packet)**. QoS1 packetID + properties round-trip verified. |
| MQV5-05 | Wire-level regression tests per codec | § Testing Recipe — exact hex fixtures for all four CONNACK reason codes, CONNECT cred-swap, PUBLISH rewrite; `writerConn` pattern from `proxy_mqtt5_test.go` reused. |
| MQV5-06 | Local e2e against real mosquitto: v5 + 3.1.1 in one run | § Testing Recipe — **already executed**; working prototype + mosquitto config in this document. Both docker (`alpine:3.21` → mosquitto 2.0.20) and local Homebrew mosquitto 2.0.22 verified available. |
| MQV5-07 | Ship: upstream PR → vendor-sync → buildpub/deploy use1 + prod verification | § Risks R-1 (this worktree's vendored meshtk is 36 commits stale and would REVERT #22/#23), R-2 (`vendor/` is git-tracked in both repos — `go mod vendor` output must be committed). |
</phase_requirements>

## Summary

The phase is unblocked and lower-risk than it looks. `github.com/eclipse/paho.golang/packets` is the correct, official Eclipse MQTT 5.0 wire codec; the `packets` sub-package is **importable standalone with zero external dependencies** (`go list -deps` resolves only stdlib), it is a separate Go module from the already-vendored `github.com/eclipse/paho.mqtt.golang`, and the two coexist without any import-path or symbol conflict. Every operation the phase needs — parse a v5 CONNECT, swap username/password, re-encode with the properties block intact; parse a v5 PUBLISH, rewrite the payload, re-encode with topic/QoS/packet-id/properties intact; emit CONNACK 0x87 and 0x8C — was executed in this session and produced correct wire bytes, verified against mosquitto 2.0.22.

The single most important finding is architectural: **do not read v5 packets with `packets.ReadPacket` directly off the socket. Capture the raw frame first, then parse a copy.** MQTT's fixed-header framing (type/flags byte + varint remaining length + body) is version-independent, so a 25-line `readFrame` gives byte-exact raw bytes for every packet. Parse only CONNECT, CONNACK and PUBLISH from those bytes; forward everything else (PINGREQ, SUBSCRIBE, SUBACK, PUBACK, UNSUBSCRIBE, DISCONNECT, AUTH, PUBREC/REL/COMP) verbatim. This satisfies MQV5-02's "forward raw rather than drop" literally, and it sidesteps three real defects that a parse-everything design would ship: paho.golang cannot parse a zero-length DISCONNECT (`E0 00`, which is legal and common in v5 — it returns `EOF`), it re-encodes a short PUBACK `40 02 xx xx` into a longer `40 04 xx xx 00 00`, and it hard-fails any packet carrying a property ID it does not model, which would tear the connection down. Under frame-capture none of those packets is ever parsed. The prototype forwarded `E0 00` untouched and mosquitto logged a graceful `Received DISCONNECT`.

The second finding is a dependency trap. `go get github.com/eclipse/paho.golang@v0.23.0` (latest) drags `golang.org/x/net 0.38.0→0.43.0` plus `x/crypto`, `x/sys`, `x/text`, `x/sync` upgrades — a 62-file / 1,113-line vendor diff through the AWS SDK and gRPC transitive paths, in a phase whose hard requirement is "do not destabilize". **`v0.22.0` requires `x/net v0.27.0`, which is below meshtk's existing `v0.38.0`, so it produces zero transitive churn**: a one-line `go.mod` addition and 17 newly vendored files. Its `packets` API is byte-identical to v0.23.0 for CONNECT/CONNACK/PUBLISH/SUBSCRIBE; the only behavioral delta is the reason-only DISCONNECT parse fix — irrelevant under frame-capture, because that packet is never parsed. Both were dry-run built and tested against a clone of the meshtk repo.

The third finding is a live correctness gap nobody has flagged: **mosquitto 2.0 advertises `Topic Alias Maximum = 10` in its CONNACK** (verified: `200900000622000a210014`). That permits a v5 client to publish with an **empty topic string** and a Topic Alias property — which would make the proxy's entire topic-based rule surface and its `msh/US/2/e/...` logging blind, while mosquitto happily resolves the alias and fans the packet out. mqttastic's behavior here is unknown and must not be relied on. The fix is two pointer assignments the proxy already has in hand: strip `TopicAliasMaximum` from the broker's CONNACK before returning it (spec: absent ⇒ 0 ⇒ client MUST NOT alias uplink) and strip it from the client's CONNECT before forwarding (⇒ broker never aliases downlink). Verified end-to-end: the client received `2006000003210014`, published full topics, and mosquitto never aliased downlink.

**Primary recommendation:** Pin `github.com/eclipse/paho.golang v0.22.0`; add `internal/app/server/proxy_v5.go` (frame reader + both v5 loops) and `inspect_v5.go` (v5 CONNECT auth + PUBLISH inspection), touching `proxy.go`/`inspect.go`/`rules.go` only with additive changes; parse exactly three packet types (CONNECT, CONNACK, PUBLISH) and relay the rest as captured bytes; re-encode a PUBLISH only when a rule actually mutated it; kill topic aliases in both directions at the CONNECT/CONNACK seam.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Protocol version detection | Proxy (meshtk, `proxy.go` preflight) | — | Already implemented (v0.0.70); the peek is non-consuming so either codec can read the CONNECT afterwards |
| v5 packet framing / raw relay | Proxy (`proxy_v5.go`) | — | Version-independent fixed-header framing; belongs beside the read loops, not in the codec library |
| v5 wire encode/decode | Library (`paho.golang/packets`) | — | Never hand-roll properties/VBI encoding; the library is the spec implementation |
| Credential verification | Proxy → `Authenticator` (DynamoDB cred cache) | — | Codec-agnostic; the v5 path calls the identical `Verify(ctx, user, pass)` contract |
| Credential swap to broker identity | Proxy (`inspect_v5.go` CONNECT branch) | — | Client creds must never reach mosquitto; the swap must happen before the backend write |
| Meshtastic envelope inspection / rules | Proxy (`rules.go` / `decider.go`) | — | Already codec-agnostic — operates on `ip.Raw.Meshtastic`, not on MQTT types (one nil-guard excepted) |
| Payload rewrite → wire | Proxy (`inspect.go` `RemarshalEnvelope` / `RewritePayloadString`) | Library (re-encode) | Struct mutation alone is a silent no-op (meshtk#22 lesson); the re-encode must be codec-dispatched |
| Topic-alias suppression | Proxy (CONNECT + CONNACK property edit) | Broker (`max_topic_alias 0`) | Proxy-side needs no container release and cannot be undone by a broker config drift |
| Authentication/authorization of the broker identity | Broker (mosquitto `password_file` + `acl.conf`) | — | Unchanged; the proxy presents `public`/`31337` exactly as today |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `github.com/eclipse/paho.golang/packets` | **v0.22.0** | MQTT 5.0 wire codec (parse/encode all 15 control packet types + properties) | Official Eclipse Paho Go v5 implementation; the `packets` sub-package is the reference encoder used by the Paho v5 client itself `[VERIFIED: module resolved from proxy.golang.org, EPL-2.0/EDL-1.0, go.sum h1:JhhUngr8TBlyUZDZw/L6WVayPi9qmSmdWeki48i5AVE=]` |
| `github.com/eclipse/paho.mqtt.golang/packets` | v1.5.0 (existing) | MQTT 3.1.1 codec — **untouched** | Already vendored and in production; the phase's stability requirement forbids changing it |

**Why v0.22.0 and not v0.23.0 (latest):**

| | v0.22.0 | v0.23.0 |
|---|---|---|
| `go.mod` delta | +1 line | +1 line, **+5 upgrades** (`x/crypto` 0.36→0.41, `x/net` 0.38→0.43, `x/sync` 0.12→0.16, `x/sys` 0.31→0.35, `x/text` 0.23→0.28, `go-cmp` added) |
| `vendor/` delta | 17 new files + `LICENSE` + 3 lines in `modules.txt` | same **plus 62 modified files / 1,113 insertions** across `x/net`, `x/sys`, `x/crypto` |
| Go directive | `go 1.21` (≤ meshtk's 1.24.1) | `go 1.24.0` (≤ meshtk's 1.24.1) |
| `packets` API for CONNECT/CONNACK/PUBLISH/SUBSCRIBE | identical | identical |
| Behavioral delta | reason-only DISCONNECT (`E0 01 00`) fails to parse; no 64KiB clamp in `writeString`/`writeBinary` | both fixed |

`[VERIFIED: dry-run `go get` + `go mod tidy` + `go mod vendor` + `go build ./...` + `go test ./internal/app/server/...` against a clone of ~/working/meshtk @5d08bb6 — both versions, this session]`

The v0.22.0 DISCONNECT delta is **inert under the recommended frame-capture design** (DISCONNECT is never parsed). The `writeString` clamp is irrelevant: mosquitto enforces `message_size_limit 1024` and Meshtastic topics are ~30 bytes. If a future change needs to parse DISCONNECT, bump to v0.23.0 and accept the vendor churn as a separate, isolated commit.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `eclipse-mosquitto` / alpine `mosquitto` | 2.0.20 (prod, alpine:3.21) / 2.0.22 (local Homebrew) | v5-native broker behind the proxy | Local e2e test backend; no config change required for v5 |
| stdlib `bufio`, `bytes`, `io` | — | Frame reader | Do not add a framing library |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `paho.golang/packets` v0.22.0 | v0.23.0 | Latest + two small fixes, at the cost of a 62-file transitive `x/*` vendor upgrade in a stability-critical phase |
| Module dependency | Copy the 17 `packets/*.go` files into `internal/mqtt5/packets/` | Zero dependency surface and full control, but forks upstream, loses future fixes, and adds EPL-2.0 source to the repo. **Not recommended** — the v0.22.0 pin already achieves zero churn |
| Proxy-side topic-alias strip | `max_topic_alias 0` in `mosquitto/entrypoint.sh` | Verified to work (CONNACK becomes `2006000003210014`) but requires a second container release and is undone by any broker-config drift. Use as optional defense-in-depth, not as the primary control |
| Frame-capture relay | `packets.ReadPacket` on every packet | Simpler-looking, but breaks zero-length DISCONNECT, inflates PUBACK/DISCONNECT on re-encode, and kills connections on unmodeled properties |

**Installation (in `~/working/meshtk`, absolute paths):**

```bash
cd /Users/khundeck/working/meshtk
GOFLAGS=-mod=mod go get github.com/eclipse/paho.golang@v0.22.0
GOFLAGS=-mod=mod go mod tidy
go mod vendor          # REQUIRED — vendor/ is git-tracked
go build ./... && go test ./...
git add go.mod go.sum vendor/
```

Expected `go.mod` diff — exactly one line:
```diff
+	github.com/eclipse/paho.golang v0.22.0
```

## Package Legitimacy Audit

`gsd-tools query package-legitimacy check` supports npm/PyPI/crates only; Go modules were verified directly against the module proxy, checksum database, and the upstream Eclipse repository.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `github.com/eclipse/paho.golang` v0.22.0 | Go module proxy (proxy.golang.org) | module line since 2019 (v0.9.0); 9 tagged releases through v0.23.0 | n/a (Go proxy publishes no counts) | github.com/eclipse-paho/paho.golang (Eclipse Foundation org; `eclipse/*` is the pre-rename path and still the canonical module path) | **OK** | Approved |

Verification performed:
- `go list -m -versions github.com/eclipse/paho.golang` → `v0.9.0 v0.9.5 v0.10.0 v0.11.0 v0.12.0 v0.20.0 v0.21.0 v0.22.0 v0.23.0` — a long, coherent release history, not a fresh squat.
- `go.sum` entries recorded and validated by the Go checksum database (`sum.golang.org`): `h1:JhhUngr8TBlyUZDZw/L6WVayPi9qmSmdWeki48i5AVE=`.
- `go.mod` files for v0.20.0–v0.23.0 fetched from `raw.githubusercontent.com/eclipse-paho/paho.golang/<tag>/go.mod` — the tags exist in the Eclipse Foundation's own repository.
- Vendored `LICENSE` reads "Eclipse Public License - v 2.0 (EPL-2.0) … and Eclipse Distribution License v1.0" — consistent with an Eclipse Foundation project.
- Go modules have no `postinstall` equivalent; the `packets` sub-package's full dependency closure is stdlib only (`go list -deps`), so there is no build-time code execution surface.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Library API — `github.com/eclipse/paho.golang/packets`

All signatures below are from `go doc -all` against the vendored v0.22.0/v0.23.0 source (identical for these types).

### Entry points

```go
// Read one v5 control packet from an io.Reader. Consumes exactly one packet.
func ReadPacket(r io.Reader) (*ControlPacket, error)

// Allocate a zero-valued packet of the given type, with Properties non-nil.
func NewControlPacket(t byte) *ControlPacket

type ControlPacket struct {
	Content Packet   // *Connect | *Connack | *Publish | *Puback | *Subscribe | ...
	FixedHeader       // { Type byte; Flags byte; remainingLength int (unexported) }
}

func (c *ControlPacket) WriteTo(w io.Writer) (int64, error) // encode to wire
func (c *ControlPacket) PacketID() uint16
func (c *ControlPacket) PacketType() string                  // "CONNECT", "PUBLISH", ...

// Packet type constants (byte): CONNECT=1 CONNACK=2 PUBLISH=3 PUBACK=4 PUBREC=5
// PUBREL=6 PUBCOMP=7 SUBSCRIBE=8 SUBACK=9 UNSUBSCRIBE=10 UNSUBACK=11
// PINGREQ=12 PINGRESP=13 DISCONNECT=14 AUTH=15
```

> ⚠ `ControlPacket` here is a **struct**; in `paho.mqtt.golang/packets` `ControlPacket` is an **interface**. The two names collide only if both packages are imported into one file — import the v5 one under an alias (`v5 "github.com/eclipse/paho.golang/packets"`) wherever both appear. Verified: both modules build together in meshtk with no conflict.

### Types the proxy touches

```go
type Connect struct {
	WillMessage     []byte
	Password        []byte       // raw bytes — feeds Authenticator.Verify unchanged
	Username        string
	ProtocolName    string       // "MQTT"
	ClientID        string
	WillTopic       string
	Properties      *Properties  // the v5 properties block, always non-nil after ReadPacket
	WillProperties  *Properties
	KeepAlive       uint16       // → proxyReadTimeout(keepalive)
	ProtocolVersion byte         // 5
	WillQOS         byte
	PasswordFlag    bool
	UsernameFlag    bool
	WillRetain      bool
	WillFlag        bool
	CleanStart      bool
}

type Connack struct {
	Properties     *Properties
	ReasonCode     byte
	SessionPresent bool
}
func (c *Connack) Reason() string   // human string for logs

type Publish struct {
	Payload    []byte      // ← ServiceEnvelope protobuf; mutate this
	Topic      string      // ← rules key. EMPTY when the client used a topic alias!
	Properties *Properties
	PacketID   uint16      // present iff QoS > 0
	QoS        byte
	Duplicate  bool
	Retain     bool
}

type Properties struct {
	// Pointer fields are nil when the property is absent on the wire.
	PayloadFormat  *byte;   MessageExpiry *uint32; ContentType string
	ResponseTopic  string;  CorrelationData []byte
	SubscriptionIdentifier *int
	SessionExpiryInterval  *uint32
	AssignedClientID string; ServerKeepAlive *uint16
	AuthMethod     string   // ← non-empty ⇒ enhanced auth ⇒ reject 0x8C
	AuthData       []byte
	RequestProblemInfo *byte; WillDelayInterval *uint32; RequestResponseInfo *byte
	ResponseInfo string; ServerReference string; ReasonString string
	ReceiveMaximum    *uint16
	TopicAliasMaximum *uint16  // ← set to nil in BOTH directions (see Topic Alias Handling)
	TopicAlias        *uint16  // ← non-nil on an uplink PUBLISH ⇒ topic is aliased ⇒ BLOCK
	MaximumQOS *byte; RetainAvailable *byte
	User []User               // []struct{ Key, Value string }
	MaximumPacketSize *uint32
	WildcardSubAvailable *byte; SubIDAvailable *byte; SharedSubAvailable *byte
}
```

### Reason-code constants (use these, do not hard-code)

```go
ConnackSuccess                    = 0x00
ConnackUnsupportedProtocolVersion = 0x84   // keep for level > 5
ConnackBadUsernameOrPassword      = 0x86
ConnackNotAuthorized              = 0x87   // ← MQV5-03 bad creds
ConnackBadAuthenticationMethod    = 0x8C   // ← MQV5-03 enhanced auth
```

### Sketch A — read CONNECT → verify → swap creds → re-encode

```go
// Source: verified end-to-end this session against mosquitto 2.0.22.
frame, typ, err := readFrame(clientReader)      // raw bytes captured first
if err != nil || typ != v5.CONNECT { return }

cp, err := v5.ReadPacket(bytes.NewReader(frame))  // parse a COPY of the frame
if err != nil { /* malformed v5 CONNECT: log + drop */ return }
c := cp.Content.(*v5.Connect)

// keepalive → client read deadline (same mapping as 3.1.1)
readTimeout := proxyReadTimeout(c.KeepAlive)

// enhanced auth is unsupported: 0x8C, before the backend dial
if c.Properties.AuthMethod != "" {
	writeMqtt5Connack(conn, v5.ConnackBadAuthenticationMethod)   // wire: 2003008c00
	return
}

ok, err := n.Authenticator.Verify(ctx, c.Username, c.Password)   // UNCHANGED contract
if err != nil || !ok {
	writeMqtt5Connack(conn, v5.ConnackNotAuthorized)             // wire: 2003008700
	return
}

c.Username = n.Config.Server.ProxyUsername      // "public"
c.Password = []byte(n.Config.Server.ProxyPassword)
c.Properties.TopicAliasMaximum = nil            // broker must not alias downlink

var out bytes.Buffer
if _, err := cp.WriteTo(&out); err != nil { return }
backendConn.Write(out.Bytes())
```

Verified wire bytes (from this session):

```
client CONNECT in   105e00044d51545405c2003c 2421001422000a27100000041100000000260006636c69656e7400096d717474617374696300
                    166d71747461737469632d616e64726f69642d74657374 000c656432373064626535643165 000768756e74657232
                    ^type/len ^"MQTT" ^v5 ^flags ^keepalive=60  ^props(0x24) ...  ^clientID  ^username  ^password

after swap+strip    105300044d51545405c2003c 2121001427100000041100000000260006636c69656e7400096d717474617374696300
                    166d71747461737469632d616e64726f69642d74657374 00067075626c6963 00053331333337
                    props shrank 0x24→0x21 (0x22 000a TopicAliasMaximum removed);
                    SessionExpiry / ReceiveMaximum / MaximumPacketSize / User props all preserved
```

`[VERIFIED: executed, paho.golang v0.22.0 and v0.23.0, identical output]`

Also verified: **parse → re-encode with no mutation is byte-identical** for a v5 CONNECT. That is a useful invariant for tests.

### Sketch B — read PUBLISH → inspect → rewrite payload → re-encode

```go
frame, typ, err := readFrame(clientReader)
if typ != v5.PUBLISH { backendConn.Write(frame); continue }   // raw relay

cp, perr := v5.ReadPacket(bytes.NewReader(frame))
if perr != nil {
	n.Config.Log.Warnf("[proxy] v5 PUBLISH parse failed: %v (forwarding raw)", perr)
	backendConn.Write(frame)                                   // never drop
	continue
}
p := cp.Content.(*v5.Publish)

// Topic aliasing defeats every topic-based rule — refuse it (belt; the CONNACK
// rewrite is the braces).
if p.Properties.TopicAlias != nil || p.Topic == "" {
	n.InspectorLogger.Warnf("action=BLOCK, ip=%s, reason=topic_alias_uplink", socketAddr)
	return
}

ip := &InspectorPacket{
	Log:   n.InspectorLogger,
	Track: &ConnectionInfo{SocketAddress: socketAddr, ProtocolVersion: 5},
	Raw:   &RawPacket{MQTT5: cp},          // NEW field; Raw.MQTT stays nil
}
ip.inspectV5Packet(n, conn)                // fills MQTT.Topics, Raw.Meshtastic, Meshtastic.*
result := n.PacketDecider.Decide(ip)       // rules engine UNCHANGED

// Rewrite rules mutate p.Payload via RemarshalEnvelope / RewritePayloadString.
if payloadChanged {
	var out bytes.Buffer
	cp.WriteTo(&out)                       // topic, QoS bits, PacketID, properties all preserved
	backendConn.Write(out.Bytes())
} else {
	backendConn.Write(frame)               // byte-exact passthrough
}
```

Verified wire bytes:

```
in   32 39 001b "msh/US/2/e/dc.run/!435990e4" 1234  14 020000012c 2600037372630007616e64726f6964  0a03616263
     ^QoS1 ^len  ^topic                        ^pktID ^props(0x14: MessageExpiry=300, User{src:android})  ^payload

out  32 3b 001b "msh/US/2/e/dc.run/!435990e4" 1234  14 020000012c 2600037372630007616e64726f6964  0a0578797a7a79
     topic, QoS bits, PacketID 0x1234 and the whole properties block survive a longer payload
```

`[VERIFIED: executed this session]`

### Sketch C — CONNACK reject, and CONNACK downlink rewrite

```go
// writeMqtt5Connack replaces the hand-rolled writeMqtt5UnsupportedConnack byte
// literal with the codec. Output is byte-identical to today's 2003008400.
func writeMqtt5Connack(conn net.Conn, reason byte) error {
	ca := v5.NewControlPacket(v5.CONNACK)
	ca.Content.(*v5.Connack).ReasonCode = reason
	_, err := ca.WriteTo(conn)
	return err
}
// 0x84 -> 2003008400   0x87 -> 2003008700   0x8C -> 2003008c00   [VERIFIED]
```

```go
// Backend loop: the ONLY reason to parse a CONNACK is to strip TopicAliasMaximum.
case v5.CONNACK:
	pk, perr := v5.ReadPacket(bytes.NewReader(frame))
	if perr != nil { conn.Write(frame); continue }        // forward raw on parse failure
	ca := pk.Content.(*v5.Connack)
	ca.Properties.TopicAliasMaximum = nil                 // client MUST NOT alias uplink
	var out bytes.Buffer
	pk.WriteTo(&out)
	conn.Write(out.Bytes())
	// mosquitto 2.0.22 sends 200900000622000a210014 -> client receives 2006000003210014
```

`[VERIFIED: executed against mosquitto 2.0.22]`

### Sketch D — the frame reader (version-independent)

```go
// readFrame reads exactly one MQTT control packet off the wire as raw bytes,
// interpreting only the fixed-header framing — 1 type/flags byte, a 1..4 byte
// varint remaining length, then that many body bytes. That framing is identical
// in 3.1.1 and v5, so the captured bytes can be relayed verbatim or handed to a
// codec, and a packet the codec cannot parse is still forwardable.
func readFrame(r *bufio.Reader) (raw []byte, pktType byte, err error) {
	b0, err := r.ReadByte()
	if err != nil { return nil, 0, err }
	frame := []byte{b0}
	var remLen int
	var mult uint32
	for i := 0; ; i++ {
		if i == 4 { return nil, 0, fmt.Errorf("malformed remaining length") }
		d, err := r.ReadByte()
		if err != nil { return nil, 0, err }
		frame = append(frame, d)
		remLen |= int(d&0x7F) << mult
		if d&0x80 == 0 { break }
		mult += 7
	}
	if remLen > maxV5PacketBytes {           // see Security Domain — cap the allocation
		return nil, 0, fmt.Errorf("v5 packet too large: %d", remLen)
	}
	if remLen > 0 {
		body := make([]byte, remLen)
		if _, err := io.ReadFull(r, body); err != nil { return nil, 0, err }
		frame = append(frame, body...)
	}
	return frame, b0 >> 4, nil
}
```

`[VERIFIED: executed — round-trips E0 00, E0 01 00, 40 02 12 34, C0 00, and a 433-byte PUBLISH byte-exactly, including back-to-back frames off one bufio.Reader]`

## Wire Format Notes

Confirmed structural facts (spec + observed bytes):

| Packet | v5 layout | Proxy action |
|--------|-----------|--------------|
| CONNECT | `"MQTT"` · ver · flags · keepalive · **properties (VBI len + body)** · clientID · [will props · will topic · will msg] · [username] · [password] | Parse + re-encode (cred swap, alias strip) |
| CONNACK | ack-flags · reason code · **properties** | Parse + re-encode (alias strip) — or emit ours on reject |
| PUBLISH | topic · [packetID iff QoS>0] · **properties** · payload | Parse; re-encode **only if a rule mutated the payload** |
| SUBSCRIBE | packetID · **properties** · (topic · options-byte)+ | Raw relay |
| SUBACK / UNSUBACK | packetID · **properties** · reason codes | Raw relay |
| PUBACK/PUBREC/PUBREL/PUBCOMP | packetID · [reason · [properties]] — both may be omitted when reason is 0 | Raw relay |
| DISCONNECT | [reason · [properties]] — **remaining length 0 is legal** | Raw relay |
| AUTH (type 15) | reason · properties — **v5-only** | Raw relay (enhanced auth already rejected at CONNECT) |
| PINGREQ / PINGRESP | empty | Raw relay |

**The properties block always sits immediately before the payload/identifier section and is length-prefixed with a variable-byte integer** — which is exactly why the 3.1.1 codec misreads a v5 CONNECT: with an empty properties block it reads the single `0x00` length byte as the high byte of the clientID length and everything downstream shifts.

Codec quirks that argue for frame-capture:

1. **`ReadPacket` cannot parse `E0 00`** (zero-length DISCONNECT — legal per MQTT 5.0 §3.14.2.1 when the reason is 0x00 with no properties). Returns `EOF`. `[VERIFIED: v0.22.0 and v0.23.0]` Under parse-everything the proxy would tear the socket down without relaying the DISCONNECT, and mosquitto would treat it as an ungraceful disconnect (Will publication semantics). Under frame-capture the prototype relayed it and mosquitto logged `Received DISCONNECT from publisher / Client publisher disconnected.`
2. **Re-encode inflates short forms.** `40 02 12 34` (PUBACK, success, no reason/properties) re-encodes to `40 04 12 34 00 00`; `E0 01 00` re-encodes to `E0 02 00 00`. Semantically equivalent and legal, but gratuitous wire churn on the hot path. `[VERIFIED]`
3. **`Properties.Unpack` hard-errors on any property ID it does not model** (`unknown Prop type %d`) and on any property not in its `ValidProperties` table for that packet type. A single unexpected property would kill the connection. `[VERIFIED: source read + executed]`
4. **`SubscriptionIdentifier` is modeled as a single `*int`**, but MQTT 5.0 permits multiple in one PUBLISH (overlapping subscriptions). Re-encoding such a PUBLISH would drop all but one. Raw relay of downlink PUBLISH avoids this entirely — and the proxy has no reason to re-encode downlink. `[CITED: MQTT 5.0 §3.3.2.3.8]` / `[VERIFIED: struct shape]`
5. **`ControlPacket.WriteTo` mutates `FixedHeader.Flags` for PUBLISH** to `Type<<4 | flags` (e.g. `0x32`), which is out of the 4-bit flags range. It is idempotent (the encoder ORs `Type<<4` again) so repeated `WriteTo` calls produce identical bytes `[VERIFIED]`, but a test asserting on `FixedHeader.Flags` after `WriteTo` will see `0x32`, not `0x02`. Assert on the wire bytes, not the struct.
6. **CONNECT parse → re-encode with no mutation is byte-identical** `[VERIFIED]`. PUBLISH likewise for the captured-frame case `[VERIFIED: 433-byte PUBLISH]`. Useful as a test invariant, but do not depend on it for packets with unusual property ordering — `Properties.Pack` emits in its own fixed order.

## Topic Alias Handling — decision input

**The risk is real, not theoretical.** mosquitto 2.0 (both 2.0.20 and 2.0.22) advertises `Topic Alias Maximum = 10` in its CONNACK by default:

```
mosquitto CONNACK: 20 09 00 00 06 22 000a 21 0014
                              ^len ^0x22 TopicAliasMaximum=10  ^0x21 ReceiveMaximum=20
```

Per MQTT 5.0 §3.3.2.3.4, a client that has been granted a non-zero Topic Alias Maximum may send a PUBLISH with an **empty topic string** plus a Topic Alias property, after one initial PUBLISH that binds the alias. Verified against mosquitto: the broker accepted `30 16 0000 03 2300 01 <payload>` (empty topic, alias 1) and resolved it correctly, logging the full topic. A proxy that keys rules and logs off `Publish.Topic` would see `""` for every subsequent packet on that alias.

Verified options:

| Option | Mechanism | Verified result | Cost |
|--------|-----------|-----------------|------|
| **A (recommended)** Strip `TopicAliasMaximum` from the broker's CONNACK before returning it | Absent ⇒ default 0 ⇒ client MUST NOT alias uplink (MQTT 5.0 §3.2.2.3.8) | Client received `2006000003210014`; published full topics | Proxy must parse+re-encode CONNACK (one extra packet type) |
| **A′ (pair with A)** Strip `TopicAliasMaximum` from the client's CONNECT before forwarding | Broker never aliases downlink ⇒ `logDownlink` always sees a real topic | mosquitto sent full topics on every downlink PUBLISH | Free — the CONNECT is already being re-encoded |
| **B (optional, defense-in-depth)** `max_topic_alias 0` in `mosquitto/entrypoint.sh` | Broker omits the property entirely | CONNACK became `2006000003210014` | Requires a mosquitto container release; can drift |
| **C (belt)** Runtime guard: uplink PUBLISH with `Properties.TopicAlias != nil` or `Topic == ""` ⇒ `action=BLOCK` | Catches a non-compliant client that aliases anyway | Prototype blocked and logged | ~4 lines |

**Recommendation: A + A′ + C.** Entirely inside meshtk, no extra container release, and C makes a spec-violating client loud instead of invisible. Setting the pointer to `nil` (omit) rather than to `&0` is preferred — both are legal, `nil` produces the smaller packet, and both were verified.

Note this makes CONNACK the third packet type the v5 path parses. That is the only reason to parse CONNACK at all; without alias suppression it could be a raw relay.

## Backend (mosquitto) findings

| Fact | Value | Source |
|------|-------|--------|
| Prod broker | mosquitto **2.0.20** (`apk add mosquitto` on `alpine:3.21`) | `[VERIFIED: docker run --rm alpine:3.21 …]` |
| Local dev broker | mosquitto **2.0.22** (Homebrew, `/opt/homebrew/sbin/mosquitto`) | `[VERIFIED]` |
| v5 support | Native. `mosquitto is an MQTT v5.0/v3.1.1/v3.1 broker.` No listener option selects a protocol version — a v5 CONNECT on an ordinary `listener` just works | `[VERIFIED: mosquitto -h + live v5 CONNECT]` |
| v5 + username/password | Accepted normally; log line `New client connected … (p5, c1, k60, u'public')` — `p5` confirms protocol 5 | `[VERIFIED]` |
| Config needed for this phase | **None.** Prod `entrypoint.sh` generates `listener 1884 / allow_anonymous false / password_file / acl_file / message_size_limit 1024 / max_keepalive 65535 / persistence false` — all version-agnostic | `[VERIFIED: apps/run.mqtt/mosquitto/entrypoint.sh]` |
| CONNACK properties advertised | `TopicAliasMaximum=10`, `ReceiveMaximum=20`. No `MaximumPacketSize`, no `MaximumQOS`, no `ServerKeepAlive` | `[VERIFIED]` |
| `max_topic_alias 0` | Supported; removes the property from CONNACK entirely | `[VERIFIED]` |
| Enhanced auth | mosquitto itself answers CONNACK **0x8C** to a CONNECT carrying `AuthMethod`, then disconnects (`using not allowed feature … or bad AUTH method`) — so the proxy's 0x8C reject matches the broker's own behavior | `[VERIFIED]` |
| Downlink aliasing | Never used when the client's CONNECT `TopicAliasMaximum` is absent/0 | `[VERIFIED]` |
| `message_size_limit 1024` | Caps the **publish payload**; ServiceEnvelopes are well under this today on 3.1.1, so v5 inherits the same envelope budget. Not a new constraint | `[VERIFIED: entrypoint.sh]` |
| MQTT path | NLB → meshtk proxy :4433 directly. `nginx` in run.mqtt serves only the meshmap static site (`nodes.json`) on :80 — it is not in the MQTT path | `[VERIFIED: apps/run.mqtt/nginx/nginx.conf]` |

## Seam Recommendation

### Shape

Dispatch **once**, at the existing v0.0.70 preflight, into a whole separate v5 connection handler. Do not thread a codec interface through the existing loops — an interface abstraction would force edits inside `handleProxy`/`handleBackend`, which is exactly the 3.1.1 blast radius the phase forbids. Two explicit branches keep the 3.1.1 diff to a single `if`.

```
proxy.go  handleProxy()
   ├─ peekConnectProtocolVersion(request)        ← already exists (v0.0.70)
   ├─ ver > 5   → writeMqtt5Connack(0x84) + action=MQTT5_REJECT   (unchanged behavior)
   ├─ ver == 5  → n.handleProxyV5(conn, request, socketAddr); return   ← NEW: ONE new line
   └─ else      → …existing 3.1.1 body, byte-for-byte unchanged…
```

### File layout

| File | Change | Blast radius on 3.1.1 |
|------|--------|-----------------------|
| `internal/app/server/proxy_v5.go` | **NEW.** `readFrame`, `handleProxyV5` (client→backend loop, incl. CONNECT auth + dial), `handleBackendV5` (backend→client loop), `writeMqtt5Connack`, `maxV5PacketBytes` | none |
| `internal/app/server/inspect_v5.go` | **NEW.** `inspectV5Connect` (passthrough allowlist, `Verify`, cred swap, ConnTrack), `inspectV5Publish` (topic, envelope decode, `rememberGateway`, `inspectMeshtastic`), `logDownlinkV5` | none |
| `internal/app/server/proxy.go` | +1 dispatch branch at the preflight; optionally reimplement `writeMqtt5UnsupportedConnack` in terms of `writeMqtt5Connack` (byte-identical — `2003008400` verified) | one `if` before the backend dial |
| `internal/app/server/inspect.go` | `RawPacket` gains `MQTT5 *v5.ControlPacket`; `ConnectionInfo` gains `ProtocolVersion byte`; `RewritePayloadString`/`RemarshalEnvelope` gain a v5 branch; `logDownlink` split into a thin wrapper + `logDownlinkEnvelope(conn, socketAddr, payload []byte, topic string) bool` | additive fields + one extracted function; existing 3.1.1 call sites and `TestSelfEchoSuppression` unchanged |
| `internal/app/server/rules.go` | **REQUIRED:** nil-guard in `AllowMQTTControl` | see below |
| `go.mod` / `go.sum` / `vendor/` | +`paho.golang v0.22.0`, 17 vendored files | none (zero transitive upgrades) |

### The `rules.go` nil-guard is not optional

`AllowMQTTControl`'s matcher does `switch (*ip.Raw.MQTT).(type)`. On a v5 connection `Raw.MQTT` is `nil` and this **panics** — taking down the whole proxy process, not just the connection. `RewriteHopLimit` and `RewriteHelloGoodbye` already guard on `ip.Raw.Meshtastic == nil` and are safe. Required change:

```go
Matcher: func(ip *InspectorPacket) bool {
	if ip.Raw.MQTT == nil {          // v5 connections carry Raw.MQTT5 instead
		return false
	}
	switch (*ip.Raw.MQTT).(type) {
	// …unchanged…
	}
},
```

`Raw.MQTT` is never nil on the 3.1.1 path, so this is provably behavior-preserving for v4.

An alternative worth stating and rejecting: synthesizing a fake `paho.mqtt.golang` `PublishPacket` so the rules engine sees a familiar type. That reintroduces exactly the meshtk#22 bug class — rules would mutate the shim and the mutation would never reach the v5 wire. Do not do it.

### How `handleBackend` learns the version

`ConnTrack` is keyed by `socketAddr`, but the entry is **not created until the CONNECT is inspected**, and `handleBackend` is spawned *before* the CONNECT is read (`proxy.go:138`). A `ConnTrack` lookup would therefore race the very first downlink packet (the CONNACK). Two complementary moves:

1. **Pass the version explicitly.** In the recommended shape this is free: `handleProxyV5` spawns `handleBackendV5` directly, so no parameter threading is needed at all and `handleBackend`'s existing signature never changes. (If instead a single shared `handleBackend` is kept, add a `protoVer byte` parameter — additive, and the v4 call site passes `4`.)
2. **Also stamp `ConnectionInfo.ProtocolVersion`** for logging and for MQV5-01's literal wording. ⚠ `inspectRawPacket`'s CONNECT branch *replaces* `n.ConnTrack[socketAddr]` with a freshly constructed `ConnectionInfo` (`inspect.go:75-86`); `inspectV5Connect` must set `ProtocolVersion: 5` on the struct it builds, or the stamp is lost on the first CONNECT.

### v5 CONNECT parity checklist (mirror `inspect.go:74-125` exactly)

- [ ] `ConnectionInfo{ClientID, Username, Password: fmt.Sprintf("%x", pw), SocketAddress, ConnectTime, ProtocolVersion: 5}` written into `ConnTrack` under `ConnMutex`
- [ ] `n.Config.Server.CredCache.Passthrough` allowlist honored — matched usernames forward **original** creds untouched
- [ ] empty username ⇒ reject (fail closed) — v5 reason 0x87
- [ ] `Verify` under `context.WithTimeout(n.Config.Server.CredCache.TimeoutSecs)`
- [ ] `action=AUTH_REJECT, ip=…, username=…, reason=error|invalid` log lines kept verbatim so ops greps still work
- [ ] cred swap to `ProxyUsername`/`ProxyPassword` on success
- [ ] `AuthMethod != ""` ⇒ 0x8C **before** the backend dial
- [ ] `proxyReadTimeout(c.KeepAlive)` applied to the client socket; the backend socket keeps `defaultProxyReadTimeout` (only the uplink goroutine touches the client deadline — preserve that invariant, it was a past bug)
- [ ] `TopicAliasMaximum = nil`
- [ ] new `action=MQTT5_CONNECT, ip=…, username=…, client_id=…` info line so Android adoption is greppable (per CONTEXT "Specific Ideas")

### Downlink parity

`logDownlink(conn, socketAddr, pub *packets.PublishPacket)` takes the 3.1.1 type. Extract its body:

```go
func (n *ServerCmd) logDownlink(conn net.Conn, socketAddr string, pub *packets.PublishPacket) bool {
	return n.logDownlinkEnvelope(conn, socketAddr, pub.Payload, pub.TopicName)   // wrapper: behavior identical
}
func (n *ServerCmd) logDownlinkEnvelope(conn net.Conn, socketAddr string, payload []byte, topic string) (suppress bool) {
	/* …the existing body, with pub.Payload → payload and pub.TopicName → topic… */
}
```

`TestSelfEchoSuppression` calls `logDownlink` and keeps passing unchanged. The v5 backend loop calls `logDownlinkEnvelope` with the parsed `Publish.Payload`/`Publish.Topic` and, when it returns `true`, simply does not write the captured frame — self-echo suppression with no re-encode.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MQTT v5 properties encode/decode | A property-block parser | `paho.golang/packets` `Properties.Pack/Unpack` | 28 property IDs, per-packet-type validity table, VBI lengths, four wire encodings (byte/u16/u32/VBI/string/binary/string-pair) |
| Variable-byte integer | Custom varint | `readFrame` (framing only) + the library (everything else) | The library's `encodeVBI`/`decodeVBI` are already correct; the framing copy is 12 lines and must exist anyway to capture raw bytes |
| CONNACK bytes | `conn.Write([]byte{0x20,0x03,0x00,0x87,0x00})` | `writeMqtt5Connack(conn, v5.ConnackNotAuthorized)` | Verified byte-identical, but self-documenting and immune to reason-code typos. (The existing `writeMqtt5UnsupportedConnack` literal is correct — `2003008400` — so this is cleanup, not a fix) |
| Reason-code strings for logs | A `map[byte]string` | `Connack.Reason()` / `Disconnect.Reason()` | Spec text already in the library |
| Topic-alias resolution table | Per-connection alias→topic map | Suppress aliases at CONNECT/CONNACK | A proxy-side alias table must stay in lockstep with the broker's or the rules silently mis-key |
| MQTT v5 test client | Bespoke byte builders | `paho.golang/packets` itself, in the test | Round-trips cleanly and needs no network client dependency |

**Key insight:** the only thing this phase should hand-roll is *framing* — and only because framing is what lets it *avoid* parsing.

## Testing Recipe

### Unit (`internal/app/server`, style per `proxy_mqtt5_test.go` / `rules_hopclamp_test.go`)

Reuse the existing `writerConn` fake (`proxy_mqtt5_test.go:15-24`) for write-only assertions and `net.Pipe()` (per `proxy_selfecho_test.go:52`) where a real duplex conn is needed. Build v5 fixtures with `paho.golang/packets` itself.

Verified hex fixtures, ready to paste:

| Assertion | Expected bytes |
|-----------|----------------|
| CONNACK unsupported version (0x84) — regression, must not change | `2003008400` |
| CONNACK not authorized (0x87) | `2003008700` |
| CONNACK bad auth method (0x8C) | `2003008c00` |
| mosquitto default CONNACK (input fixture) | `200900000622000a210014` |
| …after `TopicAliasMaximum = nil` | `2006000003210014` |
| aliased uplink PUBLISH (must BLOCK) | `300b00000323000368656c6c6f` (empty topic, alias=3) |
| zero-length DISCONNECT (must relay verbatim) | `e000` |
| short PUBACK (must relay verbatim) | `40021234` |

Test list:

1. `TestReadFrameRoundTrip` — `e000`, `e00100`, `40021234`, `c000`, `d000`, and a >127-byte PUBLISH each come back byte-identical; back-to-back frames off one `bufio.Reader` split correctly.
2. `TestV5ConnectCredSwapPreservesProperties` — encode a mqttastic-shaped CONNECT (SessionExpiry, ReceiveMaximum, TopicAliasMaximum, MaximumPacketSize, one User property), run the swap, re-parse: username==`public`, password==`31337`, clientID unchanged, `TopicAliasMaximum==nil`, all other properties intact. Assert the original client password never appears in the output bytes.
3. `TestV5ConnectNoMutationIsByteIdentical` — parse→re-encode with no edits equals the input (guards against future codec drift).
4. `TestV5ConnackReasonCodes` — the four hex fixtures above.
5. `TestV5EnhancedAuthRejected` — CONNECT with `Properties.AuthMethod="SCRAM-SHA-1"` ⇒ `2003008c00` and **no backend dial**.
6. `TestV5PublishRewriteReachesTheWire` — the meshtk#22 lesson, ported: hop-clamp a v5 PUBLISH, decode the **re-encoded wire payload**, assert `HopLimit==3`/`HopStart==7`, and assert topic, QoS bits (`0x32`), PacketID `0x1234`, MessageExpiry and User properties all survived.
7. `TestV5PublishUnchangedIsByteIdentical` — a sane packet forwards the captured frame unmodified.
8. `TestV5TopicAliasBlocked` — empty topic + `TopicAlias` ⇒ Block.
9. `TestAllowMQTTControlNilRawMQTT` — the panic guard: an `InspectorPacket` with `Raw.MQTT == nil` must return false, not panic. (Would have crashed the process.)
10. `TestV4PathUnchanged` — MQV5-05's byte-identity proof: replay a captured 3.1.1 CONNECT/PUBLISH/SUBSCRIBE/PINGREQ session and assert the forwarded bytes match a golden fixture generated from the pre-change binary. Generate the golden **before** touching anything.

### Local end-to-end (MQV5-06) — recipe already executed

Homebrew mosquitto is present and is the fastest path; docker `alpine:3.21` matches prod exactly.

```bash
# Backend (matches prod auth shape: password_file + no anonymous)
mosquitto_passwd -c -b /tmp/mqv5/passwd public 31337
cat > /tmp/mqv5/mosq.conf <<'EOF'
listener 18840 127.0.0.1
allow_anonymous false
password_file /tmp/mqv5/passwd
log_dest stdout
log_type all
persistence false
EOF
/opt/homebrew/sbin/mosquitto -c /tmp/mqv5/mosq.conf
# prod-identical alternative:
#   docker run --rm -p 18840:1884 -v /tmp/mqv5:/mosquitto/config <run.mqtt mosquitto image>
```

Then point `Server.ProxyForwardAddress` at `127.0.0.1:18840` and drive the proxy with two clients in one run — a v5 client built from `paho.golang/packets` and a 3.1.1 client built from `paho.mqtt.golang/packets`. Verified expectations (all observed in this session's prototype):

| Step | Expected | Where to confirm |
|------|----------|------------------|
| v5 CONNECT, bad creds | client receives `2003008700`; **no** mosquitto connection log | proxy log `action=AUTH_REJECT` |
| v5 CONNECT, `AuthMethod` set | client receives `2003008c00` | proxy log, before dial |
| v5 CONNECT, good creds | client receives `2006000003210014` (alias max stripped) | mosquitto: `New client connected … (p5, c1, k60, u'public')` — **`u'public'` proves the swap** |
| v5 SUBSCRIBE | SUBACK `900400010000` relayed raw | mosquitto `Received SUBSCRIBE` |
| v5 QoS0 PUBLISH, no rewrite | forwarded byte-exact | mosquitto `Received PUBLISH … q0` |
| v5 QoS1 PUBLISH + rewrite | mosquitto `Received PUBLISH … q1, m8738` (packet id preserved) and `Sending PUBACK … (m8738, rc0)` back to the right client | both logs |
| v5 downlink | subscriber receives a PUBLISH with the **full topic** and no alias | client parse |
| v5 PINGREQ `c000` | `d000` back | relayed raw |
| v5 `e000` DISCONNECT | mosquitto `Received DISCONNECT … Client … disconnected.` (graceful, not a socket error) | mosquitto log |
| 3.1.1 client in the same run | unaffected: connects, publishes, receives | both logs |

A meshtasticd sim can be layered on for a real ServiceEnvelope, but the ServiceEnvelope path is already covered by the unit tests (hop clamp + payload rewrite) — the e2e's job is the protocol plumbing.

### Prod verification (MQV5-07)

- Raw v5 CONNECT via `python3` ssl socket to `mqtt.defcon.run:4433` with **real** creds must now return `2003008700`→ no: must return a **success CONNACK** (`2000…`/`2006…`) instead of today's `2003008400`. With deliberately wrong creds it must return `2003008700` (not `2003008400`) — that alone proves the v5 codec is live.
- `MQTT5_REJECT` lines stop appearing for protocol level 5; new `MQTT5_CONNECT` lines appear.
- `action=ALLOW` 3.1.1 fleet lines continue uninterrupted across the deploy window in `/ecs/run-mqtt-meshtk-run-mqtt-use1-dc34`.

## Risks & Mitigations

### R-1 (HIGH) — This worktree's vendored meshtk is 36 commits stale; a naive vendor-sync would REVERT #22 and #23 in production

`git rev-list --count HEAD..origin/main` = **36**. `apps/run.mqtt/meshtk/VERSION` here is `v0.0.66`; `origin/main` has `v0.0.70`. The local vendored `proxy.go` contains **zero** occurrences of `peekConnectProtocolVersion` and the local vendored `inspect.go` contains **zero** occurrences of `RemarshalEnvelope` — i.e. this tree predates both the hop-clamp fix and the v5 honest-reject. `[VERIFIED: git show origin/main:… vs local]`

**Mitigation:** branch the monorepo work from `origin/main` (or a fresh worktree), never from `release/2026-07-26-230957`. Before committing the vendor-sync, assert `grep -c peekConnectProtocolVersion apps/run.mqtt/meshtk/internal/app/server/proxy.go` ≥ 1 and `grep -c RemarshalEnvelope …/inspect.go` ≥ 1.

### R-2 (HIGH) — `vendor/` is git-tracked in BOTH repos; forgetting `go mod vendor` breaks the container build

`vendor/modules.txt` is tracked (`git check-ignore` returns non-zero) in `~/working/meshtk` **and** in `apps/run.mqtt/meshtk/`. Go auto-selects `-mod=vendor` when `vendor/modules.txt` exists, and `Dockerfile.meshtk` does `COPY . .` (no `.dockerignore`), so the image build uses the vendored tree. A commit with an updated `go.mod` but a stale `vendor/` fails the Docker build with `inconsistent vendoring`.

**Mitigation:** the upstream PR must include `go.mod`, `go.sum`, `vendor/modules.txt`, and `vendor/github.com/eclipse/paho.golang/**` (17 files + LICENSE). The vendor-sync to the monorepo must copy the same set. Verify with a clean `go build ./...` from the monorepo copy.

### R-3 (HIGH) — `AllowMQTTControl` nil-derefs on v5 packets and panics the whole process

See § Seam Recommendation. A panic in `handleProxy` is not per-connection — it takes the server down. **Mitigation:** the nil-guard, plus test #9.

### R-4 (MEDIUM) — Topic aliases silently blind every topic-based rule

mosquitto advertises alias max 10 by default. **Mitigation:** strip in both directions + runtime BLOCK guard (§ Topic Alias Handling).

### R-5 (MEDIUM) — Struct-mutation-without-re-encode (the meshtk#22 bug class) recurring on the v5 path

`RewritePayloadString` and `RemarshalEnvelope` currently end in `switch p := (*ip.Raw.MQTT).(type) { case *packets.PublishPacket: p.Payload = … }`. With `Raw.MQTT == nil` on a v5 connection this **panics**; if instead the switch simply doesn't match, the rewrite is a silent no-op and hop-clamp/censoring quietly stops working for Android users. **Mitigation:** a single `setPublishPayload(b []byte) error` helper that dispatches on which of `Raw.MQTT`/`Raw.MQTT5` is non-nil and returns an error if neither is; both rewrite functions call it. Plus test #6, which asserts on the **re-encoded wire bytes**, not the struct.

### R-6 (MEDIUM) — Re-encoding downlink would corrupt multi-subscription-identifier PUBLISHes

`Properties.SubscriptionIdentifier` is a single `*int` but v5 permits several. **Mitigation:** never re-encode downlink PUBLISH — relay the captured frame. The downlink path only needs `Payload`+`Topic` for `logDownlinkEnvelope`, both available from a read-only parse.

### R-7 (MEDIUM) — Strict property parsing tears down connections on an unmodeled property

`Properties.Unpack` returns `unknown Prop type %d` for any ID outside its table, and rejects properties not valid for that packet type. **Mitigation:** frame-capture means only CONNECT/CONNACK/PUBLISH are parsed; and on a parse error, **log and forward the raw frame** rather than closing (for PUBLISH/CONNACK). For CONNECT a parse error should still fail closed — an unparseable CONNECT cannot be authenticated.

### R-8 (LOW–MEDIUM) — Unbounded allocation from the remaining-length field

`readFrame` doing `make([]byte, remLen)` allows a 256 MiB allocation from 5 attacker-controlled bytes. Note this is **not a regression**: `paho.mqtt.golang`'s `ReadPacket` already does `make([]byte, fh.RemainingLength)` with no cap on the live 3.1.1 path. `[VERIFIED: source read]` **Mitigation:** cap at `maxV5PacketBytes` (256 KiB is generous — mosquitto enforces `message_size_limit 1024` on payloads) and drop the connection above it. Applying the cap only to the v5 path leaves 3.1.1 untouched, satisfying the stability rule.

### R-9 (LOW) — Keepalive/read-deadline drift between the two loops

The existing comments in `proxy.go` record a past outage: `handleBackend` used to set the deadline on the **client** socket, racing the uplink loop. **Mitigation:** in `handleProxyV5`/`handleBackendV5`, preserve the invariant exactly — only the uplink goroutine touches `conn`'s read deadline (`proxyReadTimeout(keepalive)`, floor 60s, default 180s); the downlink goroutine only touches `backendConn`'s (`defaultProxyReadTimeout`).

### R-10 (LOW) — `paho.mqtt.golang` and `paho.golang` name collision in a shared file

Both export a `ControlPacket` (interface vs struct) and a `Connect`/`Publish`. **Mitigation:** alias the v5 import (`v5 "github.com/eclipse/paho.golang/packets"`) in every file that imports both — realistically only `inspect.go`. `[VERIFIED: both build together]`

### R-11 (LOW) — `ConnectionInfo.ProtocolVersion` lost when the CONNECT branch replaces the ConnTrack entry

`inspect.go:75-86` constructs a brand-new `ConnectionInfo` and overwrites the map entry. **Mitigation:** set `ProtocolVersion: 5` inside `inspectV5Connect`'s constructor; do not rely on a pre-stamped entry surviving.

### R-12 (LOW) — Immutable ECR + release mechanics

Standing repo landmines apply: ECR repos are immutable so the Release PR's VERSION bump must produce a new tag; a worktree release needs `env.local.sh` copied to the worktree root first; `apps/run.mqtt/meshtk/**/embedded.go` must be verified untouched after the vendor-sync (it lives at `internal/embedded/gpx/embedded.go`). `[CITED: AGENTS.md + CONTEXT.md]`

## Common Pitfalls

### Pitfall 1: Parsing every packet with `ReadPacket`
**What goes wrong:** zero-length DISCONNECTs kill the connection with `EOF` instead of being relayed; PUBACK/DISCONNECT get silently re-encoded into longer forms; one unmodeled property drops a client.
**Why it happens:** `ReadPacket` is the obvious API and it *looks* like the 3.1.1 call site it replaces.
**How to avoid:** capture the frame first; parse a copy of the bytes; parse only CONNECT, CONNACK, PUBLISH.
**Warning signs:** mosquitto logging ungraceful disconnects; connection counts churning; `unknown Prop type` in logs.

### Pitfall 2: Mutating the parsed struct and forwarding the original bytes (or vice versa)
**What goes wrong:** the hop clamp / payload rewrite is a silent no-op — exactly meshtk#22.
**How to avoid:** in the v5 loop the choice is explicit: forward `frame` **or** forward `cp.WriteTo(...)`, never both paths for the same packet. Assert on wire bytes in tests.
**Warning signs:** a rewrite rule reports `Rewrote` but the broker logs the original payload length.

### Pitfall 3: Assuming `Publish.Topic` is always populated
**What goes wrong:** topic rules and `msh/...` logs go blind under topic aliasing.
**How to avoid:** strip `TopicAliasMaximum` in both directions and BLOCK on `TopicAlias != nil`.

### Pitfall 4: Taking `paho.golang@latest`
**What goes wrong:** a 62-file `x/net`/`x/sys`/`x/crypto` vendor upgrade lands in the same PR as the protocol change, making a bisect useless if prod misbehaves.
**How to avoid:** pin `v0.22.0`.

### Pitfall 5: Editing shared helpers instead of extending them
**What goes wrong:** changing `logDownlink`'s signature or `inspectRawPacket`'s switch breaks the 3.1.1 byte-identity claim and the existing tests.
**How to avoid:** wrapper + extracted core (`logDownlinkEnvelope`); new `inspect_v5.go` rather than new cases in `inspectRawPacket`.

### Pitfall 6: Asserting on `FixedHeader.Flags` after `WriteTo`
**What goes wrong:** it reads `0x32` for a QoS1 PUBLISH, not `0x02`.
**How to avoid:** assert on the encoded bytes.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Go toolchain | build/test | ✓ | go1.25.5 darwin/arm64 (module targets go 1.24.1) | — |
| `github.com/eclipse/paho.golang` | v5 codec | ✓ | v0.22.0 downloaded + vendored + built + tested | — |
| Docker | prod-identical mosquitto e2e | ✓ | Server 29.6.1 | Homebrew mosquitto |
| mosquitto (local) | e2e broker | ✓ | 2.0.22 (`/opt/homebrew/sbin/mosquitto`) | docker `alpine:3.21` → 2.0.20 |
| `mosquitto_pub`/`mosquitto_sub`/`mosquitto_passwd` | e2e fixtures | ✓ | 2.0.22 | — |
| meshtk upstream repo | code under change | ✓ | `~/working/meshtk` @ `92bd986` (#24), clean tree, `go build ./...` + `go test ./internal/app/server/...` green | — |
| `gh` CLI / AWS profile `dc34-application` | release + prod verify | assumed present per AGENTS.md | — | — |

**Missing dependencies with no fallback:** none
**Missing dependencies with fallback:** none

## Security Domain

`security_enforcement` is not disabled in `.planning/config.json`, so this section applies. (`workflow.nyquist_validation` is `false`, so the Validation Architecture section is omitted.)

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | **yes** | Existing `Authenticator.Verify` (DynamoDB-backed cred cache, bcrypt) reused verbatim on the v5 path — no new auth logic. Fail-closed on empty username and on unparseable CONNECT |
| V3 Session Management | partial | Per-connection state only (`ConnTrack`, keyed by socket addr, 180s purge). v5 adds `ProtocolVersion`; no session tokens |
| V4 Access Control | **yes** | Credential swap to the `public` identity is the authorization boundary — mosquitto's `acl.conf` governs the swapped identity. **Client creds must never reach mosquitto**; assert this in test #2 by scanning the forwarded bytes |
| V5 Input Validation | **yes** | `paho.golang/packets` for all v5 decoding (never hand-parse); `readFrame` length cap; topic-alias BLOCK guard; protobuf `proto.Unmarshal` for the envelope (already in place) |
| V6 Cryptography | partial | AES-CTR channel decryption unchanged (`DecryptMeshtastic`); no new crypto |
| V7 Error Handling & Logging | **yes** | Keep the `action=…, ip=…, username=…` log grammar; never log the client password (existing code stores it hex-encoded in `ConnectionInfo` — do not widen that) |

### Known Threat Patterns for a v5-capable MQTT inspecting proxy

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Protocol-confusion cred bleed (v5 CONNECT parsed as 3.1.1 ⇒ clientID read as username) | Spoofing / Information Disclosure | The whole point of the phase: version-correct codec chosen at the preflight. This is a *live* defect class already observed in prod |
| Topic-alias evasion of topic rules | Tampering / Elevation of Privilege | Strip `TopicAliasMaximum` both directions + BLOCK on `TopicAlias`/empty topic |
| Memory exhaustion via remaining-length | Denial of Service | Cap `remLen` in `readFrame` (`maxV5PacketBytes`); mosquitto's `message_size_limit 1024` is a second layer |
| Panic-as-DoS (nil `Raw.MQTT` in a rule matcher) | Denial of Service | `rules.go` nil-guard; a panic in `handleProxy` takes the whole process, not one connection |
| Client credential leakage to the broker | Information Disclosure | Cred swap before the first backend write; byte-scan assertion in tests |
| Enhanced-auth (AUTH packet) downgrade/confusion | Spoofing | Reject `AuthMethod` at CONNECT with 0x8C **before** dialing the backend; never relay an AUTH packet into an authenticated session |
| Unbounded connection churn from a rejecting client | Denial of Service | Out of scope here (rate limiter deliberately disabled for the con) — but note the v5 reject path returns *before* the backend dial, so a retry-looping client costs no broker connection |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | mqttastic 0.7.0 does not use topic aliases on uplink | Topic Alias Handling | Low — the recommended CONNACK strip makes aliasing impossible regardless, and the BLOCK guard makes a violation loud |
| A2 | mqttastic tolerates a CONNACK with no `TopicAliasMaximum` property | Topic Alias Handling | Low — absent means "0", the spec default; a client that requires the property would be non-conformant. Confirmed only against the spec, not against the APK |
| A3 | mqttastic does not use MQTT 5 enhanced auth (`AuthMethod`) | MQV5-03 | Medium — if it did, every Android client would get 0x8C. Detectable immediately in the first prod log line after deploy; mosquitto itself would also reject it |
| A4 | mqttastic does not rely on `SessionExpiryInterval > 0` / persistent sessions across proxy restarts | Seam | Low — the proxy is 1:1 and stateless; mosquitto has `persistence false` today, so this is already the 3.1.1 status quo |
| A5 | Meshtastic ServiceEnvelopes over v5 stay under mosquitto's `message_size_limit 1024` | Backend findings | Low — same limit already applies to the 3.1.1 fleet in production |
| A6 | `gh`/AWS release tooling and profiles are configured as AGENTS.md describes | MQV5-07 | Low — standing practice, exercised repeatedly |
| A7 | Prod `mqtt.defcon.run:4433` fronting (NLB + PROXY protocol) is transparent to protocol version | Backend findings | Low — PROXY protocol v2 is a pre-stream header, version-agnostic; the v0.0.70 preflight already reads v5 CONNECTs through it in prod |

## Open Questions

1. **Does mqttastic negotiate anything the proxy should mirror (Receive Maximum, Session Expiry, Maximum Packet Size)?**
   - What we know: the proxy relays the client's CONNECT properties to mosquitto unchanged except `TopicAliasMaximum`, and relays mosquitto's CONNACK properties back except `TopicAliasMaximum`. Flow control (`ReceiveMaximum=20`) is therefore negotiated end-to-end correctly and the proxy does not need to track in-flight counts.
   - What's unclear: whether mqttastic sets `SessionExpiryInterval > 0` and expects session resumption.
   - Recommendation: do nothing. `persistence false` on mosquitto means sessions never survive a broker restart today either; if Android reconnect behavior looks odd during UAT, capture a real CONNECT from the APK and revisit.

2. **Should `RewriteHelloGoodbye`-style rewrites apply to v5 clients at all?**
   - What we know: the rule keys off `Track.Username == "public"`; after the cred swap the tracked username is the *client's* original, so behavior matches 3.1.1.
   - Recommendation: keep identical semantics; do not special-case v5.

3. **QoS>0 flow: anything beyond opaque relay?**
   - What we know: PUBACK relayed raw returns to the correct client with the packet id intact (`m8738` verified end-to-end). Because connections are 1:1 and the proxy never originates a PUBLISH, no packet-id remapping is needed.
   - Recommendation: opaque relay, matching the 3.1.1 path — this is what CONTEXT already directs.

4. **Keep `MQTT5_REJECT` for level > 5 only, or also emit it for parse failures?**
   - Recommendation: keep `MQTT5_REJECT` strictly for genuinely unsupported protocol levels (so the existing ops grep keeps its meaning), and add distinct actions: `MQTT5_CONNECT` (success), `MQTT5_PARSE_FAIL`. Small, and makes the Android adoption curve measurable as CONTEXT asks.

## Sources

### Primary (HIGH confidence)
- `github.com/eclipse/paho.golang` v0.22.0 and v0.23.0 — full source of `packets/` read from the module cache; `go doc -all`; `go list -deps`; behavior confirmed by executing 20+ encode/decode/round-trip cases this session
- mosquitto 2.0.22 (local) and 2.0.20 (`alpine:3.21`, prod image base) — live v5 CONNECT/CONNACK/SUBSCRIBE/PUBLISH/PUBACK/DISCONNECT exchanges, broker logs captured
- Working dual-codec proxy prototype executed against real mosquitto — all of MQV5-02/03/04's behaviors demonstrated end-to-end
- `~/working/meshtk` @ `5d08bb6`: `proxy.go`, `inspect.go`, `rules.go`, `decider.go`, `authenticator.go`, `cmd.go`, and all five existing test files, read in full
- `apps/run.mqtt/{mosquitto,meshtk,nginx}/` — Dockerfiles, `entrypoint.sh`, `acl.conf`, `nginx.conf`, VERSION files
- Dry-run dependency integration against a clone of the meshtk repo: `go get` / `go mod tidy` / `go mod vendor` / `go build ./...` / `go test ./internal/app/server/...` for both candidate versions
- `git show origin/main:…` vs local worktree — vendored-snapshot staleness

### Secondary (MEDIUM confidence)
- `raw.githubusercontent.com/eclipse-paho/paho.golang/{v0.20.0,v0.21.0,v0.22.0,v0.23.0}/go.mod` — upstream dependency requirements per tag
- MQTT 5.0 OASIS specification, §3.1 CONNECT / §3.2 CONNACK / §3.3 PUBLISH / §3.14 DISCONNECT — structural and default-value claims (topic-alias defaults, zero-length DISCONNECT legality, multiple subscription identifiers)

### Tertiary (LOW confidence)
- mqttastic (MQTTastic-Client-KMP 0.7.0) client behavior — inherited from CONTEXT's evidence base and not independently re-derived; see Assumptions A1–A4

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — both candidate versions downloaded, vendored, built and tested inside a real meshtk clone; dependency deltas measured, not estimated
- Library API: **HIGH** — every signature read from source; every claimed behavior executed
- Wire format / gotchas: **HIGH** — all four codec quirks reproduced with hex output
- Backend (mosquitto): **HIGH** — live broker, both versions, logs captured
- Seam recommendation: **HIGH** for the mechanics (nil-deref, ConnTrack race, vendor tracking all verified against the actual source); **MEDIUM** for the exact file split, which is Claude's-discretion territory
- Topic alias: **HIGH** for the risk and both fixes; **MEDIUM** for whether mqttastic would ever have triggered it
- Testing recipe: **HIGH** — the e2e was executed, not designed on paper

**Research date:** 2026-07-29
**Valid until:** 2026-08-28 (30 days — paho.golang and mosquitto 2.0.x are both slow-moving; re-check the paho.golang version pin if a v0.24.0 appears)
