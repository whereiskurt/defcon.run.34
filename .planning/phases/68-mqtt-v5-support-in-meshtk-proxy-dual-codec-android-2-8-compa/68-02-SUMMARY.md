---
phase: 68-mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa
plan: 02
subsystem: infra
tags: [mqtt, mqtt5, paho, golang, meshtk, proxy, meshtastic, wire-protocol, hop-clamp, self-echo]

# Dependency graph
requires:
  - phase: 68-01
    provides: RawPacket.MQTT5, ConnectionInfo.ProtocolVersion, readFrame, handleProxyV5/handleBackendV5, inspectV5Connect, the rules nil-guard, and the pre-change v4 wire golden (54ddfbb)
  - phase: meshtk#22
    provides: RemarshalEnvelope hop-clamp-to-wire fix — the lesson every assertion in this plan is built around
provides:
  - setPublishPayload — codec-dispatched rewrite seam; RewriteHopLimit and RewritePayloadString now reach the v5 wire
  - InspectorPacket.WireRewritten — the forward-exactly-once flag the v5 uplink loop switches on
  - logDownlinkEnvelope — codec-independent downlink core; logDownlink is now a thin wrapper with an unchanged signature
  - inspectV5Publish — v5 envelope decode feeding the UNCHANGED InspectorPacket/PacketDecider
  - handleV5PublishUplink — real uplink PUBLISH path replacing 68-01's fail-closed placeholder
  - logDownlinkV5 + the handleBackendV5 PUBLISH branch — v5 downlink logging and self-echo suppression with no re-encode
  - action=BLOCK reason=topic_alias_uplink; action=MQTT5_PARSE_FAIL mqtt_type=PUBLISH / PUBLISH_DOWNLINK
affects: [68-03, 68-04 vendor-sync, 68-05 release]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Codec dispatch inside the rewrite seam, not inside every rule — the rules engine stays codec-agnostic"
    - "Forward EXACTLY once, chosen explicitly: re-encode iff WireRewritten, otherwise relay the captured frame"
    - "Downlink parse is READ-ONLY; the captured frame is always what gets written"
    - "Wire-byte assertions on the RE-ENCODED frame, never on struct fields"
    - "Extraction proved behavior-preserving by an untouched pre-change golden rather than by inspection"

key-files:
  created:
    - /Users/khundeck/working/meshtk/internal/app/server/inspect_v5_test.go
    - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5_publish_test.go
  modified:
    - /Users/khundeck/working/meshtk/internal/app/server/inspect.go (+56/-15 — setPublishPayload, WireRewritten, both rewrites redirected)
    - /Users/khundeck/working/meshtk/internal/app/server/inspect_v5.go (+55/-0 — inspectV5Publish, logDownlinkV5)
    - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5.go (+121/-8 — handleV5PublishUplink, writeToBackend, downlink PUBLISH branch)
    - /Users/khundeck/working/meshtk/internal/app/server/proxy.go (+19/-4 — logDownlink split into wrapper + logDownlinkEnvelope)

