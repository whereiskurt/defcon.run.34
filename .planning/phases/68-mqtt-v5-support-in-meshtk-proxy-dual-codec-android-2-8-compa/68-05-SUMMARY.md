---
phase: 68-mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa
plan: 05
subsystem: infra
tags: [mqtt, mqtt5, meshtk, release, deploy, ecs, prod-verification, uat]

# Dependency graph
requires:
  - phase: 68-04
    provides: "monorepo main @ 6bbe18c — the vendored dual-codec overlay buildpub compiles"
  - phase: 68-03
    provides: "upstream meshtk main @ c5341ce — the merged dual codec the image build clones"
provides:
  - "dc34-run-mqtt-meshtk:v0.0.72 — the first production image carrying the MQTT v5 dual codec"
  - "run-mqtt-use1-dc34:115 — the deployed ECS task definition revision"
  - "prod wire evidence: the 0x84 -> 0x87 flip, 0x8C enhanced auth, 0x84 retained for level 6, success CONNACK with TopicAliasMaximum stripped"
  - "a stream-scoped log-attribution method for ECS rolling replaces"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Attribute post-deploy log evidence by LOG STREAM (per-task), never by wall-clock timestamp — during an ECS rolling replace both images write to the same log group concurrently"
    - "`aws ecs wait services-stable` is NOT a drain gate: it returns while the old task still serves every long-lived TCP connection. Poll the old task to STOPPED before claiming the new image serves production traffic"
    - "Capture the before/after wire byte BEFORE building anything — the contrast is the evidence"

key-files:
  created: []
  modified: []

key-decisions:
  - "68-05: the pre-deploy baseline was captured before any build, so the 0x84->0x87 flip is a measured contrast rather than a post-hoc assertion"
  - "68-05: all four probes were RE-RUN at 07:26:10Z after the old task reached STOPPED, so no reject/success code can be attributed to an ambiguous NLB target"
  - "68-05: a 3.1.1 (level 4) bad-credential probe was added beyond the plan — it returns the 4-byte 3.1.1 CONNACK 20020005, proving the untouched-3.1.1 requirement on the production wire and not only in the 68-01 golden"
  - "68-05: Kurt's UAT verdict is recorded verbatim and ROADMAP criterion 1 is marked met on HUMAN ATTESTATION ONLY — production telemetry does not corroborate an Android MQTT v5 session (see Open Verification Gap). This is recorded as a gap rather than silently upgraded to machine-verified."

requirements-completed: [MQV5-07]

