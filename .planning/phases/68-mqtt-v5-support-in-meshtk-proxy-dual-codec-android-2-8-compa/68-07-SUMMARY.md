---
phase: 68-mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa
plan: 07
subsystem: infra
tags: [mqtt, mqtt5, paho.golang, meshtk, proxy, go, fail-closed, rules-engine, e2e]

requires:
  - phase: 68-02
    provides: inspectV5Publish, handleV5PublishUplink, setPublishPayload codec dispatch, the WireRewritten forwarding contract
  - phase: 68-03
    provides: TestE2EDualCodec — the live-mosquitto harness and its eleven subtests
  - phase: 68-06
    provides: branch fix/mqtt5-v5-parity, touchConnTrack, writeMqtt5Disconnect, the explicit frame switch, inspectV5Subscribe
provides:
  - "parseV5PublishFrame — a property-agnostic hand parser for a v5 PUBLISH fixed+variable header"
  - "spliceV5PublishPayload — payload replacement that preserves the property block byte-for-byte"
  - "v5RawPublish — the hand-parsed PUBLISH view (QoS, Topic, VarHeaderOffset, PayloadOffset, Payload)"
  - "RawPacket.MQTT5Raw + a third setPublishPayload dispatch case"
  - "(*ServerCmd).inspectV5RawPublish — inspectV5Publish sourced from the hand-parsed view"
  - "(*ServerCmd).decideV5Publish — the single decide/log sequence both v5 PUBLISH paths use"
  - "action=MQTT5_PUBLISH_HEADER_FAIL log action"
  - "4 new TestE2EDualCodec subtests covering CR-02, CR-03, CR-04 and WR-04 against a live broker"
affects: [68-08, mqtt-proxy-observability]

tech-stack:
  added: []
  patterns:
    - "Two-parser contrast: a strict codec for the common case, a deliberately dumb length-prefix walker as the fail-closed fallback, with a test that asserts the two DISAGREE on the fixture"
    - "Splice-don't-re-encode: rebuild a frame around a new payload by copying the original variable-header byte range, which preserves fields the codec cannot represent"
    - "Shared decision helper across codec paths, so an exempt path cannot drift to a softer decision than the one the fleet is judged by"

key-files:
  created:
    - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5_rawpublish.go
    - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5_rawpublish_test.go
  modified:
    - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5.go
    - /Users/khundeck/working/meshtk/internal/app/server/inspect.go
    - /Users/khundeck/working/meshtk/internal/app/server/inspect_v5.go
    - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5_e2e_test.go

key-decisions:
  - "PUBLISH fails CLOSED. A PUBLISH nothing can read ends the connection, matching the 3.1.1 loop. This does not contradict the locked 'unknown packet types forward raw' decision, which governs types the proxy has no reason to inspect — they still relay in the frame switch's default arm"
  - "The rewrite is applied by SPLICING the new payload into the captured frame, not by a codec round trip: the codec cannot represent properties it refused to parse, whereas copying frame[VarHeaderOffset:PayloadOffset] preserves them exactly"
  - "A splice error is a Block-and-drop, never a silent forward of the unclamped original — that direction is the meshtk#22 failure mode"
  - "parseV5PublishFrame makes NO policy decisions: an empty topic is reported, and handleV5PublishUplink is what Blocks it. A parser that judged would be a second place for the topic rule to live"
  - "QoS 3 is rejected by the parser as malformed (MQTT 5.0 3.3.1.2) — the packet-id layout is undefined for it, so there is nothing honest to parse"
  - "decideV5Publish was extracted rather than duplicated, so the hand-parsed path provably runs the SAME Allow/Block/default switch and the same ALLOW/BLOCK lines as the codec path"
  - "MEASURED: mosquitto 2.0.22 refuses a client-chosen unknown property id with a malformed-packet disconnect, so no spec-conformant broker will route the CR-04 fixture. The e2e clamp subtest therefore asserts the full inspection chain live and leaves the forwarded-BYTES assertion to the unit test, which reads them directly"

requirements-completed: [MQV5-04, MQV5-05, MQV5-06]

