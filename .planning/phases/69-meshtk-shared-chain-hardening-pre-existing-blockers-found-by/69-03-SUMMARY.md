---
phase: 69-meshtk-shared-chain-hardening-pre-existing-blockers-found-by
plan: 03
subsystem: meshtk-proxy
tags: [meshtk, mqtt, security, tampering, repudiation, rf-safety, upstream]
status: complete
requirements: [MQFX-03, MQFX-04]
requires:
  - "69-01 and 69-02 (same upstream branch fix/shared-chain-hardening; tree serialization only)"
provides:
  - "logSafe(string) string / logSafeList([]string) string — conditional-quoting sanitizer"
  - "action=WILL_STRIPPED — production telemetry line, emitted on BOTH codecs with protocol_version=4|5"
  - "Last Will cleared on the v5 and the 3.1.1 CONNECT before it reaches mosquitto"
  - "logsafe_test.go + will_strip_test.go — 16 tests / 22 assertion points"
affects:
  - /Users/khundeck/working/meshtk/internal/app/server/inspect.go
  - /Users/khundeck/working/meshtk/internal/app/server/inspect_v5.go
tech-stack:
  added: []
  patterns:
    - "conditional quoting: a clean value passes through byte-identically, so a QUOTED value in production is itself the tamper signal"
    - "strip-not-inspect for a channel that can never traverse the inspection chain, rather than building a second quieter inspection path"
    - "all Will fields cleared in ONE assignment so an intermediate panic state is unreachable"
    - "identical action name + field names + field order across codecs, codec distinguished by a protocol_version field"
key-files:
  created:
    - /Users/khundeck/working/meshtk/internal/app/server/logsafe.go
    - /Users/khundeck/working/meshtk/internal/app/server/logsafe_test.go
    - /Users/khundeck/working/meshtk/internal/app/server/will_strip_test.go
  modified:
    - /Users/khundeck/working/meshtk/internal/app/server/inspect.go
    - /Users/khundeck/working/meshtk/internal/app/server/inspect_v5.go
decisions:
  - "Strip the Will, do not inspect it — the broker publishes a Will on disconnect, so its payload can NEVER traverse the uplink chain; inspecting it would build the second quiet inspection path this phase exists to close"
  - "One action name (WILL_STRIPPED) on both codecs with a protocol_version field, not a v5-prefixed variant — one production grep, codec still distinguishable"
  - "Quoting is CONDITIONAL, not a blanket strconv.Quote — a blanket quote moves every ALLOW/AUTH_REJECT/MQTT5_CONNECT line and breaks mqtt5_probe.py's client_id substring correlation"
  - "The 3.1.1 strip is gated on NOTHING (not on the auth outcome), unlike v5's — that branch falls through to a caller that decides whether to forward, so an unconditional strip cannot be bypassed by a future edit to that decision"
metrics:
  duration: ~25m
  tasks: 3
  files: 5
  completed: 2026-07-30
---

# Phase 69 Plan 03: Last-Will Bypass + Log Injection Summary

Closed the two defects that made the proxy's own security posture untrustworthy: a Last Will
delivered a client-chosen, **completely uninspected** uplink to the broker on both codecs
(68-REVIEW **CR-02**), and a newline in a client-controlled string forged log lines in the
exact telemetry Phase 68's verification and the committed `mqtt5_probe.py` correlate on
(68-REVIEW **WR-05**).

## Upstream Branch

| Item | Value |
|------|-------|
| Repo | `/Users/khundeck/working/meshtk` (upstream, NOT `apps/run.mqtt/meshtk`) |
| Branch | `fix/shared-chain-hardening` — **extended**, not rebranched |
| Ahead of `origin/main` | 11 commits (3 from 69-01, 2 from 69-02, 6 from this plan) |
| Pushed / PR'd / vendor-synced | **No** — 69-04..05 extend this branch, 69-06 opens the PR |

## Commits

