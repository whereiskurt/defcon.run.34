---
phase: 68-mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa
plan: 03
subsystem: infra
tags: [mqtt, mqtt5, mosquitto, e2e, paho, golang, meshtk, proxy, meshtastic, upstream-pr]

# Dependency graph
requires:
  - phase: 68-01
    provides: readFrame, handleProxyV5/handleBackendV5, inspectV5Connect, reason codes, alias suppression, the pre-change v4 golden (54ddfbb)
  - phase: 68-02
    provides: inspectV5Publish, handleV5PublishUplink, setPublishPayload, logDownlinkV5 + self-echo suppression
provides:
  - TestE2EDualCodec — a live mosquitto behind the REAL StartProxyServer listener, env-gated on MESHTK_E2E=1
  - internal/app/server/testdata/mosquitto.e2e.conf — prod-shaped broker fixture (no anonymous, password_file, no max_topic_alias)
  - "11-subtest protocol matrix proven against mosquitto 2.0.22 (Homebrew) AND 2.0.20 (alpine:3.21, the prod image base)"
  - "operator documentation in internal/app/server/README.md — log actions, reason codes, alias suppression, how to run the e2e"
  - "whereiskurt/meshtk main @ c5341ce — the dual codec, the pinned dependency and the vendored codec, which is what the monorepo CI build clones"
affects: [68-04 vendor-sync, 68-05 release]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Gated e2e: env var + broker-availability skip, so the default `go test ./...` stays hermetic and trustworthy"
    - "Broker readiness is the BROKER's own log line, never a TCP handshake — docker-proxy completes the handshake while the container is still installing"
    - "Connection lifetime is the CALLER's: a dial helper that registers t.Cleanup silently closes shared state one subtest later"
    - "Strict expectFrame (fail on unexpected packet type) turns self-echo suppression into an implicit assertion instead of a silent skip"
    - "Cross-codec assertions: the 3.1.1 subscriber decodes the envelope the v5 client published, so the hop clamp is proven on the wire through a real broker"

key-files:
  created:
    - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5_e2e_test.go
    - /Users/khundeck/working/meshtk/internal/app/server/testdata/mosquitto.e2e.conf
  modified:
    - /Users/khundeck/working/meshtk/internal/app/server/README.md

key-decisions:
  - "68-03: the operator documentation went in internal/app/server/README.md, not the root README. The plan permitted either ('whichever already documents the proxy'); the server README is the proxy document — it already carries the mosquitto-limits rationale, the rules examples and the flow diagram — while the root README is a project overview with a stale DEF CON 33 TODO at the top."
  - "68-03: MQTT5_AUTH_METHOD is documented alongside the three log actions the plan listed. It is a real action a v5 CONNECT can produce, and an ops reference that omits one of the actions a 3am reader will actually see is worse than no reference."
  - "68-03: the mosquitto fixture is a COMMITTED template with __PORT__/__BIND__/__PASSWORD_FILE__ tokens rendered into t.TempDir() at run time. The broker's shape stays reviewable in git while the port is allocated free per run (parallel runs cannot collide) and no credential material is ever committed."
  - "68-03: max_topic_alias is deliberately ABSENT from the fixture. mosquitto's default TopicAliasMaximum=10 is what makes the CONNACK-strip assertion falsifiable; setting it to 0 in the broker config would let a broken proxy pass."
  - "68-03: MESHTK_E2E_DOCKER=1 was added as a deliberate escape hatch so the docker fallback could actually be exercised on a machine that also has Homebrew mosquitto. Shipping an unverifiable fallback path would have been worse than shipping none — and running it immediately found the container leak."
  - "68-03: the 3.1.1 client uses the ALREADY-VENDORED root paho.mqtt.golang client package, so the e2e added zero dependency surface (go.mod, go.sum and vendor/ are untouched by this plan)."
  - "68-03: the upstream PR was merged with a merge commit (not squash) so plan 68-04 has a single addressable merge SHA (c5341ce) while the per-task history stays bisectable."

