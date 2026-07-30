---
phase: 69-meshtk-shared-chain-hardening-pre-existing-blockers-found-by
plan: 07
subsystem: meshtk-proxy
tags: [meshtk, mqtt, release, ecs, prod-verification, probes, mqtt5, security]
status: complete
requirements: [MQFX-05, MQFX-06]
requires:
  - "69-06 (upstream meshtk#29 merged; monorepo overlay at byte-parity, PR #1106 @ f7d1959)"
provides:
  - "meshtk v0.0.76 live on mqtt.defcon.run:4433 (run-mqtt-use1-dc34:119) with all six hardening defects closed"
  - "mqfx_probe.py — a committed, re-runnable production wire probe with one subcommand per safely observable defect"
  - "recorded PRE/POST transcripts against v0.0.75 and v0.0.76 from identical committed bytes"
  - "a per-defect production pre/post evidence table with per-stream, per-timestamp attribution"
  - "MQFX-06 confirmed satisfied by the shipped PR #1096 and undisturbed by this phase's vendor-sync"
affects:
  - .planning/phases/69-meshtk-shared-chain-hardening-pre-existing-blockers-found-by/69-07-probes/
tech-stack:
  added: []
  patterns:
    - "commit the probe BEFORE the release so PRE and POST are provably the same bytes"
    - "wire-AND-log conjunction per defect, correlated on a run-unique identifier"
    - "correlate on the identifier that actually appears on the line (WILL_STRIPPED carries a will topic, not a client id)"
    - "poll the OLD task to STOPPED as the drain gate; services-stable and CI-green both lie"
    - "pr_number=skip removes the one ungated merge path deploy.yml still has"
    - "do NOT edit the probe between PRE and POST, even to fix loose prose — identical bytes outrank cosmetics"
key-files:
  created:
    - .planning/phases/69-meshtk-shared-chain-hardening-pre-existing-blockers-found-by/69-07-probes/mqfx_probe.py
    - .planning/phases/69-meshtk-shared-chain-hardening-pre-existing-blockers-found-by/69-07-probes/transcript-pre-deploy-v0.0.75.txt
    - .planning/phases/69-meshtk-shared-chain-hardening-pre-existing-blockers-found-by/69-07-probes/transcript-post-deploy-v0.0.76.txt
    - .planning/phases/69-meshtk-shared-chain-hardening-pre-existing-blockers-found-by/69-07-probes/deploy-record-v0.0.76.md
  modified: []
decisions:
  - "Deployed with pr_number=skip, never latest: an UNRELATED run.human Release PR (#1109) was dispatched mid-replace, so latest would have --admin-merged someone else's work outside the Phase-69 waiver"
  - "The probe script was NOT edited between PRE and POST, even though mqfx04c's verdict prose miscalls a CONNACK a DISCONNECT — the byte assertion is exact and identical bytes are the whole point of committing first"
  - "mqfx02 publishes an ENCRYPTED text message with hop_limit=0 from a fabricated node; the decoded form of the same packet is the MQFX-01 remote process kill and is prohibited in the module docstring"
  - "8 real-client WILL_STRIPPED lines are recorded as a FINDING with a measured blast radius (zero subscribers to /will), not as a footnote"
metrics:
  duration: ~50m
  tasks: 3
  files: 4
  completed: 2026-07-30
---

# Phase 69 Plan 07: Ship and Prove in Production Summary

**meshtk `v0.0.76` is live on `mqtt.defcon.run:4433` (task definition `run-mqtt-use1-dc34:119`), and every one of the six defects this phase closed has a production observation that would look different if the fix were absent.** The decisive one is a byte comparison: the same probe's 72-byte `meshtastic.Data` came back off the production wire as **45 bytes with six fields zeroed** on `v0.0.75` and as **72 bytes, hex-identical to what was sent**, on `v0.0.76`.

MQFX-01 was never probed. Its production evidence is negative and it is complete.

## Artifacts

