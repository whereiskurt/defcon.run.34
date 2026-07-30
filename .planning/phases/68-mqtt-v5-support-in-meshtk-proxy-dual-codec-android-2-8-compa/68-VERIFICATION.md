---
phase: 68-mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa
verified: 2026-07-29T21:50:00Z
status: passed
score: 64/64 must-haves verified  # 1 qualified (see 68-08 T9); all 4 ROADMAP Success Criteria now machine-verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 37/38
  gaps_closed:

    - "ROADMAP SC3 — v5 parity: CR-02 ConnTrack refresh divergence (idle v5 sessions torn down by the 180s reaper)"
    - "ROADMAP SC3 — v5 parity: CR-03 mid-session CONNECT/AUTH relayed to mosquitto with the client's own plaintext credentials"
    - "ROADMAP SC3 — v5 parity: CR-04 fail-open PUBLISH inspection exemption bought with three unmodelled property bytes"
    - "ROADMAP SC3 — v5 parity: WR-04 v5 SUBSCRIBE never reached PacketDecider; MQTT.Topics never recorded"
    - "ROADMAP SC1 — organic Android 2.8 v5 sessions absent from telemetry (now continuously present)"
  gaps_remaining: []
  regressions: []
human_verification:

  - test: "DECISION — pre-existing shared-chain nil-cipher panic (68-REVIEW CR-01). Decide whether to hotfix before DEF CON 34 or defer. Do NOT test against production: a single crafted PUBLISH carrying a DECODED (unencrypted) TEXT_MESSAGE_APP ServiceEnvelope kills the whole proxy process and drops every connected radio."
    expected: "A nil-guard at all three layers the review names (rules.go RewriteHelloGoodbye matcher, inspect.go RewritePayloadString, a per-connection recover() in proxy.go/proxy_v5.go), plus a regression test that publishes a decoded TEXT_MESSAGE_APP on BOTH codecs and asserts the connection survives."
    why_human: "The failure mode is a fleet-wide outage, so it cannot be probed against the live proxy. It is PRE-EXISTING (the inspect.go:368 cipher deref dates to bf06311, long before this phase) and codec-symmetric, so it falsifies no phase-68 must-have — but phase 68 widened the population of clients that can reach it, because before v0.0.72 every v5 client was honest-rejected at 0x84 and could not reach the rules engine at all. Prod evidence over the deployed task's 2h57m lifetime: SIGSEGV=0, panic=0, exactly one 'Proxy server started' line (no restart), and real TEXT_MESSAGE_APP publishes flowed on BOTH codecs (Apple 3.1.1 20:44:50Z, Android v5 20:48:23Z) — the live fleet encrypts, so Cipher is non-nil on its traffic. Fix-vs-defer is a risk call for the event owner, not a verifier call."

  - test: "DECISION — pre-existing Data field loss on every rewritten TEXT_MESSAGE (68-REVIEW CR-03). Confirm whether stripping reply_id / emoji / dest / source / request_id / want_response from every text message on the live fleet is acceptable through DEF CON 34."
    expected: "RewritePayloadString mutates ip.Meshtastic.Decoded in place instead of rebuilding a fresh meshtastic.Data from three fields, so 2.8 tapbacks, threaded replies, delivery-ACK requests and DM routing fields survive; proto.Marshal's error stops being discarded with `_`."
    why_human: "This is live user-visible data loss RIGHT NOW on both codecs, not a phase-68 regression: the three-field rebuild dates to bf06311 and the Bitfield line to 0339a0c (meshtk#21), both pre-phase. RewriteHelloGoodbye calls RewritePayloadString unconditionally — the word-replacement is gated on username==\"public\" but the rewrite call is not — so it applies to every text message, not just censored ones. Whether six days before the event is the right time to touch the encrypt/remarshal path is a judgment call."

  - test: "DECISION — pre-existing Last-Will inspection bypass (68-REVIEW CR-02). Decide whether to strip Wills at CONNECT time on both codecs."
    expected: "c.WillFlag/WillTopic/WillMessage/WillProperties cleared (and logged) in inspectV5Connect, mirrored in the 3.1.1 CONNECT branch — or the Will payload routed through inspectMeshtastic + PacketDecider with a Block refusing the CONNECT."
    why_human: "Verified as codec-symmetric and pre-existing: grep for 'Will' across inspect.go, inspect_v5.go and proxy.go returns nothing, so neither codec has ever inspected a Will. It therefore satisfies SC3's literal 'works identically on v5' while leaving an uninspected, replayable path to inject an unclamped hop_limit=7 broadcast — the exact amplification RewriteHopLimit exists to stop. Not a phase-68 gap; needs an owner decision on whether it ships into the event."
accepted_limitations:

  - item: "68-08 truth 9 — 'A real Android 2.8.0 session survives a nine-minute idle period and keeps working'"
    status: "verified in substance; literal bar structurally unreachable"
    evidence: "The real client makes a nine-minute idle window impossible: the verifier measured the currently-live Android session (client_id=MeshtasticAndroidMqttProxy-!aed94d05-fdcc313a, socket 10.0.2.246:52733) at 76 min 35 s of UNBROKEN uptime (20:27:54Z-21:44:30Z, still running), 78 decision events, largest inter-event gap 68 s. The underlying invariant is proven instead by two production synthetic probes: CONNECT 18:57:01Z -> ALLOW 19:05:01Z and CONNECT 19:07:39Z -> ALLOW 19:15:39Z, i.e. 480 s idle (2.7x the 180 s reaper window) followed by a successful publish judged with the tracked username. Zero 'Username required for MQTT' Blocks on any v5 session across the task lifetime."
---

# Phase 68: MQTT v5 Support in meshtk Proxy (dual-codec) — Verification Report

**Phase Goal:** Give the meshtk reverse proxy a per-connection MQTT dual codec so Meshtastic-Android 2.8.0 (mqttastic, MQTT v5 only) phone-proxies can reach mqtt.defcon.run, while the 3.1.1 path stays byte-for-byte unchanged and the live 3.1.1 fleet is uninterrupted. Full v5 parity. Ship via upstream meshtk PR → vendor-sync → buildpub/deploy use1, prod-verified.
**Verified:** 2026-07-29T21:50:00Z
**Status:** human_needed — phase goal ACHIEVED (64/64); three pre-existing shared-chain defects escalated for an owner decision
**Re-verification:** Yes — after gap closure (68-06, 68-07, 68-08). Previous: `gaps_found`, 37/38.

## Verification method

Nothing below is taken from a SUMMARY. Every ✓ rests on one of: a test the verifier executed in this session, a byte-level comparison the verifier computed, a live probe the verifier fired at production, a CloudWatch query the verifier issued, or a line of shipped source the verifier read out of `origin/main` (not out of a working tree).

The monorepo overlay was extracted from `origin/main` with `git archive` and read from there, because the current working branch (`release/2026-07-26-230957`) still carries a **stale v0.0.66 overlay with no v5 files at all** — reading the working tree would have produced a false FAILED on every truth in this phase.

**What the verifier ran, in order:**

