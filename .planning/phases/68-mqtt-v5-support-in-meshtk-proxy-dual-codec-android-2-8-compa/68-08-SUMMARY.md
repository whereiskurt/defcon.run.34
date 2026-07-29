---
phase: 68-mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa
plan: 08
subsystem: infra
tags: [mqtt, mqtt5, meshtk, proxy, vendor-sync, release, ecs, prod-verification, probes]

requires:
  - phase: 68-06
    provides: touchConnTrack, writeMqtt5Disconnect, the explicit v5 frame switch, inspectV5Subscribe (CR-02/CR-03/WR-04 closed upstream)
  - phase: 68-07
    provides: parseV5PublishFrame, spliceV5PublishPayload, the fail-closed PUBLISH path, MQTT5_PUBLISH_HEADER_FAIL (CR-04 closed upstream)
  - phase: 68-05
    provides: meshtk v0.0.72 in prod (task def 115) — the baseline image every pre/post contrast in this plan is measured against
provides:
  - "meshtk v0.0.73 live on mqtt.defcon.run:4433 (run-mqtt-use1-dc34:116) with all four v5 parity defects closed"
  - "whereiskurt/meshtk main @ 5769031 — the upstream state the monorepo overlay mirrors byte-for-byte"
  - "mqtt5_probe.py — a committed, re-runnable production wire probe with one subcommand per closed defect"
  - "recorded pre/post probe transcripts against v0.0.72 and v0.0.73"
  - "Android UAT corroboration telemetry for !aed94d05, with the residual nine-minute gap named"
affects: [mqtt-proxy-observability, meshtk-release-process]

tech-stack:
  added: []
  patterns:
    - "Committed probes, not scratch files: the pre-deploy baseline and the post-deploy run are provably the same bytes, and the next v5 change is cheap to verify"
    - "Wire observation AND log correlation as a conjunction: where mosquitto refuses the same frame the proxy refuses, the wire cannot attribute the refusal, so the proxy's own log line is the discriminator"
    - "Correlate prod log evidence by a client id unique to the run, never by wall clock -- safe even while two images write to one log group"
    - "Probe fixtures copied from the upstream unit tests, so the probe and the tests exercise identical frames"

key-files:
  created:
    - .planning/phases/68-.../68-08-probes/mqtt5_probe.py
    - .planning/phases/68-.../68-08-probes/transcript-pre-deploy-v0.0.72.txt
    - .planning/phases/68-.../68-08-probes/transcript-post-deploy-v0.0.73.txt
    - .planning/phases/68-.../68-08-probes/uat-telemetry-aed94d05.md
  modified:
    - apps/run.mqtt/meshtk/internal/app/server/inspect.go
    - apps/run.mqtt/meshtk/internal/app/server/inspect_v5.go
    - apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go
    - apps/run.mqtt/meshtk/internal/app/server/proxy_v5_e2e_test.go
    - apps/run.mqtt/meshtk/internal/app/server/proxy_v5_parity_test.go
    - apps/run.mqtt/meshtk/internal/app/server/proxy_v5_rawpublish.go
    - apps/run.mqtt/meshtk/internal/app/server/proxy_v5_rawpublish_test.go
    - apps/run.mqtt/meshtk/internal/app/server/rules.go
    - .planning/phases/68-.../deferred-items.md

key-decisions:
  - "The changed file set was computed with git diff --name-only d340f36 <merge SHA>, never from memory, and parity was asserted over the WHOLE tracked overlay (89 files) rather than only the changed ones"
  - "Parity compared monorepo blobs against the upstream MERGE-COMMIT blobs by object (git show <sha>:<path>), never off either repo's working tree, so the check does not depend on which branch happens to be checked out"
  - "The vendor-sync was done in a git worktree cut fresh from origin/main, keeping the overlay branch and the planning branch strictly disjoint -- the release branch predates PR #1072 and syncing from it would have reverted the whole dual codec"
  - "The probes are ONE committed script, not scratch files: 68-05's evidence cannot be re-derived today because its probes were deleted"
  - "Each probe's verdict is the CONJUNCTION of a wire observation and a log correlation. Three of the four defects are wire-indistinguishable because mosquitto refuses the same frames the proxy now refuses; only the proxy's own log line separates 'the proxy refused it' from 'the broker refused it'"
  - "CR-04 publishes an UNDECRYPTABLE envelope so the expected outcome is a Block -- nothing reaches the broker and nothing is injected into the live mesh"
  - "The 480s idle floor is arithmetic, enforced in code: the reaper wakes on a 300s ticker and only then applies its 180s threshold, so a 200s window would return ALLOW on an unfixed image for ~93% of tick phases"
  - "Task 3 is recorded as a QUALIFIED pass, not a clean one: the nine-minute bar is not met by telemetry and that limitation is named rather than papered over"
  - "The proxy->mosquitto broken-pipe reconnect path is split out to deferred-items rather than investigated here -- it predates this phase and is shared with the 3.1.1 loop"