key-decisions:
  - "68-02: logDownlink and logDownlinkEnvelope both stay in proxy.go rather than moving to inspect.go. The plan explicitly permits either ('pick one file and keep the wrapper adjacent to the core'); keeping them put makes the 3.1.1 diff a 4-line rename plus a 2-line wrapper instead of a 50-line file move, and adjacency is preserved. proxy.go is now +26/-6 against origin/main (was +7/-2 after 68-01)."
  - "68-02: setPublishPayload returns an ERROR for a non-PUBLISH packet rather than silently doing nothing, which is what the old bare type switch did. A rewrite that cannot reach the wire is exactly the meshtk#22 failure mode, so it must be loud. Provably no v4 regression: RemarshalEnvelope is only reachable from RewriteHopLimit, which guards on ip.Raw.Meshtastic != nil and therefore only ever fires on a PUBLISH — and the v4 golden still passes byte-for-byte."
  - "68-02: handleV5PublishUplink was extracted as a method rather than inlined in handleProxyV5's loop. The loop needs a live socket pair and a full CONNECT to reach; the method is directly drivable with a captured frame and a writerConn, so all six uplink behaviors are tested against real wire bytes instead of through a scripted session."
  - "68-02: the hop-clamp fixture is a DECODED NODEINFO envelope, not an encrypted one. An encrypted payload with no configured cipher trips BlockInvalidEncryption before the forward, and a TEXT_MESSAGE payload reaches RewriteHelloGoodbye -> RewritePayloadString, which dereferences a nil ip.Meshtastic.Cipher and panics on a non-encrypted packet (a pre-existing landmine, untouched here). NODEINFO exercises the clamp, the decider and the ALLOW path with neither hazard."
  - "68-02: uplink parse failure RELAYS (accepted risk T-68-02-06); CONNECT parse failure still fails closed. Killing a live session over one unmodelled property is a worse outcome than relaying it — mosquitto's ACL still constrains the swapped identity, and every occurrence is greppable as action=MQTT5_PARSE_FAIL, mqtt_type=PUBLISH."
  - "68-02: downlink PUBLISH is NEVER re-encoded. Properties.SubscriptionIdentifier is modelled as a single pointer while MQTT 5.0 permits several on one PUBLISH (overlapping subscriptions), so a round trip would silently drop all but one; the downlink path needs only Payload and Topic."

patterns-established:
  - "One rewrite seam, two codecs: setPublishPayload is the single place either codec's PUBLISH payload is written, so a new codec is one case, not N rule edits"
  - "WireRewritten as an explicit forward-once switch — the alternative (write both, or mutate and forward the original) is the meshtk#22 bug class in both directions"
  - "Behavior-preserving extraction proved by a golden committed BEFORE the change and never edited (0 added / 0 deleted vs 54ddfbb), not by reading the diff"
  - "Log-line assertions via a buffer-backed logrus logger, so ops greps (action=BLOCK, reason=..., mqtt_type=...) are part of the tested contract"

requirements-completed: [MQV5-02, MQV5-04, MQV5-05]