| # | Action | Result |
|---|--------|--------|
| 1 | `git archive origin/main -- apps/run.mqtt/meshtk` → read shipped source | overlay `VERSION` = `v0.0.73` |
| 2 | sha256 of all 87 tracked overlay `.go`/`.md`/`VERSION`/`go.mod`/`go.sum` vs upstream `5769031` | 2 mismatches, both expected (`VERSION` is monorepo-only; `embedded.go` is monorepo-authoritative) |
| 3 | `go test -count=1 ./internal/app/server/` (upstream, tree clean at `5769031`) | `ok` — 79 top-level tests |
| 4 | `go vet ./internal/app/server/` | clean, exit 0 |
| 5 | `MESHTK_E2E=1 go test -run TestE2EDualCodec` vs `/opt/homebrew/sbin/mosquitto` 2.0.22 | **15/15 subtests PASS** |
| 6 | CI-overlay reproduction: `git archive 5769031` + monorepo overlay layered → `go build ./...` | exit 0; `embedded.go` = `98679cba…` (monorepo copy wins — ghost-embed regression not reintroduced) |
| 7 | `python3 mqtt5_probe.py regression-connacks` → live `mqtt.defcon.run:4433` at **21:38:16Z** | `VERDICT PASS` — all four CONNACK captures byte-identical |
| 8 | `aws ecs describe-services` / `describe-task-definition` / `describe-tasks` | `run-mqtt-use1-dc34:116`, `dc34-run-mqtt-meshtk:v0.0.73`, rollout `COMPLETED`, 1/1, task `HEALTHY` |
| 9 | 8 CloudWatch queries against the running task's log stream | see evidence tables below |

The verifier's own probe at 21:38:17Z produced `action=AUTH_REJECT` and `action=MQTT5_REJECT` lines on stream `17a91e11…`, which is how that stream was proven to belong to the exact task that answered the probe. (`describe-log-streams` reports a `lastEventTimestamp` ~2 h stale on this stream — that metadata is misleading; `get-log-events` shows events landing in real time.)

## Goal Achievement

### Observable Truths — ROADMAP Success Criteria (the contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| **SC1** | An Android 2.8.0 (mqttastic, MQTT v5) phone-proxy connects through `mqtt.defcon.run:4433` with per-user creds, subscribes, and receives the ghost/sim fleet; publishes uplink packets that pass the PacketDecider rules | **✓ VERIFIED** | Was FAILED. Verifier's own CloudWatch query over the running v0.0.73 task: **116 log lines** from `MeshtasticAndroidMqttProxy-!aed94d05` across **8 distinct session ids**, username `b84cf62c402c`. The live session `…-fdcc313a` on socket `10.0.2.246:52733` opened `action=MQTT5_CONNECT` at 20:27:54Z and was still producing `action=ALLOW` PUBLISHes at **21:44:30Z** — 76 min 35 s unbroken, ~67 s cadence. `action=ALLOW … mqtt_type=SUBSCRIBE` on the same client proves subscribe; `type=TEXT_MESSAGE_APP` ALLOW at 20:48:23Z proves rule-passing uplink |
| **SC2** | The 3.1.1 path is provably untouched: a captured v4 session's proxy behavior is byte-identical pre/post (wire-level test), and live 3.1.1 fleet traffic flows uninterrupted across the deploy | **✓ VERIFIED** | `TestV4SessionForwardBytesGolden` passes; `git log --follow proxy_v4_golden_test.go` = **exactly 1 commit** (`54ddfbb`, plan 68-01) — the golden was authored once and never adjusted to fit later work. `proxy.go` last changed in 68-02 (`5c31631`); **68-06/68-07 did not touch it** (`git diff --stat 261152b~2..5769031` = `inspect.go` and `rules.go` only). Live: verifier per-minute `action=ALLOW` across the v0.0.73 rollover (task start 18:46:59Z), 18:35→18:59Z = 12,13,13,18,18,18,12,11,18,8,6,6,8,5,8,7,7,6,6,8,6,7,6,6,6 — **never zero**, 239 events. Clients in that window include the iOS 3.1.1 proxy `MeshtasticAppleMqttProxy-!174e59c8` (66 ALLOWs) and radio `!093a781d` (47), with a `mqtt_type=DisconnectPacket` line confirming the 3.1.1 codec's own `%T` default branch is live. Verifier's live 3.1.1 probe returned `20020005` (4-byte CONNACK, unchanged) |
| **SC3** | Every proxy security/inspection feature works identically on v5 connections: cred verify + swap (no client creds ever reach mosquitto), topic rules, hop-clamp actually lands on the v5 wire, payload rewrites, downlink self-echo suppression | **✓ VERIFIED** | Was FAILED on four counts; **all four reproduced as closed on the production wire by the verifier's own log correlation** — see the per-defect table below. Codec-independence is structural, not incidental: `inspect.go:168` (3.1.1) and `inspect_v5.go:148` (v5) both set the identical literal `MQTT.Type = "SUBSCRIBE"`, and `rules.go`'s `AllowMQTTControl` carries the same six-type allowlist on both branches, so a rule cannot give a codec-dependent answer |
| **SC4** | Version-correct failure modes: bad creds on v5 → 0x87; enhanced-auth → 0x8C; 0x84 reserved for levels the proxy genuinely does not speak (>5) | **✓ VERIFIED** | Verifier ran `regression-connacks` against production at **21:38:16Z**: v5 bad creds `2003008700`, level 6 `2003008400`, v5 + AuthMethod `2003008c00`, 3.1.1 bad creds `20020005` → `VERDICT PASS`. Corroborated by the lines that probe itself produced: `action=AUTH_REJECT, username=not-a-real-user, reason=invalid` ×2 and `action=MQTT5_REJECT, protocol_version=6, reason=unsupported_protocol_version` at 21:38:17Z. `MQTT5_REJECT` with `protocol_version=5` = **0** on the v0.0.73 task |

**The four SC3 defects — production evidence gathered by the verifier**

