---
phase: 69-meshtk-shared-chain-hardening
verified: 2026-07-30T20:15:00Z
status: passed
score: 4/4 success criteria verified (6/6 requirements satisfied)
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
warnings:
  - id: WR-01
    severity: warning
    file: apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go:396-399
    issue: "handleV5PublishUplink forwards an uninspected frame when the codec type-assertion to *v5.Publish fails, instead of failing closed like its CONNECT sibling. Unreachable through the socket today (v5.ReadPacket dispatches on the same PUBLISH nibble readFrame confirmed), so no live bypass — but the odd-one-out arm on a fail-closed file. Documented in 69-REVIEW.md, non-blocking."
  - id: WR-02
    severity: warning
    file: apps/run.mqtt/meshtk/internal/app/server/logsafe.go:56
    issue: "logSafe strips C0 (<0x20) + DEL only, not the C1 control block U+0080-U+009F. The grep-line forgery vector (newline) IS stripped, so MQFX-04d's stated goal holds; residual gap is terminal-scramble on a raw log tail. Documented in 69-REVIEW.md, non-blocking."
info:
  - "IN-01 (69-REVIEW): AUTH_REJECT err=%v is interpolated without logSafe on inspect.go:139 / inspect_v5.go:85; reviewer confirmed those errors do not echo the client username today. Invariant, not a live vector."
  - "IN-02 (69-REVIEW): vendored meshtk/vendor is missing paho.golang so a direct -mod=vendor build fails; pre-existing (Phase 68), environmental, resolved by the copy-at-build pipeline. Confirmed: the go module lives outside this workspace's go.work — import diagnostics are noise per the verify brief."
  - "Two pre-existing TODOs in the vendored tree (inspect.go:98 refactor note, proxy.go:252 ALLOW_LIST) trace to commits 07695d58 / 3934c612 from March 2026 — not Phase 69 debt, and TODO is warning-class not the TBD/FIXME/XXX blocker class."
---

# Phase 69: meshtk Shared-Chain Hardening Verification Report

**Phase Goal:** Close three runtime-proven defects (plus MQFX-04/05/06) in the shared MQTT inspection chain — nil-cipher whole-process panic (MQFX-01), meshtastic.Data field loss (MQFX-02), Last-Will inspection bypass (MQFX-03), five 68-REVIEW warnings (MQFX-04), ship+prod verification with pre/post contrast (MQFX-05), and GPX-route vendor-sync immunity from PR #1096 (MQFX-06). Land upstream in ~/working/meshtk, vendor-sync to apps/run.mqtt/meshtk, release via buildpub + deploy.yml to production.
**Verified:** 2026-07-30T20:15:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A decoded (unencrypted) `TEXT_MESSAGE_APP` PUBLISH on **either** codec is handled without panicking, and a per-connection `recover()` means no single frame can take the fleet down. | ✓ VERIFIED | Three-layer guard present: `RewriteHelloGoodbye` matcher (rules.go:194-198 rejects `Decoded==nil`/`Cipher==nil`), `RewritePayloadString` (inspect.go:412-417 returns errors instead of dereferencing nil `*Cipher`), and `recoverConn` at 6 goroutine entries (proxy.go:181,320; proxy_v5.go:126,609; cmd.go:157,220) emitting `action=PANIC_RECOVERED`. Behavioral tests PASS (ran locally): `TestPanicInDeciderDoesNotEscapeHandleProxy`, `...V5`, `TestPanicInDownlinkDoesNotEscape` (3.1.1+v5), `TestRewritePayloadStringNilCipherReturnsError`, `TestDecodedTextMessageSurvivesBothCodecs` (3.1.1+v5). Production stream (task :119): `panic=0`, `SIGSEGV=0`, `Proxy server started=1` (no restart), `PANIC_RECOVERED=0`. |
| 2 | A text message carrying `reply_id`/`emoji`/`want_response` survives the rewrite path intact on both codecs. | ✓ VERIFIED | `RewritePayloadString` now mutates `ip.Meshtastic.Decoded` in place (inspect.go:433-434) instead of rebuilding from three fields, and `proto.Marshal`'s error is propagated (inspect.go:435-438, no `_` discard). Tests PASS: `TestRewritePayloadStringPreservesDataFields`, `TestDataFieldsSurviveRewriteOnV5Uplink`. Production wire byte-comparison (mqfx02-data-fields) PRE FAIL → POST PASS: every field (want_response, dest, source, request_id, reply_id, emoji) sent==wire on task :119. |
| 3 | A CONNECT carrying a Will cannot deliver an unclamped `hop_limit` broadcast to the broker on either codec. | ✓ VERIFIED | Will strip on both codecs: inspect.go:177-184 (`WillFlag` → clears WillTopic/Message/Qos/Retain, logs `action=WILL_STRIPPED protocol_version=4`) and inspect_v5.go:139-150 (`protocol_version=5`). Tests PASS: `TestWillStrippedFromV5Connect`, `TestWillStrippedFromV4Connect`, `TestUnclampedHopWillNeverReachesBackendOnEitherCodec` (v5+3.1.1). Production (mqfx03-will) PRE FAIL → POST PASS: Will never reached broker + 9 `WILL_STRIPPED` lines, incl. 8 from a real iOS client (measured zero-consumer blast radius). |
| 4 | The 3.1.1 path stays byte-identical (`proxy_v4_golden_test.go` unchanged and green) and live fleet traffic uninterrupted across the deploy. | ✓ VERIFIED | `proxy_v4_golden_test.go` last modified in Phase 68 (commit 6bbe18c1), untouched by Phase 69. Full `go test ./internal/app/server/` PASSES (ran locally, `ok ... 0.485s`). Production `regression-connacks` PRE PASS → POST PASS (four CONNACK captures byte-identical to the 68-05 record). ALLOW continuity table shows uninterrupted per-minute ALLOW traffic across the 15:32→15:41 rolling-replace boundary; drain gate honored (old task :118 held connections until STOPPED 15:41:35Z, 9 min after CI green). |