| Item | Value |
|------|-------|
| buildpub run | **`30556427674`** — `success`, 15:23:21Z → 15:29:02Z |
| Release PR | **#1107** "Bump versions for release: run.mqtt" — opened AND auto-merged by buildpub |
| deploy run | **`30556951618`** — `success`, 15:29:46Z → 15:32:13Z, `pr_number=skip` (merge job **skipped**) |
| VERSION | `v0.0.75` → **`v0.0.76`** — bumped by buildpub's own Release PR (`4140ef08`), no hand edit, no `--skip-bump` |
| Immutable ECR tag | `dc34-run-mqtt-meshtk:v0.0.76`, digest `sha256:95fb801a046bdf…a7216`, pushed 15:25:01Z |
| Task definition | `run-mqtt-use1-dc34:118` → **`119`**, referencing `…meshtk:v0.0.76` |
| Old task | `1762b3b7e0ee4f688c69842fb2bcac29` — **STOPPED at 2026-07-30T15:41:35.479Z** |
| New task | `3ba2d8ca22934c47826dc673de0a3614` — `RUNNING`, `HEALTHY`, started 15:33:57Z |
| PRE log stream | `meshtk/run-mqtt-meshtk/1762b3b7e0ee4f688c69842fb2bcac29` |
| POST log stream | `meshtk/run-mqtt-meshtk/3ba2d8ca22934c47826dc673de0a3614` |
| Service | exactly **1** deployment, `PRIMARY`, `rolloutState=COMPLETED`, `1/1` |

**No local `terragrunt apply`.** `git status --porcelain` is empty, no `*.tfstate*` artifact exists, and the applied state is attributable to deploy run `30556951618`.

## Task Commits

| # | Commit | What |
|---|--------|------|
| 1 | `8473020d` | Task 1 — the probe script, committed **before** the release |
| 2 | `69731700` | Task 1 — the recorded PRE baseline against `v0.0.75` |
| 3 | `7cf80bdc` | Task 2 — the buildpub + deploy record, guard output, drain gate |
| 4 | `14bc7a5d` | Task 3 — the recorded POST contrast against `v0.0.76` |

`git log -- .planning/phases/69-*/69-07-probes/` shows `8473020d` at **15:09:46Z**, which precedes the buildpub dispatch at **15:23:21Z**. The PRE baseline provably used committed bytes, and the script was **not touched** between PRE and POST.

## Per-defect production evidence

All PRE rows are from stream `…1762b3b7` on `v0.0.75`; all POST rows from stream `…3ba2d8ca` on `v0.0.76`. Every count is `--log-stream-names`-scoped.

### MQFX-02 — `Data` field loss (68-REVIEW CR-03) — **CLOSED**

| | PRE (`v0.0.75`, 15:21:10Z) | POST (`v0.0.76`, 15:46:44Z) |
|---|---|---|
| Sender `Data` | 72 bytes | 72 bytes (identical fixture) |
| `Data` the mesh receives | **45 bytes** | **72 bytes — hex-identical to the sender's** |
| `want_response` | `True` → **`False` LOST** | `True` → `True` **OK** |
| `dest` | `0x11112222` → **`0` LOST** | `0x11112222` **OK** |
| `source` | `0x33334444` → **`0` LOST** | `0x33334444` **OK** |
| `request_id` | `0x55556666` → **`0` LOST** | `0x55556666` **OK** |
| `reply_id` | `0x77778888` → **`0` LOST** | `0x77778888` **OK** |
| `emoji` | `1` → **`0` LOST** | `1` **OK** |
| Decision line | `action=ALLOW … mesh_type=TEXT_MESSAGE_APP` | same |
| Verdict | **FAIL** | **PASS** |

Measured as a real round trip: an **encrypted** `TEXT_MESSAGE_APP` published on a second authenticated session, fanned out by mosquitto, re-read off the downlink and decrypted with the channel key. The publishing username is an ordinary `rabbit` account, **not** `public` — which is exactly why this was fleet-wide: the word replacement is username-gated but the rewrite **call** never was. Tapbacks, threaded replies, delivery ACKs and DM routing were broken for every user and now work.

### MQFX-03 — Last-Will bypass (68-REVIEW CR-02) — **CLOSED**

| | PRE (15:13:41Z) | POST (15:45:11Z) |
|---|---|---|
| Subscriber received the Will | **YES** — 1 PUBLISH, the 75-byte `ServiceEnvelope` **verbatim** | **NO** — 0 PUBLISH frames |
| Proxy log | *(no such action exists in the image)* | `action=WILL_STRIPPED, ip=10.0.2.246:42851, protocol_version=5, username=0a487d6affa5, will_topic=msh/US/2/e/dc.run/probe-dc34p-mqfx03-037c0a22, will_bytes=75` @ 15:45:12.151Z |
| Corroboration | `[proxy] DOWNLINK bcast from=!69070001 id=69070003 topic=…probe-dc34p-mqfx03-94059a35` @ 15:13:44Z | — |
| Verdict | **FAIL** | **PASS** |

