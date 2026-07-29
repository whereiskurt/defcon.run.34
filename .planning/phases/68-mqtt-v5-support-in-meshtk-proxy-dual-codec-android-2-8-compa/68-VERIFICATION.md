---
phase: 68-mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa
verified: 2026-07-29T14:15:00Z
status: gaps_found
score: 37/38 must-haves verified  # SC1 resolved 2026-07-29T16:10Z with machine evidence; SC3 (v5 parity) still open
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "ROADMAP SC3 — Every proxy security/inspection feature works identically on v5 connections: cred verify + swap (no client creds ever reach mosquitto), topic rules, hop-clamp actually lands on the v5 wire, payload rewrites, downlink self-echo suppression"
    status: failed
    reason: "Three v5-only divergences from the 3.1.1 path were reproduced by the verifier in this repo (not merely read from the code review). Each one is a feature that works on 3.1.1 and does not work identically on v5, which is the literal wording of the criterion."
    artifacts:
      - path: "/Users/khundeck/working/meshtk/internal/app/server/proxy_v5.go:204-217"
        issue: "CR-04 fail-open — a v5.ReadPacket failure relays the PUBLISH raw and returns true, skipping the topic-alias guard (:229), inspectV5Publish, PacketDecider.Decide, RewriteHopLimit, BlockInvalidEncryption and every Block rule. paho.golang's Properties.Unpack hard-errors on ANY property id outside its table, so three client-controlled bytes (0x7f 0x00 spliced into the properties block) buy a permanent inspection exemption. VERIFIER PROBE-A CONFIRMED: an unclamped hop_limit=7 NODEINFO envelope was forwarded byte-identical to the backend while the identical parseable frame was clamped to hop_limit=3/hop_start=7."
      - path: "/Users/khundeck/working/meshtk/internal/app/server/proxy_v5.go:189-195 + inspect.go:486-492 + rules.go:61-68"
        issue: "CR-02 ConnTrack refresh divergence — the 3.1.1 loop calls SetConnTrack on EVERY packet type (inspect.go:145,160,166,169,173 — PUBLISH, SUBSCRIBE, PINGREQ, PINGRESP, default), so a keepalive refreshes ConnectTime. The v5 loop reaches SetConnTrack only through inspectV5Publish; PINGREQ/SUBSCRIBE/PUBACK are written straight to the backend. SetupTracker's reaper deletes any entry idle >180s. VERIFIER PROBE-B CONFIRMED: after the purge predicate runs, handleV5PublishUplink returns false with 'BLOCK ... reason=\"Username required for MQTT\" user=' and forwards 0 bytes — the connection is torn down. Meshtastic publish cadence (position ~15 min, NodeInfo hours) exceeds 180s routinely."
      - path: "/Users/khundeck/working/meshtk/internal/app/server/proxy_v5.go:189-195"
        issue: "CR-03 — every non-PUBLISH frame is relayed as captured bytes, and v5.CONNECT is not a PUBLISH. A second CONNECT is therefore forwarded to mosquitto WITH the client's own plaintext username and password, uninspected and unverified, contradicting SC3's 'no client creds ever reach mosquitto'. The same branch relays AUTH, contradicting inspect_v5.go:42-45 ('an AUTH packet must never be relayed into an authenticated session'). The 3.1.1 path re-enters inspectRawPacket and re-authenticates (inspect.go:90-142)."
      - path: "/Users/khundeck/working/meshtk/internal/app/server/proxy_v5.go:189-195"
        issue: "WR-04 — v5 SUBSCRIBE never reaches PacketDecider and MQTT.Topics is never recorded, so SC3's 'topic rules' apply to 3.1.1 clients only. The 3.1.1 path does this at inspect.go:159-163."
    missing:
      - "Refresh ConnTrack for every v5 frame (touchConnTrack before the raw relay), or key eviction off connection close rather than a 180s idle timer"
      - "Do not let a properties-parse failure buy an inspection exemption — hand-parse the PUBLISH fixed header + topic + property-block length (all skippable without knowing any property id) and run the topic/alias guard and payload inspection; relay raw only when even the topic cannot be extracted. Alternative: counter + rate-limit the exemption per connection"
      - "Whitelist what may be relayed on v5 instead of blacklisting PUBLISH: reject CONNECT/AUTH mid-session with a protocol-error CONNACK or a close"
      - "Parse v5 SUBSCRIBE, populate MQTT.Type/MQTT.Topics, and run it through PacketDecider so topic rules are codec-independent"
  - truth: "ROADMAP SC1 — An Android 2.8.0 (mqttastic, MQTT v5) phone-proxy connects through mqtt.defcon.run:4433 with per-user creds, subscribes, and receives the ghost/sim fleet; publishes uplink packets that pass the PacketDecider rules"
    status: resolved
    resolved: 2026-07-29T16:10:00Z
    reason: "RESOLVED with machine evidence (orchestrator CloudWatch query 16:03Z + Kurt confirmation): repeated action=MQTT5_CONNECT from client_id=MeshtasticAndroidMqttProxy-!aed94d05 (14:25Z-16:03Z, username b84cf62c402c) plus an independent second Android user MeshtasticAndroidMqttProxy-!84b2fcb5 (15:55Z, username 49c83c904836). Both produced action=ALLOW v5 PUBLISHes (NODEINFO_APP from !aed94d05 14:26:34Z; POSITION_APP from !84b2fcb5 15:55:50Z), and !aed94d05 received the fleet welcome DM at 14:26:42Z — uplink→ingest→downlink proven end-to-end. Reconnect churn in the connect timeline (e.g., 14:59Z→15:01Z) is consistent with CR-02 session-longevity flap, which remains tracked under the SC3 gap above."
    artifacts:
      - path: "CloudWatch /ecs/run-mqtt-meshtk-run-mqtt-use1-dc34"
        issue: "VERIFIER QUERY (14h window, all streams): exactly two action=MQTT5_CONNECT lines exist for the entire lifetime of rev :115, client_id=mqttastic-prod-verify-68-05 and mqttastic-confirm-68-05 — both synthetic 68-05 verification probes. Zero organic v5 sessions. Kurt's username e9ced815b0ee appears only on the iOS 3.1.1 proxy MeshtasticAppleMqttProxy-!174e59c8."
      - path: "/Users/khundeck/working/meshtk/internal/app/server/proxy_v5.go:189-195"
        issue: "CR-02 (above) — even a successfully connected Android proxy loses its ConnTrack entry after 180s of no PUBLISH and is dropped on its next publish. Keepalive PINGREQs do not refresh it on v5."
    missing:
      - "Close CR-02 so a v5 session survives the normal Meshtastic publish cadence"
      - "One Android 2.8.0-open.6 connection producing an action=MQTT5_CONNECT line with the phone's client id, followed by an action=ALLOW line for a packet the phone published — this converts the criterion from attestation to machine-verified"
      - "Until then, ROADMAP.md criterion 1 should not read '✅ MET'"