requirements-completed: [MQV5-07]

coverage:
  - id: D1
    description: "Upstream main carries the parity fixes and the monorepo overlay mirrors it byte-for-byte, with internal/embedded/ untouched"
    requirement: MQV5-07
    verification:
      - kind: other
        ref: "sha256 parity loop over the whole tracked overlay: origin/main blobs vs upstream merge-SHA 5769031 blobs -- 89 compared, 0 MISMATCH"
        status: pass
      - kind: other
        ref: "git show origin/main:apps/run.mqtt/meshtk/internal/embedded/gpx/embedded.go | shasum -a 256 = 98679cba... unchanged; absent from PR #1078 diffstat"
        status: pass
      - kind: other
        ref: "local CI-overlay reproduction (git archive 5769031 + 157 tracked overlay files untarred on top): go build ./... , go vet, go test ./internal/app/server/ all exit 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "All three PRs merged, and the vendor-sync branch was provably cut from main and not from the release branch"
    requirement: MQV5-07
    verification:
      - kind: other
        ref: "whereiskurt/meshtk#27 MERGED; monorepo #1075 MERGED; monorepo #1078 MERGED. merge-base --is-ancestor origin/main <tip> succeeds; --is-ancestor origin/release/2026-07-26-230957 <tip> FAILS"
        status: pass
    human_judgment: false
  - id: D3
    description: "The image that was built is the image that is serving, on a stable single-deployment ECS revision, deployed only via CI"
    requirement: MQV5-07
    verification:
      - kind: other
        ref: "buildpub run 30480812306 success (Release PR #1079 auto-merged, v0.0.72 -> v0.0.73); deploy run 30481496161 success; task def 116 references dc34-run-mqtt-meshtk:v0.0.73; single PRIMARY deployment rolloutState=COMPLETED 1/1; no local terragrunt apply"
        status: pass
    human_judgment: false
  - id: D4
    description: "CR-02 closed on the production wire -- a v5 session publish-idle for >=480s publishes successfully instead of being Blocked"
    requirement: MQV5-07
    verification:
      - kind: other
        ref: "cr02-idle at 480s: PRE-DEPLOY [proxy] BLOCK reason=\"Username required for MQTT\" user= (empty) + socket torn down; POST-DEPLOY action=ALLOW mqtt_type=PUBLISH mesh_type=NODEINFO_APP with clientID and username populated, session alive"
        status: pass
    human_judgment: false
  - id: D5
    description: "CR-03 closed on the production wire -- a second CONNECT on an established session is refused, not relayed"
    requirement: MQV5-07
    verification:
      - kind: other
        ref: "cr03-second-connect: PRE-DEPLOY no DISCONNECT and no violation line; POST-DEPLOY wire DISCONNECT reason 0x82 + exactly one action=MQTT5_PROTOCOL_VIOLATION mqtt_type=1"
        status: pass
    human_judgment: false
  - id: D6
    description: "CR-04 closed on the production wire -- an unmodelled-property PUBLISH carrying an undecryptable envelope is inspected and BLOCKed instead of relayed"
    requirement: MQV5-07
    verification:
      - kind: other
        ref: "cr04-unmodelled-block: PRE-DEPLOY MQTT5_PARSE_FAIL only, no decision, and mosquitto's own DISCONNECT 0x81 (e00181) relayed back proving the bytes reached the broker; POST-DEPLOY action=BLOCK with topic+clientID plus [proxy] BLOCK reason=\"Failed to decrypt with any known key\""
        status: pass
    human_judgment: false
  - id: D7
    description: "WR-04 closed on the production wire -- a v5 SUBSCRIBE is recorded with its topic filter"
    requirement: MQV5-07
    verification:
      - kind: other
        ref: "wr04-subscribe: PRE-DEPLOY SUBACK but no proxy log line at all; POST-DEPLOY action=ALLOW mqtt_type=SUBSCRIBE with the run's own filter. Also observed on the REAL Android client: 16 action=ALLOW mqtt_type=SUBSCRIBE lines for !aed94d05"
        status: pass
    human_judgment: false
  - id: D8
    description: "The 68-05 reason-code contract is unregressed and the 3.1.1 fleet never stopped flowing across the deploy"
    requirement: MQV5-07
    verification:
      - kind: other
        ref: "regression-connacks byte-identical to 68-05: 2003008700 / 2003008400 / 2003008c00 / 20020005, pre AND post"
        status: pass
      - kind: other
        ref: "per-minute action=ALLOW across 18:45Z-19:09Z: 25/25 minutes non-zero (46 old task + 105 new task), never zero at the deploy boundary"
        status: pass
    human_judgment: false
  - id: D9
    description: "The new fail-closed PUBLISH path and the stricter frame switch do not harm real clients"
    requirement: MQV5-07
    verification:
      - kind: other
        ref: "new task stream, whole ~2h lifetime: MQTT5_PUBLISH_HEADER_FAIL=0, panic=0, \"Username required for MQTT\"=0. MQTT5_PARSE_FAIL=2 and MQTT5_PROTOCOL_VIOLATION=2, all four attributable to this plan's own probes by client id -- zero from real clients, across ~36min of real Android publishing"
        status: pass
    human_judgment: false
  - id: D10
    description: "A real Android 2.8.0 session survives a real idle period and keeps working"
    requirement: MQV5-07
    verification:
      - kind: other
        ref: "Kurt's verdict \"OK! looks ok\"; telemetry: 416s (6m56s) publish-idle then a successful action=ALLOW publish with no intervening MQTT5_CONNECT; zero username-required Blocks in ~2h; 55 [proxy] ALLOW POSITION_APP publishes"
        status: partial
    human_judgment: true
    rationale: "QUALIFIED PASS. The nine-minute bar the UAT specifies is NOT met by telemetry -- the longest real-client idle-then-publish window is 6m56s and no window >=540s exists. At 416s the old reaper had a qualifying tick for 78.7% of tick phases, so the observation favours the fix but is probabilistic. The guaranteed-discriminating >=480s window is machine-proven (D4) but not client-proven. Compounding this, the Android client self-reconnects every ~1-5 minutes when idle, so the nine-minute connected-idle bar may be unreachable with this client at all. Accepted as qualified on Kurt's decision (option c) with the gap named rather than closed."