coverage:
  - id: D1
    description: "A new meshtk image carrying the dual codec is built and published to ECR under a new immutable tag"
    requirement: "MQV5-07"
    verification:
      - kind: other
        ref: "buildpub run 30430522647 conclusion=success; apps/run.mqtt/meshtk/VERSION v0.0.71 -> v0.0.72 via auto-merged Release PR #1073; ECR dc34-run-mqtt-meshtk:v0.0.72 pushed 2026-07-29T07:09:13Z"
        status: pass
    human_judgment: false
  - id: D2
    description: "The ECS service reaches a stable state on a higher task definition revision running that image"
    requirement: "MQV5-07"
    verification:
      - kind: other
        ref: "deploy run 30430919355 conclusion=success; `aws ecs wait services-stable --cluster app-use1-dc34 --services run-mqtt-use1` exit 0; revision 114 -> 115; runningCount==desiredCount==1; task def 115 containerDefinitions reference dc34-run-mqtt-meshtk:v0.0.72"
        status: pass
    human_judgment: false
  - id: D3
    description: "A bad-credential v5 CONNECT flips from 0x84 to 0x87 across the deploy"
    requirement: "MQV5-07"
    verification:
      - kind: other
        ref: "same python3 ssl probe: pre-deploy 2003008400 (07:07Z), post-deploy 2003008700 (07:21:28Z and again 07:26:10Z after old task STOPPED)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Version-correct reason codes: 0x8C for enhanced auth, 0x84 retained only for levels above 5, success CONNACK carries no TopicAliasMaximum"
    requirement: "MQV5-07"
    verification:
      - kind: other
        ref: "enhanced auth 2003008c00; protocol level 6 2003008400 + action=MQTT5_REJECT protocol_version=6; valid creds 2006000003210014 (reason 0x00, props = 0x21 ReceiveMaximum only, no 0x22)"
        status: pass
    human_judgment: false
  - id: D5
    description: "action=MQTT5_CONNECT appears for successful v5 sessions and no MQTT5_REJECT carries protocol_version=5 on the new image"
    requirement: "MQV5-07"
    verification:
      - kind: other
        ref: "stream meshtk/run-mqtt-meshtk/3473b1a8... (rev :115) whole lifetime: MQTT5_CONNECT=2, MQTT5_AUTH_METHOD=2, MQTT5_REJECT protocol_version=5 = 0, protocol_version=6 = 2, MQTT5_PARSE_FAIL=0, panic=0"
        status: pass
    human_judgment: false
  - id: D6
    description: "3.1.1 fleet traffic is uninterrupted across the deploy window"
    requirement: "MQV5-07"
    verification:
      - kind: other
        ref: "group-level action=ALLOW per minute never reached zero: 12,12,13,12,12,12,11,12,14,8,8,8,8,8; post-migration new task steady 8/min (40 per 5 min) vs pre-deploy control 61 per 5 min; live radios !a1cc1d70 and !093a781d keepaliving on the new image"
        status: pass
    human_judgment: false
  - id: D7
    description: "The 3.1.1 codec path is unchanged on the production wire"
    requirement: "MQV5-07"
    verification:
      - kind: other
        ref: "level-4 bad-credential probe returns the 4-byte 3.1.1 CONNACK 20020005 (reason 0x05), not a v5 5-byte frame — added beyond plan scope"
        status: pass
    human_judgment: false
  - id: D8
    description: "Kurt's Android 2.8.0-open.6 APK connects through the proxy and sees the ghost/sim fleet"
    requirement: "MQV5-07"
    verification:
      - kind: other
        ref: "Kurt verbatim: \"OK! I got messages eventuall flowing with to gold wiht !435990e4\" — human attestation"
        status: pass
      - kind: other
        ref: "PROXY TELEMETRY DID NOT CORROBORATE: at 13:35:34Z the only MQTT5_CONNECT lines on rev :115 for its entire lifetime are the two 68-05 verification probes; node !435990e4 has zero events across all meshtk streams and the ghosts group in the preceding 60 minutes; zero MQTT5_ lines of any kind in that window"
        status: partial
    human_judgment: true
    rationale: "Kurt reports end-to-end success and that is recorded as given. But no Android MQTT v5 session and no traffic from node !435990e4 is visible in the production proxy logs, so the working path cannot be confirmed to be the v5 codec at mqtt.defcon.run:4433. The codec itself is independently wire-proven by D3/D4/D5. See Open Verification Gap."

# Metrics
duration: ~35min active
completed: 2026-07-29
status: complete
---

# Phase 68 Plan 05: Ship the Dual Codec to Production Summary

**meshtk `v0.0.72` is live on `mqtt.defcon.run:4433` (task def `run-mqtt-use1-dc34:115`) and the production wire now answers MQTT v5 with version-correct reason codes — the decisive `2003008400` → `2003008700` flip on an unchanged bad-credential probe — while the 3.1.1 fleet never stopped flowing across the deploy.**

## Performance

- **Duration:** ~35 min active (plus a ~6 h wall-clock wait for human UAT)
- **Started:** 2026-07-29T07:04Z
- **Prod verification complete:** 2026-07-29T07:33Z
- **UAT resolved:** 2026-07-29T13:35Z
- **Tasks:** 3 (2 automated, 1 human checkpoint)
- **Files:** 0 created, 0 modified — this plan ships already-merged code

## Accomplishments

