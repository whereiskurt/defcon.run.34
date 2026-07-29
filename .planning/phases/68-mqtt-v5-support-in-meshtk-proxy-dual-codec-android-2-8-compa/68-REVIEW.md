---
phase: 68-mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa
reviewed: 2026-07-29T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - /Users/khundeck/working/meshtk/internal/app/server/proxy.go
  - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5.go
  - /Users/khundeck/working/meshtk/internal/app/server/inspect.go
  - /Users/khundeck/working/meshtk/internal/app/server/inspect_v5.go
  - /Users/khundeck/working/meshtk/internal/app/server/rules.go
  - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5_test.go
  - /Users/khundeck/working/meshtk/internal/app/server/proxy_v4_golden_test.go
  - /Users/khundeck/working/meshtk/internal/app/server/inspect_v5_test.go
  - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5_publish_test.go
  - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5_e2e_test.go
  - /Users/khundeck/working/meshtk/internal/app/server/testdata/mosquitto.e2e.conf
findings:
  critical: 5
  warning: 18
  info: 0
  total: 23
status: issues_found
---

# Phase 68: Code Review Report

**Reviewed:** 2026-07-29
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found
**Repo under review:** `/Users/khundeck/working/meshtk` @ `c5341ce` (deployed as meshtk v0.0.72)

## Summary

The dual-codec seam itself is well built: `readFrame` framing is correct (varint bounds, size cap checked before `make`), the v4 golden pins the 3.1.1 wire bytes, and the "capture-then-parse, forward exactly once" discipline in `handleV5PublishUplink` genuinely closes the meshtk#22 no-op class *for parseable packets*. Tests pass (`go test ./internal/app/server/` OK) and are unusually honest about wire-level assertions.

What the phase did **not** do is carry the 3.1.1 path's *implicit* invariants across the seam. Three of the five criticals are behaviours the v4 loop got for free (ConnTrack refresh on every packet, CONNECT re-inspection, fail-closed parsing) that the v5 sibling loop silently lost — and one of them (CR-02) will drop live Android sessions on a timer. Two more criticals (CR-01, CR-05) live in the shared rewrite helpers touched by this phase and affect **both** codecs: one is a remote process-kill, one is silent mesh data loss.

Four findings were proven by execution, not inspection, using a `go test -overlay` probe that added no files to the repo (working tree verified clean afterwards). Probe output is quoted inline.

## Critical Issues

### CR-01: Any client can kill the whole proxy process with one plaintext text message (nil cipher dereference)

**File:** `internal/app/server/rules.go:150`, `internal/app/server/inspect.go:353`, reached from `internal/app/server/proxy_v5.go:236` and `internal/app/server/proxy.go:188`

**Issue:** `RewriteHelloGoodbye` matches any `TEXT_MESSAGE_APP` packet that is decoded and not PKI-encrypted, then calls `ip.RewritePayloadString()` **unconditionally** — including when the packet arrived *already decoded* (a plaintext `MeshPacket_Decoded` envelope, which any MQTT client may publish). For such a packet `inspectMeshtastic` never runs the decrypt path, so `ip.Meshtastic.Cipher` is `nil`, and `inspect.go:353` does `cipher.NewCTR(*ip.Meshtastic.Cipher, nonce)` → nil pointer dereference.

`handleProxy` runs in a bare `go func(c net.Conn){ n.handleProxy(c) }(conn)` (`cmd.go:207-209`) with **no `recover()` anywhere in the package** — a panic in one connection terminates the entire broker-front process, i.e. the whole mesh backhaul at con.

The e2e file even documents the hazard rather than fixing it (`proxy_v5_e2e_test.go:577-581`: *"a TEXT_MESSAGE payload reaches RewritePayloadString, which dereferences a nil cipher and panics on a non-encrypted packet"*) and then routes the fixture around it, so no test covers it.

