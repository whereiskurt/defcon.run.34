---
phase: 68-mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa
reviewed: 2026-07-29T17:40:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - apps/run.mqtt/meshtk/internal/app/server/inspect.go
  - apps/run.mqtt/meshtk/internal/app/server/inspect_v5.go
  - apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go
  - apps/run.mqtt/meshtk/internal/app/server/proxy_v5_e2e_test.go
  - apps/run.mqtt/meshtk/internal/app/server/proxy_v5_parity_test.go
  - apps/run.mqtt/meshtk/internal/app/server/proxy_v5_rawpublish.go
  - apps/run.mqtt/meshtk/internal/app/server/proxy_v5_rawpublish_test.go
  - apps/run.mqtt/meshtk/internal/app/server/rules.go
findings:
  critical: 3
  warning: 13
  info: 0
  total: 16
status: issues_found
---

# Phase 68: Code Review Report

**Reviewed:** 2026-07-29T17:40:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

**Code under review:** the shipped final state of the phase — the v5 parity fixes
(upstream meshtk PR #27 @ `5769031`, vendored as monorepo `74e98f34`, live as
meshtk **v0.0.73**). The eight files were read from `origin/main`; a byte-identical
working copy of the upstream module (which has `go.mod` + `vendor`, so it compiles)
was used to **execute** probes. Every finding marked PROVEN below is backed by
runtime output, not inspection.

## Summary

The dual-codec seam is the strongest part of this phase and the parity fixes are
real: `readFrame` framing is correct (varint terminated at 4 bytes, size cap
checked *before* `make`), `parseV5PublishFrame` is a genuinely property-agnostic
walker that closes CR-04/PROBE-A, `spliceV5PublishPayload` preserves unmodelled
property bytes a codec round-trip could not, and `touchConnTrack` before type
dispatch closes the CR-02 reaper race for the keepalive values the fleet actually
uses. The shipped test suite passes clean, including `-race`
(`go test -race ./internal/app/server/` → ok, 1.5s), and its wire-byte assertion
discipline is above average.

What it did **not** do is close the two criticals the previous review of v0.0.72
already found in the *shared* rewrite helpers — a remote whole-process kill and
silent mesh data loss. Both are still in the shipped binary, both are reachable
from the new v5 path as well as the old 3.1.1 one, and both are re-proven by
execution below (CR-01, CR-03). A third bypass the prior review under-classified
as a warning is proven here to be a complete circumvention of the RF flood-radius
control the phase's own comments call the reason `RewriteHopLimit` exists (CR-02).

The new code also introduces defects of its own. The CR-04 fix built a second
PUBLISH path that is documented as mirroring its sibling "decision for decision"
and does not: it omits the topic-alias guard (WR-01, proven). The WR-04 fix relays
an unparseable SUBSCRIBE uninspected, re-opening the same
codec-dependent-inspection hole one layer up (WR-04). And both new relay paths
hand mosquitto frames the proxy knows are malformed per MQTT 5.0 §2.2.2 — the
phase's own e2e test asserts the broker responds by disconnecting the client
(WR-03).

Finally, the telemetry this phase's verification leaned on (37/38, "real Android
v5 sessions + ALLOW publishes in telemetry") is forgeable: client-controlled
`client_id` / `username` / `auth_method` are written unescaped through
`SimpleFormatter`, which does no quoting. One CONNECT produced two log lines in a
probe (WR-05).

## Narrative Findings (AI reviewer)

### Critical Issues

#### CR-01: Any authenticated client kills the whole proxy process with one plaintext text message (nil cipher dereference) — BLOCKER

**File:** `apps/run.mqtt/meshtk/internal/app/server/rules.go:152-173`, `apps/run.mqtt/meshtk/internal/app/server/inspect.go:348-383` (crash at `inspect.go:368`)