coverage:
  - id: D1
    description: "CR-04 closed — a v5 PUBLISH carrying a property id the codec does not model is inspected: its topic and ServiceEnvelope reach the InspectorPacket and PacketDecider"
    requirement: MQV5-04
    verification:
      - kind: unit
        ref: "internal/app/server/proxy_v5_rawpublish_test.go#TestParseV5PublishFrameUnmodelledProperty"
        status: pass
      - kind: unit
        ref: "internal/app/server/proxy_v5_rawpublish_test.go#TestV5UnmodelledPropertyPublishIsClamped"
        status: pass
      - kind: e2e
        ref: "internal/app/server/proxy_v5_e2e_test.go#TestE2EDualCodec/v5_unmodelled_property_publish_is_clamped_end_to_end"
        status: pass
    human_judgment: false
  - id: D2
    description: "RewriteHopLimit lands on the wire for such a frame — the forwarded bytes decode to HopLimit 3 / HopStart 7 while every unmodelled property byte survives verbatim"
    requirement: MQV5-04
    verification:
      - kind: unit
        ref: "internal/app/server/proxy_v5_rawpublish_test.go#TestV5UnmodelledPropertyPublishIsClamped"
        status: pass
      - kind: unit
        ref: "internal/app/server/proxy_v5_rawpublish_test.go#TestSpliceV5PublishPayloadPreservesProperties"
        status: pass
    human_judgment: false
  - id: D3
    description: "A Block rule fires on such a frame: an undecryptable envelope wrapped in an unmodelled property is Blocked and zero bytes reach the backend"
    requirement: MQV5-05
    verification:
      - kind: unit
        ref: "internal/app/server/proxy_v5_rawpublish_test.go#TestV5UnmodelledPropertyPublishBlockRuleFires"
        status: pass
      - kind: unit
        ref: "internal/app/server/proxy_v5_rawpublish_test.go#TestV5UnmodelledPropertyPublishEmptyTopicBlocked"
        status: pass
    human_judgment: false
  - id: D4
    description: "A v5 PUBLISH whose variable header cannot be hand-parsed is refused, not relayed — the connection is dropped as the 3.1.1 loop does"
    requirement: MQV5-05
    verification:
      - kind: unit
        ref: "internal/app/server/proxy_v5_rawpublish_test.go#TestV5MalformedPublishFailsClosed"
        status: pass
      - kind: unit
        ref: "internal/app/server/proxy_v5_rawpublish_test.go#TestParseV5PublishFrameTruncated"
        status: pass
      - kind: unit
        ref: "internal/app/server/proxy_v5_rawpublish_test.go#TestParseV5PublishFrameOversizeRejected"
        status: pass
    human_judgment: false
  - id: D5
    description: "An unmodelled-property PUBLISH no rule mutated is forwarded byte-identical to the captured frame"
    requirement: MQV5-05
    verification:
      - kind: unit
        ref: "internal/app/server/proxy_v5_rawpublish_test.go#TestV5UnmodelledPropertyPublishUnchangedIsByteIdentical"
        status: pass
      - kind: unit
        ref: "internal/app/server/proxy_v5_rawpublish_test.go#TestSpliceV5PublishPayloadIdentity"
        status: pass
    human_judgment: false
  - id: D6
    description: "The 3.1.1 path is untouched — proxy.go has an empty diff, proxy_v4_golden_test.go is byte-identical (sha256 e49ae2ed…) and green, and no pre-existing test file was edited"
    requirement: MQV5-05
    verification:
      - kind: unit
        ref: "internal/app/server/proxy_v4_golden_test.go#TestV4SessionForwardBytesGolden"
        status: pass
      - kind: other
        ref: "git diff --numstat main -- internal/app/server/proxy.go (empty) && shasum -a 256 internal/app/server/proxy_v4_golden_test.go"
        status: pass
    human_judgment: false
  - id: D7
    description: "All four closed defects are demonstrated against a live mosquitto with a 3.1.1 client sharing the run, and the eleven pre-existing subtests still pass unmodified"
    requirement: MQV5-06
    verification:
      - kind: e2e
        ref: "MESHTK_E2E=1 go test -run TestE2EDualCodec — 15/15 subtests, mosquitto 2.0.22"
        status: pass
    human_judgment: false
  - id: D8
    description: "The fix behaves correctly against the live fleet — a real Android 2.8 client publishes through the hand-parsed path without spurious MQTT5_PUBLISH_HEADER_FAIL, and MQTT5_PARSE_FAIL stays at its prod baseline of zero"
    verification: []
    human_judgment: true
    rationale: "Unit and live-broker tests prove the wire contract; only the 68-08 vendor-sync + deploy and Kurt's radio/APK UAT can prove the live fleet behaves. Deferred to 68-08 by design."