**Proven:**
```
PROBE-1 CONFIRMED: panic on plaintext TEXT_MESSAGE: runtime error: invalid memory address or nil pointer dereference
```
(driven through `handleV5PublishUplink` with a decoded `TEXT_MESSAGE_APP` envelope; identical on the v4 path via `PacketDecider.Decide`)

**Fix:** Guard the matcher and make the helper defensive, and add a recover to the connection goroutine.
```go
// rules.go — RewriteHelloGoodbye matcher
if ip.Meshtastic.Cipher == nil || !ip.Meshtastic.WasEncrypted {
    return false // nothing to re-encrypt; a plaintext payload needs a plaintext rewrite path
}

// inspect.go — RewritePayloadString, before use
if ip.Meshtastic.Cipher == nil {
    return fmt.Errorf("cannot rewrite: no cipher (packet was not channel-encrypted)"), false
}

// cmd.go — accept loop
go func(c net.Conn) {
    defer func() {
        if r := recover(); r != nil {
            n.Config.Log.Errorf("panic in connection handler: %v\n%s", r, debug.Stack())
            _ = c.Close()
        }
    }()
    n.handleProxy(c)
}(conn)
```

---

### CR-02: v5 connections are torn down on a timer — only PUBLISH refreshes ConnTrack, the reaper purges at 180s, and the next publish is Blocked

**File:** `internal/app/server/proxy_v5.go:189-195` (non-PUBLISH frames relayed with no `SetConnTrack`), `internal/app/server/inspect.go:486-492` (reaper), `internal/app/server/rules.go:61-68` (`RequireMQTTUserName`)

**Issue:** The 3.1.1 loop calls `n.SetConnTrack(ip)` on **every** packet type — PUBLISH, SUBSCRIBE, PINGREQ, PINGRESP and the `default:` branch (`inspect.go:145,160,166,169,173`) — so a keepalive PINGREQ refreshes `ConnectTime`. The v5 loop only reaches `SetConnTrack` through `inspectV5Publish` (`inspect_v5.go:147`); PINGREQ/SUBSCRIBE/PUBACK are written straight to the backend at `proxy_v5.go:192`.

`SetupTracker`'s reaper (started in `NewServer`, `cmd.go:63`) deletes any entry with `now - ConnectTime > 180`. A v5 client that publishes less often than ~3 minutes — the normal Meshtastic cadence, position ~15 min, NodeInfo hours — loses its ConnTrack entry while its keepalive pings sail past untracked. Its next PUBLISH then builds `Track = &ConnectionInfo{SocketAddress: …}` with an empty `Username`, `RequireMQTTUserName` Blocks, `handleV5PublishUplink` returns false, and `handleProxyV5` closes the socket. The client reconnect-loops; the published packet is lost; `GatewayID` is lost so self-echo suppression silently degrades too.

This is exactly the "42 CONNECTs in 30 minutes / device is flapping" failure the file header warns about, reintroduced for Android 2.8 only.

**Proven:**
```
PROBE-2: after purge handleV5PublishUplink=false forwarded=0 bytes
PROBE-2 CONFIRMED: connection dropped after ConnTrack purge
```

**Fix:** Refresh the tracker for every v5 frame, mirroring v4.
```go
// proxy_v5.go, in the uplink loop before the raw relay
n.touchConnTrack(socketAddr) // ConnMutex.Lock; if e, ok := n.ConnTrack[socketAddr]; ok { e.ConnectTime = time.Now().Unix() }
if _, err := backendConn.Write(frame); err != nil { … }
```
Belt-and-braces: make the purge a no-op for live sockets by keying eviction off connection close (the `handleProxy` defer already deletes the entry) rather than off a 180s idle timer.

---

### CR-03: A second CONNECT (or an AUTH) on a v5 session is relayed verbatim — the client's own credentials are forwarded to the broker

**File:** `internal/app/server/proxy_v5.go:189-195`