**Issue:** `RewriteHelloGoodbye` fires on any `TEXT_MESSAGE_APP` packet with a
non-nil `Decoded` and no PKI flag, then calls `ip.RewritePayloadString()`
unconditionally (`rules.go:170`) — the word-replacement is gated on
`Username == "public"` but the rewrite call is not. `RewritePayloadString`
dereferences `*ip.Meshtastic.Cipher` (`inspect.go:368`). `Cipher` is only set when
`inspectMeshtastic` had to *decrypt* the packet (`inspect.go:217`); a packet that
arrives with a **decoded** (unencrypted) payload leaves it nil. There is no
`recover()` anywhere in the proxy path (`grep -rn "recover()"` across
`internal/app`, `internal/credcache`, `pkg` → only `internal/app/fleet/otpsend.go`
and two test files), so the panic kills the process, dropping every connected
radio, not one connection.

**PROVEN.** Driving one v5 PUBLISH carrying a decoded `TEXT_MESSAGE_APP`
`ServiceEnvelope` through `handleV5PublishUplink`:

```
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x2 addr=0x0]
server.(*InspectorPacket).RewritePayloadString(...)  inspect.go:368
server.LoadInspectorRules.rewriteRules.func2(...)    rules.go:170
server.(*RuleBasedDecider).Decide(...)               decider.go:38
server.(*ServerCmd).decideV5Publish(...)             proxy_v5.go:403
server.(*ServerCmd).handleV5PublishUplink(...)       proxy_v5.go:374
```

The reachability was known to the authors and routed around rather than fixed —
`proxy_v5_publish_test.go:66-68` picks NODEINFO because it is "unlike a
TEXT_MESSAGE, one the rules engine judges without needing a channel cipher", and
`proxy_v5_e2e_test.go:576-581` states outright that "a TEXT_MESSAGE payload
reaches RewritePayloadString, which dereferences a nil cipher and panics on a
non-encrypted packet". No test asserts the non-crash.

**Fix** (three independent layers, all cheap):

```go
// rules.go — do not enter a rewrite that cannot be performed.
Matcher: func(ip *InspectorPacket) bool {
    if ip.Raw.Meshtastic == nil || ip.Raw.Meshtastic.Packet == nil ||
        ip.Meshtastic.Decoded == nil ||
        ip.Meshtastic.Decoded.Portnum != meshtastic.PortNum_TEXT_MESSAGE_APP ||
        ip.Meshtastic.WasPKIEncrypted ||
        !ip.Meshtastic.WasEncrypted || ip.Meshtastic.Cipher == nil { // NEW
        return false
    }
    ...
    if err := ip.RewritePayloadString(); err != nil { // see WR-08
        ip.Log.Errorf("payload censor failed: %v", err)
        return false
    }
    return true
}

// inspect.go — never dereference; report.
func (ip *InspectorPacket) RewritePayloadString() error {
    if ip.Meshtastic.WasPKIEncrypted {
        return fmt.Errorf("cannot rewrite: packet is PKI encrypted")
    }
    if ip.Meshtastic.Cipher == nil {
        return fmt.Errorf("cannot rewrite: no channel cipher for this packet")
    }
    ...
}

// proxy.go / proxy_v5.go — a bug in one connection must not be fleet-wide.
go func(c net.Conn) {
    defer func() {
        if r := recover(); r != nil {
            n.Config.Log.Errorf("panic serving %s: %v\n%s",
                c.RemoteAddr(), r, debug.Stack())
            c.Close()
        }
    }()
    n.handleProxy(c)
}(conn)
```

Add a regression test that publishes a decoded `TEXT_MESSAGE_APP` envelope on
**both** codecs and asserts the connection survives.

---

#### CR-02: A Last Will bypasses the entire inspection chain — unclamped hop_limit=7 broadcasts reach the mesh on demand — BLOCKER

**File:** `apps/run.mqtt/meshtk/internal/app/server/inspect_v5.go:23-114` (v5 CONNECT inspector), `apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go:178-186` (CONNECT re-encode/forward); same hole on 3.1.1 at `inspect.go:98-149`