duration: 19min
completed: 2026-07-29
status: complete
---

# Phase 68 Plan 07: CR-04 — The v5 PUBLISH Inspection Exemption, Closed Summary

**Three client-chosen bytes in a PUBLISH property block no longer buy a permanent exemption from the topic guard, the inspector, `PacketDecider.Decide`, `RewriteHopLimit`, `BlockInvalidEncryption` and every Block rule — the frame is hand-parsed and judged anyway, and a frame nothing can read is refused rather than relayed.**

## Performance

- **Duration:** 19 min
- **Started:** 2026-07-29T18:00:38Z
- **Completed:** 2026-07-29T18:19:38Z
- **Tasks:** 3 (2 TDD RED/GREEN, 1 test-only)
- **Files:** 6 in the UPSTREAM repo (2 created, 4 modified)

## Accomplishments

- **CR-04 closed, and the design got stronger rather than weaker.** `handleV5PublishUplink`'s `v5.ReadPacket` failure branch used to relay the frame and return success. It now hands the captured bytes to `parseV5PublishFrame`, a deliberately dumb walker that reads only what the MQTT 5.0 wire format guarantees is skippable without knowing any property id — topic length, optional packet id, property-block length — and never reads a single property. Because no property table is consulted, no property table can gate inspection ever again.
- **The rewrite reaches the wire by splicing, not re-encoding.** `spliceV5PublishPayload` emits the original fixed-header byte, a re-encoded remaining length, `frame[VarHeaderOffset:PayloadOffset]` copied verbatim, then the new payload. This is strictly stronger than a codec round trip on this path: the codec cannot represent the properties it refused to parse, so a re-encode would drop them. `TestSpliceV5PublishPayloadPreservesProperties` pins that the unmodelled `02 7f 00` block survives a payload that grows across the 127-byte varint boundary (remaining length `0x09` → `0x80 0x01`, both asserted byte-for-byte).
- **Fail closed on an unreadable frame.** A PUBLISH whose own length prefixes contradict its bytes logs `action=MQTT5_PUBLISH_HEADER_FAIL`, emits the BLOCK line and drops the connection — the same thing the 3.1.1 loop does with a packet its codec cannot read, and a frame mosquitto would refuse anyway. This does not contradict the locked "unknown packet types forward raw" decision: PUBLISH is a HANDLED type, and the unhandled types still relay in the frame switch's `default` arm untouched.
- **`decideV5Publish` was extracted, not duplicated.** Both the codec-parsed and hand-parsed paths call it, so the exempt path provably runs the same Allow/Block/default switch, the same `WriteDecisionLog`, the same `[proxy] ALLOW`/`[proxy] BLOCK` lines and the same Block-returns-false. Two copies of that switch would have been two chances for the fallback to drift into a softer decision than the one the fleet is judged by.
- **The e2e now covers all four defects the phase closed**, with 15/15 subtests green against mosquitto 2.0.22 and the eleven original subtests unmodified (`git diff main -- proxy_v5_e2e_test.go | grep -c '^-[^-]'` = 0).
- **A measurement that corrects the plan** (see Deviations): mosquitto refuses a client-chosen unknown property id with a malformed-packet disconnect, so no spec-conformant broker will route the CR-04 fixture. The severity of CR-04 is undiminished — the exemption disabled every PROXY-side control, which is what the hop clamp and the Block rules are — but the "3.1.1 subscriber decodes 3/7 off the unmodelled frame" assertion is physically unavailable and now lives in the unit test that reads the forwarded bytes directly.

## Task Commits

Branch **`fix/mqtt5-v5-parity`** on `/Users/khundeck/working/meshtk`, cut from `main` at `d340f36`. NOT pushed or PR'd — the vendor-sync and release are plan 68-08.