**Issue:** `handleProxyV5` re-encodes the *first* CONNECT precisely so the captured frame — which *"still carries the client's own credentials"* (`proxy_v5.go:154-155`) — never reaches mosquitto. Every subsequent frame that is not a PUBLISH is relayed as captured bytes. `v5.CONNECT` is not a PUBLISH, so a second CONNECT is forwarded **with the client's plaintext username and password**, uninspected and unverified.

The same branch also relays `AUTH` (the comment at `proxy_v5.go:189-191` lists it explicitly), directly contradicting the security invariant asserted in `inspect_v5.go:42-45`: *"an AUTH packet must never be relayed into an authenticated session."*

The 3.1.1 path has no such hole: a second CONNECT re-enters `inspectRawPacket`, is re-authenticated and cred-swapped (`inspect.go:90-142`).

Practical blast radius is bounded by mosquitto closing on a duplicate CONNECT, but the credential material still crosses the proxy→broker socket and can land in broker-side captures/logs, and the divergence defeats the phase's own stated invariant.

**Fix:** Whitelist what may be relayed rather than blacklisting PUBLISH.
```go
switch pktType {
case v5.PUBLISH:
    if !n.handleV5PublishUplink(backendConn, socketAddr, frame) { return }
    continue
case v5.CONNECT, v5.AUTH:
    n.InspectorLogger.Warnf("action=MQTT5_PROTOCOL_VIOLATION, ip=%s, mqtt_type=%d", socketAddr, pktType)
    writeMqtt5Connack(conn, v5.ConnackProtocolError) // or just close
    return
case v5.SUBSCRIBE, v5.UNSUBSCRIBE, v5.PUBACK, v5.PUBREC, v5.PUBREL, v5.PUBCOMP, v5.PINGREQ, v5.DISCONNECT:
    // relay
default:
    // relay or drop, but decide it explicitly
}
```

---

### CR-04: One unmodeled property byte disables every inspection control on the v5 path

**File:** `internal/app/server/proxy_v5.go:207-217`

**Issue:** On a `v5.ReadPacket` failure the PUBLISH is relayed raw and the function returns true, skipping — in order — the topic-alias guard (`:229`), `inspectV5Publish`, `PacketDecider.Decide`, the hop clamp, the payload censor and every Block rule. `paho.golang`'s `Properties.Unpack` hard-errors on **any** property id outside its table, so a client only has to append `02 7f 00` to its properties block to become permanently uninspectable. This is fail-**open** on the exact control (`RewriteHopLimit`) that exists to stop fleet-wide RF flood amplification, plus `BlockInvalidEncryption` and any future ACL rule.