Both halves of the conjunction flipped on identical bytes and an identical abort (TCP RST via `SO_LINGER 0`, so no DISCONNECT and the broker fires the Will). The Will payload was a fabricated-node `NODEINFO` with `hop_limit=3`/`hop_start=7`, so even unclamped pre-fix it could not amplify (T-69-07-02).

Correlation is on the **will topic**, not a client id: `action=WILL_STRIPPED` carries `ip=`, `username=`, `will_topic=` and `will_bytes=` and no client id, so the per-run unique topic is the only identifier on the line.

### MQFX-04 / WR-01 — hand-parsed PUBLISH alias blindness — **CLOSED**

| | PRE (15:15:59Z) | POST (15:45:55Z) |
|---|---|---|
| Decision | `action=ALLOW … mqtt_type=PUBLISH, mesh_type=NODEINFO_APP` @ 15:16:00.222Z | `action=BLOCK, ip=10.0.2.246:28522, reason=topic_alias_uplink` @ 15:45:55.566Z |
| `reason=topic_alias_uplink` lines | **0** | **1** |
| `action=ALLOW` PUBLISH lines | 1 | **0** |
| Wire | `e00181` — **mosquitto's own** DISCONNECT relayed back: the bytes reached the broker | socket closed by the **proxy**, `trailing_frames=0`, no broker DISCONNECT |
| Verdict | **FAIL** | **PASS** |

WR-01's proven divergence reproduced verbatim in production and then closed. The property block is `2300077f00` — Topic Alias (`0x23`) **before** the unmodelled id (`0x7f`), the ordering the shipped bounded walk can reach. The POST reason string is the codec path's **own**, so prior evidence and ops greps stay valid across both paths.

### MQFX-04 / WR-04 — uninspected SUBSCRIBE — **CLOSED**

| | PRE (15:18:36Z) | POST (15:46:14Z) |
|---|---|---|
| `action=MQTT5_PARSE_FAIL … mqtt_type=SUBSCRIBE` | 1 | 1 *(unchanged — 68-06 behaviour)* |
| Decision line with this run's filter | **0 — the parse-fail line stood ALONE** | **1** — `action=ALLOW … mqtt_type=SUBSCRIBE, mqtt_topic=[msh/US/2/e/dc.run/probe-dc34p-mqfx04b-d1d26d68/#]` |
| Verdict | **FAIL** | **PASS** |

The discriminator is the conjunction, because the parse-fail line is emitted on **both** images. Pre-fix the frame never became an `InspectorPacket`, so `PacketDecider` never ran and `MQTT.Topics` was never recorded — the first topic Block rule anyone added would silently not have applied to it.

### MQFX-04 / WR-02 — silent CONNECT close — **CLOSED**

| | PRE (15:11:37Z) | POST (15:44:30Z) |
|---|---|---|
| Bytes back to the client | **0 — silent close** | **5 — `2003008100`** |
| Proxy log | `action=MQTT5_PARSE_FAIL` without `answered=` | `action=MQTT5_PARSE_FAIL, ip=10.0.2.246:14990, answered=0x81, reason=invalid Prop type 127 for packet 1` @ 15:44:30.559Z |
| Verdict | **FAIL** | **PASS** |

Credential-free by construction: `peekConnectProtocolVersion` reads a 5 off the very bytes `v5.ReadPacket` then rejects, so this is 69-05's **branch 3** and it is socket-reachable. The `answered=` field makes an answered refusal distinguishable from a pre-fix silent close in telemetry without a second grep.

### MQFX-04 / WR-05 — forgeable telemetry — **CLOSED**

| | PRE (15:13:22Z) | POST (15:44:52Z) |
|---|---|---|
| Records produced by ONE CONNECT | **2** | **1** |
| Fabricated record | **present** — `2026-01-01 00:00:00.000 action=AUTH_REJECT, ip=10.0.0.1, username=admin-…, reason=invalid` | **absent** |
| The client-controlled value | **unquoted** | `username="mqfx04d-5c60a1a52026-01-01 00:00:00.000 action=AUTH_REJECT, ip=10.0.0.1, username=admin-…, reason=invalid"` — control rune dropped, whole value `strconv.Quote`d |
| Verdict | **FAIL** | **PASS** |