| Defect | Closed how (shipped source read directly) | Production proof (verifier's own CloudWatch correlation) |
|--------|------------------------------------------|--------------------------------------------------------|
| **CR-02** idle v5 session torn down by the 180 s reaper | `n.touchConnTrack(socketAddr)` at `proxy_v5.go:208`, **before** any type dispatch, so PINGREQ/SUBSCRIBE/PUBACK all refresh `ConnectTime` exactly as the 3.1.1 loop's five `SetConnTrack` calls do (`inspect.go:152,167,173,176,180`). `touchConnTrack` (`inspect.go:500`) is update-if-exists only, so it can never fabricate an unauthenticated entry | `dc34p-cr02-2c667646`: `MQTT5_CONNECT` 18:57:01Z → `action=ALLOW … mqtt_type=PUBLISH … mesh_type=NODEINFO_APP` 19:05:01Z = **480 s idle**, judged with the tracked username. Repeated: 19:07:39Z → 19:15:39Z. `"Username required for MQTT"` on any v5 session across the whole task lifetime = **0** (the single occurrence, 21:28:23Z, is a **3.1.1** session — `mqtt_type=PubcompPacket`, a 3.1.1 struct name; PUBCOMP is in neither codec's allowlist) |
| **CR-03** mid-session CONNECT/AUTH relayed to mosquitto with the client's own plaintext creds | `proxy_v5.go:262-274` refuses `CONNECT, AUTH, CONNACK, SUBACK, UNSUBACK, PINGRESP` — an explicit named list, not a PUBLISH special-case — logging `MQTT5_PROTOCOL_VIOLATION` and writing a v5 DISCONNECT with `DisconnectProtocolError` (= `0x82`, confirmed at `vendor/github.com/eclipse/paho.golang/packets/disconnect.go:41`) **before** anything reaches the broker | `action=MQTT5_PROTOCOL_VIOLATION, ip=10.0.2.246:59329, mqtt_type=1, reason=illegal_frame_on_established_session` at 18:56:01Z on session `dc34p-cr03-820a6d47`; again 19:07:13Z. `TestV5SecondConnectRefused` asserts byte-exact backend equality plus absence of the attacker username **and** password anywhere in the broker bytes. **Zero organic violations** across 3 h of real Android traffic — the refusal list produces no false positives on the real client |
| **CR-04** three unmodelled property bytes bought a permanent inspection exemption | `parseV5PublishFrame` (`proxy_v5_rawpublish.go`) hand-parses the fixed + variable header using only length prefixes, interpreting **no property id**; `spliceV5PublishPayload` rebuilds the frame preserving the property bytes verbatim; `setPublishPayload` gained a third `Raw.MQTT5Raw` dispatch case so `RemarshalEnvelope`/`RewritePayloadString` reach it unchanged; a hand-parse failure now `return false` (drops the connection) after `MQTT5_PUBLISH_HEADER_FAIL` | Session `dc34p-cr04-f058fe7f`, 18:56:15Z, four correlated lines in order: `MQTT5_CONNECT` → `MQTT5_PARSE_FAIL … reason=invalid Prop type 127 for packet 3` → `action=BLOCK … mqtt_topic=[msh/US/2/e/dc.run/!435990e4]` → `[proxy] BLOCK from=!435990e4 to=!ffffffff reason="Failed to decrypt with any known key"`. The topic was recovered by hand-parse, the ServiceEnvelope decoded, and `BlockInvalidEncryption` fired — on v0.0.72 these exact bytes were relayed with only the PARSE_FAIL line and no decision at all. Repeated 19:07:17Z. `MQTT5_PUBLISH_HEADER_FAIL` = **0** in prod |
| **WR-04** v5 SUBSCRIBE never reached PacketDecider; `MQTT.Topics` never recorded | `proxy_v5.go:219-260` parses a read-only copy, calls `inspectV5Subscribe` (which runs `SetConnTrack`, sets `MQTT.Type="SUBSCRIBE"` and fills `MQTT.Topics` from `s.Subscriptions`), runs `PacketDecider.Decide`, then relays the **captured** frame; `rules.go` `AllowMQTTControl` gained a `Raw.MQTT5` branch with the identical six-type allowlist, 3.1.1 branch first and unedited | Three v5 sessions logged `action=ALLOW … mqtt_type=SUBSCRIBE, mqtt_topic=[msh/US/2/e/dc.run/probe-…/#]` (18:56:28Z, 19:06:43Z, 19:07:29Z) — both `MQTT.Type` and `MQTT.Topics` populated on a v5 connection, which produced no decision line at all on v0.0.72. The real Android client's SUBSCRIBE is logged the same way |

### Observable Truths — Plan must_haves 68-01 … 68-05 (regression-checked)

The previous verification verified all 34 of these. 68-06/68-07 edited `inspect.go`, `inspect_v5.go`, `proxy_v5.go` and `rules.go`, so each group was re-checked for regression. **34/34 still hold; no regressions.**

| Group | Truths | Status | Regression evidence |
|-------|--------|--------|---------------------|
| **A1–A5** v5 CONNECT reason codes, cred swap, TopicAliasMaximum strip both directions | 5 | ✓ VERIFIED | `TestV5ConnectInvalidCredsRejected`, `TestV5ConnackReasonCodes`, `TestV5EnhancedAuthRejected`, `TestWriteMqtt5ConnackMatchesUnsupportedLiteral`, `TestV5ConnectCredSwapPreservesProperties`, `TestV5ConnectPassthroughForwardsOriginalCreds`, `TestV5ConnackTopicAliasStripped` all pass in the verifier's run; the verifier's live prod probe returned all four expected CONNACKs at 21:38Z. A4's earlier caveat ("a SECOND CONNECT is relayed verbatim") is now **retired** — CR-03 closed it |
| **A6** captured 3.1.1 session byte-identical | 1 | ✓ VERIFIED | `TestV4SessionForwardBytesGolden` passes; golden file history = 1 commit |
| **A7** `AllowMQTTControl` returns false instead of panicking on nil `Raw.MQTT` | 1 | ✓ VERIFIED | `TestAllowMQTTControlNilRawMQTT` + `TestAllowMQTTControlV4Unchanged` pass; guard read directly — the nil-`MQTT` path now falls through to the new `Raw.MQTT5` branch and finally an explicit `return false` |
| **B1–B5** v5 uplink PUBLISH → unchanged PacketDecider, hop clamp on the wire, topic/QoS/packet-id/properties preserved, unmutated frame byte-identical, topic-alias BLOCK | 5 | ✓ VERIFIED | `TestV5PublishFeedsDeciderWithTrackedUsername`, `TestV5PublishRewriteReachesTheWire`, `TestV5PublishUnchangedIsByteIdentical`, `TestV5TopicAliasBlocked`, `TestV5ParseablePublishPathUnchanged` pass. B5's earlier caveat ("unreachable when the frame also fails to parse — CR-04") is **retired** for the empty-topic case; the residual `TopicAlias`-property-on-a-hand-parsed-frame case is W1 below, a warning rather than a truth failure |
| **B6–B8** downlink self-echo suppression, captured-frame downlink, `logDownlink` 3.1.1 parity | 3 | ✓ VERIFIED | `TestV5DownlinkSelfEchoSuppressed`, `TestRememberGatewayRoundTrip`, `TestV5DownlinkForwardsCapturedFrame`, `TestV5DownlinkParseFailureForwardsRaw`, `TestSelfEchoSuppression`, `TestLogDownlinkEnvelopeParity` pass |
| **C1–C7** live-mosquitto e2e (v5 + 3.1.1 in one run), upstream suite green and merged | 7 | ✓ VERIFIED | Verifier ran `MESHTK_E2E=1 go test -run TestE2EDualCodec` → **15/15 PASS** (was 11/11; the four new subtests are the four closed defects). Full package `ok`, `go vet` clean. Merge commit **`5769031`** ("Merge pull request #27 from whereiskurt/fix/mqtt5-v5-parity") is HEAD of upstream `main`, tree clean |
| **D1–D5** overlay byte-identity, `embedded.go` untouched, CI overlay compiles, branch based on `origin/main`, PR merged | 5 | ✓ VERIFIED | Verifier's sha256 sweep: 87 files, 2 expected mismatches. `embedded.go` absent from the diffstat of **both** vendor-sync commits (`74e98f34`, `118c2433`) and identical (`98679cba…`) in the layered CI reproduction. `74e98f34^1` = `8d8568a1` and `74e98f34` is on `origin/main`; `release/2026-07-26-230957` is **not** an ancestor. Layered build exit 0 |
| **E1–E7** new immutable ECR tag, ECS stable, prod 0x87 flip, 0x84 for level 6, `MQTT5_CONNECT` present, `MQTT5_REJECT protocol_version=5` gone, 3.1.1 ALLOW continuity | 7 | ✓ VERIFIED | Now at the **v0.0.73** generation: overlay `VERSION` = `v0.0.73`; task def `:116` references `dc34-run-mqtt-meshtk:v0.0.73`; rollout `COMPLETED`, 1/1, task `HEALTHY`, a single `Proxy server started` line (no restart). E5's earlier shortfall ("no organic session has ever produced one") is **retired** — 8 organic Android session ids. `MQTT5_REJECT protocol_version=5` = 0 |