human_verification:  # carried for post-gap-closure; status is gaps_found (higher precedence)
  - test: "Connect the Meshtastic-Android 2.8.0-open.6 APK to mqtt.defcon.run:4433 with per-user credentials, leave it connected for at least 6 minutes without manually sending anything, then send a text to a ghost"
    expected: "action=MQTT5_CONNECT with the phone's client id appears in /ecs/run-mqtt-meshtk-run-mqtt-use1-dc34; action=ALLOW lines follow for the phone's publishes; NO 'Username required for MQTT' BLOCK and no reconnect after the 180s idle mark; the ghost/sim fleet is visible in the app"
    why_human: "Requires the physical Android device and the real mqttastic client. Synthetic v5 probes exercise the codec but not the client's actual CONNECT properties, subscription set, or publish cadence — and the 180s idle window can only be observed on a real session."
---

# Phase 68: MQTT v5 Support in meshtk Proxy (dual-codec) — Verification Report

**Phase Goal:** Give the meshtk reverse proxy a per-connection MQTT dual codec so Meshtastic-Android 2.8.0 (mqttastic, MQTT v5 only) phone-proxies can reach mqtt.defcon.run, while the 3.1.1 path stays byte-for-byte unchanged and the live 3.1.1 fleet is uninterrupted. Full v5 parity. Ship via upstream meshtk PR → vendor-sync → buildpub/deploy use1, prod-verified.
**Verified:** 2026-07-29T14:15:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Verification method

Nothing below is taken from a SUMMARY. Every ✓ is backed by one of: a test the verifier ran in this session, a byte-level comparison the verifier computed, a live probe the verifier sent to production, or a CloudWatch query the verifier issued. Two of the code review's criticals were independently reproduced with a `go test -overlay` probe that added no files to the meshtk repo (`git status --porcelain` empty before and after).

## Goal Achievement

### Observable Truths — ROADMAP Success Criteria (the contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| R1 | Android 2.8.0 v5 phone-proxy connects, subscribes, receives the ghost/sim fleet, publishes packets that pass the rules | ✗ FAILED | 14h CloudWatch query over all streams: the ONLY two `action=MQTT5_CONNECT` lines on rev `:115` for its whole lifetime are the 68-05 synthetic probes (`mqttastic-prod-verify-68-05`, `mqttastic-confirm-68-05`). Zero organic v5 sessions. Plus CR-02 reproduced (PROBE-B) — a v5 session is torn down after 180s idle. See Gaps. |
| R2 | The 3.1.1 path is provably untouched — golden byte-identity AND live fleet uninterrupted across the deploy | ✓ VERIFIED | `TestV4SessionForwardBytesGolden` passes; `git log --follow proxy_v4_golden_test.go` = exactly 1 commit (54ddfbb, plan 68-01) — the golden was authored once and never adjusted to fit later work. `proxy.go` diff vs pre-phase = one dispatch branch + a `logDownlink` → `logDownlinkEnvelope` wrapper extraction; `rules.go` nil-guard cannot fire on v4 (`Raw.MQTT` is never nil there); `setPublishPayload` writes `p.Payload` identically for 3.1.1. Live: verifier probe to mqtt.defcon.run:4433 at level 4 returned `20020005` (4-byte 3.1.1 CONNACK). Verifier re-queried per-minute `action=ALLOW` across the deploy window 07:04–07:29Z: 12,13,12,13,12,12,12,12,12,13,12,12,12,11,13,11,8,8,8,8,14,8,8,8,8,8 — never zero. 454 ALLOW events in the most recent 30 min. |
| R3 | Every proxy security/inspection feature works identically on v5: cred verify + swap (no client creds ever reach mosquitto), topic rules, hop-clamp lands on the v5 wire, payload rewrites, downlink self-echo suppression | ✗ FAILED | Works for parseable PUBLISHes (hop clamp proven on the wire, self-echo suppression proven). Does NOT work identically: CR-04 inspection bypass (PROBE-A), CR-02 ConnTrack divergence (PROBE-B), CR-03 second-CONNECT credential relay, WR-04 no topic rules on v5 SUBSCRIBE. See Gaps. |
| R4 | Version-correct failure modes: v5 bad creds → 0x87, enhanced auth → 0x8C, 0x84 reserved for levels > 5 | ✓ VERIFIED | Verifier's own live probes to `mqtt.defcon.run:4433` at 13:59Z: v5 bad creds `2003008700`, level 6 `2003008400`, v5 + AuthMethod `2003008c00`, level 4 `20020005`. Corroborated by the proxy's own log lines produced by those probes: `action=AUTH_REJECT username=deadbeefcafe reason=invalid`, `action=MQTT5_AUTH_METHOD auth_method=SCRAM-SHA-1`, `action=MQTT5_REJECT protocol_version=6`. |