Pre-fix, a single newline in a CONNECT username wrote a whole fake `AUTH_REJECT` record with a client-chosen timestamp, IP and username into the exact telemetry every verification in phases 68 and 69 correlates on. Post-fix that text is inert data inside one quoted field.

### MQFX-01 — nil-cipher panic — **CLOSED, and NEVER PROBED**

Per the plan's hard safety rule, no subcommand may publish a decoded text-message envelope: on `v0.0.75` that one frame reaches `RewriteHelloGoodbye` → `RewritePayloadString` with a nil cipher and SIGSEGVs the **process**, dropping every connected radio. The prohibition and its reason are in the probe's module docstring, and `mqfx02` publishes only the **encrypted** form.

| Signal | PRE stream (whole ~7h lifetime) | POST stream (whole lifetime) |
|---|---|---|
| `panic` | **0** | **0** |
| `SIGSEGV` | **0** | **0** |
| `Proxy server started` | **1** | **1** — no restart |
| `action=PANIC_RECOVERED` | 0 *(code absent)* | **0** |

Positive proof lives in 69-01's `TestRewritePayloadStringNilCipherReturnsError` (error, no panic, PUBLISH payload byte-unchanged) and 69-02's `TestPanicIn*` containment suite (both codecs, both directions, six deferred recover sites).

### Regression gate — the four CONNACK reason codes

| Case | Bytes | PRE | POST |
|---|---|---|---|
| v5 bad credentials | `2003008700` | ✓ | ✓ |
| protocol level 6 | `2003008400` | ✓ | ✓ |
| v5 enhanced auth | `2003008c00` | ✓ | ✓ |
| 3.1.1 bad credentials | `20020005` (four bytes) | ✓ | ✓ |

`regression-connacks` exits **0** against production, before and after. 69-05 edited all four v5 CONNECT failure branches and moved none of the pinned answers, and the 3.1.1 codec is untouched on the wire.

## Counters on the new task's stream (all `--log-stream-names`-scoped)

| Signal | Count | Attribution |
|---|---|---|
| `MQTT5_PUBLISH_HEADER_FAIL` | **0** | 68-07's fail-closed path never fired on a real client |
| `MQTT5_SUBSCRIBE_HEADER_FAIL` | **0** | **accepted risk T-69-05-04 is clear** — the new fail-closed SUBSCRIBE path dropped nobody, probe or real |
| `panic` | **0** | MQFX-01 |
| `SIGSEGV` | **0** | MQFX-01 |
| `Proxy server started` | **1** | no restart |
| `action=PANIC_RECOVERED` | **0** | no contained crash, so no stack to report |
| `MQTT5_ALIAS_SCAN_INDETERMINATE` | **0** | no client sent an unmodelled PUBLISH property ahead of the walk's answer |
| `Username required for MQTT` | **0** | CR-02's symptom stays gone |
| `action=MQTT5_PROTOCOL_VIOLATION` | **0** | |
| `action=MQTT5_PARSE_FAIL` | 3 | all three this plan's probes by `ip=` (mqfx04c CONNECT, mqfx04a PUBLISH, mqfx04b SUBSCRIBE) — **zero from real clients** |
| `answered=0x81` | 1 | this plan's `mqfx04c` |
| `reason=topic_alias_uplink` | 1 | this plan's `mqfx04a` |
| `action=WILL_STRIPPED` | 9 | 1 probe + **8 real client — see the finding below** |

**Sanitizer sweep:** across **all 4,663 events** on the new stream, exactly **one** line carries a quoted client-controlled value, and it is this plan's own `mqfx04d` probe. Zero real clients tripped `logSafe`, so 69-03's byte-identity contract holds on real production traffic (the check 69-03, 69-04 and 69-05 each asked 69-07 to make).

## ALLOW continuity across the deploy boundary

Per-minute `action=ALLOW`, counted **separately per stream** over a window covering both — **never zero, 34/34 minutes**:

```
15:15 11 | 15:16  5 | 15:17 11 | 15:18 19 | 15:19 12 | 15:20 12 | 15:21 14
15:22 12 | 15:23 16 | 15:24 12 | 15:25 12 | 15:26 12 | 15:27 11 | 15:28  5
15:29  5 | 15:30  5 | 15:31  7 | 15:32  7 | 15:33 17 | 15:34 11 | 15:35 14
15:36  6 | 15:37  8 | 15:38  6 | 15:39 21 | 15:40  7 | 15:41  7 | 15:42 16
15:43  8 | 15:44  8 | 15:45  9 | 15:46 17 | 15:47 21 | 15:48 18
total 382 — 246 on the draining task 1762b3b7, 136 on the new task 3ba2d8ca
```

15:35–15:40 shows **both tasks serving simultaneously**, which is precisely why the counts are attributed per stream and not by wall clock. The old task's last ALLOW is at 15:40 and it reached `STOPPED` at 15:41:35Z; the new stream carries the fleet from 15:41 onward.

**Both codecs carry real traffic post-deploy:** 3.1.1 — `MeshtasticAppleMqttProxy-!174e59c8-*` (74 ALLOW, `protocol_version=4` proven by its own strip lines) plus direct radio clients `!a033bcc7` (38) and `!a1cc1d70` (27); v5 — `MeshtasticAndroidMqttProxy-!84b2fcb5-*` (7 ALLOW, `action=MQTT5_CONNECT` at 15:40:52Z).

## FINDING — a real client uses an MQTT Will (T-69-03-05 has turned real)

**8 of the 9 `action=WILL_STRIPPED` lines are not this plan's probe.**

```
8x  username=e9ced815b0ee  protocol_version=4  will_topic=/will  will_bytes=6
    clientID=MeshtasticAppleMqttProxy-!174e59c8-...   (two session GUIDs)
    15:35:38  15:39:13  15:42:34  15:47:34  15:48:34  15:49:35  15:50:34  15:51:34
```

This **corrects an assumption recorded in 69-03**: *"Meshtastic firmware and mqttastic do not use MQTT Wills."* True of the firmware and of the Android client — but the Meshtastic **Apple/iOS** client is a third client and it does set one, on every reconnect.

Blast radius, **measured rather than assumed**:

- The Will topic is `/will` — **not** under `msh/…`. A sweep of every `SUBSCRIBE` on the new stream shows the only filters in use are `msh/US/2/e/{dc.run,LongFast,PKI,DEFCONnect,HackerComms,NodeChat}/+` and this plan's own probe topics. **Nothing subscribes to `/will`**, so the stripped Will had zero consumers.
- `will_bytes=6` — six bytes cannot be a `ServiceEnvelope` (the smallest one here is 75). **No mesh data is lost.**
- The client is unharmed: 74 `action=ALLOW` lines post-deploy across two session GUIDs, subscribing and publishing on its normal cadence.
- Pre-deploy the same client produced **1,363** `ALLOW` lines and **0** `WILL_STRIPPED`, because the code did not exist. Its Will was being forwarded to mosquitto all along and published into a topic no one reads.

Recorded as a finding, not a footnote, exactly as the plan requires. It does not block the deploy: what the client loses is a presence signal that demonstrably had no subscriber. If a consumer for `/will` is ever wanted, the honest fix is routing that Will through the decider rather than dropping it — which is what 69-03 named as the response should this risk turn real.

## MQFX-06 — confirmed satisfied by PR #1096, NOT re-implemented

Three independent checks, all green:

| Check | Result |
|---|---|
| `Dockerfile.meshtk` build-time assertion present | `grep -c 'GPXFile:' apps/run.mqtt/meshtk/Dockerfile.meshtk` = **4** (≥1) |
| The assertion is **exercised**, not decoration | buildpub run `30556427674`, stage-1 step 11/11: `meshtk GPX route assertion: verified 24 routes present in /app` |
| The assertion is **non-vacuous** | it hard-fails on an empty route set: `FATAL: no GPXFile: entries found in /app/meshtk.yaml -- assertion would pass vacuously`, and names each missing route otherwise |
| Go secondary net | `go test ./internal/app/fleet/ -run TestDC34FleetGPXRoutesResolve -count=1` → **ok**, `resolved 24 GPX routes` (exercising the `go:embed` fallback, since `go test` runs where the files are not on disk) |
| `embedded.go` untouched by this phase's vendor-sync | sha256 **`98679cbaf354f31028a3a1b4b64ef9c1e250baa4c3fb4daa0356a7d72561624b`** at the pre-sync parent `f7d19592^`, on `origin/main`, and in the working tree — **all three equal**, matching 69-06's recorded before/after value exactly |
| `internal/embedded/` in the 69-06 merge diff | **0 files** |