duration: ~2h30m (including the human UAT wait)
completed: 2026-07-29
status: complete
---

# Phase 68 Plan 08: Ship the v5 Parity Fixes and Prove Each One in Production Summary

**meshtk `v0.0.73` is live on `mqtt.defcon.run:4433` (task def `run-mqtt-use1-dc34:116`) and all four v5 parity defects now have a production observation that would look different if the fix were absent — the decisive one being an `action=ALLOW` publish after 480 seconds of idle where the same probe against `v0.0.72` recorded `[proxy] BLOCK reason="Username required for MQTT" user=` with an empty username and a torn-down socket.**

## Performance

- **Duration:** ~2h30m wall clock, including the human UAT wait
- **Started:** 2026-07-29T18:25:38Z
- **Prod verification complete:** 2026-07-29T19:20Z
- **UAT corroboration recorded:** 2026-07-29T20:55Z
- **Tasks:** 3 (2 auto, 1 blocking human-verify)

## Accomplishments

- **The whole overlay was proven byte-identical to upstream, not just the files this plan touched.** The changed set came from `git diff --name-only d340f36 5769031` (8 files, 5 modified + 3 new), but the parity assertion ran over all **89** tracked overlay paths that also exist upstream, comparing monorepo `origin/main` blobs against upstream **merge-commit** blobs by object — **0 mismatches**. That matters because `apps/build.sh resolve_meshtk` clones upstream `main` fresh at build time and untars the monorepo overlay *on top*, so any stale overlay file silently wins over the fresh upstream version.
- **The CI overlay composition was reproduced locally before the merge, not assumed.** `git archive` of the upstream merge SHA (2310 files) with all 157 tracked overlay files untarred over it, then `go build ./...`, `go vet` and `go test ./internal/app/server/` — all exit 0.
- **`internal/embedded/gpx/embedded.go` survived.** sha256 `98679cba…` identical before and after, and absent from PR #1078's diffstat. It has been clobbered by a vendor-sync before.
- **One release carried both fixes.** PR #1075 (ricky flag-line, upstream #26) was merged first so `origin/main` already had the fleet-package sync, making it the correct base; one deploy closed both.
- **Every closed defect has a distinguishable production observation with a recorded pre-deploy counterpart.** Four of five probes FAILed against `v0.0.72` and all five PASS against `v0.0.73` — see the table below. The contrast is a measurement, not an assertion.
- **The 3.1.1 fleet never stopped flowing and the reason-code contract is unregressed.** Per-minute `action=ALLOW` was non-zero for all 25 minutes spanning the deploy boundary (46 lines on the draining task, 105 on the new one), and the four 68-05 CONNACK captures are byte-identical both before and after.
- **Zero real-client harm from the two riskiest new code paths.** Across the new task's whole ~2-hour lifetime, including ~36 minutes of continuous real Android publishing: `MQTT5_PUBLISH_HEADER_FAIL` = **0**, `panic` = **0**, `"Username required for MQTT"` = **0**. The only `MQTT5_PARSE_FAIL` (2), `MQTT5_PROTOCOL_VIOLATION` (2) and `[proxy] BLOCK` (2) lines are attributable to this plan's own probes by client id.
- **WR-04 is visible on a real client, not only on a probe.** The Android app's SUBSCRIBE now appears as `action=ALLOW … mqtt_type=SUBSCRIBE` — 16 times.