**Issue:** `inspectV5Connect` inspects exactly three things on a CONNECT —
`Properties.AuthMethod`, the credentials, and `Properties.TopicAliasMaximum`. The
Will flag, Will topic, Will properties and **Will payload** are re-encoded into
the CONNECT and handed to mosquitto untouched (`proxy_v5.go:178-186`). mosquitto
publishes that payload on disconnect, so it never traverses
`handleV5PublishUplink`, never reaches `inspectV5Publish`, never reaches
`PacketDecider.Decide`, and is never touched by `RewriteHopLimit`,
`BlockInvalidEncryption` or the payload censor. `RewriteHopLimit`'s own comment
(`rules.go:119-127`) states the reason it exists: "every downlink-enabled radio is
an MQTT→RF gateway that rebroadcasts broadcasts with the packet's hop budget, so
one uplink with hop_limit 7 gets amplified across the whole con mesh." A Will is a
client-chosen, uninspected uplink on any topic, replayable by reconnect-and-drop.

**PROVEN.** A v5 CONNECT with `WillTopic = msh/US/2/e/dc.run/!435990e4` and a Will
`ServiceEnvelope{HopLimit: 7, HopStart: 9, Decoded: TEXT_MESSAGE_APP "flood via
will"}` driven through the real `handleProxyV5`:

```
bytes forwarded to broker: 140
CONFIRMED: the Will ServiceEnvelope (hop_limit=7 / hop_start=9) reached the
           broker inside the CONNECT, never inspected by the rules engine
CONFIRMED: unencrypted Will text payload passed through with no censor and no
           hop clamp
```

The prior review filed this as `WR-17` ("forwarded uninspected on both codecs").
It is not a warning: it is a total bypass of the phase's stated RF-safety control,
remotely triggerable by any credential holder, and cheap to repeat.

**Fix:** strip or inspect the Will at CONNECT time. Stripping is one line and
loses nothing the fleet uses (Meshtastic firmware and mqttastic do not rely on
MQTT Wills):

```go
// inspect_v5.go, before the CONNECT is forwarded:
if c.WillFlag {
    n.InspectorLogger.Warnf("action=MQTT5_WILL_STRIPPED, ip=%s, username=%s, will_topic=%s",
        socketAddr, connInfo.Username, sanitize(c.WillTopic))
    c.WillFlag, c.WillTopic, c.WillMessage, c.WillProperties = false, "", nil, nil
    c.WillQOS, c.WillRetain = 0, false
}
```

Mirror it in the 3.1.1 CONNECT branch (`inspect.go:98`, `p.WillFlag` et al.). If
Wills must be supported later, route `WillMessage` through `inspectMeshtastic` +
`PacketDecider` and refuse the CONNECT on a Block.

---

#### CR-03: Every rewritten TEXT_MESSAGE silently loses reply_id, emoji, dest, source, request_id and want_response — BLOCKER

**File:** `apps/run.mqtt/meshtk/internal/app/server/inspect.go:356-361`

**Issue:** `RewritePayloadString` rebuilds the `Data` message from three fields:

```go
rewritten := &meshtastic.Data{
    Portnum:  ip.Meshtastic.PortNum,
    Payload:  []byte(ip.Meshtastic.PayloadString),
    Bitfield: ip.Meshtastic.Decoded.Bitfield,
}
```

`proto.Marshal` of a fresh struct emits only what was set, so every other `Data`
field on the original packet is dropped and re-encrypted away. Because
`RewriteHelloGoodbye` calls this for **every** text message (see CR-01 — the call
is not gated on the username), this is fleet-wide, not limited to censored
messages: 2.8 tapbacks (`emoji`), threaded replies (`reply_id`), delivery-ACK
requests (`want_response`), and the DM routing fields (`dest`, `source`,
`request_id`) all vanish between the sender and the mesh.

**PROVEN.** A `Data` carrying all six fields, run through `RewritePayloadString`
with a real cipher and decrypted back off the wire:

```
wire Data: portnum=TEXT_MESSAGE_APP payload="hi there" bitfield=<set>
           want_response=false dest=0x0 source=0x0 request_id=0x0
           reply_id=0x0 emoji=0
FIELD LOST across the rewrite: want_response, dest, source, request_id,
                               reply_id, emoji
```