patterns-established:
  - "Env-gated e2e that SKIPs rather than fails when its dependency is missing — the default gate stays green and therefore stays trusted"
  - "Negative log assertions scoped by a byte cursor (buf.Len() before, buf.since(mark) after), so 'the broker never saw a connection' stays falsifiable on the Nth subtest"
  - "Whole-run log capture on failure or -v, so a red e2e is diagnosable from the test output without re-running by hand"
  - "Named containers + docker rm -f in teardown: killing the `docker run` CLI does NOT stop the container"

requirements-completed: [MQV5-06, MQV5-07]

coverage:
  - id: D1
    description: "A v5 client connects through the proxy to a real mosquitto and the broker logs the connection as protocol 5 with the SWAPPED identity"
    requirement: "MQV5-06"
    verification:
      - kind: e2e
        ref: "internal/app/server/proxy_v5_e2e_test.go#TestE2EDualCodec/v5_connect_swaps_identity_and_strips_alias_max"
        status: pass
      - kind: other
        ref: "mosquitto 2.0.22 stdout: `New client connected from 127.0.0.1:49791 as mqttastic-e2e-v5 (p5, c1, k60, u'public')` — and the test also asserts neither `runner` nor `meshpass` appears in the broker log"
        status: pass
    human_judgment: false
  - id: D2
    description: "A v5 client with bad credentials receives 2003008700 and mosquitto never sees a connection; enhanced auth receives 2003008c00, likewise before any broker dial"
    requirement: "MQV5-06"
    verification:
      - kind: e2e
        ref: "TestE2EDualCodec/v5_bad_credentials_rejected_before_broker, /v5_enhanced_auth_rejected_before_broker"
        status: pass
      - kind: other
        ref: "each subtest snapshots the broker log length first and asserts NO `New client connected` line was appended during it; proxy log carries action=AUTH_REJECT and action=MQTT5_AUTH_METHOD respectively"
        status: pass
    human_judgment: false
  - id: D3
    description: "The CONNACK reaching the client carries no TopicAliasMaximum, without any broker configuration change"
    requirement: "MQV5-06"
    verification:
      - kind: e2e
        ref: "TestE2EDualCodec/v5_connect_swaps_identity_and_strips_alias_max — exact bytes 2006000003210014 against mosquitto's own 200900000622000a210014, plus a parsed assertion that Connack.Properties.TopicAliasMaximum is nil"
        status: pass
    human_judgment: false
  - id: D4
    description: "A v5 client publishes a ServiceEnvelope that passes the PacketDecider and reaches mosquitto, at QoS0 and QoS1, with the hop clamp reaching the wire and the packet id intact"
    requirement: "MQV5-06"
    verification:
      - kind: e2e
        ref: "TestE2EDualCodec/v5_qos0_publish_forwarded_and_reaches_the_mqtt3_client, /v5_qos1_publish_hop_clamped_pubacked_and_allowed"
        status: pass
      - kind: other
        ref: "mosquitto: `Received PUBLISH … (d0, q1, r0, m4660, 'msh/US/2/e/dc.run/!435990e4', … 74 bytes)` + `Sending PUBACK … (m4660, rc0)`; client PUBACK carries 0x1234; proxy logs action=ALLOW; the 3.1.1 subscriber decodes hop_limit 3 / hop_start 7 out of the delivered envelope"
        status: pass
    human_judgment: false
  - id: D5
    description: "A v5 client receives a downlink PUBLISH with the full topic and no topic alias"
    requirement: "MQV5-06"
    verification:
      - kind: e2e
        ref: "TestE2EDualCodec/v5_downlink_carries_the_full_topic_and_no_alias — the 3.1.1 client publishes under a DIFFERENT gateway id so self-echo suppression cannot mask the assertion"
        status: pass
    human_judgment: false
  - id: D6
    description: "SUBSCRIBE relays raw with a SUBACK, PINGREQ returns PINGRESP, and a zero-length v5 DISCONNECT produces a graceful disconnect in the broker log rather than a socket error"
    requirement: "MQV5-06"
    verification:
      - kind: e2e
        ref: "TestE2EDualCodec/v5_subscribe_relayed_raw_and_suback_returned (900400010000), /v5_pingreq_gets_pingresp (c000 -> d000), /v5_zero_length_disconnect_is_graceful"
        status: pass
      - kind: other
        ref: "mosquitto: `Received DISCONNECT from mqttastic-e2e-v5` — the packet paho.golang returns EOF on, relayed intact by the frame-capture design"
        status: pass
    human_judgment: false
  - id: D7
    description: "A 3.1.1 client connects, publishes and receives in the SAME run, unaffected"
    requirement: "MQV5-06"
    verification:
      - kind: e2e
        ref: "TestE2EDualCodec/mqtt3_client_connects_alongside_the_v5_client, /mqtt3_client_disconnects_cleanly — the 3.1.1 client is interleaved (connects second, receives v5 traffic, publishes traffic the v5 client receives, disconnects last)"
        status: pass
      - kind: other
        ref: "mosquitto logs `p5` (mqttastic-e2e-v5) and `p2` (paho-e2e-v4) connections alive in the same run"
        status: pass
    human_judgment: false
  - id: D8
    description: "The default test gate stays hermetic — the e2e SKIPs, never fails, without MESHTK_E2E"
    requirement: "MQV5-06"
    verification:
      - kind: other
        ref: "`go test ./internal/app/server/ -run TestE2EDualCodec -v` => `--- SKIP: TestE2EDualCodec (0.00s)`; `go test ./...` exits 0"
        status: pass
    human_judgment: false
  - id: D9
    description: "The complete upstream test suite is green and the work is merged to whereiskurt/meshtk main"
    requirement: "MQV5-07"
    verification:
      - kind: other
        ref: "PR whereiskurt/meshtk#25 state=MERGED, merge commit c5341ce; `git show origin/main:internal/app/server/proxy_v5.go | grep -c 'func readFrame'` = 1, `inspect_v5.go | grep -c inspectV5Connect` = 2, `go.mod | grep -c 'paho.golang v0.22.0'` = 1, `vendor/modules.txt | grep -c paho.golang` = 2"
        status: pass
      - kind: other
        ref: "all four gates re-run from the merged main: go build ./... / go vet ./... / go test ./... / MESHTK_E2E=1 gated e2e — all exit 0"
        status: pass
    human_judgment: false
  - id: D10
    description: "End-to-end behavior of a real v5 client (mqttastic / Meshtastic-Android 2.8.0) through the DEPLOYED proxy"
    verification: []
    human_judgment: true
    rationale: "Nothing is deployed yet. This plan lands the code on upstream main; the vendor-sync into apps/run.mqtt/meshtk/ is 68-04 and the buildpub/deploy plus Kurt's APK UAT is 68-05. The local mosquitto e2e is the strongest machine-verifiable evidence available before a release."