### Observable Truths — Plan 68-06 must_haves (v5 relay-branch parity)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| T1 | A v5 session idle past the 180 s reaper window keeps its ConnTrack entry because every frame — PINGREQ included — refreshes ConnectTime as the 3.1.1 loop does | ✓ VERIFIED | `touchConnTrack` at `proxy_v5.go:208`, before the type switch. `TestV5PingreqRefreshesConnTrack` + `TestV5IdleSessionSurvivesReaperWindow` pass — the latter backdates 200 s, sends a real `c000` PINGREQ through the real handler, then re-runs *the reaper's own predicate verbatim*. Prod: 480 s ×2 |
| T2 | A v5 PUBLISH after a long idle gap is judged with the tracked original username, not Blocked with "Username required for MQTT" | ✓ VERIFIED | Prod `dc34p-cr02-2c667646` ALLOW at 19:05:01Z with `username=0a487d6affa5` after 480 s. The test asserts both the absence of the Block string and the presence of `user=<tracked>` |
| T3 | A second CONNECT is refused: zero bytes reach the backend, so client creds never cross the proxy→broker socket | ✓ VERIFIED | `TestV5SecondConnectRefused` → `assertRefused` compares the full backend buffer to the establishing bytes and separately asserts `len(extra)==0`, then asserts neither attacker username nor password appears in the broker bytes. Prod violation line at 18:56:01Z |
| T4 | An AUTH frame mid-session is refused the same way | ✓ VERIFIED | `v5.AUTH` is in the refusal case at `proxy_v5.go:262`; `TestV5AuthFrameRefused` passes through the same `assertRefused` |
| T5 | A refused frame produces `action=MQTT5_PROTOCOL_VIOLATION` and a v5 DISCONNECT reason `0x82` before the socket closes | ✓ VERIFIED | `writeMqtt5Disconnect(conn, v5.DisconnectProtocolError)` at `proxy_v5.go:273`; constant confirmed `= 0x82`; `assertDisconnectReason` checks `f[2]` on the actual client-bound frames. Prod log line present |
| T6 | A v5 SUBSCRIBE reaches PacketDecider with `MQTT.Type` SUBSCRIBE and its topic filters recorded, available to any rule ordered ahead of `AllowMQTTControl` | ✓ VERIFIED | `inspectV5Subscribe` read directly; `TestV5SubscribeReachesDecider`, `TestV5SubscribeCarriesTrackedUsername` pass. Prod ALLOW lines carry `mqtt_type=SUBSCRIBE, mqtt_topic=[…]` |
| T7 | A v5 and a 3.1.1 SUBSCRIBE are matched by the **same rule, by name** — codec-independent, not merely reached | ✓ VERIFIED | `TestV5SubscribeMatchesSameRuleAsV4` passes; verified structurally — both codecs assign the identical literal `"SUBSCRIBE"` (`inspect.go:168` / `inspect_v5.go:148`) |
| T8 | `AllowMQTTControl` recognizes v5 control packets, so the allowlist decides identically on both codecs | ✓ VERIFIED | `rules.go` read directly: the 3.1.1 branch is first and unedited; the v5 branch carries the same six types (`Connect, Subscribe, Puback, Pingreq, Unsubscribe, Disconnect`). `TestAllowMQTTControlV5` + `TestAllowMQTTControlV4Unchanged` pass. Cross-confirmed in prod: the 21:28:23Z Block shows PUBCOMP is allowlisted by *neither* codec — the quirk is symmetric |
| T9 | Legitimate non-PUBLISH traffic (PINGREQ, PUBACK, UNSUBSCRIBE, DISCONNECT) is still relayed byte-identically | ✓ VERIFIED | `proxy_v5.go:276-286` default arm writes the captured frame; `TestV5PingreqStillRelayedByteIdentical`, `TestV5DisconnectFrameRelayed`, `TestV5SubscribeRelayedByteIdentical` pass; e2e `v5_pingreq_gets_pingresp` and `v5_zero_length_disconnect_is_graceful` pass vs live mosquitto |
| T10 | `proxy_v4_golden_test.go` is byte-unchanged and passes | ✓ VERIFIED | `git log --follow` = 1 commit, `54ddfbb` (68-01); test passes in the verifier's run |

### Observable Truths — Plan 68-07 must_haves (CR-04 inspection exemption)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| T1 | A v5 PUBLISH carrying a property id the codec does not model is still inspected: topic and ServiceEnvelope payload reach the InspectorPacket and PacketDecider | ✓ VERIFIED | `parseV5PublishFrame` read line by line — it walks fixed header → varint remLen → uint16 topic → conditional packet id → varint property-block length → **skips the block whole**, never reading an id. `inspectV5RawPublish` sets `MQTT.Type`/`MQTT.Topics`, `proto.Unmarshal`s the envelope and calls `inspectMeshtastic`. `TestParseV5PublishFrameUnmodelledProperty` + 5 sibling parser tests pass. **Prod:** topic recovered and envelope decoded at 18:56:15Z |
| T2 | RewriteHopLimit lands on the wire for such a frame — forwarded bytes decode to HopLimit 3 / HopStart 7 while every unmodelled property byte survives verbatim | ✓ VERIFIED | `TestV5UnmodelledPropertyPublishIsClamped`, `TestSpliceV5PublishPayloadPreservesProperties`, `TestSpliceV5PublishPayloadIdentity` pass; e2e `v5_unmodelled_property_publish_is_clamped_end_to_end` passes vs live mosquitto. `spliceV5PublishPayload` copies `frame[VarHeaderOffset:PayloadOffset]` verbatim — strictly stronger than a codec round trip, which cannot represent what it refused to parse |
| T3 | A Block rule fires on such a frame: an undecryptable envelope in an unmodelled property is Blocked and zero bytes reach the backend | ✓ VERIFIED | `TestV5UnmodelledPropertyPublishBlockRuleFires` passes. **Prod, decisively:** `[proxy] BLOCK … reason="Failed to decrypt with any known key"` on the parse-failed frame, 18:56:15Z and 19:07:17Z — `BlockInvalidEncryption` reached through what used to be the exempt path |
| T4 | A v5 PUBLISH whose variable header cannot be hand-parsed at all is refused, not relayed — connection dropped as the 3.1.1 loop does | ✓ VERIFIED | `proxy_v5.go:317-327`: `MQTT5_PUBLISH_HEADER_FAIL` + a BLOCK line + `return false`. `TestV5MalformedPublishFailsClosed`, `TestParseV5PublishFrameTruncated`, `TestParseV5PublishFrameOversizeRejected` pass. Prod `MQTT5_PUBLISH_HEADER_FAIL` = 0 — no legitimate client trips it |
| T5 | An unmodelled-property PUBLISH no rule mutated is forwarded byte-identical | ✓ VERIFIED | `out := frame` unless `ip.WireRewritten`; `TestV5UnmodelledPropertyPublishUnchangedIsByteIdentical` + `TestV5PublishParseFailureForwardsRaw` pass |
| T6 | Every comment the new dispatch case falsifies is corrected: `proxy_v5.go` header posture, the retired accepted-risk block, the `RawPacket` single-field invariant, the `setPublishPayload` default error text | ✓ VERIFIED | Read in the shipped source: `proxy_v5.go:112-118` now states "The PUBLISH posture is FAIL CLOSED" and names T-68-02-06 as **retired**; `RawPacket`'s doc comment (`inspect.go:53-69`) enumerates all three fields and the at-most-one invariant; `setPublishPayload`'s default error names all three (`Raw.MQTT, Raw.MQTT5 or Raw.MQTT5Raw`) |
| T7 | A v5 client publishing an unmodelled-property frame through a live mosquitto is clamped end to end, and the 3.1.1 client in the same run is unaffected | ✓ VERIFIED | Verifier's e2e run: `v5_unmodelled_property_publish_is_clamped_end_to_end` PASS alongside `mqtt3_client_connects_alongside_the_v5_client` and `mqtt3_client_disconnects_cleanly` in the same process |