The `#1009` regression class — which stranded all 24 GPX-driven sim nodes **twice** — did not recur. No duplicate implementation was written.

## Landmines actively avoided

| Landmine | How it was avoided | Evidence |
|---|---|---|
| Attributing evidence to the wrong task during the rolling replace | every count `--log-stream-names`-scoped to one task | the per-minute table shows both streams non-zero at 15:35–15:40 |
| `services-stable` / CI-green treated as a drain gate | polled the OLD task to `STOPPED` before any post-deploy claim | deploy went green at **15:32:13Z**; the old task was still `RUNNING` at 15:34:21Z and `STOPPED` only at **15:41:35Z** — a **9-minute** lie |
| `describe-log-streams`' stale `lastEventTimestamp` | used `filter-log-events` throughout | every count above |
| A log poll returning on the CONNECT line | every wait takes the specific substring it needs (68-08 deviation 1, kept) | no spurious FAIL in either run |
| `pr_number=latest` merging an unrelated Release PR | dispatched with `pr_number=skip`; guard recorded verbatim as `[]` | an unrelated **run.human** Release PR **#1109** was in fact dispatched at 15:34:55Z, mid-replace — the race was real |
| Hand-editing VERSION into an immutable-tag collision | buildpub owned the bump | `4140ef08 Bump versions for release: run.mqtt (#1107)` |
| Probing MQFX-01 against production | prohibited in code and in the docstring; `mqfx02` publishes only the encrypted form | zero decoded `TEXT_MESSAGE_APP` publishes in the script |
| A missing contrast rounded up to a pass | script committed before the release; the one unmet claim is named below | `8473020d` at 15:09:46Z precedes buildpub at 15:23:21Z |

## Deviations from Plan

**None behavioral.** Five shape notes:

1. **`grep -c 'VERDICT '` is satisfied by a `VERDICT_CONTRACT` table, not by eleven duplicated emitters.** The criterion asks for "at least one occurrence per subcommand"; with one shared `verdict()`/`skip()`/`die()` helper the literal count would have been 4. Duplicating the emitter eleven times would be a regression — eleven copies can drift, one cannot (the same reasoning as 69-02's `assertRecovered`). Instead a module-level `VERDICT_CONTRACT` dict states each subcommand's decision in one place and is **printed at run start** (`[contract] …` on every transcript line above), so it is functional rather than padding. Count is now **16 ≥ 11**.

2. **`mqfx04c`'s verdict prose calls `2003008100` a "DISCONNECT"; it is a CONNACK carrying reason `0x81`.** The assertion that decided the verdict is the exact byte comparison `got.hex() != "2003008100"` — the same five bytes 69-05 pinned — so the measurement is correct and only the sentence is loose. **The script was deliberately not edited**, because PRE and POST must be produced by byte-identical committed bytes and cosmetics do not outrank that.

3. **`mqfx03-will` correlates on the will topic, not a client id.** The plan says "correlated to the proxy's own log lines by a client id unique to the run". `action=WILL_STRIPPED` carries `ip=`, `username=`, `will_topic=` and `will_bytes=` and **no client id** (verified against 69-03's shipped format strings), so a client-id correlation was not available. The per-run unique will topic is on the line and is equally unique, and it is additionally what makes the 8 real-client strips attributable.

4. **`mqfx04a` produced no `MQTT5_ALIAS_SCAN_INDETERMINATE` line, by design.** The plan's fixture places the alias **before** the unmodelled id, so the walk reaches a conclusive answer and Blocks; the indeterminate line belongs to the opposite ordering. The counter is asserted zero and that zero is correct, not an absence of evidence.

5. **Two evidence artifacts were committed beyond the plan's file list** — `transcript-pre-deploy-v0.0.75.txt` / `transcript-post-deploy-v0.0.76.txt` and `deploy-record-v0.0.76.md` — following 68-08's precedent, so the contrast is re-readable rather than living only in this summary. That is the failure mode which makes 68-05's evidence unrecoverable today.

## Accepted limitation — no real-client `TEXT_MESSAGE_APP` in the post-deploy window

The plan asks for "real `TEXT_MESSAGE_APP` allow lines … after the deploy on both codecs". **That contrast could not be produced and is not rounded up.**

- Real text traffic on this fleet is rare: over the PRE task's whole **~7-hour** lifetime there was exactly **one** real text message (`MeshtasticAndroidMqttProxy-!a35a6224`, 10:47:57Z). None occurred in the ~18 minutes of post-deploy observation.
- Real PUBLISH mesh types on the new stream are 23 `POSITION_APP`, 2 `NODEINFO_APP` and 1 `TEXT_MESSAGE_APP` — this plan's own `mqfx02` probe. `POSITION_APP` and `NODEINFO_APP` never enter the censor, so they do not exercise the rewrite.
- What **is** settled: the rewrite path is proven healthy on the production wire for an **encrypted** `TEXT_MESSAGE_APP` round trip on the **v5** codec, with all six fields preserved (`mqfx02` POST PASS).
- The **both-codecs** form of the claim stands on 69-01's `TestRewritePayloadStringPreservesDataFields` (3.1.1, decrypt round trip off the forwarded bytes) and `TestDataFieldsSurviveRewriteOnV5Uplink` (v5, driven through the real `handleV5PublishUplink`), which assert the identical six fields through one shared helper so the two codecs' assertions cannot drift.

## Scope Boundary Honoured

- **No local `terragrunt apply`, no `--with-terragrunt`.** Local tooling was not used to build at all; buildpub did the build and push, `deploy.yml` did the apply.
- No source file was edited by this plan. Its only writes are under `.planning/phases/69-*/69-07-probes/`.
- No package-manager install ran. `cryptography` 49.0.0 was already present; the probe imports it and installs nothing.
- `git stash` never invoked. No `git clean`, no force-push, no `reset --hard`.
- The probe never published a decoded text-message envelope, never used a valid credential on a rejection-path subcommand, and printed no secret.
- **WR-03 remains open and untouched** (both relay paths handing mosquitto frames the proxy knows are malformed) — visible in both `mqfx04a` and `mqfx04b` as mosquitto's own `e00181` coming back. It is not in MQFX-04. WR-06, WR-07 and WR-09..WR-13 also remain open, including the pre-existing `gofmt` wart (WR-12).

## Threat Register Outcome

| Threat ID | Disposition | Status |
|---|---|---|
| T-69-07-01 (DoS, probing the nil-cipher panic against production) | mitigate | **Closed by prohibition.** No subcommand publishes a decoded text-message envelope; the rule and its reason are in the module docstring; `mqfx02` publishes only the encrypted form. MQFX-01's production evidence is the zero-panic / zero-SIGSEGV / single-startup-line negative on both streams. |
| T-69-07-02 (Tampering, the Will probe injecting an uninspected packet) | mitigate | The Will payload is a fabricated-node (`!69070001`) `NODEINFO` with `hop_limit=3`/`hop_start=7` on a probe-unique topic. Delivered once pre-fix, to this plan's own subscriber; unamplifiable by construction. |
| T-69-07-03 (Repudiation, mis-attribution during the rolling replace) | mitigate | Every count `--log-stream-names`-scoped; the old task polled to `STOPPED` at 15:41:35Z before any post-deploy claim; `filter-log-events` used throughout, never `describe-log-streams` metadata. The per-minute table shows both streams live at 15:35–15:40. |
| T-69-07-04 (Info Disclosure, credentials or a channel key leaking) | mitigate | `MQTT_USERNAME`/`MQTT_PASSWORD`/`MESHTK_CHANNEL_KEY` from the environment with **no defaults**; only shape and length are printed. Grep-verified against the live secret: it appears nowhere in the script, either transcript, the deploy record or this summary. |
| T-69-07-05 (DoS, the new fail-closed paths dropping real clients) | mitigate | `MQTT5_SUBSCRIBE_HEADER_FAIL` = **0** and `MQTT5_PUBLISH_HEADER_FAIL` = **0** on the new stream. All 3 `MQTT5_PARSE_FAIL`, the 1 `answered=0x81` and the 1 `topic_alias_uplink` are attributable by `ip=` to this plan's probes — zero from real clients. |
| T-69-07-06 (Tampering, a local apply bypassing CI) | mitigate | Deploy attributable to run `30556951618`; `git status --porcelain` empty; no `*.tfstate*` artifact. |
| T-69-07-10 (EoP, no human checkpoint between release and deploy) | accept | As planned, under the owner's recorded Phase-69 authorization. Every gate was mechanical and every assertion was a hard stop; none was waved through, and the one unmet claim is named as a limitation rather than passed. |
| T-69-07-11 (EoP, `pr_number=latest` merging an unrelated Release PR) | mitigate | **Closed, and it was a live risk.** Guard output recorded verbatim as `[]`; deploy dispatched with `pr_number=skip` so the merge job was skipped. An unrelated **run.human** Release PR #1109 was dispatched at 15:34:55Z during this plan's replace — `latest` would have `--admin`-merged it outside the waiver's scope. |
| T-69-07-07 (Tampering, VERSION collision / `--skip-bump`) | mitigate | buildpub owned the bump; `git log -1 -- VERSION` names its own Release PR commit `4140ef08`; ECR immutability did not fire, which is the expected outcome of a real bump. |
| T-69-07-08 (Tampering, vendor-sync reverting the GPX-route fix) | mitigate | Dockerfile assertion present (4 `GPXFile:` lines) **and exercised in the build log** (`verified 24 routes present in /app`); `TestDC34FleetGPXRoutesResolve` green; `embedded.go` sha256 equal at the pre-sync parent, on `origin/main` and in the tree. |
| T-69-07-09 (Repudiation, a missing contrast rounded up) | mitigate | Script committed at 15:09:46Z, before buildpub at 15:23:21Z, and **not edited** between PRE and POST — including a deliberate refusal to fix loose prose. The single unproduced contrast (real-client `TEXT_MESSAGE_APP`) is recorded as a named limitation with the tests that stand for it. |
| T-69-07-SC (Tampering, dependency substitution during the release) | mitigate | No package-manager install ran anywhere. The image was built by CI from `origin/main`, whose `go.mod`/`go.sum`/`vendor/` 69-06 asserted byte-unchanged. |

## Threat Flags

None. This plan released an already-reviewed image and observed production; it introduced no network endpoint, auth path, file access pattern or schema change of its own. The one new production observation it surfaces — a real client setting an MQTT Will — is recorded above as a finding.

## Known Stubs

None.

## Self-Check: PASSED

- `69-07-probes/mqfx_probe.py` — exists; `--help` lists all 11 subcommands including the 7 the plan names
- `69-07-probes/transcript-pre-deploy-v0.0.75.txt` — exists
- `69-07-probes/transcript-post-deploy-v0.0.76.txt` — exists
- `69-07-probes/deploy-record-v0.0.76.md` — exists
- commits `8473020d`, `69731700`, `7cf80bdc`, `14bc7a5d` — all present on `local-main-track`
- buildpub run `30556427674` `success`; deploy run `30556951618` `success`
- ECR tag `dc34-run-mqtt-meshtk:v0.0.76` present; task definition `119` references it; service `1/1` `COMPLETED`
- no credential value present anywhere under `.planning/phases/69-*` (grep-verified against the live secret)

## Left For Later

- **Push.** The 14 local `docs(69-*)` / `test(69-07)` / `chore(69-07)` commits on `local-main-track` are still unpushed, as they have been since 69-01. The session close pushes them.
- **The real Will user.** `MeshtasticAppleMqttProxy-!174e59c8` (username `e9ced815b0ee`) now has its `/will` presence signal dropped on every reconnect. Zero subscribers exist for it today, so nothing is broken; if one is ever wanted, route that Will through the decider rather than dropping it.
- **Real-client `TEXT_MESSAGE_APP` post-deploy.** Worth a one-line re-check next time someone sends a text on the fleet: `filter-log-events --filter-pattern '"TEXT_MESSAGE_APP"'` scoped to the current stream, then confirm the fields survive. The machine proof is already in place.
- **`cac1`.** This release and deploy were `use1` only, matching the plan. `ca-central-1` still serves the pre-fix meshtk.
- **WR-03** remains open (both relay paths handing mosquitto frames the proxy knows are malformed) — visibly so, as the `e00181` in two of this plan's own captures. Not in MQFX-04.
- `mqfx_probe.py` is now the reusable asset in the way `mqtt5_probe.py` was: any future meshtk change should re-run all eleven subcommands pre- and post-deploy.