The trade-off is documented as accepted risk T-68-02-06, but the accepted risk was framed as *"relaying an odd packet"*; what it actually buys an attacker is a total inspection bypass, and it is trivially discoverable (the repo's own test fixture `300a0003616263027f006869` demonstrates the technique).

**Proven:**
```
PROBE-4: forwarded=true identical=true
PROBE-4 CONFIRMED: hop_limit=7 reached the broker unclamped via one unmodeled property.
  action=MQTT5_PARSE_FAIL, ip=203.0.113.7:50000, mqtt_type=PUBLISH, reason=invalid Prop type 127 for packet 3
```

**Fix:** Do not let a properties-parse failure buy an inspection exemption. Minimum viable: hand-parse the PUBLISH variable header (topic + property-block length are trivially skippable without knowing any property id), then run the topic/alias guard and inspect the payload; relay raw only when even the fixed header/topic cannot be extracted. Alternative: keep the raw relay but count/alarm it and rate-limit it per connection, so a client that "cannot be parsed" more than N times in a window is dropped rather than exempted.

---

### CR-05: Every rewritten TEXT_MESSAGE loses reply_id, emoji, dest, source, request_id and want_response

**File:** `internal/app/server/inspect.go:341-345`, triggered from `internal/app/server/rules.go:150`

**Issue:** `RewritePayloadString` rebuilds the inner `Data` from scratch with only three fields:
```go
rewritten := &meshtastic.Data{Portnum: …, Payload: …, Bitfield: …}
```
`meshtastic.Data` also carries `WantResponse`, `Dest`, `Source`, `RequestId`, `ReplyId`, `Emoji` (mesh.pb.go:1810-1828) plus `unknownFields`. All are silently dropped on re-encrypt. Because `RewriteHelloGoodbye` calls the helper **unconditionally** (the word substitutions are gated on `Username == "public"`, the rewrite is not), this happens to *every* channel-encrypted text message traversing the proxy from any user — including reply threading (`reply_id`), emoji reactions (`emoji`), and multihop routing metadata (`dest`/`source`) on DMs.

The commit that added `Bitfield` here fixed exactly this class of bug for one field (2.8 pre-hop drop); the other six are still gone.

**Proven:**
```
PROBE-3 CONFIRMED: reply_id/emoji/dest/source/request_id/want_response dropped
 orig=portnum:TEXT_MESSAGE_APP payload:"hi" want_response:true dest:3735928559 source:4277009102 request_id:42 reply_id:99 emoji:1 bitfield:1
 new =portnum:TEXT_MESSAGE_APP payload:"hi" bitfield:1
```

**Fix:** Mutate the decoded message in place instead of rebuilding it — protobuf-go then preserves every modelled *and* unknown field, the same property `RemarshalEnvelope` already relies on:
```go
d := proto.Clone(ip.Meshtastic.Decoded).(*meshtastic.Data)
d.Payload = []byte(ip.Meshtastic.PayloadString)
dataBytes, err := proto.Marshal(d)
if err != nil { return fmt.Errorf("marshal rewritten Data: %w", err), false }
```
And skip the whole re-encrypt when nothing changed (`PayloadString` byte-equal to `Decoded.Payload`).

## Warnings

### WR-01: The payload censor swallows its own failure and still reports Rewrote

**File:** `internal/app/server/rules.go:150-152`
**Issue:** `ip.RewritePayloadString()` returns `(error, bool)` and both results are discarded; the matcher returns `true` regardless. If the rewrite fails (PKI guard, `setPublishPayload` type error, marshal error) `WireRewritten` stays false and the *original* bytes are forwarded while the rule reports `Rewrote` — the meshtk#22 silent-no-op the phase set out to eliminate, still live in the censor.
**Fix:** `if err, _ := ip.RewritePayloadString(); err != nil { ip.Log.Errorf("censor rewrite failed: %v", err); return false }`. Also normalise the signature to `(bool, error)`; `(error, bool)` inverts Go convention and the bool is always `false`.

### WR-02: `proto.Marshal` error discarded before encryption

**File:** `internal/app/server/inspect.go:346`
**Issue:** `dataBytes, _ := proto.Marshal(rewritten)` — on error this encrypts and publishes a zero-length payload, producing an undecodable packet with no log line.
**Fix:** Check and return the error (see CR-05 fix).

### WR-03: CONNACK re-encode failure silently restores the broker's topic-alias budget

**File:** `internal/app/server/proxy_v5.go:318-328`
**Issue:** `if _, werr := pk.WriteTo(&out); werr == nil { frame = out.Bytes() }` — when `werr != nil` the original CONNACK (still advertising `TopicAliasMaximum=10`) is forwarded with no log at all, re-arming the exact blinding the strip exists to prevent. Silent fallbacks on security controls are how the control quietly stops existing.
**Fix:** Log at Warn (`action=MQTT5_CONNACK_REENCODE_FAIL`) and consider dropping the connection rather than granting the alias budget.

### WR-04: v5 SUBSCRIBE and all non-PUBLISH control packets never reach the decider or any log

**File:** `internal/app/server/proxy_v5.go:189-195`
**Issue:** The 3.1.1 path runs `PacketDecider.Decide` on every packet and records `MQTT.Topics` for SUBSCRIBE (`inspect.go:159-163`). The v5 path relays them blind, so any topic-scoped subscribe rule added later silently applies to iOS/firmware only, and there is zero v5 subscribe observability (the e2e verifies the SUBACK from mosquitto's log, not the proxy's).
**Fix:** Parse SUBSCRIBE (it round-trips cleanly), build an `InspectorPacket` with `MQTT.Type="SUBSCRIBE"` + topics, and run it through the decider; relay the captured frame unless a rule mutates it.

### WR-05: Suppressing a QoS>0 downlink without acknowledging it stalls the broker's inflight window

**File:** `internal/app/server/proxy.go:262-266`, `internal/app/server/proxy_v5.go:336-352`
**Issue:** Self-echo suppression is implemented as "do not write the frame". For a QoS1/QoS2 downlink that means the broker never receives a PUBACK/PUBREC, keeps the message inflight and retransmits with DUP forever, and the proxy suppresses each retransmission — an unbounded retransmit loop per suppressed message. Harmless while every subscription is QoS0; a single QoS1 subscription (the v5 e2e already publishes at QoS1) makes it real.
**Fix:** When suppressing a PUBLISH with QoS > 0, synthesise the acknowledgement to the broker (`PUBACK` with the packet id for QoS1) instead of dropping silently.

### WR-06: Downlink loop exit leaves a half-open connection; the `ctx.Done()` selects are dead code

**File:** `internal/app/server/proxy.go:150-154,242-247`, `internal/app/server/proxy_v5.go:166-170,293-298`
**Issue:** `ctx` is cancelled only by the uplink function's own `defer cancel()`, so the `select { case <-ctx.Done(): … default: }` in both loops can never fire from the peer's side — it is unreachable in the downlink goroutines and pure noise in the uplink ones. When `handleBackend[V5]` returns (broker closed, oversize frame, read error) nothing closes `conn` or cancels `ctx`; the uplink loop keeps a client socket alive with no downlink path for up to `readTimeout` (180s), during which the radio believes it is connected and its publishes are one-way.
**Fix:** `defer cancel()` + `defer conn.Close()` in the downlink goroutine, or a shared `ctx` cancelled by whichever side dies first. Then delete the `select` scaffolding or make it meaningful.

### WR-07: Credential swap sets Username/Password but not the CONNECT flags

**File:** `internal/app/server/inspect_v5.go:96-97` (and `inspect.go:139-140`)
**Issue:** `paho.golang` encodes the password only `if c.PasswordFlag` (`vendor/.../packets/connect.go:73-78`). A CONNECT with `UsernameFlag=true, PasswordFlag=false` that authenticates (possible if a stored credential is empty) is forwarded as user `proxy` with **no** password; mosquitto rejects it and the proxy logs a successful `MQTT5_CONNECT` — an unfalsifiable "auth passed but the session dies" report.
**Fix:** Set `c.UsernameFlag = true; c.PasswordFlag = true` alongside the swap on both codecs.

### WR-08: The client's password is kept in memory for the life of the connection, hex-encoded, and a test asserts a false safety property

**File:** `internal/app/server/inspect_v5.go:30-36`, `internal/app/server/inspect.go:95`, `internal/app/server/proxy_v5_test.go:609-615`
**Issue:** `Password: fmt.Sprintf("%x", c.Password)` is not redaction — hex is a reversible encoding of the plaintext, retained in a long-lived process-wide map. Any future `%+v` of a `ConnectionInfo` (or an admin endpoint that dumps ConnTrack) leaks the credential. The comment *"the plaintext must not reach any log line"* and the test `if strings.Contains(info.Password, v5TestPassword)` create confidence the encoding does not earn.
**Fix:** Do not store it. If a fingerprint is needed for debugging, store `sha256(password)[:8]` and rename the field `PasswordFingerprint`.

### WR-09: Hardcoded client-ID inspection bypass (`kphkphkph`)

**File:** `internal/app/server/proxy.go:180-184`
**Issue:** `if strings.Contains(strings.ToLower(ip.Track.ClientID), "kphkphkph") { shouldInspect = false }` — the client ID is entirely client-controlled, so any authenticated (or passthrough) client that knows or guesses this string skips *all* rules, including the hop clamp and every Block. It is a shared-secret backdoor in a public-facing service, marked only by a `// TODO: Build this out as an actual ALLOW_LIST`.
**Fix:** Key the exemption off the authenticated username against a configured allowlist (`Config.Server.InspectExempt`), never off a client-supplied identifier; or delete it.

### WR-10: Stale comment claims the v5 PUBLISH path "fails closed" when it fails open

**File:** `internal/app/server/proxy_v5.go:96`
**Issue:** *"v5 PUBLISH inspection lands in plan 68-02 and fails closed until it does"* — 68-02 shipped and the parse-failure path fails **open** (CR-04). A reader auditing the security posture from the header comment reaches the opposite conclusion from the code 100 lines below.
**Fix:** Update the header to state the actual posture and cross-reference T-68-02-06.

### WR-11: Channel-key selection accepts the first key whose plaintext happens to parse as protobuf

**File:** `internal/app/server/inspect.go:274-291`
**Issue:** `DecryptMeshtastic` XORs with each configured key and accepts whichever yields bytes `proto.Unmarshal` does not reject. There is no MIC, and protobuf accepts many byte strings (including empty), so a wrong key can "succeed" — after which `BlockInvalidEncryption` does not fire, rules judge garbage fields, and if the censor path runs the packet is **re-encrypted under the wrong key**, corrupting it for its real recipients.
**Fix:** Constrain acceptance: require `PortNum` to be a known enum value, require the decoded `Data` to re-marshal to the same byte length, and prefer the key implied by the topic's channel segment before brute-forcing the rest.

### WR-12: Rate limiting is fully disabled and the v5 path has no limiter hook at all

**File:** `internal/app/server/proxy.go:17-24,190-201`
**Issue:** The `EnforceLimit` call is commented out (con-debug, 2026-07-19) and `rateLimiter`/`socketPenalty` are now dead; the v5 loop never had a limiter call to comment out, so re-enabling it post-con would restore throttling for 3.1.1 clients only. Combined with CR-04 and WR-14 that leaves the v5 path with no throughput or log-volume ceiling.
**Fix:** When re-enabling, add the same enforcement to `handleProxyV5`/`handleV5PublishUplink`, and delete the commented block in favour of a config flag (`Config.Server.RateLimitEnabled`) so the dead code is not the toggle.

### WR-13: `inspect.go` is not gofmt-clean

**File:** `internal/app/server/inspect.go:48-50`
**Issue:** `gofmt -l ./internal/app/server/` reports `inspect.go` (struct field alignment on `WasEncrypted`/`WasPKIEncrypted`/`HadEncryptedPayload`). A repo whose CI gate lets unformatted code merge will also let a diff-noise reformat mask a real change later.
**Fix:** `gofmt -w internal/app/server/inspect.go` and add `gofmt -l` (fail on non-empty) to CI.

### WR-14: Per-packet Warn logging on the parse-failure paths is attacker-triggerable amplification

**File:** `internal/app/server/proxy_v5.go:215,340`
**Issue:** Each unparseable PUBLISH emits a Warn line containing attacker-influenced content, uncapped and unthrottled (WR-12). A client publishing junk at line rate turns the proxy into a log pump against CloudWatch.
**Fix:** Log the first N per connection then sample, or increment a counter and log once per interval.

### WR-15: The `logDownlink*` self-echo check trusts a gateway id the publisher supplies

**File:** `internal/app/server/inspect.go:153-155`, `internal/app/server/proxy.go:325-329`
**Issue:** `rememberGateway` records whatever `GatewayId` string the client puts in its own uplink envelope, and downlink suppression compares against it. A client that claims another radio's gateway id causes *its own* downlink for that gateway to be suppressed — self-harm only today, but the same trusted value is used for correlation in logs and would become a spoofing primitive the moment anything authorises on it.
**Fix:** Cross-check the claimed gateway id against the topic's trailing `!nodeid` segment (already parsed) and log/refuse a mismatch.

### WR-16: `TrackConnection` trusts a PROXY-protocol header with no policy configured

**File:** `internal/app/server/inspect.go:429-441` (with `cmd.go:176`, out of scope but load-bearing)
**Issue:** `proxyproto.Listener{Listener: listener}` sets no `Policy`, so PROXY headers are honoured from **any** peer, and the resulting spoofable address becomes the `ConnTrack` key, the rate-limit key and the identity in every log line. Anyone able to reach the listener directly (bypassing the NLB — SG misconfiguration, in-VPC pivot) can collide with a victim's key: overwrite its `ConnectionInfo`, poison its `GatewayID`, or delete its entry on disconnect and get the victim Blocked (CR-02 mechanics).
**Fix:** `proxyproto.Listener{Listener: listener, Policy: func(upstream net.Addr) (proxyproto.Policy, error) { … REQUIRE for the NLB subnet, REJECT otherwise }}`.

### WR-17: Last Will and Testament is forwarded uninspected on both codecs

**File:** `internal/app/server/proxy_v5.go:156-164`, `internal/app/server/inspect.go:90-142`
**Issue:** The CONNECT's will topic/payload are re-encoded and forwarded verbatim. When the client drops, mosquitto publishes that payload under the swapped `public` identity — bypassing the hop clamp, the censor, `BlockInvalidEncryption` and every topic rule, with no proxy log line. It is the one publish path the proxy structurally cannot see.
**Fix:** Inspect the will payload at CONNECT time (it is a `ServiceEnvelope` on the same topic space): run it through `inspectMeshtastic` + the decider, clamp/censor it in place, or strip the will and refuse the connection when it fails the rules.

### WR-18: e2e harness has four flake/robustness defects

**File:** `internal/app/server/proxy_v5_e2e_test.go:147-153,265,410,444-453`
**Issue:** (a) `assertNoLog` proves "the broker never saw this" with a fixed 500 ms sleep — under CI load a slow broker log makes the strongest security assertions in the file (rejection happened *before* the dial) pass vacuously. (b) Readiness greps the bare substring `"running"` in mosquitto's log — matched by unrelated lines. (c) `freePort` closes the listener before the broker/proxy binds it (TOCTOU); two parallel packages can collide. (d) `StartProxyServer` calls `Config.Log.Fatal` on listen error, which `os.Exit`s the whole test binary with no diagnosis.
**Fix:** (a) poll for a positive completion signal (proxy log line + broker connection count unchanged) instead of sleeping; (b) match `"mosquitto version ... running"`; (c) hold the listener and hand the `net.Listener` to the server, or retry-on-bind; (d) return the error from `StartProxyServer` instead of `Fatal`.

---

## Notes on what is genuinely solid

Called out because a review that only lists defects invites the wrong fixes:

- `readFrame` (`proxy_v5.go:37-76`) — varint termination at 4 bytes, size check strictly before `make`, and the back-to-back framing test are all correct. Do not "simplify" the capture-before-parse design; CR-04's fix must preserve it.
- The v4 golden (`proxy_v4_golden_test.go`) pins forwarded bytes *and* the decision sequence, and deliberately includes a rule mutation. It is the right shape. Its one gap: it re-implements `handleProxy`'s inner loop rather than driving `handleProxy`, so a change to the preflight/dispatch (`proxy.go:113-130`) would not trip it.
- `setPublishPayload` erroring instead of silently not-matching (`inspect.go:306-331`) is the correct treatment of the meshtk#22 class — WR-01 is a caller failing to honour it, not a flaw in the seam.

---

_Reviewed: 2026-07-29_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Evidence: 4 findings reproduced via `go test -overlay` probes; meshtk working tree left unmodified (`git status --porcelain` empty)._