### Observable Truths — Plan 68-08 must_haves (ship)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| T1 | Parity fixes merged to whereiskurt/meshtk main and the monorepo overlay byte-identical to that upstream state | ✓ VERIFIED | Upstream HEAD `5769031` (PR #27), tree clean. Verifier sha256 sweep: 87/87 shared files identical bar `VERSION` (monorepo-only; upstream has no `VERSION` file) and `embedded.go` (monorepo-authoritative by design) |
| T2 | One release carries both the v5 parity fixes and the already-open ricky flag-line vendor-sync, so one deploy closes both | ✓ VERIFIED | `74e98f34^1` = `8d8568a1` = "Merge pull request #1075 from whereiskurt/fix/ricky-flag-vendor-sync"; `118c2433` ("vendor ricky flag-line reliable delivery (upstream #26 / d340f36)") and `74e98f34` are both ancestors of `d0f4fd29` ("Bump versions for release: run.mqtt (#1079)"). One tag, both fixes — this also closes the "PR #1075 open, not deployed" state |
| T3 | `internal/embedded/gpx/embedded.go` byte-unchanged by the vendor-sync | ✓ VERIFIED | Absent from the diffstat of both `74e98f34` and `118c2433`; sha `98679cba…` on `origin/main` and in the layered CI reproduction |
| T4 | A new immutable ECR tag built by buildpub and the ECS service stable on a task definition referencing it | ✓ VERIFIED | `run-mqtt-use1-dc34:116` → `dc34-run-mqtt-meshtk:v0.0.73` (both the `run-mqtt-meshtk` and `run-mqtt-ghosts` containers); single PRIMARY deployment, `rolloutState=COMPLETED`, 1/1, task `HEALTHY`, started 18:47:38Z |
| T5 | On the production wire, a second CONNECT on an established v5 session is refused rather than relayed | ✓ VERIFIED | `action=MQTT5_PROTOCOL_VIOLATION … mqtt_type=1` at 18:56:01Z and 19:07:13Z, correlated to `dc34p-cr03-*` sessions by socket address |
| T6 | On the production wire, an unmodelled-property PUBLISH carrying an undecryptable envelope is BLOCKed instead of relayed | ✓ VERIFIED | Four-line correlated sequence at 18:56:15Z ending in `BLOCK … reason="Failed to decrypt with any known key"`; repeated 19:07:17Z |
| T7 | A v5 session held idle past the 180 s tracker window publishes successfully instead of being Blocked | ✓ VERIFIED | 480 s idle → ALLOW, twice (18:57:01Z→19:05:01Z, 19:07:39Z→19:15:39Z). Zero `"Username required for MQTT"` on any v5 session |
| T8 | The four CONNACK reason codes and the 3.1.1 CONNACK format unchanged from 68-05, and 3.1.1 ALLOW traffic never stops across the deploy | ✓ VERIFIED | Verifier's own `regression-connacks` at 21:38Z → `VERDICT PASS`, all four byte-identical including the 4-byte `20020005`. ALLOW per-minute across the 18:47Z rollover never zero (25 consecutive minutes) |
| T9 | A real Android 2.8.0 session survives a nine-minute idle period and keeps working | **✓ PASSED (qualified)** | Counted in the score, qualification recorded in `accepted_limitations`. **Substance verified; literal bar structurally unreachable.** The real client cannot produce a nine-minute idle window: the verifier measured the live session at **76 min 35 s unbroken** with a largest inter-event gap of **68 s** (~67 s POSITION cadence). The invariant it was designed to test is proven instead at **480 s idle in production, twice**. No proxy-side Block, violation or error on that session. Deliberately named as a limitation in `68-08-SUMMARY.md` and in the ROADMAP plan line |

