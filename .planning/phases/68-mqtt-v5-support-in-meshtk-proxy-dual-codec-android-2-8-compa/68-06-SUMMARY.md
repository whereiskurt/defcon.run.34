---
phase: 68-mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa
plan: 06
subsystem: infra
tags: [mqtt, mqtt5, paho.golang, meshtk, proxy, go, conntrack, rules-engine]

requires:
  - phase: 68-01
    provides: v5 dual-codec seam — readFrame frame-capture relay, inspectV5Connect, handleProxyV5/handleBackendV5, the AllowMQTTControl nil-guard, and proxy_v4_golden_test.go
  - phase: 68-02
    provides: inspectV5Publish, handleV5PublishUplink, writeToBackend, WireRewritten forwarding contract
  - phase: 68-05
    provides: v5 dual codec live in prod (meshtk v0.0.72) — the deployment whose telemetry surfaced the SC3 parity gap
provides:
  - "(*ServerCmd).touchConnTrack — codec-independent ConnTrack idle-timer refresh"
  - "writeMqtt5Disconnect — spec-correct mid-session refusal answer (DISCONNECT, never a second CONNACK)"
  - "explicit frame-type switch in handleProxyV5: inspect / refuse / relay, no fallthrough"
  - "(*ServerCmd).inspectV5Subscribe — v5 mirror of the 3.1.1 SUBSCRIBE inspector"
  - "codec-independent AllowMQTTControl (dispatches on Raw.MQTT5 when Raw.MQTT is nil)"
  - "action=MQTT5_PROTOCOL_VIOLATION and action=MQTT5_PARSE_FAIL/mqtt_type=SUBSCRIBE log actions"
  - "proxy_v5_parity_test.go — wire-level harness driving the real handleProxyV5 against a real dialled backend"
affects: [68-07, 68-08, mqtt-proxy-observability]

tech-stack:
  added: []
  patterns:
    - "Session-level wire harness: real handleProxyV5 + real dialled TCP backend + net.Pipe client, asserting on recorded byte streams on BOTH sides"
    - "Frame-completeness polling (splitFrames over the proxy's own readFrame) as the happens-before edge between the proxy goroutine and the test"
    - "Matching-rule-NAME assertions for cross-codec parity, since DecisionResult carries no rule identity and a Decision-only assertion is vacuous under short-circuit"

key-files:
  created:
    - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5_parity_test.go
  modified:
    - /Users/khundeck/working/meshtk/internal/app/server/inspect.go
    - /Users/khundeck/working/meshtk/internal/app/server/inspect_v5.go
    - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5.go
    - /Users/khundeck/working/meshtk/internal/app/server/rules.go

key-decisions:
  - "touchConnTrack is called immediately after readFrame and BEFORE any type dispatch, so it covers every frame type including keepalives — mirroring the 3.1.1 loop where every inspectRawPacket branch calls SetConnTrack"
  - "touchConnTrack is update-if-exists ONLY: an entry born without a CONNECT would carry an empty Username and defeat RequireMQTTUserName, the rule the whole fix exists to keep satisfied"
  - "Mid-session violations are answered with DISCONNECT 0x82 (wire e0028200), not a second CONNACK — a CONNACK is only legal in response to a CONNECT on a fresh session"
  - "The refusal set is exactly CONNECT, AUTH and the four server-only types (CONNACK/SUBACK/UNSUBACK/PINGRESP); everything else, modelled or not, still relays raw, honoring the locked 'unknown types forward' decision"
  - "The SUBSCRIBE branch is INLINE in handleProxyV5 rather than extracted like handleV5PublishUplink, so the decider call is provably inside the loop"
  - "The v5 SUBSCRIBE parse is read-only and the CAPTURED frame is relayed — same subscription-identifier round-trip hazard that keeps the downlink from re-encoding"
  - "AllowMQTTControl reaches the 3.1.1 branch FIRST and keeps its cases and their order, so the decision sequence the v4 golden pins cannot move"

patterns-established:
  - "Every v5 frame type has a stated outcome in a switch; a fallthrough relay is no longer how the loop makes decisions"
  - "Cross-codec parity is asserted by rule NAME, not by 'not Blocked'"

requirements-completed: [MQV5-02, MQV5-03, MQV5-05]