The `Bitfield:` line was added by *this* phase (to stop 2.8 radios dropping the
packet), which shows the field-loss class was understood; the fix enumerated one
field instead of preserving the message.

**Fix:** mutate the decoded message in place instead of rebuilding it, so
everything — including protobuf unknown fields — survives:

```go
d := ip.Meshtastic.Decoded
d.Payload = []byte(ip.Meshtastic.PayloadString)
dataBytes, err := proto.Marshal(d)
if err != nil {
    return fmt.Errorf("failed to marshal rewritten Data: %w", err)
}
```

(The current code also discards `proto.Marshal`'s error with `_` on line 361.)
Add a test that round-trips a `Data` with all optional fields set and asserts
byte-level equality of everything but `payload`.

---

### Warnings

#### WR-01: The hand-parsed PUBLISH path omits the topic-alias guard the codec path has — the documented "decision for decision" parity is false — WARNING

**File:** `apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go:332-335` vs `apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go:368-371`

**Issue:** The codec path Blocks on
`(p.Properties != nil && p.Properties.TopicAlias != nil) || p.Topic == ""`. The
hand-parsed path checks only `rp.Topic == ""` — `parseV5PublishFrame` skips the
property block whole, so an alias property is invisible to it. `inspectV5RawPublish`
claims it "mirrors its sibling decision for decision" (`inspect_v5.go:158-162`);
it does not.

**PROVEN.** A QoS0 PUBLISH with `TopicAlias=7` (id `0x23`) *plus* unmodelled id
`0x7f` (to force the raw path), topic `a/b`:

```
action=MQTT5_PARSE_FAIL ... reason=invalid Prop type 127 for packet 3
[proxy] ALLOW from=!435990e4 to=!ffffffff type=NODEINFO_APP topic=[a/b] user=publisher
DIVERGENCE: a PUBLISH carrying a TopicAlias property was allowed on the
hand-parsed path (the codec path Blocks it)
```

Blast radius is bounded today — a *blank* topic is still Blocked on both paths, and
68-01 strips `TopicAliasMaximum` in both directions so mosquitto grants no alias
budget — which is why this is a warning and not a blocker. But it is a security
guard missing on one of two paths through the same control, and the asymmetry is
exactly the shape of CR-04.

**Fix:** have the parser report alias presence without reintroducing a property
table — a single id comparison inside the block it already walks past:

```go
// parseV5PublishFrame, while skipping the property block:
for q := pos; q < pos+propLen; { /* minimal id/len walk */ }
// or, cheaper and sufficient given no alias budget is ever granted:
rp.HasProperties = propLen > 0
```

then Block in `handleV5PublishUplink` on `rp.HasTopicAlias` (or, per WR-03, refuse
frames carrying unmodelled properties outright, since the broker will anyway).

---

#### WR-02: An unparseable v5 CONNECT is dropped with no CONNACK — the client cannot tell why and hot-retries — WARNING

**File:** `apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go:135-146`

**Issue:** `v5.ReadPacket` failing on the CONNECT logs `MQTT5_PARSE_FAIL` and
`return`s. `handleProxy`'s deferred `conn.Close()` drops the socket with **no
CONNACK at all**. Since `Properties.Unpack` hard-errors on any property id outside
paho.golang's table (the premise of the whole CR-04 fix), a client that adds one
unmodelled CONNECT property gets a silent TCP close. `proxy_v5_e2e_test.go:736-741`
states the standard for this exact situation: mqttastic "retries every 5-25s
forever". Answering nothing is the failure mode this phase was created to remove
(0x84 retry-looping), reintroduced one layer down.

**PROVEN.** A CONNECT with protocol level 5 and property id `0x7f` is refused by
`v5.ReadPacket` while `peekConnectProtocolVersion` still returns `(5, true)` — so
it routes to `handleProxyV5` and takes this branch.

**Fix:** answer before returning, on all three CONNECT failure branches
(`:125`, `:139`, `:144`):

```go
writeMqtt5Connack(conn, v5.ConnackMalformedPacket) // 0x81
return
```

---

#### WR-03: Both new relay paths hand mosquitto frames the proxy knows are malformed, and the broker kills the session — WARNING

**File:** `apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go:317-355` (raw PUBLISH), `apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go:225-236` (SUBSCRIBE parse-fail)

**Issue:** MQTT 5.0 §2.2.2 makes an unrecognised property id a **Malformed
Packet**. The proxy inspects such a frame (good) and then relays it (bad). The
phase's own e2e test documents the consequence and asserts it:

```go
// proxy_v5_e2e_test.go:1164-1165
waitForLog(t, "mosquitto", h.broker.logs, brokerMark,
    "Client "+rawPublishClientID+" disconnected due to malformed packet", ...)
```

So the client loses its whole session anyway — the proxy just makes the broker do
the killing, with no v5 reason code reaching the client and an
`action=ALLOW` line in the log for a packet that was never routed. The inspection
value of CR-04's fix is real; the relay is not.

**Fix:** after inspection, either strip the offending property bytes and forward a
clean frame, or refuse locally with `writeMqtt5Disconnect(conn, 0x81)` and log
`action=BLOCK, reason=malformed_properties`. Either way the client gets a reason
code and the ALLOW log stops claiming a delivery that did not happen.

---

#### WR-04: An unparseable v5 SUBSCRIBE is relayed uninspected — the WR-04 hole is re-opened one layer up — WARNING

**File:** `apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go:225-236`, test `apps/run.mqtt/meshtk/internal/app/server/proxy_v5_parity_test.go:637-667`

**Issue:** WR-04 was closed so that "topic rules" stopped meaning "topic rules for
3.1.1 clients". But a SUBSCRIBE the codec cannot read is relayed to the broker
without reaching `inspectV5Subscribe` or `PacketDecider` (accepted risk
T-68-06-05). The exemption is bought with the same three client-chosen bytes as
CR-04, and the property-agnostic walker that fixed CR-04 for PUBLISH was not
extended to SUBSCRIBE — where the wire format is *even simpler* (packet id,
property block, then a list of length-prefixed filters). The risk note is honest
that no topic Block rule exists today; the defect is that the first one added will
silently not apply to these frames.

**Fix:** add `parseV5SubscribeFrame` alongside `parseV5PublishFrame` (same
skip-the-property-block technique) so `MQTT.Topics` is always populated, and keep
the relay. Failing that, log at a level that will actually be noticed and add a
test asserting the decider is reached.

---

#### WR-05: Client-controlled strings are written unescaped into the security log — the phase's own verification telemetry is forgeable — WARNING

**File:** `apps/run.mqtt/meshtk/internal/app/server/inspect_v5.go:52-53`, `apps/run.mqtt/meshtk/internal/app/server/inspect_v5.go:112-113`; formatter at `apps/run.mqtt/meshtk/internal/app/server/cmd.go:331-334`

**Issue:** `client_id`, `username` and `auth_method` come straight off the wire and
go straight into `InspectorLogger` format strings. Production uses
`SimpleFormatter`, which is `fmt.Sprintf("%s %s\n", timestamp, entry.Message)` —
no quoting, no escaping. A newline in a client id therefore forges arbitrary log
lines in the file that is rotated to S3 and grepped for `action=AUTH_REJECT`,
`action=MQTT5_CONNECT` and `action=ALLOW`. Phase 68's verification is literally
"37/38 … ALLOW publishes in telemetry".

**PROVEN.** One CONNECT with
`ClientID = "evil\n2026-07-29 00:00:00.000 action=AUTH_REJECT, ip=10.0.0.1, username=admin, reason=invalid"`:

```
2026-07-29 17:24:20.461 action=MQTT5_CONNECT, ip=203.0.113.7:50000, username=victim, client_id=evil
2026-07-29 00:00:00.000 action=AUTH_REJECT, ip=10.0.0.1, username=admin, reason=invalid
LOG INJECTION: one CONNECT produced 2 log lines
```

(Tests use logrus' `TextFormatter`, which quotes — which is why no test caught it.)

**Fix:** sanitize at the boundary and use it everywhere a client string is logged
(both codecs):

```go
func logSafe(s string) string {
    if len(s) > 128 { s = s[:128] }
    return strconv.Quote(strings.Map(func(r rune) rune {
        if r == '\n' || r == '\r' || r < 0x20 { return -1 }
        return r
    }, s))
}
```

---

#### WR-06: The CR-02 ConnTrack fix is incomplete — the reaper window is shorter than the client silence the proxy tolerates — WARNING

**File:** `apps/run.mqtt/meshtk/internal/app/server/inspect.go:500-507` (`touchConnTrack`), `apps/run.mqtt/meshtk/internal/app/server/inspect.go:509-530` (reaper), `apps/run.mqtt/meshtk/internal/app/server/proxy.go:45-54` (`proxyReadTimeout`)

**Issue:** `touchConnTrack` is deliberately update-if-exists, and the reaper
deletes any entry idle `> 180s`. But the uplink loop tolerates
`1.5 × keepalive` of client silence with **no upper bound**
(`proxyReadTimeout`). For any negotiated keepalive above 120s the tolerated
silence exceeds the reaper window: the entry is purged while the session is
healthy, the next PUBLISH is judged with an empty `Track.Username`, and
`RequireMQTTUserName` Blocks it and drops the socket — the precise CR-02 symptom,
for a different reason. The fix holds for keepalive ≤ 120s (mqttastic's 60s
included), which is why prod verification passed.

**Fix:** derive the two numbers from one place. Either cap the read timeout at the
reaper window, or make the reaper window a function of it:

```go
const connTrackIdleTTL = 2 * defaultProxyReadTimeout // 360s, > any tolerated silence
// and in SetupTracker: if now-connInfo.ConnectTime > int64(connTrackIdleTTL/time.Second)
```

Better still: delete entries on connection close only (`handleProxy` already does
this in its defer) and treat the reaper as a leak backstop, not a liveness gate.

---

#### WR-07: The v5 downlink loop dies silently and does not end the session; the `ctx.Done()` selects are dead code — WARNING

**File:** `apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go:443-454`, `apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go:188-192`

**Issue:** `handleBackendV5` returns on any `readFrame` error without calling
`cancel()`, closing `conn`, or logging anything. `cancel` is only invoked by
`handleProxyV5`'s own `defer`, so `case <-ctx.Done()` in **both** loops can never
fire while the other is running — dead code in both. Consequence: if the backend
read fails (or the fixed `defaultProxyReadTimeout` 180s deadline on
`backendConn` expires while the client's tolerance is `1.5 × keepalive`, i.e. any
keepalive > 120s), downlink stops permanently while the client keeps a session it
believes is subscribed. Radios silently stop receiving DMs and ACKs with no log
line. This mirrors the 3.1.1 `handleBackend`, so it is inherited rather than
invented — but it is new code that copied it.

**Fix:**

```go
func (n *ServerCmd) handleBackendV5(ctx context.Context, cancel context.CancelFunc, ...) {
    defer cancel()            // uplink's select now means something
    ...
    frame, pktType, err := readFrame(backendReader)
    if err != nil {
        n.Config.Log.Warnf("[proxy] downlink ended ip=%s err=%v", socketAddr, err)
        return
    }
```

and derive the backend deadline from the same keepalive the uplink uses.

---

#### WR-08: `RewritePayloadString`'s error is discarded by its only caller, and its second return value is a constant — WARNING

**File:** `apps/run.mqtt/meshtk/internal/app/server/rules.go:170`, `apps/run.mqtt/meshtk/internal/app/server/inspect.go:348-383`

**Issue:** The signature is `(error, bool)` — reversed from Go convention — and the
`bool` is `false` on every return path, so it carries no information. The only
caller ignores both (`ip.RewritePayloadString()` as a bare statement) and returns
`true`/`Rewrote` regardless. So when `setPublishPayload` fails, the parsed
envelope has been mutated and re-encrypted, the rule reports `Rewrote`, and the
**original bytes go to the broker** — the meshtk#22 silent-no-op this phase's
comments (`inspect.go:300-313`) say must never be possible again. `RewriteHopLimit`
gets this right (`rules.go:142-145`); the censor does not.

**Fix:** `func (ip *InspectorPacket) RewritePayloadString() error`, and at the call
site `if err := ip.RewritePayloadString(); err != nil { ip.Log.Errorf(...); return false }`.

---

#### WR-09: Fail-open remnant and fabricated log fields on the PUBLISH paths — WARNING

**File:** `apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go:357-361`, `apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go:323-326`

**Issue:** Two smaller contradictions of the stated fail-closed posture:

1. `:357-361` — if `cp.Content` is not a `*v5.Publish`, the frame is relayed with
   **no inspection at all** (`return n.writeToBackend(backendConn, frame)`), two
   lines after the hand-parse arm was added specifically to stop that. The arm is
   effectively unreachable (the fixed header already said type 3), which is the
   argument for making it `return false` rather than the one remaining
   relay-an-uninspected-PUBLISH path in the file.
2. `:324-325` — the header-fail BLOCK line hardcodes `from=!00000000
   to=!00000000 user=""`. Those are the fields ops filter and aggregate on;
   emitting synthetic zeros pollutes them. Log the real unknowns as absent
   (`from=unknown`) or omit the mesh fields entirely, as `WriteDecisionLog` does
   when `WasUnmarshalled` is false.

**Fix:** make the `!ok` arm `return false` with a `MQTT5_PUBLISH_HEADER_FAIL`-style
line, and drop the fake `0, 0, ""` arguments.

---

#### WR-10: Policy Blocks close the socket with no v5 DISCONNECT, while protocol violations get one — WARNING

**File:** `apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go:251`, `apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go:334`, `apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go:370`, `apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go:419`

**Issue:** CR-03's fix correctly answers illegal frames with
`DISCONNECT 0x82`, but a Block decision (`BlockInvalidEncryption`,
`RequireMQTTUserName`, the topic-alias guard) just returns and lets the deferred
`conn.Close()` drop the socket. To a v5 client that is indistinguishable from a
network fault, so mqttastic reconnects immediately and can loop — the flap
signature this phase spent three plans chasing. v5 exists precisely to make this
diagnosable.

**Fix:** `writeMqtt5Disconnect(conn, v5.DisconnectNotAuthorized)` (0x87) or
`DisconnectAdministrativeAction` (0x98) before returning on a Block, mirroring the
violation path.

---

#### WR-11: Write-only `ProtocolVersion` with a doc contract the code never satisfies; `v5RawPublish.QoS` read only by tests — WARNING

**File:** `apps/run.mqtt/meshtk/internal/app/server/inspect.go:83-86`, `apps/run.mqtt/meshtk/internal/app/server/inspect_v5.go:36`, `apps/run.mqtt/meshtk/internal/app/server/proxy_v5_rawpublish.go:23-25`

**Issue:** `ConnectionInfo.ProtocolVersion` documents itself as "4 = 3.1.1, 5 = v5"
and is set to `5` in exactly one place (`inspect_v5.go:36`). The 3.1.1 CONNECT
branch never sets it, so it stays `0` for every 3.1.1 connection, and **no
production code reads it at all** (`grep -rn ProtocolVersion *.go | grep -v _test`
→ only the write and the comment; 19 references, all in tests). Any future
consumer writing `if info.ProtocolVersion == 4` — the contract the comment
promises — will mis-classify the entire 3.1.1 fleet. Same shape, lower stakes:
`v5RawPublish.QoS` is populated but never read outside tests.

**Fix:** set `ProtocolVersion: 4` in the 3.1.1 CONNECT branch (one line, makes the
comment true), or delete the field until something reads it. Tests asserting a
write-only field assert nothing.

---

#### WR-12: `inspect.go` is not gofmt-clean — WARNING

**File:** `apps/run.mqtt/meshtk/internal/app/server/inspect.go:47-50`

**Issue:** `gofmt -l internal/app/server/` lists `inspect.go` (along with
pre-existing `cmd.go`, `inspect_auth_test.go`, `proxy_mqtt5_test.go`). The
misalignment is in the `Meshtastic` struct fields this phase's predecessor added
(`WasEncrypted` / `WasPKIEncrypted` / `HadEncryptedPayload`). CI runs
`go build/vet/test` (per the vendor commit message) and would not catch it — which
matters for a repo whose sync discipline is byte-parity with upstream, since any
contributor's editor will reformat the file and create phantom diffs.

**Fix:** `gofmt -w internal/app/server/` and add `gofmt -l . | tee /dev/stderr | wc -l | grep -qx 0` to the CI gate.

---

#### WR-13: Test-suite defects — an unreachable assertion, duplicated helpers, and no coverage of the known crash — WARNING

**File:** `apps/run.mqtt/meshtk/internal/app/server/proxy_v5_parity_test.go:299-317`, `apps/run.mqtt/meshtk/internal/app/server/proxy_v5_parity_test.go:48-63`, `apps/run.mqtt/meshtk/internal/app/server/proxy_v5_e2e_test.go:91-116`, `apps/run.mqtt/meshtk/internal/app/server/proxy_v5_e2e_test.go:162-175`, `apps/run.mqtt/meshtk/internal/app/server/proxy_v5_e2e_test.go:147-153`

**Issue:** Five items that weaken the safety net this phase relies on:

1. **Dead assertion.** In `assertRefused`, `bytes.Equal(backend, establishing)`
   already `t.Fatalf`s on mismatch, so the following
   `if extra := backend[len(establishing):]; len(extra) != 0` can never be reached
   with a non-empty slice. It reads like a second, stronger check and is not one.
2. **Duplicated helper.** `syncBuf` (parity test) and `syncBuffer` (e2e test) are
   the same mutex-wrapped `bytes.Buffer` in the same package, with divergent APIs
   (`Bytes()` vs `String()/Len()/since()`).
3. **Dead field.** `pairAuthenticator.calls` is incremented under a mutex and
   never read — the assertion it was presumably for ("the authenticator was
   consulted exactly once") is missing.
4. **Fixed-sleep negative assertion.** `assertNoLog(..., 500*time.Millisecond)`
   proves absence by sleeping; under a loaded CI box it can pass while the broker
   line is still in flight. The positive assertions all poll (`waitForLog`) —
   the negative ones should poll for a *subsequent* positive marker instead.
5. **The crash is uncovered.** Two helper comments
   (`proxy_v5_publish_test.go:66-68`, `proxy_v5_e2e_test.go:576-581`) document the
   CR-01 nil-cipher panic and pick fixtures that avoid it. No test asserts a
   plaintext `TEXT_MESSAGE_APP` publish is survivable on either codec, so the
   suite is green with a remote process-kill in the shipped binary.

**Fix:** delete (1) or replace it with a length assertion made *before* the
equality check; unify (2) into one helper; assert or delete (3); make (4) poll for
a happens-after marker; and add the missing case for (5) as part of the CR-01 fix.

---

## Verification notes

- Files were read from `origin/main` (the shipped overlay). A working copy of the
  upstream module at `5769031` was confirmed byte-identical for `rules.go`,
  `inspect.go` and `proxy_v5.go` (`diff` → no output) before any probe was run.
- The shipped suite is green and race-clean:
  `go test ./internal/app/server/` → ok 0.37s;
  `go test -race ./internal/app/server/` → ok 1.48s.
- Probes were written as throwaway `_test.go` files in a **scratch copy** outside
  the repository and removed before the suite was re-run. No repository file was
  modified by this review.
- Out-of-scope-but-adjacent, carried forward from the prior review and still
  present in shipped code: the `kphkphkph` client-ID inspection bypass
  (`proxy.go:182`), rate limiting fully disabled (`proxy.go:190-201`),
  `maxV5PacketBytes` deliberately not applied to the 3.1.1 codec
  (`proxy_v5.go:21-23` — the path the whole fleet uses is still an unbounded
  allocation), channel-key selection accepting the first key whose plaintext
  happens to parse as protobuf (`inspect.go:281-298`), and the self-echo check
  trusting a publisher-supplied gateway id (`proxy.go:325`).

---

_Reviewed: 2026-07-29T17:40:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