**Score: 64/64 truths verified** (0 present-behavior-unverified; 1 qualified — 68-08 T9). The two ROADMAP Success Criteria that failed in the previous verification are now among the most strongly evidenced items in this report, both machine-verified from production telemetry the verifier queried itself.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go` | v5 client + backend loops, `readFrame`, CONNACK/DISCONNECT writers, explicit frame switch | ✓ VERIFIED | 511 lines on `origin/main`; dispatched from `proxy.go:128`; every frame type has a stated outcome (inspected / refused / relayed) — nothing falls through |
| `…/proxy_v5_rawpublish.go` | property-agnostic PUBLISH header parser + payload splicer | ✓ VERIFIED | 203 lines; `parseV5PublishFrame`, `spliceV5PublishPayload`, `decodeV5Varint`, `encodeV5Varint`; wired from `handleV5PublishUplink:317,348` and `setPublishPayload`'s third case |
| `…/proxy_v5_rawpublish_test.go` | fail-closed + splice regression tests | ✓ VERIFIED | 22 410 bytes; 9 tests present and passing (`TestParseV5PublishFrame*` ×6, `TestSpliceV5PublishPayload*` ×3) |
| `…/proxy_v5_parity_test.go` | CR-02 / CR-03 / WR-04 wire-level tests | ✓ VERIFIED | 23 356 bytes; drives the **real** `handleProxyV5` through a session harness and asserts byte-exact backend buffers plus log content — not stubbed helpers |
| `…/inspect_v5.go` | v5 CONNECT/PUBLISH/SUBSCRIBE/rawPublish inspectors, downlink adapter | ✓ VERIFIED | `inspectV5Connect`, `inspectV5Publish`, `inspectV5Subscribe`, `inspectV5RawPublish`, `logDownlinkV5` — all called from `proxy_v5.go` |
| `…/inspect.go` | `touchConnTrack`, `RawPacket.MQTT5Raw`, `setPublishPayload` third dispatch | ✓ VERIFIED | `touchConnTrack` at :500 (update-if-exists only); `MQTT5Raw` at :67; third dispatch case present with an accurate default error |
| `…/rules.go` | codec-independent `AllowMQTTControl` | ✓ VERIFIED | 3.1.1 branch first and unedited; v5 branch with the identical six-type allowlist; explicit "neither codec populated → false" tail |
| `…/proxy_v5_e2e_test.go` | live-mosquitto e2e incl. all four closed defects | ✓ VERIFIED | 15/15 subtests PASS in the verifier's `MESHTK_E2E=1` run against mosquitto 2.0.22 |
| Upstream merge commit | `whereiskurt/meshtk` main | ✓ VERIFIED | `5769031` (PR #27), HEAD of `main`, tree clean |
| Monorepo vendor-sync + release | merged to `origin/main` | ✓ VERIFIED | `74e98f34` (#1078) + `118c2433` (#1075) + `d0f4fd29` (#1079 version bump) |
| ECR image on a stable task def | prod artifact | ✓ VERIFIED | `dc34-run-mqtt-meshtk:v0.0.73` on `run-mqtt-use1-dc34:116` |
| `68-08-probes/mqtt5_probe.py` | reproducible per-defect prod probes | ✓ VERIFIED | Present and runnable by the verifier; `regression-connacks` re-run live → `VERDICT PASS` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `proxy.go` preflight | `proxy_v5.go handleProxyV5` | `peekConnectProtocolVersion` → single `else if ok && ver == 5` branch | ✓ WIRED | `proxy.go:122-131`; the 3.1.1 body below is textually untouched (file unmodified by 68-06/07) |
| `handleProxyV5` frame loop | `inspect.go touchConnTrack` | called on **every** frame, before the type switch | ✓ WIRED | `proxy_v5.go:208` |
| `handleProxyV5` SUBSCRIBE arm | `PacketDecider.Decide` | `inspectV5Subscribe` → `Decide` → relay captured frame | ✓ WIRED | `proxy_v5.go:238-260`; prod ALLOW lines confirm the decision runs |
| `handleV5PublishUplink` codec-parse failure | `parseV5PublishFrame` → `inspectV5RawPublish` → `decideV5Publish` | fall-through on `v5.ReadPacket` error; hand-parse failure → `return false` | ✓ WIRED | `proxy_v5.go:317-355`; prod BLOCK proves the whole chain executes |
| `RawPacket.MQTT5Raw` | `setPublishPayload` | third `switch` case | ✓ WIRED | `TestSetPublishPayloadDispatchV5` / `…3111` / `…NeitherIsError` pass |
| rewrite rules | v5 wire | `RemarshalEnvelope`/`RewritePayloadString` → `setPublishPayload` → `spliceV5PublishPayload` | ✓ WIRED | `TestV5UnmodelledPropertyPublishIsClamped` + e2e clamp-end-to-end |
| `rules.go AllowMQTTControl` | `Raw.MQTT5` | nil-guarded dispatch, 3.1.1 first | ✓ WIRED | Read directly; `TestAllowMQTTControlV5` |
| `apps/build.sh resolve_meshtk` | upstream clone + monorepo overlay | fresh `git clone` then `tar` overlay of every repo-tracked file | ✓ WIRED | Verifier reproduced it: layered tree builds (`go build ./...` exit 0) and `embedded.go` resolves to the monorepo copy |
| `origin/main` overlay | ECS task | buildpub VERSION bump → immutable ECR tag → `deploy.yml` | ✓ WIRED | `VERSION` `v0.0.73` → tag `v0.0.73` → task def `:116` |

### Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Produces real data | Status |
|----------|--------------|--------|--------------------|--------|
| `inspectV5RawPublish` | `ip.MQTT.Topics`, `ip.Raw.Meshtastic` | `parseV5PublishFrame` topic + `proto.Unmarshal(p.Payload)` | Yes — the prod line carries `mqtt_topic=[msh/US/2/e/dc.run/!435990e4]` and `from=!435990e4 to=!ffffffff` off a frame the codec refused | ✓ FLOWING |
| `inspectV5Subscribe` | `ip.MQTT.Topics` | `s.Subscriptions[].Topic` | Yes — prod `mqtt_topic=[msh/US/2/e/dc.run/probe-…/#]` | ✓ FLOWING |
| `touchConnTrack` | `ConnectTime` on the tracker entry | update-if-exists on the live `SetupTracker` map | Yes — a 480 s-idle publish was judged with the tracked username in prod | ✓ FLOWING |
| `spliceV5PublishPayload` | forwarded frame bytes | `frame[0]`, re-encoded varint, verbatim var-header slice, new payload | Yes — clamped bytes decode to HopLimit 3 / HopStart 7 with unmodelled property bytes intact | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full server package green | `go test -count=1 ./internal/app/server/` | `ok … 0.358s`, 79 top-level tests | ✓ PASS |
| Static analysis clean | `go vet ./internal/app/server/` | no output, exit 0 | ✓ PASS |
| Live-mosquitto dual-codec e2e | `MESHTK_E2E=1 go test -run TestE2EDualCodec` | 15/15 subtests PASS in 1.20 s | ✓ PASS |
| CI overlay compiles | `git archive 5769031` + overlay → `go build ./...` | exit 0 | ✓ PASS |
| Overlay byte-identity | sha256 × 87 tracked files vs upstream | 2 expected mismatches | ✓ PASS |
| Production CONNACK contract | `python3 mqtt5_probe.py regression-connacks` | `VERDICT PASS` (4/4 byte-identical) | ✓ PASS |
| Deployed image / service state | `aws ecs describe-services` / `describe-task-definition` | `:116` / `v0.0.73` / COMPLETED / 1-1 / HEALTHY | ✓ PASS |
| Debt-marker gate on phase-changed files | `grep -nE "TBD\|FIXME\|XXX"` × 9 files | zero matches | ✓ PASS |

### Probe Execution

Phase-declared probes live at `68-08-probes/mqtt5_probe.py` (no conventional `scripts/*/tests/probe-*.sh` exist in this repo). All five subcommands are present and readable — **no `MISSING_PROBE`**.

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| `regression-connacks` | `python3 mqtt5_probe.py regression-connacks` | `VERDICT PASS all four CONNACK captures byte-identical to the 68-05 record`, exit 0 — **executed by the verifier at 21:38:16Z against production** | ✓ PASS |
| `cr03-second-connect` | `python3 mqtt5_probe.py cr03-second-connect` | Not re-executed — requires `MQTT_USERNAME`/`MQTT_PASSWORD` the verifier does not hold. **Verified by an equivalent independent route:** the verifier queried the proxy's own `action=MQTT5_PROTOCOL_VIOLATION` lines (18:56:01Z, 19:07:13Z), which is the exact discriminator the probe's own docstring names as decisive | ✓ PASS (equivalent evidence) |
| `cr04-unmodelled-block` | `python3 mqtt5_probe.py cr04-unmodelled-block` | Same — verified via the four-line correlated `MQTT5_CONNECT → MQTT5_PARSE_FAIL → BLOCK → "Failed to decrypt with any known key"` sequence at 18:56:15Z and 19:07:17Z | ✓ PASS (equivalent evidence) |
| `wr04-subscribe` | `python3 mqtt5_probe.py wr04-subscribe` | Same — verified via three `action=ALLOW … mqtt_type=SUBSCRIBE, mqtt_topic=[…]` lines on v5 sessions | ✓ PASS (equivalent evidence) |
| `cr02-idle` | `python3 mqtt5_probe.py cr02-idle` | Same — verified via two CONNECT→ALLOW pairs at exactly 480 s | ✓ PASS (equivalent evidence) |

The four credentialed probes were not re-fired because they require production MQTT credentials and two of them publish into the live mesh. The verifier substituted its own CloudWatch correlation, which reads the same proxy-emitted discriminators the probes assert on rather than the probes' self-reported verdict lines.

### Requirements Coverage

`.planning/REQUIREMENTS.md` does not exist in this milestone (removed at the v1.9 close), so traceability comes from PLAN frontmatter cross-referenced against the ROADMAP `**Requirements:**` line. **All 7 IDs accounted for; no orphans** — every ID in the ROADMAP line appears in at least one plan's `requirements`, and every ID in a plan's `requirements` appears in the ROADMAP line.

| Requirement | Source plans | Status | Evidence |
|-------------|-------------|--------|----------|
| **MQV5-01** per-connection version in `ConnectionInfo`; both loops dispatch; 3.1.1 byte-for-byte unchanged | 68-01 | ✓ SATISFIED | `ConnectionInfo.ProtocolVersion` at `inspect.go:86`, stamped `= 5` at `inspect_v5.go:36`; single dispatch branch at `proxy.go:128`; uplink `handleProxyV5`, downlink `handleBackendV5` (spawned at `proxy_v5.go:174`, so the version reaches it by construction rather than by a racy ConnTrack lookup); golden test unmoved (1 commit) |
| **MQV5-02** v5 codec for CONNECT/CONNACK/PUBLISH/SUBSCRIBE/SUBACK/PUBACK/PINGREQ/PINGRESP/DISCONNECT; unknown types forwarded raw | 68-01, 68-02, 68-06 | ✓ SATISFIED | `go.mod` pins `github.com/eclipse/paho.golang v0.22.0`, 17 vendored packet files. The frame switch now covers all three outcomes explicitly; the `default` arm forwards raw with a stated rationale. SUBSCRIBE moved from raw-relay to inspected in 68-06 |
| **MQV5-03** v5 CONNECT auth + cred swap + properties preserved; 0x87 invalid; 0x8C enhanced auth | 68-01, 68-06 | ✓ SATISFIED | Live prod: `2003008700` / `2003008c00` at 21:38Z. Cred swap: the re-encoded CONNECT is forwarded (`proxy_v5.go:176-186`), never the captured frame. 68-06 closed the residual hole where a *second* CONNECT leaked the client's own creds |
| **MQV5-04** v5 PUBLISH parity: envelope → unchanged PacketDecider; `RemarshalEnvelope`/`RewritePayloadString` preserve topic/QoS/properties; downlink `logDownlink` + self-echo identical | 68-02, 68-07 | ✓ SATISFIED | Hop clamp lands on the wire on both the codec and hand-parsed paths (tests + e2e + prod). Downlink parses read-only and writes the captured frame; `TestLogDownlinkEnvelopeParity` + `TestSelfEchoSuppression` pass. **Caveat:** the *payload-rewrite* leg is parity-correct but shares two pre-existing defects with the 3.1.1 path (nil cipher, `Data` field loss) — escalated below; both are symmetric on both codecs, so parity itself holds |
| **MQV5-05** wire-level per-codec regression tests | 68-01, 68-02, 68-06, 68-07 | ✓ SATISFIED | 79 top-level tests pass; the four defect-specific suites assert byte-exact buffers and log content, not just non-error returns |
| **MQV5-06** local e2e vs real mosquitto; 3.1.1 client unaffected in the same run | 68-03, 68-07 | ✓ SATISFIED | Verifier's own run: 15/15 including `mqtt3_client_connects_alongside_the_v5_client` and `mqtt3_client_disconnects_cleanly` |
| **MQV5-07** ship: upstream PR → vendor-sync → buildpub/deploy use1 + prod verification + Android UAT | 68-03, 68-04, 68-05, 68-08 | ✓ SATISFIED | `5769031` upstream; `74e98f34`+`118c2433`+`d0f4fd29` monorepo; `v0.0.73` on task def `:116`; prod 0x84→0x87 flip re-confirmed live; `MQTT5_REJECT protocol_version=5` = 0; 3.1.1 ALLOW continuity unbroken; Android UAT machine-verified (8 organic session ids, 76 min unbroken current session) with the nine-minute idle bar recorded as an accepted limitation |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| all 9 phase-changed files | — | `TBD` / `FIXME` / `XXX` | — | **Zero matches.** Debt-marker gate passes; completion is auditable |
| `inspect.go` | 94 | `TODO: Refactor the inspcet* functions…` | ℹ️ Info | **Pre-existing** — `git log -L 94,94` attributes it to `bf06311`, long before this phase |
| `proxy.go` | 180 | `TODO: Build this out as an actual ALLOW_LIST` | ℹ️ Info | **Pre-existing** — `93e719b`. `proxy.go` was not modified by 68-06/07 at all |
| `proxy_v5_publish_test.go` | — | `TestV5PublishParseFailureForwardsRaw` name still describes the retired fail-open posture | ⚠️ Warning | Naming wart only. The test's assertions remain correct under the new posture (its fixture's topic parses, no rule Blocks it, so it is inspected *and then* forwarded byte-identical). Fail-closed behavior is covered by `TestV5MalformedPublishFailsClosed` and the three `TestV5UnmodelledProperty*` tests. Rename suggested, not required |