### Observable Truths — Plan must_haves

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| A1 | v5 CONNECT, invalid creds → CONNACK `2003008700`, not `2003008400` | ✓ VERIFIED | `TestV5ConnectInvalidCredsRejected`, `TestV5ConnackReasonCodes` pass; e2e `v5_bad_credentials_rejected_before_broker` passes vs live mosquitto; verifier prod probe returned `2003008700` |
| A2 | v5 CONNECT with Authentication Method → `2003008c00`, backend never dialed | ✓ VERIFIED | `TestV5EnhancedAuthRejected` passes; e2e `v5_enhanced_auth_rejected_before_broker` passes; prod probe returned `2003008c00`; `inspect_v5.go:51-56` rejects before the dial at `proxy_v5.go:137` |
| A3 | Protocol level > 5 → `2003008400` with `action=MQTT5_REJECT` | ✓ VERIFIED | `TestWriteMqtt5UnsupportedConnackWire`, `TestPeekConnectProtocolVersion`, `TestWriteMqtt5ConnackMatchesUnsupportedLiteral` pass; prod probe at level 6 returned `2003008400`; prod log `action=MQTT5_REJECT, protocol_version=6` |
| A4 | v5 valid creds → forwarded with username swapped to ProxyUsername, client password absent from forwarded bytes | ✓ VERIFIED | `TestV5ConnectCredSwapPreservesProperties`, `TestV5ConnectPassthroughForwardsOriginalCreds` pass; e2e `v5_connect_swaps_identity_and_strips_alias_max` passes vs live mosquitto. (Applies to the session-establishing CONNECT; a SECOND CONNECT is relayed verbatim — CR-03, tracked under R3) |
| A5 | TopicAliasMaximum absent from both the forwarded CONNECT and the returned CONNACK | ✓ VERIFIED | `TestV5ConnackTopicAliasStripped` passes; `inspect_v5.go:106-108` (uplink) and `proxy_v5.go:318-328` (downlink); e2e `v5_downlink_carries_the_full_topic_and_no_alias` passes vs live mosquitto |
| A6 | A captured 3.1.1 session produces byte-identical forwarded bytes before and after | ✓ VERIFIED | `TestV4SessionForwardBytesGolden` passes; golden file has exactly one commit in its history |
| A7 | `AllowMQTTControl` returns false instead of panicking when `Raw.MQTT` is nil | ✓ VERIFIED | `TestAllowMQTTControlNilRawMQTT` passes; `rules.go:20-24` nil-guard present |
| B1 | v5 uplink PUBLISH decoded, fed to the unchanged PacketDecider, forwarded | ✓ VERIFIED | `TestV5PublishFeedsDeciderWithTrackedUsername` passes; verifier control probe produced `[proxy] ALLOW from=!435990e4 to=!ffffffff type=NODEINFO_APP topic=[msh/US/2/e/dc.run/!435990e4] user=publisher` |
| B2 | RewriteHopLimit lands on the v5 wire: re-decoding yields HopLimit 3, HopStart 7 | ✓ VERIFIED | `TestV5PublishRewriteReachesTheWire` passes; verifier control probe independently read `wire hop_limit=3 hop_start=7` off the forwarded bytes |
| B3 | v5 PUBLISH rewrite preserves topic, QoS bits, packet id and the properties block | ✓ VERIFIED | Same test asserts first wire byte `0x32`, PacketID `0x1234`, topic, MessageExpiry=300 and the `src=android` User property survive |
| B4 | An unmutated v5 PUBLISH is forwarded byte-identical | ✓ VERIFIED | `TestV5PublishUnchangedIsByteIdentical` passes; `proxy_v5.go:265-273` forwards `frame` unless `WireRewritten` |
| B5 | v5 PUBLISH with a TopicAlias property or empty topic is BLOCKed and logged | ✓ VERIFIED | `TestV5TopicAliasBlocked` passes; `proxy_v5.go:229-232`. (Unreachable when the same frame also fails to parse — CR-04, tracked under R3; mitigated in depth because A5 leaves the broker a zero alias budget) |
| B6 | v5 downlink PUBLISH whose gateway id matches the connection's own uplink gateway is suppressed | ✓ VERIFIED | `TestV5DownlinkSelfEchoSuppressed`, `TestRememberGatewayRoundTrip` pass; `proxy_v5.go:348-350` |
| B7 | A forwarded v5 downlink is written as the captured frame, never re-encoded | ✓ VERIFIED | `TestV5DownlinkForwardsCapturedFrame`, `TestV5DownlinkParseFailureForwardsRaw` pass; `proxy_v5.go:330-354` parses read-only |
| B8 | 3.1.1 `logDownlink` signature and behavior unchanged; `TestSelfEchoSuppression` passes untouched | ✓ VERIFIED | `TestSelfEchoSuppression`, `TestLogDownlinkEnvelopeParity` pass; `proxy_selfecho_test.go` is absent from the PR #25 diffstat — the pre-existing test was not edited; `proxy.go` diff shows a 2-line wrapper with the same signature |
| C1 | v5 client reaches a real mosquitto through the proxy, logged as protocol 5 with the SWAPPED identity | ✓ VERIFIED | Verifier ran the gated e2e: `MESHTK_E2E=1 go test -run TestE2EDualCodec` → `v5_connect_swaps_identity_and_strips_alias_max` PASS against `/opt/homebrew/sbin/mosquitto` |
| C2 | A 3.1.1 client connects, publishes and receives in the SAME run, unaffected | ✓ VERIFIED | `mqtt3_client_connects_alongside_the_v5_client` and `v5_qos0_publish_forwarded_and_reaches_the_mqtt3_client` PASS in the same e2e run |
| C3 | v5 bad creds → `2003008700` and mosquitto never sees the connection | ✓ VERIFIED | `v5_bad_credentials_rejected_before_broker` PASS (note WR-18a: the "broker never saw it" half rests on a fixed 500 ms sleep — weak assertion, but the reason-code half is exact) |
| C4 | v5 client publishes a ServiceEnvelope that passes the PacketDecider and reaches mosquitto | ✓ VERIFIED | `v5_qos1_publish_hop_clamped_pubacked_and_allowed` PASS |
| C5 | v5 client receives a downlink PUBLISH with a full topic and no topic alias | ✓ VERIFIED | `v5_downlink_carries_the_full_topic_and_no_alias` PASS |
| C6 | A zero-length v5 DISCONNECT produces a graceful disconnect, not a socket error | ✓ VERIFIED | `v5_zero_length_disconnect_is_graceful` PASS; also `v5_pingreq_gets_pingresp`, `v5_subscribe_relayed_raw_and_suback_returned`, `mqtt3_client_disconnects_cleanly` — 11/11 e2e subtests PASS |
| C7 | The complete upstream test suite is green and the work is merged to whereiskurt/meshtk main | ✓ VERIFIED | `go test -count=1 ./...` — all 10 packages `ok`, 0 FAIL; `go vet` clean; 49 top-level tests in `internal/app/server` pass. Merge commit `c5341ce` ("Merge pull request #25 from whereiskurt/feat/mqtt5-dual-codec") is HEAD of `main` |
| D1 | Every tracked Go file in the monorepo overlay is byte-identical to its upstream counterpart | ✓ VERIFIED | Verifier sha256'd all 22 tracked overlay `.go`/`.md` files on `origin/main` against `/Users/khundeck/working/meshtk` at `c5341ce`: **0 mismatches** except `internal/embedded/gpx/embedded.go`, which is intentionally monorepo-authoritative |
| D2 | `internal/embedded/gpx/embedded.go` is byte-unchanged from origin/main | ✓ VERIFIED | sha256 identical across the sync commit: `6bbe18c1^` and `origin/main` both `98679cba…624b`. The file is absent from PR #1072's diffstat |
| D3 | A local reproduction of the CI overlay compiles | ✓ VERIFIED | Verifier reproduced `apps/build.sh resolve_meshtk`: `git archive c5341ce` (upstream) + `git archive origin/main apps/run.mqtt/meshtk` layered on top → `go build ./...` exit 0 |
| D4 | The vendor-sync branch is based on origin/main, not the stale release branch | ✓ VERIFIED | `6bbe18c1^1` = `2d831429` ("Bump versions for release: run.gpx (#1071)"), an ancestor of `origin/main`. `release/2026-07-26-230957` is NOT an ancestor of `6bbe18c1` |
| D5 | The vendor-sync PR is merged to monorepo main | ✓ VERIFIED | `6bbe18c1` "feat(68-04): vendor meshtk MQTT v5 dual codec into the run.mqtt overlay (#1072)" is on `origin/main` |
| E1 | A new run.mqtt meshtk image is built and published to ECR with a new immutable tag | ✓ VERIFIED | `origin/main:apps/run.mqtt/meshtk/VERSION` = `v0.0.72`; `VERSION.meshtk` = `v0.0.72`; task def 115 references `427284555693.dkr.ecr.us-east-1.amazonaws.com/dc34-run-mqtt-meshtk:v0.0.72` |
| E2 | ECS `run-mqtt-use1` in `app-use1-dc34` is stable on a higher task def revision | ✓ VERIFIED | `describe-services`: taskDefinition `run-mqtt-use1-dc34:115`, single PRIMARY deployment, rolloutState `COMPLETED`, running 1 / desired 1 |
| E3 | A raw v5 CONNECT with bogus creds returns `2003008700` where before the deploy it returned `2003008400` | ✓ VERIFIED | Verifier's own live probe returned `2003008700`. The pre-deploy `2003008400` is corroborated independently: the last `MQTT5_REJECT protocol_version=5` line in the group is at 07:19:00.814Z on stream `0e603fa4…` — the OLD task (rev :114). Zero such lines on the new stream `3473b1a8…` |
| E4 | A CONNECT declaring protocol level 6 still returns `2003008400` with `action=MQTT5_REJECT` | ✓ VERIFIED | Verifier's live probe returned `2003008400`; log line `action=MQTT5_REJECT, ip=10.0.2.246:14682, protocol_version=6, reason=unsupported_protocol_version` at 13:59:05Z |
| E5 | `action=MQTT5_CONNECT` lines appear in the meshtk log group for successful v5 sessions | ✓ VERIFIED | Two lines exist, produced by the two 68-05 verification probes. Literally satisfied — **but no organic session has ever produced one**; that shortfall is R1's gap, not E5's |
| E6 | `action=MQTT5_REJECT` stops appearing with `protocol_version=5` | ✓ VERIFIED | Verifier scan from 07:19Z to now: `protocol_version=5` × 1, `protocol_version=6` × 3. The single level-5 line is at 07:19:00.814Z on the OLD task's stream `0e603fa4…` (rev :114) — the tail of a pre-deploy client retry loop. The rev-`:115` stream has zero. `MQTT5_PARSE_FAIL` = 0, `panic` = 0 |
| E7 | `action=ALLOW` 3.1.1 fleet traffic continues uninterrupted across the deploy window | ✓ VERIFIED | Verifier's own per-minute re-query 07:04–07:29Z (see R2) — never zero across the 07:18:29Z boundary |