| Sha | Message |
|-----|---------|
| `e7a9fc1` | `fix(69-03): sanitize client-controlled strings at every InspectorLogger boundary` |
| `165e6fb` | `test(69-03): pin the sanitizer contract and the one-CONNECT-one-line proof` |
| `0495193` | `fix(69-03): strip and log the Last Will on the v5 CONNECT path` |
| `9421ae8` | `test(69-03): prove a v5 Will never reaches the broker` |
| `52ded86` | `fix(69-03): mirror the Last Will strip on the 3.1.1 CONNECT path` |
| `764710a` | `test(69-03): prove an unclamped-hop Will reaches neither backend on either codec` |

## The Shipped `action=WILL_STRIPPED` Lines (69-07 greps these in production)

Both format strings, verbatim as shipped. Field names and field order are **identical**;
the only difference is the `protocol_version` value.

`inspect_v5.go:140`
```go
n.InspectorLogger.Warnf("action=WILL_STRIPPED, ip=%s, protocol_version=5, username=%s, will_topic=%s, will_bytes=%d",
    socketAddr, logSafe(connInfo.Username), logSafe(c.WillTopic), len(c.WillMessage))
```

`inspect.go:172`
```go
n.InspectorLogger.Warnf("action=WILL_STRIPPED, ip=%s, protocol_version=4, username=%s, will_topic=%s, will_bytes=%d",
    ip.Track.SocketAddress, logSafe(connInfo.Username), logSafe(p.WillTopic), len(p.WillMessage))
```

Captured verbatim from a real strip on each codec, through the **production `SimpleFormatter`**:

```
2026-07-30 10:04:40.516 action=WILL_STRIPPED, ip=203.0.113.7:50000, protocol_version=5, username=ed270dbe5d1e, will_topic=msh/US/2/e/dc.run/!435990e4, will_bytes=60
2026-07-30 10:04:40.516 action=MQTT5_CONNECT, ip=203.0.113.7:50000, username=ed270dbe5d1e, client_id=mqttastic-android-test
2026-07-30 10:04:40.516 action=WILL_STRIPPED, ip=203.0.113.7:50000, protocol_version=4, username=ed270dbe5d1e, will_topic=msh/US/2/e/dc.run/!435990e4, will_bytes=60
2026-07-30 10:04:40.516 action=ALLOW,ip=203.0.113.7:50000, clientID=meshtastic-will, username=ed270dbe5d1e, mqtt_type=PUBLISH, mqtt_topic=[msh/US/2/e/dc.run/!435990e4]
```

**Grep target for 69-07:** `action=WILL_STRIPPED`. Expected production count is **zero** —
Meshtastic firmware and mqttastic do not use MQTT Wills. Any non-zero count names a real Will
user who is now silently losing a feature (accepted risk T-69-03-05), identified by
`username=`, `ip=` and the codec via `protocol_version=`.

Note the fourth line above: `mqtt_topic=[msh/US/2/e/dc.run/!435990e4]` — the decision log's
topic list is **byte-identical** to what production has always emitted, despite the verb
changing from `%+v` to a `%s` of `logSafeList`. That is asserted, not eyeballed
(`TestDecisionLogCleanValuesAreByteIdentical` compares the whole returned line against a
literal built from `fmt.Sprintf("%+v", topics)`).

## The Sanitizer's Quoting Rules As Implemented

`logSafe` returns the input **byte-identically** unless one of these fires, in which case the
whole (cleaned) value is `strconv.Quote`d:

| Trigger | Rationale |
|---------|-----------|
| any rune `< 0x20` (includes `\n`, `\r`, `\t`) or `0x7f` (DEL) | the forgery vector itself — dropped, then quoted because the value was modified |
| more than 128 **runes** | caps a client padding the log; sliced rune-wise so UTF-8 stays valid |
| contains a space, comma, double quote or equals sign | would break the `key=value, key=value` grammar every consumer parses by |

Because quoting is conditional, **a quoted value in production is itself a tamper signal**.
`logSafeList` maps `logSafe` element-wise and renders with `%+v`, so a clean slice is
indistinguishable from today's output and one hostile filter in a multi-filter SUBSCRIBE
cannot forge a line while the rest of the list stays readable.

Out of scope by design: `Config.Log` (the `[proxy] ALLOW` / `[proxy] BLOCK` lines and 69-02's
`action=PANIC_RECOVERED`) uses logrus' `TextFormatter`, which already quotes — 69-02 proved
that non-forgeable with a newline-bearing panic value.