- **The single wire fact that proves the codec is live.** The identical raw v5 CONNECT with deliberately bogus credentials returned `2003008400` (0x84 Unsupported Protocol Version) at 07:07Z and `2003008700` (0x87 Not authorized) at 07:21Z. That byte can only change if the v5 codec parsed the CONNECT and ran it through the Authenticator instead of the v0.0.70 honest-reject preflight.
- **All four reason codes confirmed on the production wire**, then **re-run at 07:26:10Z after the old task reached `STOPPED`** so nothing can be attributed to an ambiguous NLB target.
- **Release discipline held.** buildpub owned the bump (`v0.0.71` → `v0.0.72`, Release PR #1073 auto-merged); no `--skip-bump`, no hand-edited VERSION, no local `terragrunt apply`. Task def 115 provably references `dc34-run-mqtt-meshtk:v0.0.72`.
- **3.1.1 continuity measured, not assumed** — `action=ALLOW` never reached zero, and a level-4 probe returning the 4-byte `20020005` proves the 3.1.1 codec is untouched in production, not just in the 68-01 golden.
- **No parse-failure storm and no panic** — `MQTT5_PARSE_FAIL=0`, `panic=0` on the new image, so nothing mqttastic-shaped destabilised the read loop.

## Recorded artifacts

### Probes (same script, `python3` ssl socket to mqtt.defcon.run:4433)

| Probe | Pre-deploy (07:07Z) | Post-deploy (07:26:10Z, old task STOPPED) | Meaning |
|---|---|---|---|
| v5 (level 5), bad creds | `2003008400` | **`2003008700`** | 0x87 Not authorized — the decisive flip |
| level 6, bad creds | `2003008400` | `2003008400` | 0x84 stays reserved for levels above 5 |
| v5 + AuthMethod | `2003008400` | `2003008c00` | 0x8C Bad authentication method |
| v5, valid creds | *(0x84)* | `2006000003210014` | 0x00 Success; props = `21 00 14` only, **no `0x22`** |
| 3.1.1 (level 4), bad creds | — | `20020005` | 3.1.1 CONNACK format unchanged (added beyond plan) |

### Release / deploy

```
buildpub run 30430522647   conclusion=success   (--ref main, apps=run.mqtt, regions=use1)
  VERSION v0.0.71 -> v0.0.72 ; Release PR #1073 auto-merged (squash) 07:13:11Z
  ECR dc34-run-mqtt-meshtk:v0.0.72 pushed 07:09:13Z
deploy run  30430919355   conclusion=success   (region=us-east-1, pr_number=skip, invalidate_cache=false)
  aws ecs wait services-stable --cluster app-use1-dc34 --services run-mqtt-use1  -> exit 0
  task definition run-mqtt-use1-dc34:114 -> :115 ; runningCount==desiredCount==1
  task def 115 -> dc34-run-mqtt-meshtk:v0.0.72 (meshtk AND ghosts containers)
```

### CloudWatch — new task stream only (`meshtk/run-mqtt-meshtk/3473b1a8…`, rev :115)

```
MQTT5_CONNECT                    = 2   (both 68-05 verification probes)
MQTT5_AUTH_METHOD                = 2
MQTT5_REJECT protocol_version=5  = 0   <-- the criterion
MQTT5_REJECT protocol_version=6  = 2
MQTT5_PARSE_FAIL                 = 0   (no storm)
panic                            = 0
action=ALLOW (clean 5-min window) = 40  [pre-deploy control 61 / 5 min]
```

### 3.1.1 continuity, per minute (group level, deploy boundary 07:18:29Z)

```
07:06 12 | 07:07 12 | 07:08 12 | 07:09 12 | 07:10 12 | 07:11 12 | 07:12 13
07:13 12 | 07:14 12 | 07:15 12 | 07:16 11 | 07:17 12 | 07:18 14  <-- new task starts
07:19  8 | 07:20  8 | 07:21  8 | 07:22  8 | 07:23  8   (never zero)
```

## Deviations from Plan

### 1. [Rule 1 — measurement bug] The plan's "no MQTT5_REJECT with protocol_version=5" criterion is unsatisfiable by a timestamp query

- **Found during:** Task 2
- **Issue:** two `MQTT5_REJECT, protocol_version=5` lines appear at 07:18:30 and 07:19:00, *after* the new task's `startedAt` of 07:18:29. A naive time-boxed query fails the criterion.
- **Diagnosis:** both came from the **old** task's log stream (`0e603fa4…`, task-definition `:114`, confirmed via `describe-tasks` showing `DEACTIVATING`→`STOPPING`→`STOPPED`). They are the tail of a client's unbroken ~30.5 s retry loop that runs continuously from before the deploy and stops dead at 07:19:00. The new task has **zero**.
- **Fix:** attribute all post-deploy evidence by `--log-stream-names` (per task) instead of by wall clock. Both images write to the same log group concurrently during a rolling replace.
- **Commit:** n/a (verification method)

### 2. [Rule 2 — missing critical verification] `services-stable` returned while the new image had served zero fleet traffic

- **Found during:** Task 2
- **Issue:** at the moment CI went green *and* `aws ecs wait services-stable` exited 0, meshtk `v0.0.72` had logged **zero** `action=ALLOW` events — every 3.1.1 fleet packet was still being served by the draining `v0.0.71` task, because MQTT clients hold long-lived TCP connections through NLB deregistration. Declaring success there would have shipped without ever proving the new image handles the fleet.
- **Fix:** polled until the old task reached `STOPPED` (07:25:55Z), then confirmed `ALLOW` migrated to the new stream (8 → 10 → 14, steady 8/min) and re-ran all four probes against the sole remaining task.
- **Commit:** n/a (verification only)

### 3. [Additive] A 3.1.1 (level 4) probe was added

The plan specified four v5-family probes. A level-4 bad-credential probe was added; it returns the 4-byte 3.1.1 CONNACK `20020005` rather than a 5-byte v5 frame, proving the untouched-3.1.1 requirement on the production wire.

## UAT record

**Kurt's verdict, verbatim:**

> "OK! I got messages eventuall flowing with to gold wiht !435990e4"

Preceded by two interim observations, verbatim:

> "I just tried a android device saying Hi to goldstein and max retrans..."
> "I'm not in the nodes.json file yet.. hm..."

### Root cause of the initial "max retrans" — confirmed, and it is not a v5 defect

The interim failure was traced to node **`!174e59c8`** (decimal `391010760`), connected as `MeshtasticAppleMqttProxy-!174e59c8-…` — an **iOS proxy on the MQTT 3.1.1 path**, not a v5 session. Its PKI DM was accepted and `ALLOW`ed by the proxy on the sender's own gateway topic `msh/US/2/e/PKI/!174e59c8`, in two retransmit bursts of three (13:28:55 / 13:29:01 / 13:29:05 and 13:31:43 / 13:31:48 / 13:31:53). At each of those exact timestamps the ghosts container logged:

```
keycache miss for node !174e59c8, nodes.json fallback used (enrollment-coverage)
PKI decrypt failed for packet from 391010760 on msh/US/2/e/PKI/!174e59c8:
    failed to resolve sender public key: PubKey not found for node 391010760
Requesting nodeinfo from node 174e59c8 via node 1555f041
```

Both symptoms share one cause: **the node had published no `NODEINFO_APP` packet** (0 in 6 h; only `MAP_REPORT_APP` and `POSITION_APP`), and it had no row in the MeshRadio DDB. With no public key the fleet cannot decrypt the PKI DM, therefore cannot ACK it, therefore the radio retransmits to the limit — "max retrans" — and with no NODEINFO it is absent from the node inventory — "not in nodes.json". The fleet was actively self-healing (`Requesting nodeinfo from …`), which is why messages began flowing once registration completed. **This is expected fresh-radio first-connect behaviour, identical on v0.0.71, and independent of the dual codec.** Worth flagging: a newly-flashed radio cannot receive PKI DM ACKs until it has published NODEINFO and the fleet has cached its pubkey.

### Open Verification Gap (must not be read as machine-verified)

Kurt's success report is recorded as given, but **production telemetry does not corroborate it as an Android MQTT v5 session**. Queried at 13:35:34Z:

- The only `MQTT5_CONNECT` lines on rev `:115` **for its entire lifetime** are the two 68-05 verification probes (`mqttastic-prod-verify-68-05`, `mqttastic-confirm-68-05`).
- Node **`!435990e4`** has **zero** events across *all* meshtk streams and the ghosts log group in the preceding 60 minutes, and zero on rev `:115` ever.
- **Zero** `MQTT5_` lines of any kind in that 60-minute window.
- The only client on Kurt's username `e9ced815b0ee` is the iOS 3.1.1 `MeshtasticAppleMqttProxy-!174e59c8-…`.

So whatever path carried his messages to goldstein, it left no trace of an Android v5 session or of `!435990e4` at `mqtt.defcon.run:4433` — plausibly direct RF/LoRa, the iOS proxy, or another endpoint. **The dual codec itself is independently wire-proven** by the four probes and the `MQTT5_CONNECT` log lines, so this gap concerns the Android client's real-world path, not the codec. ROADMAP criterion 1 is marked met on **human attestation only**; a short re-verification — connect the 2.8.0 APK and confirm an `action=MQTT5_CONNECT` line appears with the phone's client id — would close it conclusively.

## Files Created/Modified

None. This plan builds, deploys and verifies the code merged in 68-04; it authors nothing. Both working trees were clean at every step (`git status --porcelain` empty), so tasks 1 and 2 produced no task commits — consistent with their `<files>none</files>` declarations.

## Issues Encountered

- **Log evidence during a rolling replace is ambiguous by timestamp.** Resolved by stream-scoped attribution (deviation 1). This is the single most reusable lesson here.
- **`services-stable` is not a drain gate** (deviation 2) — the AGENTS.md "CI going green is not proof the new task is serving" landmine, in a subtler form that also defeats the obvious `wait` remedy.
- **`rollback.yml` does not list `run.mqtt`** in its `app` choice input (only run.auth/human/cms/gpx/flash). The plan named it as the escape hatch; it was not needed, but a run.mqtt rollback would require a different mechanism. Recorded for whoever needs it under pressure.
- **The coordinator's stated UAT window (07:30–08:00Z) was ~6 h stale** — actual time was 13:31Z. A 45-minute query would have found nothing and could have been misread as "the session vanished".

## Known Stubs

None.

## Threat Flags

None. No new surface was introduced — this plan ships already-reviewed code. All six `mitigate` dispositions are implemented:

| Threat | Status |
|---|---|
| T-68-05-01 (DoS during rolling replace) | Mitigated — `services-stable` + revision check + per-minute ALLOW continuity across the window; never zero |
| T-68-05-02 (unmodelled property parse storm) | Mitigated — `MQTT5_PARSE_FAIL=0` and `panic=0` on the new image |
| T-68-05-03 (credential disclosure in verification) | Mitigated — reject probes used bogus creds; the one valid probe read `mqttUsername`/`mqttPassword` from the RunUser row, validated the username against `^[0-9a-f]{12}$` before use, passed the password via env var, never printed it (shape/length only), and the scratch files were deleted afterwards |
| T-68-05-04 (deploying an image other than the one built) | Mitigated — task def 115 inspected and confirmed to reference `dc34-run-mqtt-meshtk:v0.0.72` |
| T-68-05-05 (local terragrunt apply) | Mitigated — deploy ran solely via `deploy.yml`; no local apply |
| T-68-05-06 (v5 client reaching the broker without cred swap) | Mitigated — bad-credential probe rejected at the proxy with 0x87 before any backend dial |

## User Setup Required

None.

## Next Phase Readiness

- MQV5-07 is complete: upstream merged, vendor-synced, released, deployed and wire-verified in us-east-1.
- **Carried forward:** the Open Verification Gap above — a single Android 2.8.0 connection producing an `action=MQTT5_CONNECT` line would convert ROADMAP criterion 1 from human attestation to machine-verified.
- **cac1 remains out of scope** (S3 asset sync broken there for run.mqtt; use1-only is standing practice).
- **Pre-existing, still unfixed:** `RewritePayloadString` dereferences `*ip.Meshtastic.Cipher` unconditionally, so `RewriteHelloGoodbye` panics on a non-encrypted `TEXT_MESSAGE_APP`. Predates this phase; affects 3.1.1 identically.

## Self-Check: PASSED

buildpub run `30430522647` and deploy run `30430919355` both resolve with `conclusion=success`; Release PR #1073 is `MERGED`; `git show origin/main:apps/run.mqtt/meshtk/VERSION` returns `v0.0.72`; ECR tag `dc34-run-mqtt-meshtk:v0.0.72` exists (pushed 07:09:13Z); `run-mqtt-use1-dc34:115` is the service's task definition with `runningCount==desiredCount==1` and references that image; all five CONNACK captures were taken from the live endpoint and re-run against the sole remaining task; every log count cited was produced by a `filter-log-events` query scoped to the rev `:115` stream. No file was created or modified by this plan, so no file-existence claims are made.

---
*Phase: 68-mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa*
*Completed: 2026-07-29*