| # | Commit | What |
|---|---|---|
| 1 | `99ef70b` (test) | Task 1 RED — ten failing behaviors for the parser and the splicer |
| 2 | `c5eec06` (fix) | Task 1 GREEN — `proxy_v5_rawpublish.go`: `v5RawPublish`, `parseV5PublishFrame`, `spliceV5PublishPayload` |
| 3 | `0fe7c5d` (test) | Task 2 RED — six failing behaviors for the fail-closed uplink path |
| 4 | `5fad569` (fix) | Task 2 GREEN — the fallback, `inspectV5RawPublish`, `RawPacket.MQTT5Raw`, the third dispatch case, the comment corrections |
| 5 | `9cb63fa` (test) | Task 3 — four new `TestE2EDualCodec` subtests |

No REFACTOR commits were needed.

## Files Created/Modified

Upstream `/Users/khundeck/working/meshtk` (`git diff --numstat main`, this plan's rows in bold):

| File | +/- | What changed |
|---|---|---|
| **`internal/app/server/proxy_v5_rawpublish.go`** | **+202/-0** | **New — the hand parser, the splicer, and the shared VBI codec** |
| **`internal/app/server/proxy_v5_rawpublish_test.go`** | **+628/-0** | **New — 16 tests (10 parser/splicer + 6 uplink)** |
| **`internal/app/server/proxy_v5.go`** | **+185/-35** | **Fail-closed fallback in `handleV5PublishUplink`; `decideV5Publish` extracted; posture comments corrected** (68-06 contributed +93/-10 of this) |
| **`internal/app/server/inspect.go`** | **+41/-8** | **`RawPacket.MQTT5Raw`, third `setPublishPayload` case, three comment corrections** (68-06 contributed +18/-0) |
| **`internal/app/server/inspect_v5.go`** | **+71/-0** | **`inspectV5RawPublish`** (68-06 contributed +33/-0) |
| **`internal/app/server/proxy_v5_e2e_test.go`** | **+212/-0** | **Four new subtests, added-to only** |
| `internal/app/server/proxy_v5_parity_test.go` | +722/-0 | 68-06, untouched here |
| `internal/app/server/rules.go` | +36/-16 | 68-06, untouched here |

`git diff --name-only main` lists exactly those eight — the union of 68-06's five and this plan's six — and `git status --porcelain` is empty. Nothing under `internal/app/fleet/`, `internal/embedded/` or `internal/mqtt/`.

## Exact fixture bytes

| Fixture | Bytes | Purpose |
|---|---|---|
| CR-04 unmodelled property (recorded) | `300a0003616263027f006869` | `30` PUBLISH QoS0 · `0a` remLen 10 · `0003 616263` topic `abc` · `02` property block length · `7f 00` property id 0x7f, outside paho.golang's table · `6869` payload `hi`. The codec errors; the hand parser reads topic `abc`, payload `hi`, `VarHeaderOffset` 2, `PayloadOffset` 10 |
| Unmodelled-property envelope carrier | `30 <varint> 001b 6d73682f55532f322f652f64632e72756e2f213433353939306534 02 7f 00 <ServiceEnvelope>` | Same shape wrapping a real NODEINFO envelope on `msh/US/2/e/dc.run/!435990e4`; built by `unmodelledPropertyFrame`, which asserts `v5.ReadPacket` really does refuse it |
| Unreadable header (fail-closed) | `3006 0003616263 80` | A property-length varint that never terminates. Both parsers refuse; the connection is dropped |
| Oversize | `30818010` | Declared remaining length 262145 = `maxV5PacketBytes` + 1, rejected before any indexing |
| Truncated set | `30040005 6162` · `3206 0003616263 12` · `3006 0003616263 80` · `3008 0003616263 05 7f00` · `30ff …` · `3002 …` | Inside the topic, the packet id, the property-length varint, the property block, and both directions of a declared-length disagreement |
| Splice boundary | remLen `0x09` (8-byte variable header + 1) and `0x80 0x01` (8 + 120 = 128) | Pins that the rebuilt varint is correct on both sides of the 127-byte boundary |
| Topic alias (unchanged, 68-02) | `300b00000323000368656c6c6f` | Still Blocked on the parseable path |

## Before/after forwarded-payload hop values

`TestV5UnmodelledPropertyPublishIsClamped` publishes a NODEINFO `ServiceEnvelope` with **`hop_limit = 7`, `hop_start = 9`** inside the unmodelled-property carrier, then locates the payload in the FORWARDED frame with the hand parser (never by assuming an offset — the codec cannot read that frame) and decodes it:

- **In:** `hop_limit 7`, `hop_start 9` — the values the client chose.
- **Out:** **`hop_limit 3`, `hop_start 7`** — the RF flood-radius cap, with `Data.bitfield` still present (2.8 firmware drops decoded packets whose bitfield is absent).
- The forwarded frame is **not** byte-equal to the captured one (asserted), its topic is unchanged, and `frame[VarHeaderOffset:PayloadOffset]` is byte-identical across the rewrite — the `02 7f 00` property block included.

Before this plan the same frame reached the backend **byte-identical at 7/9**, which is what the verifier recorded as PROBE-A.

## e2e subtest roster — 15/15 PASS

`MESHTK_E2E=1 go test ./internal/app/server/ -run TestE2EDualCodec -count=1` against `/opt/homebrew/sbin/mosquitto` **2.0.22**, run three times, all green.

| # | Subtest | Origin |
|---|---|---|
| 1 | `v5_bad_credentials_rejected_before_broker` | 68-03 |
| 2 | `v5_enhanced_auth_rejected_before_broker` | 68-03 |
| 3 | `v5_connect_swaps_identity_and_strips_alias_max` | 68-03 |
| 4 | `mqtt3_client_connects_alongside_the_v5_client` | 68-03 |
| 5 | `v5_subscribe_relayed_raw_and_suback_returned` | 68-03 |
| 6 | **`v5_subscribe_is_logged_by_the_proxy`** | **68-07 (WR-04)** |
| 7 | **`v5_second_connect_refused_and_broker_never_sees_it`** | **68-07 (CR-03)** |
| 8 | `v5_qos0_publish_forwarded_and_reaches_the_mqtt3_client` | 68-03 |
| 9 | `v5_qos1_publish_hop_clamped_pubacked_and_allowed` | 68-03 |
| 10 | `v5_downlink_carries_the_full_topic_and_no_alias` | 68-03 |
| 11 | **`v5_unmodelled_property_publish_is_clamped_end_to_end`** | **68-07 (CR-04)** |
| 12 | **`v5_idle_session_survives_and_publishes`** | **68-07 (CR-02)** |
| 13 | `v5_pingreq_gets_pingresp` | 68-03 |
| 14 | `mqtt3_client_disconnects_cleanly` | 68-03 |
| 15 | `v5_zero_length_disconnect_is_graceful` | 68-03 |

No existing subtest was weakened or re-timed, and the two new negative assertions poll for positive signals instead of sleeping: the second-CONNECT subtest waits for its own `New client connected` line by client id, and the idle subtest backdates `ConnectTime` to `now-200` rather than sleeping out the 180s reaper window.

## Re-measured golden sha256

```
e49ae2ed7c93f62c0607aa04aa34c6c0521dbe88c0e147eba2f3b904951757d6  internal/app/server/proxy_v4_golden_test.go
```

Unchanged, and `TestV4SessionForwardBytesGolden` is green **after** the `setPublishPayload` edit — which is the whole reason the golden exists, since that function is on the 3.1.1 rewrite path too. `git diff --numstat main -- internal/app/server/proxy.go` is empty.

## Deviations from Plan

**1. [Rule 1 — falsified plan assumption] `v5_unmodelled_property_publish_is_clamped_end_to_end` cannot assert on what the 3.1.1 subscriber received, because mosquitto refuses the frame.**

- **Found during:** Task 3, on the first gated e2e run.
- **Measured:** mosquitto 2.0.22 logged `Client mqttastic-e2e-v5 disconnected due to malformed packet` and never logged a `Received PUBLISH` for the frame. MQTT 5.0 §2.2.2 makes an unrecognised property identifier a Malformed Packet, and mosquitto's `property__read` returns `MOSQ_ERR_MALFORMED_PACKET` on its `default` arm. The collateral damage was visible too: the shared v5 session was torn down, which failed the three subtests that ran after it.
- **Why no fixture substitution was possible:** paho.golang's `ValidProperties` table for PUBLISH is exactly the MQTT 5.0 PUBLISH property set (0x01, 0x02, 0x03, 0x08, 0x09, 0x0B, 0x23, 0x26), and its only other `Publish.Unpack` failure modes are truncation. So for a PUBLISH there is **no** frame that `v5.ReadPacket` refuses and a spec-conformant broker accepts. Every candidate examined (non-minimal varints, duplicate properties, out-of-range `PayloadFormatIndicator`, client-sent `SubscriptionIdentifier`) fails in the *opposite* direction — paho accepts and mosquitto refuses.
- **Fix:** the subtest keeps its name and now runs on its **own** v5 connection (containing mosquitto's disconnect) and asserts, live: (1) `action=MQTT5_PARSE_FAIL` — the CR-04 trigger really fired; (2) no `MQTT5_PUBLISH_HEADER_FAIL` — the hand parser read it; (3) `action=ALLOW` carrying `mqtt_type=PUBLISH`, the exact topic, `mesh_type=NODEINFO_APP` and `mesh_from=435990e4` — the entire inspection chain CR-04 skipped, running against a real broker; (4) mosquitto's malformed-packet disconnect for that client id — proving the forwarded bytes reached the broker rather than being dropped. The forwarded-BYTES hop assertion is where it can actually be made: `TestV5UnmodelledPropertyPublishIsClamped`, which decodes the forwarded frame directly.
- **Impact on the finding:** none on severity. CR-04 disabled every PROXY-side control — the topic guard, the decider, the hop clamp, `BlockInvalidEncryption` — for any client willing to spend three bytes. Whether a particular broker then also refuses the frame is not the proxy's control to skip. It does mean the exemption could not have been used to *deliver* traffic through mosquitto specifically, which is a useful narrowing to record for 68-08's prod watch.
- **Files:** `internal/app/server/proxy_v5_e2e_test.go`. **Commit:** `9cb63fa`.

**2. [Shape] `decideV5Publish` was extracted from `handleV5PublishUplink` rather than the switch being duplicated.**
The plan says the fallback runs "the identical Allow/Block/default switch the parseable path uses — same decision logs, same ALLOW and BLOCK lines". Extraction is the only way to make "identical" a fact rather than a promise. The parseable path's behavior is unchanged (its tests and the v4 golden are the gate); `handleV5PublishUplink` now calls `decideV5Publish` twice.

**3. [Shape] The WR-10 posture comment was already corrected by 68-06, so this plan extended it instead of inverting it.**
The plan expected `proxy_v5.go`'s header to still assert the opposite of the code ("v5 PUBLISH inspection lands in plan 68-02 and fails closed until it does"). 68-06 had already replaced that sentence. The `handleProxyV5` doc comment now states the PUBLISH posture explicitly — inspected when the codec refuses, refused when nothing can read it, with T-68-02-06 named as retired — so an auditor reads the security model at the top of the file. All four `inspect.go`/`proxy_v5.go` comments the plan enumerated (the accepted-risk block, the `RawPacket` invariant, the `setPublishPayload` default error text, and `setPublishPayload`'s own doc comment at the fifth site the plan flagged as sitting outside both awk gates) were corrected.

**4. [Shape] The parser rejects QoS 3.**
Not in the plan's behavior list. MQTT 5.0 §3.3.1.2 makes QoS 3 a malformed packet and the packet-id layout is undefined for it, so there is nothing honest to parse — and the plan's posture for this path is fail-closed. Three lines, no test of its own.

**Total deviations:** 1 falsified-assumption fix, 3 shape notes. **Scope creep:** none — CR-01 (nil-`Cipher` dereference), CR-05 (`Data` fields dropped on rewrite) and WR-13 (gofmt) were all left alone as the plan requires, and no repo-wide `gofmt -w` was run.

## Issues Encountered

**Two RED tests passed at RED by design.** `TestV5UnmodelledPropertyPublishUnchangedIsByteIdentical` and `TestV5ParseablePublishPathUnchanged` are regression guards on behavior that must NOT change, so they were green before the fix — the same shape as 68-06's two relay guards. The four behavioral tests for CR-04 failed at RED exactly as expected. Task 1's RED was a compile failure (`undefined: parseV5PublishFrame`), the standard Go RED shape for new functions.

**The pre-existing `TestV5PublishParseFailureForwardsRaw` still passes, and that is not an accident.** It is a 68-02 test asserting the old relay behavior on the CR-04 fixture. Under the new code that frame is hand-parsed (topic `abc`, payload `hi`), decoded as an empty `ServiceEnvelope` with one unknown field, matched by no rule, and forwarded **byte-identically** with the `action=MQTT5_PARSE_FAIL mqtt_type=PUBLISH` line still emitted — so every assertion it makes still holds while the packet is now inspected. No pre-existing test file appears in `git diff --name-only main`.

**Pre-existing flake in an unrelated package (NOT fixed — out of scope).** `internal/credcache`'s `TestSingleflight_DeduplicatesConcurrentFetches` failed once during this plan's full-repo run and passed on three consecutive isolated re-runs. Confirmed pre-existing in 68-06 (3/12 isolated failures on a clean `main`; `go list -deps ./internal/credcache` shows zero meshtk dependencies) and already logged to `deferred-items.md`. **The phase-68 gate is `go test ./internal/app/server/`**, which is green under `-count=3` and `-race`.

## Verification Performed

- `go build ./...` — exit 0
- `go vet ./internal/app/server/` — exit 0
- `go test ./internal/app/server/ -count=3 -race` — ok
- All 16 new tests pass (10 parser/splicer, 6 uplink); every 68-02 and 68-06 behavior still holds
- `MESHTK_E2E=1 go test -run TestE2EDualCodec -count=1` — **15/15 subtests PASS**, three consecutive runs, mosquitto 2.0.22
- `shasum -a 256 internal/app/server/proxy_v4_golden_test.go` → `e49ae2ed7c93f62c0607aa04aa34c6c0521dbe88c0e147eba2f3b904951757d6` (unchanged); `TestV4SessionForwardBytesGolden` green after the `setPublishPayload` edit
- `git diff --numstat main -- internal/app/server/proxy.go` — empty
- `git diff main -- internal/app/server/proxy_v5_e2e_test.go | grep -c '^-[^-]'` — 0 (added to, never edited)
- Greps: `parseV5PublishFrame` def = 1, `spliceV5PublishPayload` def = 1, `maxV5PacketBytes` in the new file = 3 (≥2), `MQTT5_PUBLISH_HEADER_FAIL` = 1, `inspectV5RawPublish` def = 1, `SetConnTrack` inside it = 1, `parseV5PublishFrame` inside `handleV5PublishUplink` (comments stripped) = 1, `case ip.Raw` inside `setPublishPayload` = 4 (was 3 on `main`), old default error text = 0, `Exactly one of MQTT` in `RawPacket` = 0, all four new e2e subtest names = 1 each
- `git status --porcelain` — empty

## User Setup Required

None.

## Next Phase Readiness

Ready for **68-08**: PR `fix/mqtt5-v5-parity` upstream, vendor-sync `apps/run.mqtt/meshtk/`, release and deploy, then watch prod telemetry. Three metrics matter after the deploy:

- **`MQTT5_PUBLISH_HEADER_FAIL` — expected count zero.** A non-zero count means live clients are sending frames whose own length prefixes disagree with their bytes, and this plan drops those connections (accepted risk T-68-07-03). This is the single most important new signal.
- **`MQTT5_PARSE_FAIL` with `mqtt_type=PUBLISH`** — the prod baseline is 0. A rise means real clients are using properties `paho.golang v0.22.0` does not model, which now costs an inspection but not a session.
- **`MQTT5_PROTOCOL_VIOLATION`** — 68-06's signal (T-68-06-06); a rise would mean the stricter frame switch is tearing down legitimate mqttastic sessions.

Carry-forward landmines for 68-08, unchanged from 68-04/68-05/68-06: branch the monorepo from `origin/main`, never from `release/2026-07-26-230957`; `vendor/` is git-tracked in both repos and `Dockerfile.meshtk` does `COPY . .`, so a `go.mod` change without a matching `vendor/` fails the build with `inconsistent vendoring`; never touch `internal/embedded/gpx/embedded.go`; and `aws ecs wait services-stable` is not a drain gate for long-lived MQTT TCP — poll the old task to `STOPPED` before claiming the new image serves prod.

## Self-Check: PASSED

- Both claimed artifacts exist on disk (`proxy_v5_rawpublish.go`, `proxy_v5_rawpublish_test.go`), as does this SUMMARY
- All five claimed commits exist in the meshtk repo (`99ef70b`, `c5eec06`, `0fe7c5d`, `5fad569`, `9cb63fa`)
- No stubs: every function this plan added is fully wired and exercised by a passing test; no placeholder values, no TODOs

---
*Phase: 68-mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa*
*Completed: 2026-07-29*