## Every `logSafe` / `logSafeList` Call Site, Enumerated By Hand

The plan requires this list explicitly, so a value renamed to something not containing the
word "password" cannot slip past a text filter. **18 call sites, and none of them is a
password.** The password is stored hex-encoded on `ConnectionInfo` and is not logged on either
codec; it is deliberately NOT routed through the sanitizer, because doing so would imply it is
loggable-with-care. It is not loggable at all.

`inspect.go` (10):

| Log line | Wrapped identifier |
|----------|--------------------|
| `action=AUTH_REJECT ... reason=error` | `logSafe(p.Username)` |
| `action=AUTH_REJECT ... reason=invalid` | `logSafe(p.Username)` |
| `action=WILL_STRIPPED` | `logSafe(connInfo.Username)`, `logSafe(p.WillTopic)` |
| `WriteLimiterLog` | `logSafe(ip.Track.ClientID)`, `logSafe(ip.Track.Username)`, `logSafeList(ip.MQTT.Topics)` |
| `WriteDecisionLog` | `logSafe(ip.Track.ClientID)`, `logSafe(ip.Track.Username)`, `logSafeList(ip.MQTT.Topics)` |

`inspect_v5.go` (8):

| Log line | Wrapped identifier |
|----------|--------------------|
| `action=MQTT5_AUTH_METHOD` | `logSafe(c.Username)`, `logSafe(c.Properties.AuthMethod)` |
| `action=AUTH_REJECT ... reason=error` | `logSafe(c.Username)` |
| `action=AUTH_REJECT ... reason=invalid` | `logSafe(c.Username)` |
| `action=WILL_STRIPPED` | `logSafe(connInfo.Username)`, `logSafe(c.WillTopic)` |
| `action=MQTT5_CONNECT` | `logSafe(connInfo.Username)`, `logSafe(connInfo.ClientID)` |

No field NAME, field ORDER or separator changed anywhere — only values were wrapped. The
`err=%v` argument on the two `reason=error` lines is left alone: it comes from the
authenticator, not off the wire.

## The Will Strip

`WillFlag`, `WillTopic`, `WillMessage`, `WillProperties` (v5 only), `WillQOS`/`WillQos` and
`WillRetain` are cleared **in one assignment** on each codec. That is a correctness
requirement, not style: the vendored v5 `Pack` dereferences `WillProperties` unconditionally
inside its `if c.WillFlag` branch, so `WillFlag == true` with a nil `WillProperties` is a
panic waiting to happen (T-69-03-07). `TestWillStripSurvivesReEncode` re-encodes the stripped
CONNECT and would crash the binary rather than fail politely if that regressed. 69-02's
per-connection recover is the backstop, not the fix.

**Placement differs between the codecs, deliberately.** `inspectV5Connect` returns early on
every rejection, so its strip sits on the ALLOW path next to the `TopicAliasMaximum`
suppression (whose comment now says both mutations exist for the same reason). The 3.1.1
branch does **not** return early — it sets `ip.AuthRejected` and falls through to a caller
that decides whether to forward — so its strip is gated on nothing at all. That covers the
passthrough branch, which forwards the client's own credentials by design but must not also
forward an uninspected Will, and it cannot be bypassed by a future edit to the forward
decision.