coverage:
  - id: D1
    description: "CR-02 closed — a v5 session idle past the 180s reaper window keeps its ConnTrack entry, because every frame it sends (PINGREQ included) refreshes ConnectTime"
    requirement: MQV5-02
    verification:
      - kind: unit
        ref: "internal/app/server/proxy_v5_parity_test.go#TestV5PingreqRefreshesConnTrack"
        status: pass
      - kind: unit
        ref: "internal/app/server/proxy_v5_parity_test.go#TestV5IdleSessionSurvivesReaperWindow"
        status: pass
    human_judgment: false
  - id: D2
    description: "CR-03 closed — a second CONNECT and an AUTH frame are refused with DISCONNECT 0x82 and contribute zero bytes to the broker socket; the client's own password never crosses the proxy->broker socket"
    requirement: MQV5-03
    verification:
      - kind: unit
        ref: "internal/app/server/proxy_v5_parity_test.go#TestV5SecondConnectRefused"
        status: pass
      - kind: unit
        ref: "internal/app/server/proxy_v5_parity_test.go#TestV5AuthFrameRefused"
        status: pass
      - kind: unit
        ref: "internal/app/server/proxy_v5_parity_test.go#TestV5ServerOnlyFrameRefused"
        status: pass
    human_judgment: false
  - id: D3
    description: "The stricter frame switch does not tear down legitimate mqttastic traffic — PINGREQ and DISCONNECT still relay byte-identically"
    requirement: MQV5-02
    verification:
      - kind: unit
        ref: "internal/app/server/proxy_v5_parity_test.go#TestV5PingreqStillRelayedByteIdentical"
        status: pass
      - kind: unit
        ref: "internal/app/server/proxy_v5_parity_test.go#TestV5DisconnectFrameRelayed"
        status: pass
    human_judgment: false
  - id: D4
    description: "WR-04 closed — a v5 SUBSCRIBE reaches PacketDecider with MQTT.Type and its topic filters recorded, carries the tracked original username, and is relayed byte-identically"
    requirement: MQV5-02
    verification:
      - kind: unit
        ref: "internal/app/server/proxy_v5_parity_test.go#TestV5SubscribeReachesDecider"
        status: pass
      - kind: unit
        ref: "internal/app/server/proxy_v5_parity_test.go#TestV5SubscribeCarriesTrackedUsername"
        status: pass
      - kind: unit
        ref: "internal/app/server/proxy_v5_parity_test.go#TestV5SubscribeRelayedByteIdentical"
        status: pass
      - kind: unit
        ref: "internal/app/server/proxy_v5_parity_test.go#TestV5SubscribeParseFailureRelaysRaw"
        status: pass
    human_judgment: false
  - id: D5
    description: "The rules engine is codec-independent — a v5 and a 3.1.1 SUBSCRIBE match the same rule BY NAME, and AllowMQTTControl answers identically on both codecs with the 3.1.1 outcomes unchanged"
    requirement: MQV5-02
    verification:
      - kind: unit
        ref: "internal/app/server/proxy_v5_parity_test.go#TestV5SubscribeMatchesSameRuleAsV4"
        status: pass
      - kind: unit
        ref: "internal/app/server/proxy_v5_parity_test.go#TestAllowMQTTControlV5"
        status: pass
      - kind: unit
        ref: "internal/app/server/proxy_v5_parity_test.go#TestAllowMQTTControlV4Unchanged"
        status: pass
    human_judgment: false
  - id: D6
    description: "The 3.1.1 path is untouched — proxy.go has an empty diff, proxy_v4_golden_test.go is byte-identical (sha256 e49ae2ed…), and TestV4SessionForwardBytesGolden is green after the rules.go edit"
    requirement: MQV5-05
    verification:
      - kind: unit
        ref: "internal/app/server/proxy_v4_golden_test.go#TestV4SessionForwardBytesGolden"
        status: pass
      - kind: other
        ref: "git -C /Users/khundeck/working/meshtk diff --numstat main -- internal/app/server/proxy.go (empty) && shasum -a 256 internal/app/server/proxy_v4_golden_test.go"
        status: pass
    human_judgment: false
  - id: D7
    description: "The fix behaves correctly against a live mosquitto with a real Android 2.8 client — an idle session survives, a keepalive-only client is not torn down, and MQTT5_PROTOCOL_VIOLATION does not appear at volume in prod"
    verification: []
    human_judgment: true
    rationale: "Unit tests prove the wire contract against a synthetic backend; only the 68-08 vendor-sync + deploy and Kurt's radio/APK UAT can prove the live fleet behaves. Deferred to 68-08 by design."

duration: 11min
completed: 2026-07-29
status: complete
---

# Phase 68 Plan 06: v5 Parity — ConnTrack Refresh, Illegal-Frame Refusal, SUBSCRIBE Inspection Summary