**Score:** 4/4 truths verified (0 present, behavior-unverified). All behavior-dependent truths (panic containment, field preservation, Will strip, byte-identity) carry passing behavioral tests AND recorded production wire evidence.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `internal/app/server/inspect.go` | nil-cipher guards, in-place Data mutation, proto.Marshal error, Will strip (v4), logSafe | ✓ VERIFIED | Lines 177-184 (Will), 412-417 (nil guards), 433-455 (in-place + error), 20 logSafe sites across inspection files |
| `internal/app/server/rules.go` | nil-cipher guard in RewriteHelloGoodbye matcher | ✓ VERIFIED | Lines 194-198 reject nil Decoded/Cipher; error-return path (212-215) instead of silent no-op |
| `internal/app/server/proxy.go` | recoverConn definition + read-loop guards | ✓ VERIFIED | recoverConn defined line 140, PANIC_RECOVERED telemetry line 158, deferred at 181/320 |
| `internal/app/server/proxy_v5.go` | recoverConn guards, CONNECT fail CONNACK w/ answered=, SUBSCRIBE→decider | ✓ VERIFIED | recoverConn 126/609; answered=0x81 telemetry (153/159/174/454); handleV5SubscribeUplink→decideV5Subscribe→PacketDecider.Decide (527/538-539) |
| `internal/app/server/cmd.go` | recoverConn at accept-loop spawns | ✓ VERIFIED | Deferred at 157 (labelAcceptProtobuf) and 220 (labelAcceptProxy) |
| `internal/app/server/inspect_v5.go` | Will strip (v5), logSafe | ✓ VERIFIED | Lines 139-150 Will strip protocol_version=5; logSafe on Username/AuthMethod/ClientID/WillTopic |
| `internal/app/server/logsafe.go` | logSafe + logSafeList sanitizer | ✓ VERIFIED | logSafe (49), logSafeList (88), strips C0+DEL. C1 gap = WR-02 (non-blocking) |
| `internal/app/server/proxy_v5_rawpublish.go` | bounded topic-alias scan that never gates inspection | ✓ VERIFIED | scanV5PublishAlias (107) returns hasAlias/complete/stop; MQTT5_ALIAS_SCAN_INDETERMINATE logged, not gated |
| `internal/app/server/proxy_v5_rawsubscribe.go` | hand-parsed SUBSCRIBE reaching the decider | ✓ VERIFIED | inspectV5RawSubscribe builds InspectorPacket (190); wired to PacketDecider.Decide via proxy_v5.go |
| `Dockerfile.meshtk` | COPY ghosts/runs/city flat + build-time GPXFile assertion | ✓ VERIFIED | Lines 43-45 flat COPY; RUN assertion 55-74 loops every GPXFile:, non-vacuous guard (58) + names-missing failure (65) |
| `69-07-probes/mqfx_probe.py` | committed reusable prod probe | ✓ VERIFIED | 62 KB committed; 7 defect subcommands |
| `69-07-probes/transcript-{pre,post}-deploy` | pre/post wire contrast | ✓ VERIFIED | PRE v0.0.75 baseline + POST v0.0.76 contrast, 7/7 PASS |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| RewriteHelloGoodbye (rules.go) | RewritePayloadString (inspect.go) | matcher calls rewrite, error-return on failure | ✓ WIRED | rules.go:212-215; nil-guarded both ends |
| handleV5SubscribeUplink | PacketDecider.Decide | decideV5Subscribe(inspectV5Subscribe(...)) | ✓ WIRED | proxy_v5.go:527,538-539 — SUBSCRIBE now reaches decider (was relayed uninspected pre-fix) |
| read-loop goroutines | recoverConn | defer n.recoverConn(label, conn) | ✓ WIRED | 6 sites across proxy.go/proxy_v5.go/cmd.go |
| shipped config GPXFile: | /app filesystem | Dockerfile build-time RUN assertion | ✓ WIRED | build log run 30556427674: "verified 24 routes present in /app" |
| upstream ~/working/meshtk | apps/run.mqtt/meshtk overlay | 69-06 vendor-sync | ✓ WIRED | commit 576a1e1d "vendor-sync meshtk overlay from upstream merge 8747f1d" on origin/main |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Panic containment (both codecs + downlink) | `go test -mod=mod -run TestPanicInDecider*/TestPanicInDownlink*` | PASS | ✓ PASS |
| Nil-cipher returns error, no SIGSEGV | `go test -run TestRewritePayloadStringNilCipherReturnsError` | PASS | ✓ PASS |
| Decoded text survives both codecs | `go test -run TestDecodedTextMessageSurvivesBothCodecs` | PASS (3.1.1+v5) | ✓ PASS |
| Data fields preserved (v4+v5) | `go test -run TestRewritePayloadStringPreservesDataFields/TestDataFieldsSurviveRewriteOnV5Uplink` | PASS | ✓ PASS |
| Will stripped both codecs | `go test -run TestWillStripped*/TestUnclampedHopWillNeverReachesBackendOnEitherCodec` | PASS | ✓ PASS |
| Full server package suite (once) | `go test -mod=mod ./internal/app/server/` | `ok ... 0.485s` | ✓ PASS |