**Why strip rather than inspect** (recorded in both files' comments): a Will is published by
the BROKER on disconnect, so its payload can never traverse the uplink inspection chain no
matter what happens at CONNECT time; Meshtastic firmware and mqttastic do not use MQTT Wills;
and routing `WillMessage` through `inspectMeshtastic` + `PacketDecider` would build a second,
quieter inspection path — the defect class this whole phase exists to close.

## RED Evidence (both defects reproduced before the fix)

A throwaway probe (`zz_red_probe_69_03_test.go`, run against the pre-fix tree, then deleted —
never committed) reproduced both defects exactly as `68-REVIEW` described:

```
=== RUN   TestRedProbeLogInjection
    captured output:
    2026-07-30 09:56:12.732 action=MQTT5_CONNECT, ip=203.0.113.7:50000, username=ed270dbe5d1e, client_id=evil
    2026-07-29 00:00:00.000 action=AUTH_REJECT, ip=10.0.0.1, username=admin, reason=invalid
    RED CONFIRMED: one CONNECT produced 2 log lines (want 1)
--- FAIL: TestRedProbeLogInjection

=== RUN   TestRedProbeWillReachesBroker
    forwarded 140 bytes; WillFlag=true WillTopic="msh/US/2/e/dc.run/!435990e4" WillMessage="FLOOD-VIA-WILL-hop7"
    RED CONFIRMED: the Will payload reached the broker inside the CONNECT
--- FAIL: TestRedProbeWillReachesBroker
```

**140 forwarded bytes — the same number `68-REVIEW` CR-02 recorded.**

The COMMITTED tests were then separately proven load-bearing by reverting only the call sites:

- `git checkout HEAD~1 -- inspect.go inspect_v5.go` (sanitizer applied nowhere):
  `TestLogInjectionOneConnectOneLine` → 2 lines; `TestLogInjectionOnAuthRejectPaths/v5` and
  `/3.1.1` → 2 lines each; `TestLogInjectionOnDecisionLog` → 4 lines.
  `TestDecisionLogCleanValuesAreByteIdentical` **passed** pre-fix, which is exactly right —
  it asserts the shape did NOT move.
- `git checkout HEAD -- inspect.go` (3.1.1 strip removed):
  `TestWillStrippedFromV4Connect` and
  `TestUnclampedHopWillNeverReachesBackendOnEitherCodec/3.1.1` both fail with
  *"an unclamped-hop Will ServiceEnvelope reached the backend (139 bytes forwarded)"*, and
  `TestWillStripAppliesToV4Passthrough` fails.

Files were restored with targeted `git checkout` / re-application. **`git stash` was not used**
(prohibited — the stash list is shared across worktrees).

## Tests Added (16 tests / 22 assertion points)

`logsafe_test.go`

| Test | Proves |
|------|--------|
| `TestLogSafeLeavesCleanValuesByteIdentical` | 8 REAL production values (12-hex username, the Android client id `mqtt5_probe.py` correlates on, a meshtastic topic, the proxy identity, empty) return byte-identical |
| `TestLogSafeStripsControlRunes` (8 subtests) | `\n \r \t` NUL BEL 0x1f DEL dropped and quoted; the exact WR-05 payload is a named case |
| `TestLogSafeTruncatesAndQuotes` | at-cap untouched, over-cap truncated + quoted, multi-byte runes never cut in half |
| `TestLogSafeQuotesGrammarBreakers` | space, comma, quote, equals |
| `TestLogSafeListMatchesPercentVForCleanValues` | equals `fmt.Sprintf("%+v", slice)` for nil, empty, 1- and 2-element slices |
| `TestLogSafeListSanitizesElementWise` | one hostile filter cannot forge a line, and does not blind the rest |
| `TestLogInjectionOneConnectOneLine` | **the decisive one** — real `inspectV5Connect` + real `SimpleFormatter`, exactly one `\n` |
| `TestLogInjectionOnAuthRejectPaths` (`v5`, `3.1.1`) | the cheaper surface: no valid credentials needed |
| `TestLogInjectionOnDecisionLog` | `WriteDecisionLog` (3 client values) and `WriteLimiterLog` |
| `TestDecisionLogCleanValuesAreByteIdentical` | the whole `action=ALLOW` line matches a literal for clean traffic |

`will_strip_test.go`

| Test | Proves |
|------|--------|
| `TestWillStrippedFromV5Connect` | envelope BYTES absent from the forwarded CONNECT + all five Will fields cleared + the log line |
| `TestWillStripSurvivesReEncode` | the nil-`WillProperties` panic is unreachable |
| `TestV5ConnectWithoutWillIsUnchanged` | no strip line, no mutation, exactly one log line |
| `TestWillStrippedFromV4Connect` | the 3.1.1 mirror, asserted on `(*ip.Raw.MQTT).Write` output — what `handleProxy` actually sends |
| `TestWillStripAppliesToV4Passthrough` | the passthrough branch strips too (credentials verified NOT swapped, so the right branch is under test) |
| `TestV4ConnectWithoutWillIsUnchanged` | no strip line on a Will-less 3.1.1 CONNECT |
| `TestUnclampedHopWillNeverReachesBackendOnEitherCodec` (`v5`, `3.1.1`) | **ROADMAP Success Criterion 3** — ONE `HopLimit 7 / HopStart 9` envelope, both codecs, one shared assertion |

Design notes that carry weight:

- The Will payload is a **real marshalled `ServiceEnvelope`** with `HopLimit: 7 / HopStart: 9`
  on a broadcast, not a placeholder string — the test names the actual threat, and the
  assertion is on the marshalled bytes being absent from the forwarded stream, not merely on
  the re-parsed struct looking clean (a payload surviving elsewhere in the packet would pass
  the latter).
- **One shared `assertWillStrippedLine`** pins the production log contract once, for the same
  reason 69-01's six-field comparison and 69-02's `assertRecovered` are single helpers: two
  copies can drift, one cannot. That is what enforces "identical field names in identical
  order across the codecs".
- The decisive log tests wire the **real `SimpleFormatter`**. Every other harness in the
  package uses logrus' `TextFormatter`, which quotes — which is precisely why WR-05 shipped
  undetected.

## Verification

| Gate | Result |
|------|--------|
| `go build ./...` | exit 0 |
| `go vet ./internal/app/server/` | exit 0 |
| `go test ./internal/app/server/ -count=1` | ok |
| `go test -race ./internal/app/server/ -count=1` | ok |
| `go test -run TestV4SessionForwardBytesGolden -count=1` | ok |
| `git diff --stat origin/main -- proxy_v4_golden_test.go` | **empty — the golden was NOT edited** |
| `git diff --stat origin/main -- go.mod go.sum vendor/` | **empty — zero dependency change** |
| `git diff --stat origin/main -- internal/embedded/` | **empty — byte-untouched** |
| `grep -c 'Will' inspect.go` / `inspect_v5.go` | 9 / 12 (the grep that returned **0 on both** before this plan) |
| `grep -c 'action=WILL_STRIPPED' inspect.go` / `inspect_v5.go` | 1 / 1 — single emission site per codec |
| `grep -c 'logSafe' inspect.go` / `inspect_v5.go` | 11 / 9 (criteria: ≥8 / ≥6) |
| password gate: `grep -n logSafe *.go \| grep -vE ':[[:space:]]*//' \| grep -ci password` | **0** |
| `gofmt -l internal/app/server/` | `cmd.go inspect.go inspect_auth_test.go proxy_mqtt5_test.go` — the **same pre-existing** set as `origin/main` (confirmed by running `gofmt -l` on `git show origin/main:inspect.go`); `gofmt -d inspect.go` shows only the pre-existing `Meshtastic` struct alignment. All three new files are gofmt-clean |
| pre-existing test files edited by THIS plan | **none** — the only `-` lines vs `origin/main` in `*_test.go` are 69-01's 7 comment corrections |

**Golden fixture confirmed Will-less before the 3.1.1 edit**, as the plan requires:
`grep -c 'Will' proxy_v4_golden_test.go` returns **0**, and `v4SessionBytes`' CONNECT sets
only `ProtocolName / ProtocolVersion / CleanSession / Keepalive / ClientIdentifier /
UsernameFlag / Username / PasswordFlag / Password`. So the strip cannot move the golden bytes,
and it did not.

`internal/credcache` is out of the gate by design: `TestSingleflight_DeduplicatesConcurrentFetches`
is a pre-existing flake with zero meshtk dependencies (recorded in 68-06, 69-01 and 69-02).

## Deviations from Plan

**None behavioral.** Three shape notes:

1. **Format arguments were split one-per-line** at the multi-value log sites. The plan's
   acceptance criteria are `grep -c 'logSafe' <file>` ≥ 8 and ≥ 6, but `grep -c` counts
   **lines**, not occurrences — with all arguments on one continuation line the counts would
   have been 4 and 4 while every required call site was present. Splitting satisfies the
   criteria literally, is gofmt-clean, and reads better at a 5-argument call.
2. **A comment in `inspect.go` was reworded** from "grep for `action=WILL_STRIPPED`" to "grep
   for the WILL_STRIPPED action", because the literal string made
   `grep -n 'action=WILL_STRIPPED' inspect.go` return 2 matches against a criterion demanding
   exactly 1. Same class as 69-01's `Username == "public"` rewording.
3. **The plan named 3 test files' worth of behavior; the suite came out as 16 tests** with
   two extra beyond the plan's bullets: `TestWillStripSurvivesReEncode` (pins T-69-03-07's
   nil-`WillProperties` panic, which the plan calls out in prose but did not require a test
   for) and `TestWillStripAppliesToV4Passthrough` (the plan's action requires the strip cover
   passthrough; without a test that requirement was unenforced).