**`handleProxyV5`'s non-PUBLISH relay branch — which special-cased PUBLISH and relayed everything else untracked, unauthenticated and unjudged — is now an explicit switch that refreshes the tracker on every frame, refuses credential-bearing frames with DISCONNECT 0x82, and runs SUBSCRIBE through the same rules engine 3.1.1 uses.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-07-29T17:44:28Z
- **Completed:** 2026-07-29T17:55:58Z
- **Tasks:** 2 (both TDD, RED then GREEN)
- **Files modified:** 5 (4 modified, 1 created) in the UPSTREAM repo

## Accomplishments

- **CR-02 (the one silently degrading every live Android session) closed.** `touchConnTrack` is called immediately after `readFrame`, before any type dispatch. The reaper in `SetupTracker` deletes any entry idle >180s, which is far shorter than the Meshtastic position cadence (~15 min), so a v5 session that only keepalived between publishes lost its tracker entry — and the next PUBLISH was Blocked with "Username required for MQTT" and the socket torn down. `TestV5IdleSessionSurvivesReaperWindow` is PROBE-B inverted: it backdates `ConnectTime` to `now-200`, sends one PINGREQ, evaluates the reaper's own `now - ConnectTime > 180` predicate, and then proves the following PUBLISH reaches the backend byte-identically and is logged `[proxy] ALLOW … user=ed270dbe5d1e`.
- **CR-03 closed.** CONNECT and AUTH — plus the four server-only types a client must never send — are refused with `action=MQTT5_PROTOCOL_VIOLATION` and a DISCONNECT carrying reason 0x82 (wire `e0028200`, measured), and return without writing anything to the backend. `TestV5SecondConnectRefused` proves the ENTIRE backend byte stream equals the establishing CONNECT exactly (zero further bytes) and that neither the attacker username nor its password appears anywhere in it — the invariant re-encoding the establishing CONNECT exists to protect, now held for the whole session rather than only its first packet.
- **WR-04 closed.** `inspectV5Subscribe` records `MQTT.Type` and `MQTT.Topics` (in filter order) and calls `SetConnTrack` so the tracked original username is in place before any rule reads it; `handleProxyV5` runs `PacketDecider.Decide` on it. `AllowMQTTControl` now dispatches on `Raw.MQTT5` when `Raw.MQTT` is nil, so the control-packet allowlist gives identical answers on both codecs.
- **Parity is asserted by rule NAME, not by "not Blocked."** `LoadInspectorRules` puts `AllowMQTTControl` first among the inspect rules, so once it matches a v5 SUBSCRIBE the decider short-circuits before `RequireMQTTUserName` is ever consulted — a "not Blocked" assertion would have passed whether or not `SetConnTrack` ran. `matchingRuleName` reproduces `Decide`'s selection so the test can name the rule; both codecs match `AllowMQTTControl`.
- **The refusal set stayed small on purpose.** `TestV5PingreqStillRelayedByteIdentical` and `TestV5DisconnectFrameRelayed` pin that legitimate traffic still relays as captured. The DISCONNECT fixture is deliberately the zero-length form `e000` that paho.golang cannot parse (it returns EOF) — so it doubles as proof the refusal switch dispatches on the fixed-header type and never on a parse.
- **New wire harness.** `proxy_v5_parity_test.go` drives the REAL `handleProxyV5` against a REAL dialled TCP backend, recording every byte on both sides. 14 new tests (7 per task), green under `-count=5` and under `-race`.

## Task Commits

Branch: **`fix/mqtt5-v5-parity`** on `/Users/khundeck/working/meshtk`, cut from `main` at `d340f36`. NOT pushed or PR'd — the vendor-sync and release are plan 68-08.

1. **Task 1 (RED): failing wire tests for ConnTrack refresh and illegal-frame refusal** — `9ebe867` (test)
2. **Task 1 (GREEN): touchConnTrack + writeMqtt5Disconnect + explicit frame switch** — `ec63aa8` (fix)
3. **Task 2 (RED): failing tests for SUBSCRIBE inspection and codec-independent allowlist** — `3a375ee` (test)
4. **Task 2 (GREEN): inspectV5Subscribe + SUBSCRIBE branch + AllowMQTTControl v5 dispatch** — `261152b` (fix)

No REFACTOR commits were needed — neither GREEN left cleanup behind.

## Files Created/Modified

Upstream `/Users/khundeck/working/meshtk` (`git diff --numstat main`):