coverage:
  - id: D1
    description: "A v5 uplink PUBLISH carrying a ServiceEnvelope is decoded, fed to the unchanged PacketDecider with the ORIGINAL client username, and forwarded"
    requirement: "MQV5-04"
    verification:
      - kind: unit
        ref: "internal/app/server/proxy_v5_publish_test.go#TestV5PublishFeedsDeciderWithTrackedUsername"
        status: pass
      - kind: other
        ref: "rules.go is unchanged by this plan — git diff --stat main -- internal/app/server/rules.go is still the 68-01 nil-guard alone (+7/-0)"
        status: pass
    human_judgment: false
  - id: D2
    description: "RewriteHopLimit applied to a v5 PUBLISH lands on the WIRE: decoding the re-encoded bytes yields HopLimit 3 and HopStart 7, with topic, QoS bits, packet id and the whole properties block preserved"
    requirement: "MQV5-04"
    verification:
      - kind: unit
        ref: "internal/app/server/proxy_v5_publish_test.go#TestV5PublishRewriteReachesTheWire"
        status: pass
      - kind: other
        ref: "IN/OUT frames differ in exactly 2 bytes (4807 7809 -> 4803 7807); see 'Hop-clamp wire fixtures' below"
        status: pass
    human_judgment: false
  - id: D3
    description: "A v5 PUBLISH that no rule mutated is forwarded as the captured frame, byte-identical"
    requirement: "MQV5-04"
    verification:
      - kind: unit
        ref: "internal/app/server/proxy_v5_publish_test.go#TestV5PublishUnchangedIsByteIdentical"
        status: pass
    human_judgment: false
  - id: D4
    description: "A v5 uplink PUBLISH with a TopicAlias property or an empty topic is BLOCKed and logged action=BLOCK reason=topic_alias_uplink; nothing reaches the broker"
    requirement: "MQV5-04"
    verification:
      - kind: unit
        ref: "internal/app/server/proxy_v5_publish_test.go#TestV5TopicAliasBlocked (fixture 300b00000323000368656c6c6f)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A v5 downlink PUBLISH whose gateway id matches the connection's own uplink gateway is suppressed; a different gateway's is written as the captured frame"
    requirement: "MQV5-04"
    verification:
      - kind: unit
        ref: "internal/app/server/proxy_v5_publish_test.go#TestV5DownlinkSelfEchoSuppressed, #TestV5DownlinkForwardsCapturedFrame"
        status: pass
    human_judgment: false
  - id: D6
    description: "The 3.1.1 logDownlink signature and behavior are unchanged; TestSelfEchoSuppression passes with a zero-line diff and the v4 wire golden still matches"
    requirement: "MQV5-04"
    verification:
      - kind: unit
        ref: "internal/app/server/proxy_selfecho_test.go#TestSelfEchoSuppression, internal/app/server/proxy_v4_golden_test.go#TestV4SessionForwardBytesGolden, internal/app/server/inspect_v5_test.go#TestLogDownlinkEnvelopeParity"
        status: pass
      - kind: other
        ref: "git diff --numstat main -- proxy_selfecho_test.go => no output (0/0); git diff --numstat 54ddfbb -- proxy_v4_golden_test.go => no output (0/0)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Exactly three v5 packet types are ever parsed (CONNECT, CONNACK, PUBLISH); an unparseable PUBLISH is relayed in both directions and the connection stays open"
    requirement: "MQV5-02"
    verification:
      - kind: unit
        ref: "internal/app/server/proxy_v5_publish_test.go#TestV5PublishParseFailureForwardsRaw, #TestV5DownlinkParseFailureForwardsRaw"
        status: pass
    human_judgment: false
  - id: D8
    description: "handleBackendV5 deadlines the backend socket and never the client socket"
    requirement: "MQV5-04"
    verification:
      - kind: unit
        ref: "internal/app/server/proxy_v5_publish_test.go#TestV5DownlinkDeadlineOnBackendSocket"
        status: pass
      - kind: other
        ref: "awk '/func \\(n \\*ServerCmd\\) handleBackendV5/,/^}/' internal/app/server/proxy_v5.go | grep -c 'conn.SetReadDeadline' => 0"
        status: pass
    human_judgment: false
  - id: D9
    description: "The rewrite seam cannot panic and cannot silently no-op"
    requirement: "MQV5-05"
    verification:
      - kind: unit
        ref: "internal/app/server/inspect_v5_test.go#TestSetPublishPayloadDispatch3111, #TestSetPublishPayloadDispatchV5, #TestSetPublishPayloadNeitherIsError, #TestSetPublishPayloadNonPublishIsError"
        status: pass
    human_judgment: false
  - id: D10
    description: "End-to-end behavior of a real v5 client (mqttastic / Android 2.8.0) through the deployed proxy"
    verification: []
    human_judgment: true
    rationale: "Still nothing deployed. The branch is local to /Users/khundeck/working/meshtk and has NOT been pushed, PR'd, vendor-synced or released. MQV5-06 (local mosquitto e2e) and MQV5-07 (prod verify + Kurt's APK UAT) are later plans in this phase."

# Metrics
duration: 11min
completed: 2026-07-29
status: complete
---

# Phase 68 Plan 02: v5 PUBLISH Parity Summary

**A v5 uplink PUBLISH is now decoded into the existing InspectorPacket, judged by an untouched PacketDecider, hop-clamped onto the actual v5 wire (proved by decoding the re-encoded bytes, not the struct), forwarded byte-exact when no rule fired, and refused when it hides behind a topic alias — while v5 downlink gained 3.1.1's logging and self-echo suppression without ever re-encoding a packet.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-07-29T06:13:09Z
- **Completed:** 2026-07-29T06:24:36Z
- **Tasks:** 3 (each RED → GREEN)
- **Files:** 2 created, 4 modified
- **Tests added:** 15 new test functions (5 in `inspect_v5_test.go`, 10 in `proxy_v5_publish_test.go`)