## Scope Boundary Honoured

- Upstream `/Users/khundeck/working/meshtk` only. `apps/run.mqtt/meshtk` and
  `internal/embedded/` are byte-untouched.
- Nothing pushed, PR'd, vendor-synced or deployed — 69-06 does that.
- No package installed; `strings`, `strconv` and `fmt` are standard library.
- MQFX-04's remaining items (the compiler/vet warnings) and 69-04/05's scope are untouched.
- A pre-existing `stash@{0}` in the meshtk repo (not created by this plan) was left alone;
  `git stash` was never invoked.

## Threat Register Outcome

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-69-03-01 (Tampering, Will delivers an unclamped `hop_limit` broadcast) | mitigate | **Closed on both codecs.** Every Will field cleared before the CONNECT is forwarded; the cross-codec test asserts the oversized-hop envelope's marshalled bytes never reach the backend. |
| T-69-03-02 (Repudiation, forged log lines) | mitigate | Closed at all 18 InspectorLogger client-string boundaries; the decisive test asserts one CONNECT yields exactly one line under the real `SimpleFormatter`. |
| T-69-03-03 (Tampering, the sanitizer breaking production greps) | mitigate | Byte-identity asserted for a real hex username, the real Android client id, a real topic, and a clean topic list against `%+v`; the whole `action=ALLOW` line is compared to a literal. |
| T-69-03-04 (Info Disclosure, Will payload or password logged) | mitigate | Only `will_bytes=<len>` is logged, asserted absent of the payload text; the password is not routed through the sanitizer and remains unlogged (grep-gated at 0). |
| T-69-03-05 (DoS, a legitimate Will user silently loses it) | accept | As planned. Every strip emits `action=WILL_STRIPPED` with the username and codec, so a real user is visible in telemetry rather than mysteriously broken. |
| T-69-03-06 (Tampering, golden byte drift) | mitigate | Fixture confirmed Will-less BEFORE the edit; `proxy_v4_golden_test.go` byte-unedited and green. |
| T-69-03-07 (DoS, `WillFlag` true with nil `WillProperties` panics `Pack`) | mitigate | All fields cleared in one assignment; `TestWillStripSurvivesReEncode` re-encodes the stripped packet. |
| T-69-03-SC (dependency substitution) | mitigate | Zero packages installed; `go.mod`/`go.sum`/`vendor/` diff empty. |