### Human Verification Required

Three items, all **escalation decisions rather than verification gaps**. None falsifies a phase-68 must-have: every one lives in the **shared** inspection chain, is reachable identically from both codecs, and pre-dates this phase in git history — which is precisely why SC3's "works identically on v5" survives them. They are surfaced because two are live risks six days before the event, and burying them behind a `passed` verdict would be dishonest.

#### 1. Pre-existing nil-cipher panic — whole-process kill (68-REVIEW CR-01)

**Test:** Decide whether to hotfix before DEF CON 34 or defer. **Do not probe production** — one crafted PUBLISH carrying a DECODED (unencrypted) `TEXT_MESSAGE_APP` ServiceEnvelope drops every connected radio.
**Expected:** Nil-guards at all three layers the review names (`rules.go` `RewriteHelloGoodbye` matcher, `inspect.go` `RewritePayloadString`, a per-connection `recover()` in both proxy loops), plus a regression test that publishes a decoded `TEXT_MESSAGE_APP` on **both** codecs and asserts the connection survives.
**Why human:** The verifier confirmed the mechanism by reading the shipped source — `RewriteHelloGoodbye` calls `ip.RewritePayloadString()` unconditionally (the word-replacement is gated on `Username == "public"`, the rewrite call is not), and `inspect.go:368` dereferences `*ip.Meshtastic.Cipher` with no guard while `Cipher` is assigned only at `inspect.go:217`, inside the decrypt path. `git log -L` puts the deref in `bf06311`, so the phase did not introduce it. It *did* widen exposure: before v0.0.72 every v5 client was rejected at 0x84 and could not reach the rules engine. Reassuring prod evidence over the deployed task's 2 h 57 m: `SIGSEGV` = 0, `panic` = 0, exactly one `Proxy server started` line (no restart), and real `TEXT_MESSAGE_APP` publishes flowed on both codecs (Apple 3.1.1 20:44:50Z, Android v5 20:48:23Z) — the live fleet encrypts, so `Cipher` is non-nil on its traffic. Fix-vs-defer is a risk call for the event owner.