# Metrics
duration: 20min
completed: 2026-07-29
status: complete
---

# Phase 68 Plan 03: Live-Broker E2E and Upstream Merge Summary

**A real mosquitto now runs behind the real `StartProxyServer` listener in-test, with a v5 client and a 3.1.1 client interleaved in one run — eleven subtests proving the swap, the alias strip, the QoS1 PUBACK, the hop clamp landing on the wire as seen by the *other* codec's subscriber, and a graceful zero-length DISCONNECT — and the whole dual codec is merged to `whereiskurt/meshtk` main at `c5341ce`, which is what the monorepo image build clones.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-29T06:29:59Z
- **Completed:** 2026-07-29T06:50:03Z
- **Tasks:** 3
- **Files:** 2 created (1,078 lines), 1 modified (+72)
- **Subtests added:** 11, all against a live broker

## Accomplishments

- **The broker's own log is now the witness.** `New client connected from 127.0.0.1:49791 as mqttastic-e2e-v5 (p5, c1, k60, u'public')` is a single line that proves two separate things a unit test cannot: the protocol version survived the proxy (`p5`) and the client's credential did not reach mosquitto (`u'public'`). The test additionally asserts neither `runner` nor `meshpass` appears anywhere in the broker log.
- **The hop clamp is proven on the wire, cross-codec, through a real broker.** The v5 client publishes an envelope with `hop_limit 7 / hop_start 9`; the **3.1.1** subscriber decodes `3 / 7` out of what mosquitto actually fanned out. That closes the meshtk#22 loop end to end: not a struct read, not a re-encode in the same process — a different client, a different codec, on the other side of the broker.
- **Both broker backends verified, not just the convenient one.** mosquitto **2.0.22** (Homebrew) and **2.0.20** (`alpine:3.21` — the production image base) both produce byte-identical CONNACKs and pass all eleven subtests. The docker path was exercised deliberately via a `MESHTK_E2E_DOCKER=1` escape hatch rather than shipped unverified — and running it immediately found a container leak.
- **The default gate stayed hermetic.** `go test ./...` reports the e2e as SKIP, exits 0, and gained no dependency: the 3.1.1 client uses the already-vendored root `paho.mqtt.golang` package, so `go.mod`, `go.sum` and `vendor/` are untouched by this plan.
- **Rejections provably cost the broker nothing.** Both reject subtests snapshot the broker log length first and assert no `New client connected` line was appended. mqttastic retries every 5–25s forever, so "rejected before the backend dial" is a capacity property, not a nicety.
- **Self-echo suppression is asserted implicitly and for free.** The v5 client is subscribed to the very topic it publishes on. `expectFrame` is strict — an unexpected packet type fails the test — so if suppression regressed, the client's own PUBLISH would land in the next read and be reported instead of quietly skipped.
- **The work is on upstream main.** PR [whereiskurt/meshtk#25](https://github.com/whereiskurt/meshtk/pull/25) is MERGED at `c5341ce`, carrying the pinned dependency, the vendored codec, both prior waves and this one. All four gates were re-run *from the merged main* and are green.

## Task Commits

Code commits on `feat/mqtt5-dual-codec` in the UPSTREAM repo `/Users/khundeck/working/meshtk` (continuing from 68-02's `2c3a9cb`):

| # | Task | SHA | Type |
|---|------|-----|------|
| 1 | E2E harness — broker fixture, live proxy, v5 CONNECT paths | `e534cf0` | test |
| 2 | Dual-client traffic matrix — publish/subscribe/downlink + 3.1.1 | `a9ab2d7` | test |
| 3 | Operator documentation for the dual codec | `6062c7f` | docs |
| — | **Merge to `whereiskurt/meshtk` main (PR #25)** | **`c5341ce`** | merge |

**Plan metadata** is committed separately in the monorepo (`.planning/`).

## Recorded artifacts

### The four gates, all green in the session the PR was merged

```
go build ./...                                                       OK
go vet ./...                                                         OK
go test ./...                                                        OK  (e2e reports SKIP)
MESHTK_E2E=1 go test ./internal/app/server/ -run TestE2EDualCodec    OK  (11/11 subtests, 1.55s)
```

Additionally, beyond the plan's requirement:

```
MESHTK_E2E=1 MESHTK_E2E_DOCKER=1 go test … -run TestE2EDualCodec     OK  (mosquitto 2.0.20, 11/11)
MESHTK_E2E=1 go test -race       … -run TestE2EDualCodec             OK
3 consecutive runs                                                   OK  (no flake)
```

All four re-run from the merged `origin/main` after the merge: green.

### Observed mosquitto log markers (2.0.22, one run)

```
New client connected from 127.0.0.1:49791 as mqttastic-e2e-v5 (p5, c1, k60, u'public').
New client connected from 127.0.0.1:49793 as paho-e2e-v4      (p2, c1, k60, u'public').
Received SUBSCRIBE from mqttastic-e2e-v5   /  Sending SUBACK to mqttastic-e2e-v5
Received PUBLISH from mqttastic-e2e-v5 (d0, q0, r0, m0,     'msh/US/2/e/dc.run/!435990e4', ... (74 bytes))
Received PUBLISH from mqttastic-e2e-v5 (d0, q1, r0, m4660,  'msh/US/2/e/dc.run/!435990e4', ... (74 bytes))
Sending PUBACK to mqttastic-e2e-v5 (m4660, rc0)
Received PUBLISH from paho-e2e-v4      (d0, q0, r0, m0,     'msh/US/2/e/dc.run/!15550041', ... (74 bytes))
Received PINGREQ from mqttastic-e2e-v5     /  Sending PINGRESP to mqttastic-e2e-v5
Received DISCONNECT from paho-e2e-v4
Received DISCONNECT from mqttastic-e2e-v5
```

Matching proxy inspector log:

```
action=AUTH_REJECT, ip=…, username=runner, reason=invalid
action=MQTT5_AUTH_METHOD, ip=…, username=runner, auth_method=SCRAM-SHA-1, reason=enhanced_auth_unsupported
action=MQTT5_CONNECT, ip=…, username=runner, client_id=mqttastic-e2e-v5
action=ALLOW,ip=…, clientID=mqttastic-e2e-v5, username=runner, mqtt_type=PUBLISH, mqtt_topic=[msh/US/2/e/dc.run/!435990e4],mesh_type=NODEINFO_APP, …
action=ALLOW,ip=…, clientID=paho-e2e-v4,      username=runner, mqtt_type=PUBLISH, mqtt_topic=[msh/US/2/e/dc.run/!15550041],mesh_type=NODEINFO_APP, …
```

Note the v5 client's own two PUBLISHes never come back down its socket, despite it being subscribed to `msh/US/2/e/dc.run/#` — self-echo suppression, observed rather than asserted.

### E2E matrix results

| Subtest | Result | Evidence |
|---|---|---|
| `v5_bad_credentials_rejected_before_broker` | PASS | client `2003008700`; zero `New client connected` during the subtest; `action=AUTH_REJECT` |
| `v5_enhanced_auth_rejected_before_broker` | PASS | client `2003008c00`; zero broker connections; `action=MQTT5_AUTH_METHOD` |
| `v5_connect_swaps_identity_and_strips_alias_max` | PASS | client `2006000003210014` (broker's own `200900000622000a210014`); `p5` + `u'public'`; `action=MQTT5_CONNECT` |
| `mqtt3_client_connects_alongside_the_v5_client` | PASS | `p5` and `p2` connections alive in the same run |
| `v5_subscribe_relayed_raw_and_suback_returned` | PASS | SUBACK `900400010000`; `Received SUBSCRIBE` |
| `v5_qos0_publish_forwarded_and_reaches_the_mqtt3_client` | PASS | broker `q0` on the full topic; 3.1.1 subscriber decodes gateway `!435990e4` |
| `v5_qos1_publish_hop_clamped_pubacked_and_allowed` | PASS | broker `q1, m4660` + `Sending PUBACK (m4660, rc0)`; client PUBACK id `0x1234`; `action=ALLOW`; 3.1.1 subscriber decodes hop 3/7 |
| `v5_downlink_carries_the_full_topic_and_no_alias` | PASS | full topic `msh/US/2/e/dc.run/!15550041`, `Properties.TopicAlias == nil` |
| `v5_pingreq_gets_pingresp` | PASS | `c000` → `d000`; `Received PINGREQ` |
| `mqtt3_client_disconnects_cleanly` | PASS | `Received DISCONNECT from paho-e2e-v4` |
| `v5_zero_length_disconnect_is_graceful` | PASS | `e000` → `Received DISCONNECT from mqttastic-e2e-v5` (not a socket error) |

### Upstream main verification (post-merge)

```
$ git show origin/main:internal/app/server/proxy_v5.go   | grep -c 'func readFrame'          -> 1
$ git show origin/main:internal/app/server/inspect_v5.go | grep -c 'inspectV5Connect'        -> 2
$ git show origin/main:go.mod            | grep -c 'github.com/eclipse/paho.golang v0.22.0'  -> 1
$ git show origin/main:vendor/modules.txt| grep -c 'paho.golang'                             -> 2
$ git show origin/main:internal/app/server/proxy_v5_e2e_test.go | grep -c 'func TestE2EDualCodec' -> 1
$ gh pr view 25 --repo whereiskurt/meshtk --json state -q .state -> MERGED
```

`golang.org/x/net` on main is still `v0.38.0` — the zero-transitive-churn pin held all the way to the merge.

### Repository cleanliness

`git status --porcelain` in `/Users/khundeck/working/meshtk` is empty. No password file, no rendered mosquitto config and no generated credential material is tracked — the fixture is a template and everything derived from it lives in `t.TempDir()`.

## Files Created/Modified

- `internal/app/server/proxy_v5_e2e_test.go` (new, 1,053 lines) — `TestE2EDualCodec` and its harness: `syncBuffer` log capture, `waitForLog`/`assertNoLog` cursors, `pairAuthenticator`, broker resolution + start/teardown for both backends, `startHarness` (the real `StartProxyServer`), the hand-rolled `v5Client`, the `mqtt3Client` wrapper, Meshtastic envelope fixtures, and the 11 subtests
- `internal/app/server/testdata/mosquitto.e2e.conf` (new, 25 lines) — prod-shaped broker fixture with `__PORT__`/`__BIND__`/`__PASSWORD_FILE__` tokens and a comment recording why `max_topic_alias` is deliberately absent
- `internal/app/server/README.md` (+72) — the dual-codec operator section: accepted protocol levels, the log-action table, the CONNACK reason-code table with verified wire bytes, topic-alias suppression, and how to run the gated e2e

## Decisions Made

See `key-decisions` in the frontmatter. The three with the longest reach:

- **The documentation went in `internal/app/server/README.md`.** The plan permitted either file. The server README *is* the proxy document — mosquitto's limits, the rules examples, the flow diagram — while the root README opens with a stale "TODO: Update this now that we're live at DEFCON 33!".
- **`MESHTK_E2E_DOCKER=1` exists so the fallback is verifiable.** A fallback path that only runs on a machine without Homebrew mosquitto is a fallback nobody has ever executed. Adding the knob cost three lines and immediately surfaced the container leak below.
- **Merge commit, not squash.** Plan 68-04 needs a single addressable SHA (`c5341ce`) for the vendor-sync while the ten per-task commits stay bisectable if prod misbehaves.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Shared connections were closed one subtest early**

- **Found during:** Task 2 (first run of the traffic matrix)
- **Issue:** `dialV5` and `dialMQTT3` registered their teardown with `t.Cleanup` on the `*testing.T` they were handed. For the throwaway clients in the rejection subtests that is correct, but the v5 client created in the CONNECT subtest has to outlive it — `t.Cleanup` inside a subtest fires when *that subtest* ends. mosquitto logged `Client mqttastic-e2e-v5 closed its connection.` immediately after the CONNACK and all seven following subtests failed with `use of closed network connection`.
- **Fix:** the dial helpers register no cleanup at all; lifetime is the caller's. Short-lived clients do `t.Cleanup(c.close)` at the call site; the long-lived clients register on a `root *testing.T` stored on the harness. Both helpers carry a comment recording the failure mode.
- **Files modified:** `internal/app/server/proxy_v5_e2e_test.go`
- **Verification:** all 11 subtests pass; three consecutive runs and a `-race` run clean
- **Committed in:** `a9ab2d7`

**2. [Rule 1 - Bug] The docker fallback leaked running containers**

- **Found during:** Task 2 (verifying the docker path)
- **Issue:** teardown was `cmd.Process.Kill()`, which kills the local `docker run` CLI. The container keeps running, keeps its published port bound and survives the test binary. Three orphaned `alpine:3.21` containers were found with `docker ps` — a direct hit on this plan's own threat T-68-03-03 ("e2e leaves broker processes or listeners behind").
- **Fix:** the container is started with `--name meshtk-e2e-<port>` and torn down with `docker rm -f <name>` before the process kill. The three orphans were removed.
- **Files modified:** `internal/app/server/proxy_v5_e2e_test.go`
- **Verification:** after a full docker run, `docker ps | grep alpine` returns nothing
- **Committed in:** `a9ab2d7`

**3. [Rule 1 - Bug] Broker readiness was a TCP handshake, which docker answers before the broker exists**

- **Found during:** Task 2 (verifying the docker path)
- **Issue:** `waitForListener` dialled the published port. Under docker that port is served by `docker-proxy`, which completes the handshake as soon as the container starts — while `apk add --no-cache mosquitto` is still running inside it. The probe returned "ready" against a broker that did not exist yet, the proxy's CONNECT vanished into a broken pipe, and the run failed with an empty mosquitto log. It passed intermittently before, because the two 500 ms reject-subtest settles happened to cover the install window.
- **Fix:** readiness is now the broker's own `mosquitto version … running` log line (120 s budget, which covers `apk add`), *then* the listener probe.
- **Files modified:** `internal/app/server/proxy_v5_e2e_test.go`
- **Verification:** the docker path passes all 11 subtests; the local path is unaffected
- **Committed in:** `a9ab2d7`

**4. [Rule 1 - Bug] The plan's expected `p4` marker does not exist**

- **Found during:** Task 2
- **Issue:** the plan (from the research recipe) expected mosquitto to log a 3.1.1 connection as `p4`. It logs `p2`. The marker is mosquitto's **internal protocol enum** (`mosq_p_mqtt311 == 2`, `mosq_p_mqtt5 == 5`), not the wire protocol level (4). Observed identically on 2.0.22 and 2.0.20. Asserting `p4` would have been an assertion that can never pass.
- **Fix:** the subtest asserts `p2` for the 3.1.1 connection and `p5` for the v5 one, with a comment recording the enum-vs-wire-level distinction so it is not "corrected" back.
- **Files modified:** `internal/app/server/proxy_v5_e2e_test.go`
- **Verification:** `mqtt3_client_connects_alongside_the_v5_client` passes on both broker versions
- **Committed in:** `a9ab2d7`

### Plan-shape adaptations (no functional deviation)

1. **The 3.1.1 client is the vendored root `paho.mqtt.golang` client**, exactly as the plan asked — worth recording because it was checked first: `vendor/modules.txt` already lists the root package (not only `packets`), so the e2e added **zero** dependency surface. Had it not been vendored, the fallback would have been hand-rolling the 3.1.1 client from `paho.mqtt.golang/packets` rather than perturbing `go.mod` in a stability-critical change.

2. **`MESHTK_E2E_DOCKER=1` is an addition to the plan's broker-resolution order** — the order itself is unchanged (Homebrew → PATH → docker); the variable only forces the third branch so it could be verified.

3. **Whole-run log capture also fires under `-v`, not only on failure.** The plan asked for capture on failure (implemented per-subtest via `h.dump` and for the whole run in a root `t.Cleanup`). Extending it to verbose runs is what made the evidence in this SUMMARY reproducible by anyone with one command.

4. **The e2e documentation section was added to the README beyond the plan's list** (log actions, reason codes, alias suppression). A reader who has just seen `action=MQTT5_PARSE_FAIL` at 3am should be able to reproduce the failing protocol locally from the same page.

---

**Total deviations:** 4 auto-fixed (all Rule 1 — three genuine test-harness bugs, one incorrect expected value inherited from the research recipe); 4 plan-shape adaptations with no behavioral effect.
**Impact on plan:** No scope creep. Every acceptance criterion in all three tasks is satisfied literally, except that `p4` is asserted as `p2` — because `p4` is factually not what mosquitto logs, on either verified version.

## Issues Encountered

- **The `p4` expectation came from the research document and was wrong.** It survived research, planning and plan-checking because nobody had run the assertion. It cost one test cycle to find and is now pinned with a comment. Worth remembering: a recipe's *observed* rows and its *expected* rows are not the same evidence class, even in the same table.
- **All three harness bugs were in the test, not the proxy.** The v5 codec itself needed no change in this plan — every subtest passed against the code as merged from 68-01/68-02 once the harness was correct. That is the outcome the two prior waves' wire-level unit tests were supposed to buy, and it held.
- **`gofmt` drift is unchanged from 68-01/68-02.** `cmd.go`, `inspect.go`, `inspect_auth_test.go` and `proxy_mqtt5_test.go` remain unformatted at `origin/main` and were left alone deliberately; both files added by this plan are gofmt-clean.
- **The upstream repo has no CI.** `gh pr checks 25` reports no checks and there is no `.github/workflows/`. The four local gates are therefore the entire gate, which is why they were re-run from the merged main rather than trusted from the branch.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path, file-access pattern, or schema change was introduced — the e2e binds only ephemeral localhost ports allocated at run time. All four `mitigate` dispositions in the plan's threat register are implemented:

| Threat | Status |
|---|---|
| T-68-03-01 (merge on a red gate) | Mitigated — all four gates green before the PR and re-run green from the merged main; the PR body records the evidence |
| T-68-03-02 (credential fixtures committed) | Mitigated — password file generated into `t.TempDir()`, `git status --porcelain` clean, the committed fixture is a template |
| T-68-03-03 (leftover brokers/listeners) | Mitigated — **and it fired**: the docker teardown genuinely leaked containers and is fixed; ports are allocated free at run time |
| T-68-03-04 (non-hermetic default run) | Mitigated — verified SKIP, not fail, under a plain `go test ./...`, which exits 0 |

## User Setup Required

None for this plan. Note the state of the world: the dual codec is on **upstream main**, but nothing is deployed. `apps/run.mqtt/meshtk/` in the monorepo has **not** been synced and no release has been built.

## Next Phase Readiness

**Ready for 68-04 (vendor-sync):**

- `whereiskurt/meshtk` main is at `c5341ce` and contains the dual codec, the pinned `paho.golang v0.22.0` and the vendored `packets` tree. The monorepo image build clones upstream main, so this is the hand-off point.
- All four gates are green from that exact SHA.
- The sync set is `go.mod`, `go.sum`, `vendor/modules.txt`, `vendor/github.com/eclipse/paho.golang/**` (18 files), and the changed/new files under `internal/app/server/`.

**Landmines carried forward (repeated from 68-01 and 68-02, still live):**

- **R-1:** the monorepo's vendored meshtk snapshot is stale (`v0.0.66` vs upstream `v0.0.70`+). Branch the monorepo work from `origin/main`, **never** from `release/2026-07-26-230957`, or the sync REVERTS meshtk#22/#23. Before committing the sync, assert `grep -c peekConnectProtocolVersion apps/run.mqtt/meshtk/internal/app/server/proxy.go` ≥ 1 and `grep -c RemarshalEnvelope …/inspect.go` ≥ 1.
- **R-2:** `vendor/` is git-tracked in both repos and `Dockerfile.meshtk` does `COPY . .`, so a `go.mod` change without the matching `vendor/` output fails the image build with `inconsistent vendoring`.
- Never touch `apps/run.mqtt/meshtk/internal/embedded/gpx/embedded.go` — a vendor-sync clobbered the `go:embed` con routes once already. Verify it is untouched before committing.
- **Pre-existing landmine, still deliberately not fixed:** `RewritePayloadString` dereferences `*ip.Meshtastic.Cipher` unconditionally, so `RewriteHelloGoodbye` panics on a non-encrypted `TEXT_MESSAGE_APP` packet. It predates this phase and affects 3.1.1 identically.

**Carried forward:**

- MQV5-07 (monorepo half) — vendor-sync (68-04) → buildpub/deploy use1 → prod verification → Kurt's Android 2.8.0 APK UAT (68-05).

## Self-Check: PASSED

Both created files exist on disk and on `origin/main`; all three task SHAs (`e534cf0`, `a9ab2d7`, `6062c7f`) and the merge SHA (`c5341ce`) resolve in `/Users/khundeck/working/meshtk`; PR #25 reports `MERGED`; `git status --porcelain` is empty there; `go build ./... && go vet ./... && go test ./...` and the gated e2e all exit 0 from the merged main.

---
*Phase: 68-mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa*
*Completed: 2026-07-29*