| File | +/- | What changed |
|---|---|---|
| `internal/app/server/inspect.go` | +18/-0 | `touchConnTrack` beside `SetConnTrack` — update-if-exists idle-timer refresh, no InspectorPacket |
| `internal/app/server/inspect_v5.go` | +33/-0 | `inspectV5Subscribe` — the v5 mirror of the 3.1.1 SUBSCRIBE branch |
| `internal/app/server/proxy_v5.go` | +93/-10 | `writeMqtt5Disconnect`; `touchConnTrack` call; the relay branch replaced by an explicit inspect/refuse/relay switch with its own SUBSCRIBE case |
| `internal/app/server/rules.go` | +36/-16 | `AllowMQTTControl` v5 dispatch on `Raw.MQTT5` (+1 import) |
| `internal/app/server/proxy_v5_parity_test.go` | +722/-0 | New — the session harness and all 14 tests |

`git diff --name-only main` lists exactly those five files, and `git status --porcelain` is empty.

## Fixtures used

- **Establishing CONNECT** — `mqttasticConnect(t)` from `proxy_v5_test.go`: the mqttastic shape (SessionExpiry 10000, ReceiveMaximum 20, TopicAliasMaximum 10, MaximumPacketSize 1048576, User `client=mqttastic`), username `ed270dbe5d1e`, password `hunter2`. Re-encoded onto the backend with the swapped `proxy`/`proxypass` identity.
- **Second CONNECT (`attackerConnect`)** — client id `mqttastic-second-connect`, username `attacker-username`, password `attacker-plaintext-password`. Both byte sequences are asserted absent from the whole backend stream.
- **AUTH** — `v5.NewControlPacket(v5.AUTH)` with `ReasonCode = AuthReauthenticate` (0x19).
- **Server-only frame** — a client-sent PINGRESP `d000`.
- **Keepalive / graceful close** — PINGREQ `c000`; zero-length DISCONNECT `e000`.
- **Idle-survival PUBLISH** — `v5PublishFrame(nodeInfoEnvelope(3, 3))`: a decoded NODEINFO ServiceEnvelope with in-budget hops, so no rewrite fires and byte-identical relay is the expected outcome.
- **SUBSCRIBE** — two filters in order: `msh/US/2/e/dc.run/#` (QoS 0) and `msh/US/2/e/PKI/#` (QoS 1), packet id 0x0015.
- **Unparseable SUBSCRIBE** — `82091234027f0000016100`: packet id 0x1234, property id 0x7f (outside paho.golang's table), one filter `a` QoS 0. The test asserts the fixture genuinely fails `v5.ReadPacket` before relying on it.
- **Measured DISCONNECT wire** — `e0028200` for reason 0x82.

## Decisions Made

See `key-decisions` in the frontmatter. The two worth restating:

- **`touchConnTrack` never creates an entry.** It mirrors `SetConnTrack`'s update-if-exists semantics exactly. An entry created by a stray keepalive would carry an empty `Username`, which is precisely the state `RequireMQTTUserName` exists to Block — the "fix" would have manufactured the failure it was written to prevent.
- **The SUBSCRIBE branch is inline in `handleProxyV5`** rather than extracted the way `handleV5PublishUplink` was in 68-02. The plan's acceptance criterion requires the decider call to be provably *inside* the loop function, and the harness in this plan drives the real loop anyway, so extraction bought nothing.

## Deviations from Plan

None affecting behavior. Three plan-shape notes:

**1. The 3.1.1 branch of `AllowMQTTControl` is re-indented, not textually untouched.**
The plan asked to "keep the existing `Raw.MQTT` type switch exactly as it is and reach it first." The switch's cases and their order are unchanged and it is still evaluated first, but the early-return nil-guard became an `if ip.Raw.MQTT != nil { … }` wrapper so a v5 packet can fall through to the v5 dispatch. Behavior identity is proven two ways: `TestV4SessionForwardBytesGolden` still passes with `proxy_v4_golden_test.go` byte-identical, and the new `TestAllowMQTTControlV4Unchanged` pins the matcher's own outcomes for CONNECT/SUBSCRIBE/PUBLISH/PINGREQ.

**2. `rules.go` also gains one import line.** The acceptance criterion says the diff shows "additions only inside the AllowMQTTControl matcher"; referencing `*v5.Connect` et al. mechanically requires `v5 "github.com/eclipse/paho.golang/packets"` in the import block. Nothing else in the file moved.

**3. The stale `handleProxyV5` doc comment was corrected.** It still read "Only CONNECT is parsed here. Everything else is relayed as captured bytes; v5 PUBLISH inspection lands in plan 68-02 and fails closed until it does" — untrue since 68-02, and actively misleading about the very branch this plan rewrote. Replaced with a one-sentence statement of the inspect/refuse/relay contract.

**Total deviations:** 0 auto-fixed bugs; 3 documentation/shape notes.
**Impact on plan:** none. No scope creep — every out-of-scope item named in the plan (CR-01, CR-05, WR-13, the other WR findings) was left alone, and no repo-wide gofmt was run.

## Issues Encountered

**RED gate — two tests passed at RED by design.** `TestV5PingreqStillRelayedByteIdentical` and `TestV5DisconnectFrameRelayed` are regression guards on traffic that must keep relaying unchanged, so they were green before the fix. The five behavioral tests for CR-02/CR-03 failed at RED as expected (2 on the tracker predicate, 3 on the 5s timeout waiting for a DISCONNECT that was never written). Task 2's RED was a compile failure — `n.inspectV5Subscribe` undefined — which is the standard Go RED shape for a new method.

**Test/proxy synchronization.** `net.Pipe` is unbuffered and the proxy writes on its own goroutine, so a naive "write a frame, then read `ConnectTime`" test races `touchConnTrack`. The harness instead polls the recorded backend stream for the next COMPLETE frame using the proxy's own `readFrame` (`splitFrames`); observing the relayed frame is a happens-after edge for everything the loop did before relaying it. Log assertions are made only after every goroutine is joined.

**Pre-existing flaky test in an unrelated package (NOT fixed — out of scope).** `internal/credcache`'s `TestSingleflight_DeduplicatesConcurrentFetches` fails intermittently, so `go test ./...` is not reliably green. Confirmed pre-existing: it fails 3/12 isolated runs on a clean `main` worktree, and `go list -deps ./internal/credcache` shows the package has zero meshtk dependencies — it cannot be affected by anything in this plan. Logged to `deferred-items.md`. `go test ./internal/app/server/ -count=5` and `-race` are green.

## Verification Performed

- `go build ./...` — exit 0
- `go vet ./internal/app/server/` — exit 0
- `go test ./internal/app/server/ -count=5` — ok; `-race` — ok
- All 14 new tests pass; 7 per task, matching the plan's behavior lists
- `shasum -a 256 internal/app/server/proxy_v4_golden_test.go` → `e49ae2ed7c93f62c0607aa04aa34c6c0521dbe88c0e147eba2f3b904951757d6` (unchanged)
- `go test -run TestV4SessionForwardBytesGolden` — ok, after the `rules.go` edit
- `git diff --numstat main -- internal/app/server/proxy.go` — empty
- `git diff --numstat main --` the nine pre-existing test files — empty (no pre-existing test was edited to make a change pass)
- Greps: `touchConnTrack` def = 1, `writeMqtt5Disconnect` def = 1, `MQTT5_PROTOCOL_VIOLATION` = 1, `touchConnTrack` inside `handleProxyV5` = 1, `inspectV5Subscribe` def = 1, `SetConnTrack` inside `inspectV5Subscribe` = 1, `mqtt_type=SUBSCRIBE` = 1, decider-call tokens inside `handleProxyV5` = 2 (≥1)
- `git status --porcelain` — empty

## User Setup Required

None.

## Next Phase Readiness

Ready for **68-07** (the remaining SC3 gap: CR-04, the v5 PUBLISH parse-failure bypass), which lands on the same branch `fix/mqtt5-v5-parity`. 68-07's hand-parse pattern for PUBLISH is also the named escape hatch if a topic Block rule is ever added and the accepted `MQTT5_PARSE_FAIL/SUBSCRIBE` relay risk (T-68-06-05) needs closing.

Then **68-08**: PR the branch upstream, vendor-sync `apps/run.mqtt/meshtk/`, release and deploy, and watch `MQTT5_PROTOCOL_VIOLATION` in prod telemetry — the metric that would show the stricter frame switch tearing down a legitimate mqttastic session (T-68-06-06). Prod evidence to date is `MQTT5_PARSE_FAIL = 0`.

Carry-forward landmines for 68-08 (from 68-04/68-05, unchanged): branch the monorepo from `origin/main`, never from `release/2026-07-26-230957`; `vendor/` is git-tracked in both repos and `Dockerfile.meshtk` does `COPY . .`, so a `go.mod` change without a matching `vendor/` fails the build with `inconsistent vendoring`; never touch `internal/embedded/gpx/embedded.go`; and `aws ecs wait services-stable` is not a drain gate for long-lived MQTT TCP.

## Self-Check: PASSED

- All three claimed artifacts exist on disk (`68-06-SUMMARY.md`, `deferred-items.md`, `proxy_v5_parity_test.go`)
- All four claimed commits exist in the meshtk repo (`9ebe867`, `ec63aa8`, `3a375ee`, `261152b`)
- No stubs: every function this plan added is fully wired and exercised by a passing test

---
*Phase: 68-mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa*
*Completed: 2026-07-29*