## Accomplishments

- **The hop clamp provably reaches the v5 wire.** `TestV5PublishRewriteReachesTheWire` re-parses the bytes handed to the broker and decodes the ServiceEnvelope out of them. The IN and OUT frames differ in exactly two bytes — `4807 7809` → `4803 7807` — with the topic, the `0x32` first byte, packet id `0x1234`, the MessageExpiry property and the User property all byte-identical. This is the assertion meshtk#22 did not have.
- **68-01's fail-closed placeholder is gone.** `grep -c v5_publish_inspection_pending proxy_v5.go` is 0; a v5 PUBLISH now goes through the same decide/forward sequence as 3.1.1.
- **Two latent bugs closed at once.** The bare `switch p := (*ip.Raw.MQTT).(type)` at the end of `RewritePayloadString` and `RemarshalEnvelope` would have *panicked* on a v5 packet (`Raw.MQTT` is nil) — and a panic in the read loop takes the process, not the connection. Had it merely failed to match, the hop clamp and the payload censor would have become silent no-ops for every Android client while rules reported `Rewrote`.
- **"The 3.1.1 path is unchanged" survived a refactor of the 3.1.1 path.** `logDownlink` was split and both rewrite functions were rewired, yet `TestV4SessionForwardBytesGolden` still passes and `proxy_v4_golden_test.go` has **0 added / 0 deleted lines against `54ddfbb`** — the SHA it was committed at, before any 68-01 source edit. The golden was not adjusted to fit the change; the change fits the golden.
- **No pre-existing test file was edited.** `proxy_selfecho_test.go`, `rules_hopclamp_test.go`, `proxy_downlink_test.go`, `proxy_timeout_test.go`, `inspect_auth_test.go`, `proxy_mqtt5_test.go`, `proxy_v5_test.go` and `proxy_v4_golden_test.go` are all 0/0 against their baselines.
- **The rules engine needed zero v5 awareness.** `git diff --stat main -- rules.go` is still the 68-01 nil-guard alone (+7/-0). Rules operate on `ip.Raw.Meshtastic`, so the envelope decode is the whole integration.
- **The read-deadline outage cannot come back on v5.** `TestV5DownlinkDeadlineOnBackendSocket` wraps both sockets in a counting `net.Conn` and asserts the client socket's deadline is touched **zero** times by the downlink goroutine.

## Task Commits