## Task Commits

| # | Commit | What |
|---|---|---|
| 1 | `74e98f34` → merged `2935a829` | Task 1 — vendor-sync the overlay to byte-parity with upstream main @ `5769031` (PR #1078) |
| 2 | `1a2e14fa` | Task 2 — the committed probe script, landed **before** the buildpub run |
| 3 | `4767575e` | Task 2 — fix the probe's log-poll race (deviation 1, Rule 1) |
| 4 | `85c7ad45` | Task 2 — the recorded pre/post probe transcripts |
| 5 | `25004d5d` | Task 3 — the Android UAT corroboration telemetry |

`git log --oneline -- .planning/phases/68-*/68-08-probes/` shows `1a2e14fa` (18:36Z) precedes the buildpub run (18:38Z), so the pre-deploy baseline provably used committed bytes.

## Git and release artifacts

| Artifact | Value |
|---|---|
| Upstream merge SHA | `5769031881efa6b9f54ee1ca51afe7b896867086` (whereiskurt/meshtk PR **#27**) |
| Monorepo PRs | **#1075** (ricky flag-line) MERGED · **#1078** (vendor-sync) MERGED @ `2935a829` · **#1079** (Release v20260729.1838, buildpub-owned VERSION bump) MERGED |
| Files the vendor-sync touched | `internal/app/server/`: `inspect.go`, `inspect_v5.go`, `proxy_v5.go`, `rules.go`, `proxy_v5_e2e_test.go` (modified) + `proxy_v5_parity_test.go`, `proxy_v5_rawpublish.go`, `proxy_v5_rawpublish_test.go` (new) — 8 total, +2097/−59 |
| buildpub run | `30480812306` — `conclusion=success` |
| deploy run | `30481496161` — `conclusion=success` |
| VERSION | `v0.0.72` → **`v0.0.73`** (buildpub owned the bump; no `--skip-bump`, no hand edit) |
| Task definition | `run-mqtt-use1-dc34:115` → **`116`**, referencing `dc34-run-mqtt-meshtk:v0.0.73` |
| Old task drained | `3473b1a8…` reached **STOPPED at 18:55:04Z** before any post-deploy result was recorded |
| Log streams | old `meshtk/run-mqtt-meshtk/3473b1a842eb4a39914de53150bfbca9` · new `meshtk/run-mqtt-meshtk/17a91e1151984604a3783db2d78687b5` |

## The four defect probes — pre/post contrast

| Probe | Pre-deploy (v0.0.72, stream `3473b1a8`) | Post-deploy (v0.0.73, stream `17a91e11`) |
|---|---|---|
| `cr02-idle` (480s) | **FAIL** — `[proxy] BLOCK from=!435990e4 to=!ffffffff reason="Username required for MQTT" user=` (username **empty**, `clientID=` empty), socket torn down | **PASS** — `action=ALLOW … clientID=dc34p-cr02-…, username=0a487d6affa5, mqtt_type=PUBLISH, mesh_type=NODEINFO_APP` at 480s; session alive (PINGRESP returned) |
| `cr03-second-connect` | **FAIL** — no DISCONNECT at all, socket stayed open, no violation line: the frame was relayed | **PASS** — wire DISCONNECT `reason=0x82` + exactly one `action=MQTT5_PROTOCOL_VIOLATION, mqtt_type=1, reason=illegal_frame_on_established_session` |
| `cr04-unmodelled-block` | **FAIL** — `action=MQTT5_PARSE_FAIL … reason=invalid Prop type 127 for packet 3` and **no decision at all**; mosquitto's own DISCONNECT `0x81` came back through the downlink as `e00181`, proving the bytes reached the broker | **PASS** — `action=BLOCK … clientID=dc34p-cr04-…, mqtt_type=PUBLISH, mqtt_topic=[msh/US/2/e/dc.run/!435990e4]` plus `[proxy] BLOCK … reason="Failed to decrypt with any known key"`; nothing relayed |
| `wr04-subscribe` | **FAIL** — SUBACK `900400150000` returned but **no proxy log line whatsoever** | **PASS** — `action=ALLOW … mqtt_type=SUBSCRIBE, mqtt_topic=[msh/US/2/e/dc.run/probe-…/#]` |
| `regression-connacks` | PASS | **PASS** |

The pre-deploy `cr02-idle` run used the **same 480s duration** as the post-deploy run. That is load-bearing: the reaper only evaluates its 180s threshold on a 300s tick, so a shorter baseline would have proven nothing and cannot be reconstructed after the deploy.

### Regression CONNACK captures — byte-identical to 68-05, before and after

| Case | Bytes | Meaning |
|---|---|---|
| v5 bad credentials | `2003008700` | 0x87 Not authorized |
| protocol level 6 | `2003008400` | 0x84 Unsupported Protocol Version |
| v5 Authentication Method property | `2003008c00` | 0x8C Bad authentication method, answered before the backend dial |
| 3.1.1 (level 4) bad credentials | `20020005` | the 4-byte 3.1.1 CONNACK — the 3.1.1 codec is untouched on the wire |

Valid-credential success remains `2006000003210014`, with `TopicAliasMaximum` stripped.

## 3.1.1 ALLOW continuity across the deploy window

Per-minute `action=ALLOW`, both streams, 18:45Z–19:09Z — **never zero**, 25/25 minutes covered:

```
18:45 6 | 18:46 6 | 18:47 8 | 18:48 5 | 18:49 8 | 18:50 7 | 18:51 7 | 18:52 6 | 18:53 6
18:54 8 | 18:55 6 | 18:56 7 | 18:57 6 | 18:58 6 | 18:59 6 | 19:00 6 | 19:01 6 | 19:02 7
19:03 6 | 19:04 4 | 19:05 5 | 19:06 5 | 19:07 6 | 19:08 4 | 19:09 4
total 151 — 46 on the draining task 3473b1a8, 105 on the new task 17a91e11
```

## New-stream health counts (whole ~2h task lifetime)

| Signal | Count | Attribution |
|---|---|---|
| `MQTT5_PUBLISH_HEADER_FAIL` | **0** | the single most important new signal — 68-07's fail-closed path never fired on a real client |
| `panic` | **0** | |
| `"Username required for MQTT"` | **0** | CR-02's symptom is gone; pre-deploy it fired for a probe after 480s |
| `MQTT5_PARSE_FAIL` | 2 | both this plan's `cr04` probes, by client id — zero from real clients |
| `MQTT5_PROTOCOL_VIOLATION` | 2 | both this plan's `cr03` probes, by client id — T-68-06-06 clear |
| `[proxy] BLOCK` | 2 | both this plan's `cr04` probes |

## UAT record

**Kurt's verdict, verbatim:**

> "OK! looks ok"

He did not state how long he actually idled, so the idle window below is derived from telemetry timestamps rather than from the report. Full detail in `68-08-probes/uat-telemetry-aed94d05.md`.

**Corroborating telemetry** for `MeshtasticAndroidMqttProxy-!aed94d05-*` (username `b84cf62c402c`), scoped to the current task's stream:

| Check | Result |
|---|---|
| `action=MQTT5_CONNECT` for the phone's client id | ✅ 16 lines, 18:54:04Z → 20:27:54Z |
| `action=ALLOW` for its publishes | ✅ 55 `[proxy] ALLOW from=!aed94d05 to=!ffffffff type=POSITION_APP topic=[msh/US/2/e/dc.run/!aed94d05] user=b84cf62c402c` |
| Zero BLOCK carrying the username-required reason | ✅ **0** over the whole task lifetime |
| No second `MQTT5_CONNECT` inside the idle window | ⚠️ **the nine-minute bar is not met — see Named Limitation** |

Best real-client window, no intervening `MQTT5_CONNECT`:

```
20:10:01Z  action=MQTT5_CONNECT
   ... 416s with no publish and no reconnect ...
20:16:57Z  action=ALLOW mqtt_type=PUBLISH POSITION_APP   <- succeeded
```

## Named Limitation — the nine-minute bar is not met

**This is a qualified pass, accepted on Kurt's decision (option c), not a clean one.**

- The longest real-client publish-idle-then-successful-publish window with no intervening `MQTT5_CONNECT` is **416s (6m56s)**. **No window ≥540s exists anywhere in the telemetry.**
- At 416s the old code's reaper had a qualifying tick for `(416 − 180) / 300` = **78.7%** of possible tick phases. So the observation favours the fix but is **probabilistic**, not guaranteed-discriminating.
- **The 24m08s currently-open session is not CR-02 evidence and must not be read as such.** It carries 25 consecutive successful publishes with a **median 65s** inter-publish gap — a client publishing every ~65s never idles past the 180s threshold, so that session **would have survived on the old code too**. Session length alone proves nothing here.
- **The bar may be unreachable with this client.** When idle the phone re-establishes on its own every ~1–5 minutes (observed CONNECT gaps include 124s, 127s, 67s, 67s, 285s, 133s, 125s). A nine-minute *connected* idle window may not be something the app will do, which would make the UAT as specified unsatisfiable rather than merely unsatisfied.

What **is** settled: CR-02 is machine-proven at the guaranteed-discriminating 480s, with a pre-deploy FAIL and a post-deploy PASS at the identical duration (D4), and the symptom it produces — a username-required Block — is absent from two hours of production including ~36 minutes of real Android publishing. What remains open is only the real-Android version of the same claim at the nine-minute bar.

## Deviations from Plan

### 1. [Rule 1 — Bug in this plan's own code] The probe's log poll returned before the line it needed was ingested

- **Found during:** Task 2, on the first post-deploy `cr02-idle` run.
- **Issue:** `fetch_logs` polled until *any* event matched the run's client id. The session's own `action=MQTT5_CONNECT` line is ingested within seconds of CONNECT, so the poll returned immediately — but for `cr02-idle` the decision line arrives **eight minutes later**. The probe reported FAIL against an image whose `action=ALLOW` line was already in CloudWatch (confirmed by direct query: `19:05:01.744 action=ALLOW … clientID=dc34p-cr02-2c667646, mqtt_type=PUBLISH, mesh_type=NODEINFO_APP`, exactly 480s after the `18:57:01.676` CONNECT).
- **Fix:** callers now pass the substring identifying the line they are waiting for — `action=MQTT5_CONNECT`, `action=MQTT5_PROTOCOL_VIOLATION`, `action=BLOCK`, `[proxy] BLOCK`, `mqtt_type=SUBSCRIBE`, `mqtt_type=PUBLISH`, and the username-required reason.
- **Why the baseline is still valid:** the change can only turn a spurious FAIL into a PASS — it never relaxes an assertion. Each of the four pre-deploy FAIL verdicts rested on a **positively observed** line (the username-required Block, the parse-fail with no decision, the absent DISCONNECT on a still-open socket, the SUBACK with no log line), not on a timing-sensitive absence. All five subcommands were nonetheless **re-run** post-deploy with the fixed script and all five exit 0; that re-run is what the post-deploy transcript records.
- **Files:** `68-08-probes/mqtt5_probe.py`. **Commit:** `4767575e`.

### 2. [Shape] Each probe's verdict is a wire **and** log conjunction, not a wire-only assertion

The plan described wire-observable outcomes per defect. Measurement showed three of the four are **not** wire-distinguishable, because mosquitto refuses the same frames the proxy now refuses (the 68-07 finding, re-confirmed here): pre-deploy, the relayed CR-04 frame came back as mosquitto's own DISCONNECT `0x81` (`e00181`) through the downlink, and a relayed second CONNECT can likewise end in a broker-side DISCONNECT. What separates "the proxy refused it" from "the broker refused it" is the proxy's own log line. So every subcommand also correlates against CloudWatch on a client id unique to the run — which additionally makes the probes safe to run during a rolling replace, since a unique client id cannot be attributed to the wrong task. This strengthens the plan's acceptance criteria (all of which are log-based for CR-03/CR-04/WR-04) rather than weakening them.

### 3. [Additive] Probe transcripts and UAT telemetry committed as artifacts

The plan's file list for Task 2 was the script alone. Both runs' verbatim output (`transcript-pre-deploy-v0.0.72.txt`, `transcript-post-deploy-v0.0.73.txt`) and the UAT telemetry analysis (`uat-telemetry-aed94d05.md`) were committed too, so the pre/post contrast and the UAT corroboration are re-readable rather than living only in this summary — the failure mode that makes 68-05's evidence unrecoverable today.

### 4. [Shape] The vendor-sync was done in a `git worktree`, not by switching branches

The plan allowed either. A worktree cut from `origin/main` keeps the overlay branch and the planning branch strictly disjoint with no risk of the working tree's pre-existing dirty file (`apps/run.human/webapp/scripts/seed-ctf-otp.mts`, unrelated to this plan) being swept into either. That file was never staged, committed or reverted. The worktree was removed after the merge.

### 5. [Deferred] The proxy→mosquitto broken-pipe reconnect path

Split out to `deferred-items.md` on Kurt's decision (option c) rather than investigated here — see below.

**Total deviations:** 1 auto-fixed bug (Rule 1), 3 shape/additive notes, 1 deferral. **Scope creep:** none.

## Follow-up split out — proxy→mosquitto `broken pipe`

Logged to `deferred-items.md`. Two of the Android reconnects have an identified proxy-side cause that is **not** CR-02 and **not** a regression from this phase:

```
20:16:57Z level=error failed to write to backend: write tcp 127.0.0.1:38104->127.0.0.1:1884: write: broken pipe
20:16:59Z action=MQTT5_CONNECT   (reconnect 2s later)
20:19:08Z level=error failed to write to backend: write tcp 127.0.0.1:42922->127.0.0.1:1884: write: broken pipe
20:19:12Z action=MQTT5_CONNECT   (reconnect 4s later)
```

The proxy decided ALLOW, then found the proxy→broker socket already closed and dropped the client — correct, pre-existing behaviour on a dead backend, on a path shared with the 3.1.1 loop. On the same stream `timeout` = 0, `EOF` = 0. Two occurrences in ~36 minutes. The leading hypothesis recorded for investigation is a **duplicate-client-id takeover**: the app reuses one client id (`…-fdcc313a`) across reconnects, so a new CONNECT with that id makes mosquitto evict the previous session — which would make the broken pipe a *consequence* of reconnect churn rather than its cause. That fits the 2–4s reconnect latency and should be settled before any code change.

## Threat mitigations

| Threat | Disposition |
|---|---|
| T-68-08-01 (stale overlay reverts an upstream fix) | Mitigated — changed set from `git diff --name-only`; sha256 parity over all 89 tracked overlay files vs merge-SHA blobs, 0 mismatches; CI overlay reproduced and built before merge |
| T-68-08-02 (vendor-sync clobbers `embedded.go`) | Mitigated — excluded by the copy loop, sha256 `98679cba…` asserted unchanged, absent from the PR diffstat |
| T-68-08-03 (branching off the stale release branch) | Mitigated — worktree cut from freshly fetched `origin/main`; `merge-base --is-ancestor origin/release/2026-07-26-230957 <tip>` FAILS as required |
| T-68-08-04 (rolling replace drops fleet traffic) | Mitigated — per-minute ALLOW non-zero for all 25 minutes across the boundary; old task polled to STOPPED before any claim |
| T-68-08-05 (credential leaks through a probe) | Mitigated — username shape-validated `^[0-9a-f]{12}$`, password by env var only, never printed (shape/length only), grep-verified absent from the committed script and both transcripts, no scratch file with credentials survives |
| T-68-08-06 (deployed image ≠ built image) | Mitigated — task def 116 inspected, references `dc34-run-mqtt-meshtk:v0.0.73`, the tag buildpub pushed at 18:39:35Z |
| T-68-08-07 (local `terragrunt apply` bypasses CI) | Mitigated — deploy attributable to `deploy.yml` run `30481496161`; no local apply, no local tfstate artifacts |
| T-68-08-08 (fail-closed path drops a real client's frames) | Mitigated — `MQTT5_PUBLISH_HEADER_FAIL` = 0 on the new stream across ~2h including ~36min of real Android publishing; the UAT is the second detector |
| T-68-08-09 (CR-04 probe injects a fake node) | Mitigated — the probe publishes an undecryptable envelope, Blocked at the proxy; nothing reached the broker or the fleet ingest |

## Verification Performed

- Parity loop, `origin/main` overlay blobs vs upstream merge-SHA blobs: **89 compared, 0 MISMATCH**
- `embedded.go` sha256 `98679cbaf354f31028a3a1b4b64ef9c1e250baa4c3fb4daa0356a7d72561624b` unchanged; absent from PR #1078 files
- PR #1078 file list entirely under `apps/run.mqtt/meshtk/`; no `.planning/` path; **no `VERSION`**
- Ancestry: `merge-base --is-ancestor origin/main <tip>` succeeds; `--is-ancestor origin/release/2026-07-26-230957 <tip>` FAILS
- Local CI-overlay reproduction: `go build ./...` 0, `go vet ./internal/app/server/` 0, `go test ./internal/app/server/` ok
- Upstream gate before the PR: `go build ./...` 0, `go test ./internal/app/server/` ok
- ECS: single PRIMARY deployment, `rolloutState=COMPLETED`, 1/1, revision **116** > 115, image `v0.0.73` > `v0.0.72`
- Old task polled to STOPPED (18:55:04Z) before any post-deploy result recorded; every count `--log-stream-names`-scoped
- All five probe subcommands exit **0** post-deploy; four of five FAILed pre-deploy
- `python3 mqtt5_probe.py cr02-idle --idle-seconds 200` refuses to run (480s floor enforced in code)
- `git log --oneline -- .planning/phases/68-*/68-08-probes/` — script committed 18:36Z, buildpub launched 18:38Z
- No credential value in the committed script, either transcript, or this summary (grep-verified against the live password)
- Pre-existing dirty file `apps/run.human/webapp/scripts/seed-ctf-otp.mts` never staged, committed or reverted

## User Setup Required

None.

## Next Phase Readiness

Phase 68 is complete: the dual codec and all four parity fixes are live on `v0.0.73`, and MQV5-01 through MQV5-07 are satisfied.

Two items carry forward, both in `deferred-items.md`:

1. **proxy→mosquitto `broken pipe`** — investigate the duplicate-client-id takeover hypothesis first; also worth adding client id / username to the `failed to write to backend` log line, which today carries only the TCP 4-tuple and cannot be correlated to a session without hand-matching timestamps.
2. **`internal/credcache` `TestSingleflight` flake** — pre-existing, zero meshtk dependencies; keep `go test ./internal/app/server/` as the meshtk gate.

Open verification gap, recorded rather than closed: the real-Android nine-minute idle-survival claim. If it is retried, note that the app self-reconnects every ~1–5 minutes when idle, so the test may need a different formulation — for instance instrumenting the app's own keepalive rather than asking for a wall-clock idle window it will not hold.

`mqtt5_probe.py` is the reusable asset. Any future v5 change should re-run all five subcommands pre- and post-deploy; that is now a two-command operation rather than a re-derivation.

## Self-Check: PASSED

- All four claimed artifacts exist on disk: `mqtt5_probe.py`, `transcript-pre-deploy-v0.0.72.txt`, `transcript-post-deploy-v0.0.73.txt`, `uat-telemetry-aed94d05.md`
- All five claimed commits exist: `74e98f34`, `1a2e14fa`, `4767575e`, `85c7ad45`, `25004d5d` (plus merge `2935a829`)
- No stubs. One partial coverage item (D10) is explicitly marked `status: partial` with its limitation named in the frontmatter rationale and in a dedicated section, rather than reported as complete

---
*Phase: 68-mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa*
*Completed: 2026-07-29*