#### 2. Pre-existing `Data` field loss on every rewritten TEXT_MESSAGE (68-REVIEW CR-03)

**Test:** Confirm whether stripping `reply_id`, `emoji`, `dest`, `source`, `request_id` and `want_response` from every text message on the live fleet is acceptable through the event.
**Expected:** `RewritePayloadString` mutates `ip.Meshtastic.Decoded` in place rather than rebuilding a fresh `meshtastic.Data` from three fields; `proto.Marshal`'s error stops being discarded with `_`.
**Why human:** Live, user-visible data loss on **both** codecs right now — 2.8 tapbacks, threaded replies, delivery-ACK requests and DM routing fields vanish between sender and mesh. The verifier confirmed the three-field rebuild in the shipped source and dated it to `bf06311`, with the `Bitfield:` line added later by `0339a0c` (meshtk#21) — both pre-phase. Whether to touch the encrypt/remarshal path six days out is a judgment call.

#### 3. Pre-existing Last-Will inspection bypass (68-REVIEW CR-02)

**Test:** Decide whether to strip Wills at CONNECT time on both codecs.
**Expected:** `WillFlag`/`WillTopic`/`WillMessage`/`WillProperties` cleared and logged in `inspectV5Connect`, mirrored in the 3.1.1 CONNECT branch — or the Will payload routed through `inspectMeshtastic` + `PacketDecider` with a Block refusing the CONNECT.
**Why human:** Verified codec-symmetric and pre-existing: `grep -n Will` across `inspect.go`, `inspect_v5.go` and `proxy.go` returns **nothing**, so neither codec has ever inspected a Will. It satisfies SC3's literal wording while leaving a client-chosen, replayable path to inject an unclamped `hop_limit=7` broadcast — the exact amplification `RewriteHopLimit`'s own comment says it exists to stop.

### Warnings (no owner decision needed — candidates for a follow-up item)

| # | Finding | Assessment |
|---|---------|-----------|
| W1 | The hand-parsed PUBLISH path Blocks on an empty topic but not on a `TopicAlias` **property** the way the codec path does (`proxy_v5.go:332` vs `:368`), so its "mirroring decision for decision" comment overstates it (68-REVIEW WR-01) | Real divergence, low impact, and **not a v5-vs-3.1.1 parity gap** — 3.1.1 has no topic aliases. The dangerous case (a blank topic blinding every topic rule) *is* guarded on both paths, and A5 leaves the broker a zero alias budget by stripping `TopicAliasMaximum` from both CONNECT and CONNACK. Falsifies no 68-07 truth |
| W2 | A v5 SUBSCRIBE the codec cannot parse is relayed uninspected (`proxy_v5.go:226-236`), re-opening codec-dependent inspection one layer up (68-REVIEW WR-04) | Declared in-code as accepted risk **T-68-06-05** with a stated rationale. Security delta today is zero: `AllowMQTTControl` allows every SUBSCRIBE, so there is no topic Block rule to evade — the inspection is currently informational. Becomes real the moment a topic Block rule ships; worth a follow-up item then |
| W3 | `rules.go` calls `ip.RewritePayloadString()` as a bare statement, discarding both return values `(error, bool)` | Pre-existing signature and pre-existing call shape. Folded into escalation item 2's fix |
| W4 | A `writeToBackend` failure logs only the TCP 4-tuple, so correlating a dropped client to a session needs hand-matching timestamps | Already captured in `deferred-items.md` alongside the proxy→mosquitto `broken pipe` investigation. Confirmed out of scope: pre-existing and shared with the 3.1.1 loop |
| W5 | `describe-log-streams` reports a `lastEventTimestamp` ~2 h stale on the active stream | AWS metadata artifact, not a phase defect. Recorded because it would mislead the next verifier into concluding the proxy had stopped logging — `get-log-events` shows events arriving in real time |

### Deferred Items

`deferred-items.md` records two out-of-scope discoveries. Both were re-checked against later ROADMAP phases: **no later phase in this milestone claims either**, so they remain open follow-ups rather than roadmap-deferred items. Neither is a phase-68 gap.

| # | Item | Verifier assessment |
|---|------|--------------------|
| 1 | `internal/credcache` flaky `TestSingleflight_DeduplicatesConcurrentFetches` | Confirmed unreachable from this phase — `go list -deps ./internal/credcache` shows zero meshtk dependencies. The verifier used `./internal/app/server/` as its gate, which was stable across every run |
| 2 | proxy→mosquitto socket dies mid-session (`broken pipe`) | Confirmed pre-existing and shared with the 3.1.1 loop. On the currently-live Android session the verifier measured **76 min 35 s with no reconnect at all** — materially better than the churn 68-08 observed, which weakens hypothesis (3) (duplicate-client-id takeover) as the dominant cause |

## Gaps Summary

**No gaps.** The phase goal is achieved, and the two ROADMAP Success Criteria that failed in the previous verification are now among the best-evidenced items in this report:

- **SC1** went from "zero organic v5 sessions in 14 h of telemetry" to a live Android 2.8 session that has been continuously connected for 76 minutes at the moment of verification, across 8 distinct session ids, publishing NODEINFO / POSITION / TEXT_MESSAGE that all pass the rules.
- **SC3**'s four defects are each closed in the shipped source, covered by wire-byte tests, exercised end to end against a real mosquitto, **and** observed working on the production wire through the proxy's own telemetry — most decisively CR-04, where a frame that v0.0.72 relayed uninspected now produces a correlated `MQTT5_PARSE_FAIL → BLOCK → "Failed to decrypt with any known key"` sequence, proving the hand-parser recovered the topic, decoded the envelope and reached `BlockInvalidEncryption`.

The gap-closure work also held the line on what it must not disturb: `proxy.go` was not touched by 68-06/07, the byte-identity golden still has exactly one commit in its history, `embedded.go` is unchanged, and 3.1.1 ALLOW traffic never hit zero across the v0.0.73 rollover.

**What keeps this from a clean `passed`:** three pre-existing defects in the *shared* inspection chain — a remotely-triggerable whole-process panic, silent `Data` field loss on every rewritten text message, and an uninspected Last-Will path. None is a phase-68 regression; all three are codec-symmetric, which is exactly why SC3's parity wording survives them. But two are live risks with the event six days out, and one of them (the panic) became reachable from a second codec because of this phase. They need an owner's fix-or-defer decision, not another verification pass.

**One qualification, not a gap:** 68-08's "nine-minute idle" bar cannot be produced by the real Android client, which publishes every ~67 s. The invariant behind it is proven at 480 s idle in production twice over, and real-client session longevity is proven at 76 min 35 s unbroken.

---

_Verified: 2026-07-29T21:50:00Z_
_Verifier: Claude (gsd-verifier)_