### Probe Execution (production artifacts — not re-run per verify brief)

| Probe | Source | Result | Status |
|-------|--------|--------|--------|
| 7-defect pre/post wire contrast | `69-07-probes/mqfx_probe.py` transcripts | POST SUMMARY 7 of 7 PASS; every PRE FAIL → POST PASS | ✓ PASS (recorded) |
| Counters on new task stream | transcript-post-deploy-v0.0.76.txt | panic=0, SIGSEGV=0, MQTT5_PUBLISH_HEADER_FAIL=0, MQTT5_SUBSCRIBE_HEADER_FAIL=0 | ✓ PASS (recorded) |
| MQFX-06 build assertion | buildpub run 30556427674 log | "verified 24 routes present in /app" | ✓ PASS (recorded) |

_Note: per the verify brief, production was not probed and terragrunt was not run by the verifier; MQFX-05 production evidence is verified from the committed probe artifacts, which are internally consistent and attributed to deploy.yml run 30556951618 → task def run-mqtt-use1-dc34:119 / meshtk v0.0.76._

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| MQFX-01 | nil-cipher panic guarded at 3 layers + per-connection recover, regression test both codecs | ✓ SATISFIED | Truth 1 — guards + 6 recoverConn sites + passing tests + prod panic=0 |
| MQFX-02 | Data field loss: in-place Decoded mutation, proto.Marshal error propagated | ✓ SATISFIED | Truth 2 — inspect.go:433-455 + passing tests + prod byte-comparison |
| MQFX-03 | Last-Will bypass: clear/log Will at CONNECT on both codecs | ✓ SATISFIED | Truth 3 — inspect.go:177 / inspect_v5.go:139 + prod WILL_STRIPPED |
| MQFX-04 | Five 68-REVIEW warnings: alias guard (a), SUBSCRIBE inspection (b), CONNECT CONNACK (c), logSafe (d), test rename (e) | ✓ SATISFIED | 04a: scanV5PublishAlias + prod BLOCK topic_alias_uplink; 04b: SUBSCRIBE→decider + prod decision line; 04c: answered=0x81 + prod; 04d: 20 logSafe sites + prod quoted-tamper; 04e: TestV5PublishParseFailureForwardsRaw renamed (proxy_v5_publish_test.go:501). All 4 prod subcommands PRE FAIL → POST PASS |
| MQFX-05 | Ship + prod verify per defect, pre/post contrast, HEADER_FAIL=0, ALLOW continuity | ✓ SATISFIED | v0.0.76 on task :119; committed probe/transcripts; HEADER_FAIL=0; ALLOW continuity table across deploy boundary |
| MQFX-06 | GPX-route vendor-sync immunity (PR #1096, verification-only) | ✓ SATISFIED | Dockerfile.meshtk flat COPY + non-vacuous build-time assertion; build log verified 24 routes |

No orphaned requirements (no REQUIREMENTS.md in this milestone — traceability is ROADMAP Requirements/Success Criteria + the seven SUMMARY.md files, as noted in the brief). All six MQFX IDs declared in the phase are covered.

### Anti-Patterns / Review Findings

| Item | File | Severity | Impact |
|------|------|----------|--------|
| WR-01: type-assert-fail PUBLISH arm forwards uninspected | proxy_v5.go:396-399 | ⚠️ Warning | Unreachable through the socket today (codec dispatches on the PUBLISH nibble); odd-one-out on a fail-closed file. Non-blocking; follow-up. |
| WR-02: logSafe misses C1 controls U+0080–U+009F | logsafe.go:56 | ⚠️ Warning | Grep-line forgery vector (newline) IS closed; residual = terminal-scramble on raw log tail. MQFX-04d goal met. Non-blocking; follow-up. |
| IN-01: AUTH_REJECT err=%v unsanitized | inspect.go:139 / inspect_v5.go:85 | ℹ️ Info | Reviewer confirmed errors do not echo client username today. Invariant to document. |
| IN-02: vendor/ missing paho.golang | vendor/modules.txt | ℹ️ Info | Pre-existing (Phase 68), environmental; build uses -mod=mod; resolved by copy-at-build. |
| Two TODO markers | inspect.go:98, proxy.go:252 | ℹ️ Info | Pre-existing (March 2026 commits), not Phase 69 debt; TODO is warning-class, not TBD/FIXME/XXX blocker-class. |

No BLOCKER-class defect. 69-REVIEW.md itself reported 0 critical / 2 warning / 2 info, consistent with this verification.

### Human Verification Required

None. All behavior-dependent truths carry passing behavioral tests plus recorded production wire evidence. The two open WARNINGs (WR-01, WR-02) are non-blocking hardening follow-ups already documented in 69-REVIEW.md — recommend tracking them as todos, but they do not gate this phase's goal.

### Gaps Summary

No gaps. The phase goal is achieved end to end:

- All four ROADMAP success criteria are TRUE in the codebase, each proven by a passing behavioral test AND corroborated by recorded production wire evidence on meshtk v0.0.76 (task def run-mqtt-use1-dc34:119).
- All six MQFX requirements are satisfied. The three runtime-proven defects (nil-cipher panic, Data field loss, Will bypass) are closed on both codecs; the five 68-REVIEW warnings are addressed (all four production-checkable ones went PRE FAIL → POST PASS); ship+prod verification is complete with a committed per-defect pre/post contrast; and GPX-route vendor-sync immunity (MQFX-06) is enforced by a build-time Dockerfile assertion whose "verified 24 routes" output appears in the release build log.
- The 3.1.1 golden path is byte-identical (golden test untouched since Phase 68, regression-connacks unregressed) and fleet ALLOW traffic was uninterrupted across the rolling-replace boundary, with a real 9-minute drain gate honored rather than trusting CI-green.

Two code-review WARNINGs remain open (WR-01 unreachable-today inspection-bypass arm; WR-02 C1-control sanitizer gap). Neither blocks the goal; both are recommended follow-ups.

---

_Verified: 2026-07-30T20:15:00Z_
_Verifier: Claude (gsd-verifier)_