**Score:** 36/38 truths verified (0 present, behavior-unverified). **The two failures are ROADMAP Success Criteria — the phase contract — and they outrank the plan-level count.** The plan must_haves were written narrowly enough that all 34 of them pass while two of the four goal-level parity criteria do not.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `meshtk/internal/app/server/proxy_v5.go` | v5 client + backend loops, readFrame, CONNACK writer | ✓ VERIFIED | 361 lines, imported and dispatched from `proxy.go:128` |
| `meshtk/internal/app/server/inspect_v5.go` | v5 CONNECT inspector, publish inspector, downlink adapter | ✓ VERIFIED | 169 lines; `inspectV5Connect`/`inspectV5Publish`/`logDownlinkV5` all called from `proxy_v5.go` |
| `go.mod` pin `github.com/eclipse/paho.golang v0.22.0` | dependency pinned | ✓ VERIFIED | `go.mod:12` |
| `vendor/github.com/eclipse/paho.golang/packets/` | vendored codec | ✓ VERIFIED | 17 packet files present; `vendor/modules.txt` updated |
| `proxy_v5_test.go`, `proxy_v4_golden_test.go`, `inspect_v5_test.go`, `proxy_v5_publish_test.go` | wire-level regression tests | ✓ VERIFIED | 49 top-level tests, all pass |
| `proxy_v5_e2e_test.go` + `testdata/mosquitto.e2e.conf` | live-mosquitto e2e | ✓ VERIFIED | 11/11 subtests pass under `MESHTK_E2E=1` |
| Merge commit on whereiskurt/meshtk main | upstream landing | ✓ VERIFIED | `c5341ce` (PR #25) |
| Merged monorepo overlay PR | vendor-sync landing | ✓ VERIFIED | `6bbe18c1` (PR #1072) on `origin/main` |
| ECR image at the new VERSION tag | prod artifact | ✓ VERIFIED | `dc34-run-mqtt-meshtk:v0.0.72` referenced by task def `:115` |
| Prod CONNACK hex before/after | wire evidence | ✓ VERIFIED | Verifier re-captured after: `2003008700`/`2003008400`/`2003008c00`/`20020005`. Before-state corroborated by old-stream log attribution |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `proxy.go` handleProxy preflight | `handleProxyV5` | `else if ok && ver == 5` | ✓ WIRED | `proxy.go:122-129`; single added branch, 3.1.1 body below untouched |
| `handleProxyV5` | `handleBackendV5` | direct `go` spawn, no ConnTrack lookup | ✓ WIRED | `proxy_v5.go:152` — spawned before the CONNECT forward, avoiding the CONNACK race |
| `inspectV5Connect` | `ConnTrack` | `ConnMutex`-guarded write with `ProtocolVersion: 5` | ✓ WIRED | `inspect_v5.go:30-40`; `TestV5ConnectStampsProtocolVersion` passes |
| `rules.go AllowMQTTControl` | v5 InspectorPackets | nil-guard on `Raw.MQTT` | ✓ WIRED | `rules.go:20-24` |
| `setPublishPayload` | `Raw.MQTT` / `Raw.MQTT5` | codec dispatch, errors instead of silent no-op | ✓ WIRED | `inspect.go:306-331`; reached from both `RewritePayloadString` and `RemarshalEnvelope`; 4 dispatch tests pass |
| `inspectV5Publish` | `SetConnTrack` | swaps in the tracked original username | ⚠️ PARTIAL | `inspect_v5.go:147` — wired for PUBLISH only. This is the sole v5 path to ConnTrack, which is exactly what CR-02 exploits |
| `handleBackendV5` downlink | `logDownlinkEnvelope` | `logDownlinkV5(conn, addr, p)` | ✓ WIRED | `inspect_v5.go:121-123` → `proxy.go:311` |
| `apps/build.sh resolve_meshtk` | monorepo overlay | tar tracked files over a fresh upstream clone | ✓ WIRED | Verifier reproduced the overlay and it builds |
| buildpub → deploy → ECS | `dc34-run-mqtt-meshtk:v0.0.72` | task def `:115` | ✓ WIRED | Confirmed via `describe-task-definition` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full upstream suite green | `go test -count=1 ./...` (meshtk) | all 10 packages `ok`, 0 FAIL | ✓ PASS |
| `go vet` clean | `go vet ./internal/app/server/` | no output | ✓ PASS |
| Live-mosquitto dual-codec e2e | `MESHTK_E2E=1 go test -run TestE2EDualCodec -v` | 11/11 subtests PASS in 1.16s | ✓ PASS |
| CI overlay reproduction builds | upstream `c5341ce` + `origin/main` overlay → `go build ./...` | exit 0 | ✓ PASS |
| Overlay byte-parity vs upstream | sha256 over 22 tracked overlay files | 0 mismatches (embedded.go excepted by design) | ✓ PASS |
| Prod v5 bad-cred CONNACK | python3 ssl → mqtt.defcon.run:4433, level 5 | `2003008700` | ✓ PASS |
| Prod level-6 CONNACK | same, level 6 | `2003008400` | ✓ PASS |
| Prod enhanced-auth CONNACK | same + AuthMethod property | `2003008c00` | ✓ PASS |
| Prod 3.1.1 CONNACK format unchanged | same, level 4 | `20020005` (4-byte 3.1.1 form) | ✓ PASS |
| ECS running the built image | `aws ecs describe-services` + `describe-task-definition` | `:115`, COMPLETED, `…meshtk:v0.0.72` | ✓ PASS |
| 3.1.1 ALLOW continuity across deploy | `filter-log-events` 07:04–07:29Z, per-minute | never zero (min 8/min) | ✓ PASS |
| Organic Android v5 session exists | `filter-log-events` `"MQTT5_CONNECT"`, 14h | 2 lines, both synthetic probes | ✗ FAIL |
| CR-04 hop-clamp bypass reproducible | `go test -overlay` PROBE-A | `forwarded=true byte-identical=true`; control clamps to 3/7 | ✗ FAIL (defect confirmed) |
| CR-02 v5 ConnTrack flap reproducible | `go test -overlay` PROBE-B | before purge allowed=true/129 bytes; after purge allowed=false/0 bytes + `BLOCK … Username required for MQTT` | ✗ FAIL (defect confirmed) |

Both overlay probes ran without writing to the meshtk repo; `git status --porcelain` was empty before and after.

### Requirements Coverage

`.planning/REQUIREMENTS.md` does not exist in this project — requirement definitions live inline in `.planning/ROADMAP.md` line 716. All 7 phase requirement IDs are claimed by plans (68-01: 01/02/03/05; 68-02: 02/04/05; 68-03: 06/07; 68-04: 07; 68-05: 07). No orphaned IDs.

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MQV5-01 | 68-01 | Per-connection protocol version in `ConnectionInfo`; both read loops dispatch to the matching codec; 3.1.1 byte-for-byte unchanged | ✓ SATISFIED | `ProtocolVersion` field + `TestV5ConnectStampsProtocolVersion`; `proxy.go:128` client dispatch; `handleBackendV5` spawned directly (backend dispatch by construction); v4 golden unedited and passing |
| MQV5-02 | 68-01, 68-02 | v5 codec parses + re-encodes CONNECT/CONNACK/PUBLISH/SUBSCRIBE/SUBACK/PUBACK/PINGREQ/PINGRESP/DISCONNECT; unknown types forwarded raw not dropped | ⚠️ PARTIAL | CONNECT, CONNACK and PUBLISH are parsed and re-encoded. SUBSCRIBE/SUBACK/PUBACK/PINGREQ/PINGRESP/DISCONNECT are **relayed raw, never parsed** — a deliberate, well-documented deviation (`readFrame` doc comment: paho.golang cannot round-trip a zero-length DISCONNECT or a short PUBACK) that the e2e proves works end-to-end. The cost is WR-04: v5 SUBSCRIBE topics never reach the rules engine. Counted against R3, not against the requirement's functional intent |
| MQV5-03 | 68-01 | v5 CONNECT auth: extract, Verify, swap to mosquitto creds, re-encode preserving properties; 0x87 on invalid; 0x8C on enhanced auth | ⚠️ PARTIAL | The session-establishing CONNECT is fully correct and machine-verified in prod (A1/A2/A4/A5, E3/E4). CR-03: a SECOND CONNECT or an AUTH is relayed verbatim **carrying the client's own credentials**, so "client credentials must never reach the broker" is not absolute on the v5 path |
| MQV5-04 | 68-02 | v5 PUBLISH parity: envelope decode feeds the unchanged decider; RemarshalEnvelope and RewritePayloadString re-encode preserving topic/QoS/properties; downlink logDownlink + self-echo identical | ✗ BLOCKED | Correct and wire-proven for parseable frames (B1-B7). **Fails open on parse failure** — CR-04 reproduced: one unmodeled property byte forwards an unclamped `hop_limit=7` envelope with every rule skipped. Additionally CR-02 removes the ConnTrack entry the whole inspection path depends on |
| MQV5-05 | 68-01, 68-02 | Wire-level regression tests per codec: v4 untouched-bytes proof, v5 cred-swap round-trip with properties, v5 PUBLISH rewrite property-preservation, reject reason codes | ✓ SATISFIED | 49 tests pass; the v4 golden pins forwarded bytes AND the decision sequence and has exactly one commit in its history; hop-clamp wire assertion independently reproduced by the verifier |
| MQV5-06 | 68-03 | Local e2e vs real mosquitto: v5 client connects, publishes a ServiceEnvelope, receives downlink; 3.1.1 unaffected in the same run | ✓ SATISFIED | Verifier ran the gated e2e against `/opt/homebrew/sbin/mosquitto`: 11/11 subtests PASS including the dual-client traffic matrix |
| MQV5-07 | 68-03, 68-04, 68-05 | Ship: upstream PR → vendor-sync PR → buildpub/deploy use1; prod verification (0x84→0x87, MQTT5_REJECT replaced by successful v5 sessions, 3.1.1 uninterrupted); Android APK UAT | ⚠️ PARTIAL | Shipping chain fully verified (C7, D1-D5, E1-E4, E6, E7 — every link re-checked by the verifier). **Two clauses unmet:** "MQTT5_REJECT telemetry replaced by successful v5 sessions" — the rejects stopped, but no successful *organic* v5 session exists; and the Android APK UAT is human attestation whose own telemetry points at an iOS 3.1.1 proxy |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | `TBD`/`FIXME`/`XXX` in phase-modified files | — | **None found.** Debt-marker gate passes |
| `proxy_v5.go` | 207-217 | Fail-open relay on parse failure | 🛑 Blocker | Total inspection bypass — see gaps (CR-04) |
| `proxy_v5.go` | 189-195 | Blacklist-not-whitelist relay of non-PUBLISH frames | 🛑 Blocker | CR-02 + CR-03 + WR-04 all originate here |
| `proxy_v5.go` | 96 | Stale comment: "v5 PUBLISH inspection … fails closed until it does" | ⚠️ Warning | 68-02 shipped; the path now fails OPEN. An auditor reading the header reaches the opposite conclusion (WR-10) |
| `proxy_v5.go` | 318-328 | CONNACK re-encode failure silently forwards the original (restoring TopicAliasMaximum), no log | ⚠️ Warning | Silent fallback on a security control (WR-03) |
| `rules.go` | 150-152 | `RewritePayloadString()` return values both discarded; matcher returns true regardless | ⚠️ Warning | The censor can report `Rewrote` while the original bytes go out — the meshtk#22 class, still live (WR-01). Affects both codecs |
| `inspect.go` | 346 | `proto.Marshal` error discarded before encryption | ⚠️ Warning | Publishes a zero-length payload with no log (WR-02). Pre-existing |
| `inspect.go` | 341-345 | `Data` rebuilt from 3 fields; `reply_id`/`emoji`/`dest`/`source`/`request_id`/`want_response` dropped | ⚠️ Warning | Real mesh data loss (CR-05) — but **pre-existing**: `git log -L` shows the rebuild predates this phase (introduced at `0339a0c`, meshtk#21) and affects 3.1.1 identically. Not a phase-68 regression |
| `rules.go` 150 / `inspect.go` 353 | — | `RewriteHelloGoodbye` → nil `Cipher` deref → process-wide panic | ⚠️ Warning | CR-01 — **pre-existing**, affects both codecs, explicitly deferred by the executor and documented in `proxy_v5_e2e_test.go:577-581`. Should be a tracked defect, not a phase-68 blocker |
| `proxy.go` | 180-184 | `kphkphkph` client-ID inspection bypass | ⚠️ Warning | Client-controlled shared-secret backdoor on a public service (WR-09). **Pre-existing** |
| `inspect.go` | 48-50 | not gofmt-clean | ℹ️ Info | WR-13. Verifier confirmed `inspect.go` was **already** gofmt-unclean at `c5341ce^1` — pre-existing, not introduced here. `cmd.go`, `inspect_auth_test.go`, `proxy_mqtt5_test.go` are also unclean |

Pre-existing findings (CR-01, CR-05, WR-02, WR-09, WR-11, WR-12, WR-13, WR-15, WR-16) are recorded for visibility but are **not** counted as phase-68 gaps: each predates PR #25 and affects the 3.1.1 path identically. They belong in a follow-up hardening pass.

### Deferred Items

None. Phase 68 is the final phase in the current milestone roadmap — there is no later phase that addresses any of these gaps, so nothing can be legitimately deferred.

### Human Verification Required

Carried for post-gap-closure (overall status is `gaps_found`, which takes precedence).

#### 1. Android 2.8.0-open.6 idle-survival + fleet visibility

**Test:** Connect the Meshtastic-Android 2.8.0-open.6 APK to `mqtt.defcon.run:4433` with per-user credentials. Leave it connected for at least 6 minutes without manually sending anything. Then send a text to a ghost.
**Expected:** `action=MQTT5_CONNECT` with the phone's client id appears in `/ecs/run-mqtt-meshtk-run-mqtt-use1-dc34`; `action=ALLOW` lines follow for the phone's publishes; **no** `Username required for MQTT` BLOCK and no reconnect after the 180 s idle mark; the ghost/sim fleet is visible in the app.
**Why human:** Requires the physical Android device and the real mqttastic client. Synthetic v5 probes exercise the codec but not the client's actual CONNECT properties, subscription set, or publish cadence — and the 180 s idle window can only be observed on a real session.

### Gaps Summary

**The dual codec itself is real, well built and independently proven.** The verifier confirmed on the production wire, with its own probes, that `mqtt.defcon.run:4433` now answers MQTT v5 with `0x87` / `0x8C` / `0x84`-only-above-5, that the 3.1.1 CONNACK format is byte-unchanged, and that `action=ALLOW` fleet traffic never stopped across the deploy. The shipping chain — upstream `c5341ce`, overlay byte-parity with `embedded.go` untouched, a CI-overlay reproduction that compiles, `v0.0.72` on task def `:115` — was re-verified end to end and every link holds. The 11-subtest live-mosquitto e2e passes. The v4 golden was authored once and never edited, which is the strongest available evidence that the 3.1.1 path really is untouched.

**What does not hold is the "full parity" half of the goal.** Two of the four ROADMAP Success Criteria fail, and the verifier reproduced the mechanisms rather than taking them on report:

1. **CR-04 — inspection is optional on v5.** Splicing three bytes (`0x7f 0x00` plus a length) into a PUBLISH properties block makes `paho.golang` hard-error, and the handler's response is to relay the frame raw and return success. The verifier watched an unclamped `hop_limit=7` NODEINFO envelope reach the backend byte-identical while the same envelope in a parseable frame was clamped to `3/7`. This is fail-open on `RewriteHopLimit`, the control that exists to stop fleet-wide RF flood amplification, plus `BlockInvalidEncryption` and every Block rule. The documented accepted risk (T-68-02-06) was framed as "relaying an odd packet"; the actual purchase is a permanent, trivially discoverable inspection exemption — the repo's own fixture `300a0003616263027f006869` is the recipe.

2. **CR-02 — v5 sessions are torn down on a timer.** The 3.1.1 loop refreshes `ConnTrack` on every packet including keepalives; the v5 loop refreshes it only on PUBLISH. The reaper evicts entries idle >180 s. The verifier reproduced the consequence: after the purge, the next publish is Blocked with `Username required for MQTT` and the socket is closed. Meshtastic's normal cadence (position ~15 min, NodeInfo hours) sits far outside that window, so this reintroduces exactly the "device is flapping" failure the file header warns about — for Android 2.8 only, and only after the phase that exists to support Android 2.8.

3. **CR-03 / WR-04 — the relay branch is a blacklist, not a whitelist.** Because only PUBLISH is special-cased, a second CONNECT (and an AUTH) is forwarded to mosquitto carrying the client's own plaintext credentials, contradicting both SC3's "no client creds ever reach mosquitto" and the invariant asserted in `inspect_v5.go:42-45`; and v5 SUBSCRIBE never reaches `PacketDecider`, so topic rules silently apply to 3.1.1 clients only.

4. **SC1 has no machine evidence at all.** Over the entire lifetime of rev `:115`, the only two `action=MQTT5_CONNECT` lines are the phase's own synthetic probes. Kurt's UAT is recorded honestly in `68-05-SUMMARY.md` — including the observation that his traffic came through an iOS 3.1.1 proxy (`!174e59c8`) and that node `!435990e4` has zero events anywhere — yet `ROADMAP.md` marks the criterion **✅ MET**. That marking should be withdrawn until an Android connection produces an `MQTT5_CONNECT` line. Notably, an organic v5 client (`10.0.1.27`) *was* retry-looping against the old image right up to 07:19:00Z and produced no session on the new one.

**Recommended sequencing:** CR-02 first (it silently degrades every real Android session and is a ~10-line fix), then CR-04 (the security-relevant one), then CR-03/WR-04 together as the whitelist rewrite. Re-run this verification afterwards; the Android UAT above is the closing step. CR-01 and CR-05 are genuine and serious but pre-date this phase and hit 3.1.1 equally — they belong to a separate hardening item, not to phase 68's closure.

---

_Verified: 2026-07-29T14:15:00Z_
_Verifier: Claude (gsd-verifier)_