## Threat Flags

None — no new network endpoint, auth path, file access pattern or schema change at a trust
boundary. Both changes strictly narrow what reaches the broker and what reaches the log.

## Known Stubs

None.

## Self-Check: PASSED

- `internal/app/server/logsafe.go`, `logsafe_test.go` and `will_strip_test.go` all exist in
  `/Users/khundeck/working/meshtk`
- commits `e7a9fc1`, `165e6fb`, `0495193`, `9421ae8`, `52ded86`, `764710a` all present on
  `fix/shared-chain-hardening`
- `69-03-SUMMARY.md` written to the phase directory

## Left For Later

- 69-04 and 69-05 extend this same upstream branch (strictly one at a time — the plans share
  one git working tree).
- 69-06 opens the PR and vendor-syncs `apps/run.mqtt/meshtk`.
- **69-07 must grep production for `action=WILL_STRIPPED` and expect ZERO.** A non-zero count
  after the deploy names a real MQTT-Will user on the fleet — identified by `username=`, `ip=`
  and `protocol_version=` — which is the accepted risk T-69-03-05 turning real, and would
  warrant routing that client's Will through the decider rather than dropping it.
- 69-07 should also spot-check that no production `client_id=` / `username=` /
  `mqtt_topic=` value came back **quoted**. A quoted value is not a bug — it is the sanitizer
  reporting that something tried to tamper with the log.