All commits on branch `feat/mqtt5-dual-codec` in the UPSTREAM repo `/Users/khundeck/working/meshtk` (continuing from 68-01's `8aa70ec`).

| # | Task | SHA | Type |
|---|------|-----|------|
| 1 | Task 1 RED — seam tests | `4ee0cf9` | test |
| 2 | Task 1 GREEN — `setPublishPayload`, `WireRewritten`, `logDownlinkEnvelope` | `5c31631` | feat |
| 3 | Task 2 RED — uplink PUBLISH wire tests | `c70e2f9` | test |
| 4 | Task 2 GREEN — `inspectV5Publish`, `handleV5PublishUplink`, alias block | `82ac220` | feat |
| 5 | Task 3 RED — downlink tests | `ae792d0` | test |
| 6 | Task 3 GREEN — `logDownlinkV5`, downlink PUBLISH branch | `2c3a9cb` | feat |

TDD gate sequence satisfied for all three tasks: a `test(...)` commit precedes each `feat(...)` commit, and each RED commit was verified failing (compile failure for tasks 1–2, assertion failures for task 3's two new behaviors) before the implementation was written.

**Plan metadata** is committed separately in the monorepo (`.planning/`).

## Recorded artifacts

### Hop-clamp wire fixtures

The fixture is a QoS1 v5 PUBLISH on `msh/US/2/e/dc.run/!435990e4`, packet id `0x1234`, properties `MessageExpiry=300` + `User{src: android}`, carrying a decoded NODEINFO ServiceEnvelope with `HopLimit 7 / HopStart 9`.

Captured frame (IN):

```
327f001b6d73682f55532f322f652f64632e72756e2f213433353939306534123414020000012c26000373
72630007616e64726f69640a360de490594315ffffffff35cdab34124807780922210804121b0a09213433
3539393065341209444333342074657374 1a035433344801120664632e72756e1a09213433353939306534
```

Forwarded frame (OUT, after `RewriteHopLimit` → `RemarshalEnvelope` → `setPublishPayload` → `cp.WriteTo`):

```
327f001b6d73682f55532f322f652f64632e72756e2f213433353939306534123414020000012c26000373
72630007616e64726f69640a360de490594315ffffffff35cdab34124803780722210804121b0a09213433
3539393065341209444333342074657374 1a035433344801120664632e72756e1a09213433353939306534
```

**Diff: exactly two bytes.** `48 07` → `48 03` (hop_limit 7 → 3) and `78 09` → `78 07` (hop_start 9 → 7, HOP_MAX). Same total length, so the `327f` fixed header is unchanged; every property byte and the packet id `1234` are identical.

### Other exact fixtures

| Fixture | Hex | Used by |
|---------|-----|---------|
| Topic-aliased uplink PUBLISH (empty topic, alias 3, payload "hello") | `300b00000323000368656c6c6f` | `TestV5TopicAliasBlocked` |
| PUBLISH with an unmodelled property id `0x7f` | `300a0003616263027f006869` | `TestV5PublishParseFailureForwardsRaw`, `TestV5DownlinkParseFailureForwardsRaw` (both assert the fixture genuinely fails `v5.ReadPacket` first) |

### No pre-existing test file changed

```
$ git diff --numstat main -- internal/app/server/proxy_selfecho_test.go \
    internal/app/server/rules_hopclamp_test.go internal/app/server/proxy_downlink_test.go \
    internal/app/server/proxy_timeout_test.go internal/app/server/inspect_auth_test.go \
    internal/app/server/proxy_mqtt5_test.go
(no output)

$ git diff --numstat 54ddfbb -- internal/app/server/proxy_v4_golden_test.go
(no output)
```

`proxy_v4_golden_test.go` and `proxy_v5_test.go` show as wholly-added against `main` only because they were created in 68-01; neither was edited by this plan.

### Diffstat for this plan (`8aa70ec..HEAD`)

| File | Diff |
|------|------|
| `internal/app/server/inspect.go` | +56 / -15 |
| `internal/app/server/inspect_v5.go` | +55 / -0 |
| `internal/app/server/proxy_v5.go` | +121 / -8 |
| `internal/app/server/proxy.go` | +19 / -4 |
| `internal/app/server/inspect_v5_test.go` | +166 (new) |
| `internal/app/server/proxy_v5_publish_test.go` | +498 (new) |

## Files Created/Modified

- `internal/app/server/inspect.go` — `InspectorPacket.WireRewritten`; `setPublishPayload(b []byte) error` dispatching on `Raw.MQTT` / `Raw.MQTT5`; both `RewritePayloadString` and `RemarshalEnvelope` now route through it with unchanged signatures
- `internal/app/server/inspect_v5.go` — `inspectV5Publish` (ConnTrack swap-in, topic, envelope decode, `rememberGateway`, `inspectMeshtastic`) and `logDownlinkV5`
- `internal/app/server/proxy_v5.go` — `handleV5PublishUplink` (parse a copy, alias guard, inspect, decide, forward exactly once), `writeToBackend`, the `handleBackendV5` PUBLISH branch, and the removal of the fail-closed placeholder
- `internal/app/server/proxy.go` — `logDownlink` is now a two-line wrapper over the extracted `logDownlinkEnvelope(conn, socketAddr, payload, topic)`; every comment moved with the body
- `internal/app/server/inspect_v5_test.go` (new) — 5 tests: three-way `setPublishPayload` dispatch, the non-PUBLISH error case, and wrapper/core parity across all five downlink gateway cases
- `internal/app/server/proxy_v5_publish_test.go` (new) — 10 tests: the six uplink behaviors and the four downlink behaviors, all against wire bytes

## Decisions Made

See `key-decisions` in the frontmatter. The three with the longest reach:

- **`logDownlink` stayed in `proxy.go`.** The plan permitted either file. Keeping it put made the 3.1.1 diff a 4-line rename plus a 2-line wrapper rather than a 50-line file move, and the wrapper is still adjacent to the core. Cost: `proxy.go` is now +26/-6 against `origin/main` instead of 68-01's +7/-2. That number is bought back by the golden, which pins the forwarded bytes for a whole 3.1.1 session and still passes untouched.
- **`setPublishPayload` errors on a non-PUBLISH packet.** The old type switch silently did nothing. Silence is the meshtk#22 failure mode, so the seam is loud instead — and it is provably not a v4 regression because `RemarshalEnvelope` is only reachable from `RewriteHopLimit`, whose matcher requires a decoded ServiceEnvelope and therefore a PUBLISH.
- **Downlink is parsed read-only and never re-encoded.** `Properties.SubscriptionIdentifier` is a single `*int` in paho.golang while MQTT 5.0 permits several on one PUBLISH; re-encoding a packet delivered against overlapping subscriptions would drop all but one.

## Deviations from Plan

### Auto-fixed Issues

None. No blocking issue, bug, or missing critical functionality was encountered.

### Plan-shape adaptations (behavior identical, no functional deviation)

1. **`logDownlink` / `logDownlinkEnvelope` live in `proxy.go`, not `inspect.go`.** The plan's action text offers exactly this choice ("or leave `logDownlink` in proxy.go and add the extracted core beside it — pick one file and keep the wrapper adjacent to the core") and the acceptance criterion greps `internal/app/server/*.go`, which is satisfied (total = 1). Task 1's `<files>` list named `inspect.go`; the smaller 3.1.1 diff won.

2. **The uplink PUBLISH body was extracted as `handleV5PublishUplink` rather than inlined into `handleProxyV5`'s loop.** The plan describes the logic as living in the loop. Inlined, it is only reachable through a live socket pair plus a full authenticated CONNECT; as a method it is drivable with a captured frame and a `writerConn`, so all six behaviors assert on real forwarded bytes instead of on a scripted session. `handleProxyV5`'s branch is now two lines calling it, and every plan grep still passes (`reason=topic_alias_uplink` = 1, `v5_publish_inspection_pending` = 0).

3. **An extra test beyond the listed behaviors: `TestSetPublishPayloadNonPublishIsError`.** The plan specified the neither-nil error case; the non-PUBLISH case is the other half of the same contract and documents the deliberate behavior change from "silently do nothing".

4. **The hop-clamp fixture uses a decoded NODEINFO envelope, not an encrypted one.** An encrypted payload with no configured cipher trips `BlockInvalidEncryption` and the packet never reaches the forward; a `TEXT_MESSAGE` payload reaches `RewriteHelloGoodbye` → `RewritePayloadString`, which dereferences a nil `ip.Meshtastic.Cipher` and panics on a non-encrypted packet. NODEINFO exercises the clamp, the decider and the ALLOW log path with neither hazard.

5. **A small `writeToBackend` helper** was added so the three forward sites (parse-fail relay, rewritten re-encode, byte-exact passthrough) share one error-log line instead of repeating it.

---

**Total deviations:** 0 auto-fixed; 5 plan-shape adaptations with no behavioral effect.
**Impact on plan:** No scope creep. Every acceptance criterion in all three tasks is satisfied literally, including all nine greps, both `awk`-scoped checks, and every numstat.

## Issues Encountered

- **Two of task 3's four behaviors passed on first run**, because 68-01's downlink loop already relayed everything raw and already deadlined only the backend socket. They are regression guards rather than drivers; only self-echo suppression and the `PUBLISH_DOWNLINK` parse-fail log were genuinely RED. This is recorded rather than hidden: a test that was green before the change did not drive the change.
- **`gofmt` drift is unchanged from 68-01.** `cmd.go`, `inspect.go`, `inspect_auth_test.go` and `proxy_mqtt5_test.go` remain unformatted; `gofmt -d inspect.go` shows the drift is confined to the pre-existing `Meshtastic` struct field alignment, which predates `origin/main`. All code added by this plan is gofmt-clean, and reformatting was left alone deliberately — it would pollute the "3.1.1 unchanged" diff.
- **A `net` import was missing from the first draft of `proxy_v5_publish_test.go`**, caught immediately by the RED run and fixed before the RED commit.

## Known Stubs

None. The fail-closed `v5_publish_inspection_pending` placeholder from 68-01 was the only stub in the v5 path and it is removed.

## Threat Flags

None. No new network endpoint, auth path, file-access pattern, or schema change was introduced; every trust boundary touched is already in the plan's `<threat_model>`. All six `mitigate` dispositions (T-68-02-01 through -05, -07) are implemented and each has a named test; T-68-02-06 remains `accept` with detection via `action=MQTT5_PARSE_FAIL, mqtt_type=PUBLISH`.

## User Setup Required

None. Note that nothing has shipped: the branch is local to `/Users/khundeck/working/meshtk` and has **not** been pushed, PR'd, vendor-synced to `apps/run.mqtt/meshtk/`, or deployed.

## Next Phase Readiness

**Ready for 68-03 and beyond:**

- The v5 path is functionally complete for CONNECT, CONNACK and PUBLISH in both directions; everything else relays as captured bytes.
- `go build ./... && go vet ./internal/app/server/ && go test ./...` all exit 0 from `/Users/khundeck/working/meshtk`; `git status --porcelain` is empty.
- The 3.1.1 golden and `TestSelfEchoSuppression` are the standing regression gate for any further edit to the shared path.

**Carried forward / not yet done:**

- MQV5-06 — local mosquitto e2e with a v5 and a 3.1.1 client in one run.
- MQV5-07 — upstream PR → vendor-sync → buildpub/deploy use1 → prod verify → Kurt's Android 2.8.0 APK UAT.
- **Landmine for 68-04 (repeated from 68-01):** the monorepo vendored snapshot is stale — branch from `origin/main`, never from `release/2026-07-26-230957`, or the sync REVERTS meshtk#22/#23. And never touch `apps/run.mqtt/meshtk/internal/embedded/gpx/embedded.go`.
- **Pre-existing landmine noticed, deliberately not fixed (out of scope):** `RewritePayloadString` dereferences `*ip.Meshtastic.Cipher` unconditionally, so `RewriteHelloGoodbye` panics on a non-encrypted `TEXT_MESSAGE_APP` packet. It predates this phase and affects 3.1.1 identically; fixing it would change 3.1.1 behavior, which this phase forbids.

## Self-Check: PASSED

Both created files exist on disk; all six commit SHAs (`4ee0cf9`, `5c31631`, `c70e2f9`, `82ac220`, `ae792d0`, `2c3a9cb`) resolve in `/Users/khundeck/working/meshtk`; `git status --porcelain` is empty there; `go build ./... && go vet ./internal/app/server/ && go test ./...` exits 0 with all 28 v5/golden/self-echo/hop-clamp tests passing.

---
*Phase: 68-mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa*
*Completed: 2026-07-29*
