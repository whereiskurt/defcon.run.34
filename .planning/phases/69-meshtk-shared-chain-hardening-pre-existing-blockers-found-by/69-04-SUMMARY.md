---
phase: 69-meshtk-shared-chain-hardening-pre-existing-blockers-found-by
plan: 04
subsystem: meshtk-proxy
tags: [meshtk, mqtt, security, tampering, repudiation, parity, upstream]
status: complete
requirements: [MQFX-04]
requires:
  - "69-01, 69-02 and 69-03 (same upstream branch fix/shared-chain-hardening; tree serialization only)"
  - "69-03's logSafe sanitizer (the new log line depends on it)"
provides:
  - "scanV5PublishAlias(block) (found, complete, stop) — bounded, error-free topic-alias walk"
  - "v5RawPublish.HasTopicAlias / .AliasScanComplete / .AliasScanStop"
  - "action=MQTT5_ALIAS_SCAN_INDETERMINATE — production telemetry line, logSafe-sanitized"
  - "the hand-parsed PUBLISH path Blocks a detectable alias with reason=topic_alias_uplink"
  - "TestV5PublishInspectedThenForwardedByteIdentical (replaces the fail-open-named test)"
affects:
  - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5_rawpublish.go
  - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5.go
  - /Users/khundeck/working/meshtk/internal/app/server/inspect_v5.go
tech-stack:
  added: []
  patterns:
    - "sound-until-unknown walk: an unmodelled id abandons a refinement, never an inspection"
    - "a scan that returns no error, so it can never become a reason to withhold a parse result"
    - "trap-byte test fixtures — a wrong skip width lands on an unmodelled id, so 'the alias was found' IS the width proof"
    - "doc comments that ENUMERATE what is mirrored instead of claiming parity"
decisions:
  - "THREE new fields, not two: the two booleans the plan names, plus AliasScanStop, because the plan's own log-line spec requires the walk's stop offset as a client-controlled number"
  - "An incomplete walk logs and CONTINUES — degrading to a Block would be CR-04 with the sign flipped (a property table deciding a packet)"
  - "The alias id byte alone establishes presence; a truncated alias value still reports found (fail closed) with complete=false"
  - "The new line is emitted after inspectV5RawPublish so the client id comes from ip.Track.ClientID, avoiding a new ConnTrack accessor"
metrics:
  duration: ~35m
  tasks: 2
  files: 4
  completed: 2026-07-30
---

# Phase 69 Plan 04: Hand-Parsed PUBLISH Topic-Alias Parity Summary

Closed the asymmetry that let a client pick which inspection path judged it. The codec
path Blocks on `Properties.TopicAlias != nil`; the hand-parsed path skipped the property
block whole and could not see an alias at all, while `inspectV5RawPublish`'s comment
claimed it mirrored its sibling "decision for decision" (68-REVIEW **WR-01**). It now
does — and the fix does not reintroduce the defect class the asymmetry came from, because
an unmodelled property id still costs exactly one optional refinement and never an
inspection.

## Upstream Branch

| Item | Value |
|------|-------|
| Repo | `/Users/khundeck/working/meshtk` (upstream, NOT `apps/run.mqtt/meshtk`) |
| Branch | `fix/shared-chain-hardening` — **extended**, not rebranched |
| Ahead of `origin/main` | 15 commits (3 from 69-01, 2 from 69-02, 6 from 69-03, 4 from this plan) |
| Pushed / PR'd / vendor-synced | **No** — 69-05 extends this branch, 69-06 opens the PR |

## Commits

| Sha | Message |
|-----|---------|
| `ddc55ce` | `fix(69-04): report a topic alias from the hand-parsed PUBLISH view` |
| `9aa3b65` | `test(69-04): pin every modelled PUBLISH property wire shape in the alias walk` |
| `6f127be` | `fix(69-04): Block a detectable topic alias on the hand-parsed PUBLISH path` |
| `5a0eff9` | `test(69-04): pin both alias orderings and retire the fail-open test name` |

## The Shipped `action=MQTT5_ALIAS_SCAN_INDETERMINATE` Line (69-07 greps this)

Emitted from exactly **one** site — `proxy_v5.go:377`
(`grep -c 'action=MQTT5_ALIAS_SCAN_INDETERMINATE' proxy_v5.go` = 1):

```go
n.InspectorLogger.Warnf("action=MQTT5_ALIAS_SCAN_INDETERMINATE, ip=%s, client_id=%s, mqtt_topic=%s, prop_offset=%d",
    socketAddr,
    logSafe(ip.Track.ClientID),
    logSafe(rp.Topic),
    rp.AliasScanStop)
```

Captured verbatim from a real indeterminate walk through the **production
`SimpleFormatter`** (both records the hand-parse arm emits, in order):

```
2026-07-30 10:18:21.524 action=MQTT5_PARSE_FAIL, ip=203.0.113.7:50000, mqtt_type=PUBLISH, reason=invalid Prop type 127 for packet 3
2026-07-30 10:18:21.524 action=MQTT5_ALIAS_SCAN_INDETERMINATE, ip=203.0.113.7:50000, client_id=mqttastic-android-test, mqtt_topic=msh/US/2/e/dc.run/!435990e4, prop_offset=0
```

Clean values render **unquoted and byte-plain**, exactly as 69-03's conditional-quoting
contract requires — so a quoted `client_id=` or `mqtt_topic=` on this line in production
is itself the tamper signal.

**Grep target for 69-07:** `action=MQTT5_ALIAS_SCAN_INDETERMINATE`. Expected production
count is **zero** — Meshtastic firmware and mqttastic do not send unmodelled PUBLISH
properties. A non-zero count names a real client whose property block the walk cannot
finish; `prop_offset=` says where it stopped, so the modelled id set can be extended
against evidence rather than guesswork. It is **not** an alert: the frame was still
inspected, decided and clamped.

`grep -c 'topic_alias_uplink' proxy_v5.go` = **2** — one per path, same action string,
same reason string, which is what keeps prior evidence and ops greps valid across both.

## The Property Ids The Walk Models

The complete set MQTT 5.0 §3.3.2.3 permits on a PUBLISH. Any other id ends the walk.

| Id | Property | Wire shape |
|----|----------|------------|
| `0x01` | Payload Format Indicator | one byte |
| `0x02` | Message Expiry Interval | four bytes |
| `0x03` | Content Type | length-prefixed string |
| `0x08` | Response Topic | length-prefixed string |
| `0x09` | Correlation Data | length-prefixed binary |
| `0x0b` | Subscription Identifier | variable byte integer |
| `0x23` | **Topic Alias** | two bytes — **detected, returns immediately** |
| `0x26` | User Property | two length-prefixed strings |

Eight ids across the seven distinct wire shapes the plan enumerates. The two-byte shape is
the alias itself: it is **detected rather than skipped**, because presence is the only fact
the caller needs and the caller Blocks on presence without ever reading the value.

### The three answers, and why none of them is an error

`scanV5PublishAlias` returns `(hasAlias, complete bool, stop int)` and **never an error**.
That is the load-bearing property, not a style choice:

| Situation | Returns | Caller does |
|-----------|---------|-------------|
| alias id seen | found, **complete** | Block, `reason=topic_alias_uplink` |
| walked to the end, no alias | not found, **complete** | nothing — normal inspection |
| id outside the modelled set | not found, **incomplete**, offset of the id byte | log once, **continue into the inspector** |
| any length prefix past the block end | not found, **incomplete**, offset of the id byte | same |
| alias id present but its value truncated | **found**, incomplete | Block (fail closed — an alias was declared) |

"Complete" means the walk reached a **conclusive** answer, not that it read every byte:
once the alias id is seen there is nothing left to learn.

## Why This Is Not CR-04 Coming Back

Written into `scanV5PublishAlias`' doc comment, because a reader who remembers CR-04 will
reasonably flinch at an id table appearing in this file:

- **CR-04** was that an unmodelled property id **gated inspection**. `Properties.Unpack`
  hard-errored, the error made `handleV5PublishUplink` relay the frame untouched, and three
  client-chosen bytes bought a permanent exemption from the hop clamp, the decider and every
  Block rule. The id table was load-bearing for a decision it had no business making.
- **Here** an unmodelled id costs **one optional refinement**. The frame is still
  hand-parsed, the topic recovered, the ServiceEnvelope decoded, `PacketDecider` run,
  `RewriteHopLimit` applied and every Block rule fired. The walk stops, says so, and the
  packet is judged exactly as it would have been without the walk.

That is enforced by test, not by comment: `TestV5UnmodelledPropertyPublishIsClamped` and
`TestV5UnmodelledPropertyPublishBlockRuleFires` — the 68-07 tests that pin CR-04 closed —
pass **unedited**, and `TestV5AliasIndeterminateStillFullyInspected` asserts the clamp
reaches the wire on the indeterminate path specifically.

**The residual, stated rather than hidden:** an alias hidden *behind* an unmodelled id is
not detected. It is bounded by 68-01 stripping `TopicAliasMaximum` from both the CONNECT
and the CONNACK — the broker grants a zero alias budget and would treat any alias as a
protocol error — and it is now observable instead of unknown.

## RED Evidence (both tasks, tests written before the code)

**Task 1** — the scan was committed as an inert stub (`return false, false, 0`) so the new
tests compiled and failed on assertions rather than on a missing symbol:

```
--- FAIL: TestV5AliasScanWireShapes/payload_format_indicator_(one_byte)
    scan(017f230007) = found false, complete false (stopped at 0); want found true, complete true
    -- the preceding value was not skipped by its own width
--- FAIL: TestV5AliasScanWireShapes/message_expiry_interval_(four_bytes)   [... 8/8 shapes ...]
--- FAIL: TestV5AliasScanModelledAliasFreeBlockIsComplete
--- FAIL: TestV5AliasScanReportedByParseV5PublishFrame/alias_before_an_unmodelled_id
    HasTopicAlias = false, want true
```

**Task 2** — tests written against the post-Task-1 tree, before the guard, reproduce
**WR-01's PROVEN divergence verbatim**:

```
--- FAIL: TestV5TopicAliasBlockedOnHandParsedPath
    a PUBLISH carrying a Topic Alias was allowed on the hand-parsed path (WR-01)
--- FAIL: TestV5AliasIndeterminateStillFullyInspected
    one frame produced 0 indeterminate lines (want exactly 1); got:
    action=MQTT5_PARSE_FAIL, ... reason=invalid Prop type 127 for packet 3
    [proxy] ALLOW from=!435990e4 to=!ffffffff type=NODEINFO_APP topic=[msh/US/2/e/dc.run/!435990e4] user=publisher
--- FAIL: TestV5AliasIndeterminateLogCannotBeForged
    the indeterminate line was never emitted
```

The `ALLOW` line above is the divergence exactly as 68-REVIEW recorded it. `git stash` was
**never invoked** (prohibited — the stash list is shared across worktrees); the pre-existing
`stash@{0}` in this repo was left alone.

## Tests Added (9 tests / 20 subtests)

`proxy_v5_rawpublish_test.go` — **extended, never rewritten** (zero assertion lines removed):

| Test | Proves |
|------|--------|
| `TestV5AliasScanWireShapes` (8 subtests) | every modelled shape is skipped by **exactly** its own width |
| `TestV5AliasScanModelledAliasFreeBlockIsComplete` | a wholly modelled, alias-free block is not-found and **complete**, stopping at the block end |
| `TestV5AliasScanEmptyBlockIsComplete` | the no-properties case |
| `TestV5AliasScanUnmodelledIDIsIncompleteNotAnError` | not-found + incomplete + the id's offset, **no error return** |
| `TestV5AliasScanTruncatedValueIsIncompleteNotAnError` (8 subtests) | 8 truncation shapes; no error, no slice out of range |
| `TestV5AliasScanReportedByParseV5PublishFrame` (4 subtests) | both fields reported off the parse result, both orderings, topic/payload/offset undisturbed |

`proxy_v5_publish_test.go`:

| Test | Proves |
|------|--------|
| `TestV5TopicAliasBlockedOnHandParsedPath` | alias-before-unknown → Block with the codec path's own reason, and **not** reported as indeterminate |
| `TestV5AliasIndeterminateStillFullyInspected` | unknown-before-alias → one log line, then hop clamp on the forwarded bytes, property block preserved verbatim, **no** alias Block |
| `TestV5AliasIndeterminateLogCannotBeForged` | one frame = one physical line for the new record, through the real `SimpleFormatter` |

**The trap-byte design is what makes the wire-shape table honest.** Each modelled value is
padded with `0x7f` — an id the walk deliberately does not model — and a real Topic Alias
follows it. Skip one byte too few or too many and the walk lands on a trap, gives up, and
reports not-found-and-incomplete. So *"the alias was found"* is itself the proof that the
preceding value was skipped by exactly its own width; a shape assertion cannot pass
vacuously.

**The injection test wires the real `SimpleFormatter` and a dedicated inspector buffer.**
Every other harness in that file uses logrus' `TextFormatter`, which quotes — precisely why
WR-05 shipped undetected. `Config.Log` gets its own logger so the `[proxy] ALLOW` line
cannot pollute a physical-line count.

## The Renamed Test

| | Value |
|---|---|
| Old name | `TestV5PublishParseFailureForwardsRaw` |
| New name | `TestV5PublishInspectedThenForwardedByteIdentical` |
| Assertion count **before** | **4** (fixture guard, connection survives, bytes byte-identical, log line contains both `action=MQTT5_PARSE_FAIL` and `mqtt_type=PUBLISH`) |
| Assertion count **after** | **4** — byte-for-byte the same body |
| Diff | the `func` declaration line plus 3 comment lines; **no assertion, fixture or expectation touched** |

`grep -c 'func TestV5PublishParseFailureForwardsRaw' internal/app/server/*.go` = **0**. The
old name survives only in the replacement's doc comment, for traceability — the plan scopes
the criterion to declarations and explicitly permits that.

The old name advertised the posture 68-02 retired when it closed CR-04. The frame is now
inspected and *then* forwarded byte-identically **because no rule mutated it**, which is a
very different fact from a fail-open relay.

## Verification

| Gate | Result |
|------|--------|
| `go build ./...` | exit 0 |
| `go vet ./internal/app/server/` | exit 0 |
| `go test ./internal/app/server/ -count=1` | ok |
| `go test ./internal/app/server/ -count=3` | ok |
| `go test -race ./internal/app/server/ -count=1` | ok |
| `go test -run TestV5AliasScan -count=1 -v` | 6 top-level PASS + 20 subtests, every shape named in the output |
| `go test -run 'TestV5TopicAlias\|TestV5AliasIndeterminate\|TestV5UnmodelledProperty\|TestV5PublishInspectedThen' -count=1` | ok |
| `go test -run TestV5UnmodelledPropertyPublishIsClamped -count=1` | **PASS unedited** — the scan does not gate inspection |
| `go test -run TestV5UnmodelledPropertyPublishBlockRuleFires -count=1` | **PASS unedited** |
| `go test -run TestV4SessionForwardBytesGolden -count=1` | ok |
| `git diff --stat origin/main -- proxy_v4_golden_test.go` | **empty — the golden was NOT edited** |
| `git diff --stat origin/main -- go.mod go.sum vendor/` | **empty — zero dependency change** |
| `git diff --stat origin/main -- internal/embedded/` | **empty — byte-untouched** |
| `grep -c 'HasTopicAlias' proxy_v5_rawpublish.go` | 4 (criterion: ≥ 2) |
| `grep -c 'AliasScanComplete' proxy_v5_rawpublish.go` | 4 |
| `grep -c 'topic_alias_uplink' proxy_v5.go` | **2** — codec path and hand-parse path |
| `grep -c 'action=MQTT5_ALIAS_SCAN_INDETERMINATE' proxy_v5.go` | **1** — single emission site |
| `grep -c 'func TestV5PublishParseFailureForwardsRaw' *.go` | **0** |
| `git diff origin/main -- proxy_v5_rawpublish_test.go \| grep -c '^-[^-]'` | **0 removed lines** |
| `gofmt -l internal/app/server/` | `cmd.go inspect.go inspect_auth_test.go proxy_mqtt5_test.go` — the **same pre-existing** set as `origin/main`; every file this plan touched is gofmt-clean |

### E2E: **RAN** (not skipped)

A local mosquitto was available, so `MESHTK_E2E=1 go test -run TestE2EDualCodec -count=1`
executed for real and passed — **15/15 subtests**, including
`v5_unmodelled_property_publish_is_clamped_end_to_end`, which is the end-to-end form of the
CR-04-stays-closed guarantee this plan had to preserve.

### Test-file removals across the whole branch

`git diff origin/main -- 'internal/app/server/*_test.go' | grep -c '^-[^-]'` = **11**, and
every one is accounted for: 7 comment corrections from 69-01, plus this plan's 3 corrected
comment lines and 1 renamed function declaration. **Zero assertions removed by any plan in
this phase.**

`internal/credcache` is out of the gate by design: `TestSingleflight_DeduplicatesConcurrentFetches`
is a pre-existing flake with zero meshtk dependencies (recorded in 68-06, 69-01, 69-02 and 69-03).

## Deviations from Plan

**None behavioral.** Three shape notes:

1. **THREE new `v5RawPublish` fields, not two.** The plan's action says "two new fields"
   (alias found, walk complete) — both are present and are what the acceptance criteria
   check. `AliasScanStop` is the third, and it exists because the plan's **own** Task 2
   log-line specification requires "the walk's stop offset" as a client-controlled number
   formatted with a numeric verb. Without a field there is nothing to log. It is
   report-only, meaningful only when the walk is incomplete, and documented as such.

2. **The injection assertion is scoped to the new line, not to the whole buffer.** The
   criterion reads `strings.Count(out, "\n") == 1`, which cannot hold literally: the
   hand-parse arm **always** emits `action=MQTT5_PARSE_FAIL` first, and that line is
   pre-existing (68-02) rather than added by this plan. The test instead asserts
   `strings.Count(out[idx:], "\n") == 1` from the new line's own offset to the end of the
   log — literally "the new line is exactly one physical line, and nothing follows it",
   which is the measurement the criterion is reaching for and is *stricter* about the new
   line specifically. It **additionally** asserts the whole frame produces exactly 2
   records, so a hostile client id demonstrably adds zero lines.

3. **The new log line is emitted after `inspectV5RawPublish` builds `ip`**, so the client id
   comes from `ip.Track.ClientID` — the tracked `ConnectionInfo` that `SetConnTrack` swaps
   in, i.e. the same value every other production line carries. The alternative was a new
   `clientIDFor(socketAddr)` accessor in `inspect.go`, a file this plan is not scoped to
   touch. Ordering is unaffected: the line still precedes the decision, and the alias
   **Block** still happens strictly before any inspection, matching the codec path.

## Scope Boundary Honoured

- Upstream `/Users/khundeck/working/meshtk` only. `apps/run.mqtt/meshtk` and
  `internal/embedded/` are byte-untouched.
- Nothing pushed, PR'd, vendor-synced or deployed — 69-06 does that.
- **WR-03 not touched** (both relay paths handing mosquitto frames known to be malformed) —
  explicitly out of scope per the plan's scope fence, and it is not in MQFX-04.
- WR-06 through WR-13 untouched, including the `gofmt` wart (WR-12). The pre-existing
  `gofmt -l` offender set is unchanged.
- 69-05's scope (the SUBSCRIBE seam and the CONNECT failure branches) untouched.
- No package installed; `encoding/binary` and `fmt` are standard library and were already
  imported.
- `git stash` never invoked; the pre-existing `stash@{0}` left alone.

## Threat Register Outcome

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-69-04-01 (Tampering, alias invisible to the hand-parsed path) | mitigate | **Closed.** Blocked with the codec path's own reason string; both property orderings tested; the pre-fix RED reproduced WR-01's ALLOW verbatim. |
| T-69-04-02 (Tampering, a property table GATING inspection — the CR-04 class) | mitigate | The scan returns no error and never withholds a parse result. The 68-07 clamp and block-rule tests pass **unedited**, and the indeterminate path is separately asserted to clamp on the wire. |
| T-69-04-03 (Repudiation, the new line reopening WR-05) | mitigate | Both client strings through `logSafe`, the offset with `%d`; asserted one physical line through the real `SimpleFormatter` with a newline-bearing, forged-BLOCK client id. |
| T-69-04-04 (Info Disclosure, logging the topic / offset) | accept | As planned. Both already appear on existing ALLOW/BLOCK lines for the same frame; no new class of value is disclosed. |
| T-69-04-05 (Tampering, 3.1.1 byte drift) | mitigate | `proxy_v4_golden_test.go` byte-unedited (`git diff` empty) and green; the edited arm is v5-only. |
| T-69-04-06 (Repudiation, a rename quietly dropping assertions) | mitigate | 4 assertions before, 4 after, body byte-identical; only the declaration and 3 comment lines differ. |
| T-69-04-SC (dependency substitution) | mitigate | Zero packages installed; `go.mod`/`go.sum`/`vendor/` diff empty. |

## Threat Flags

None — no new network endpoint, auth path, file access pattern or schema change at a trust
boundary. The change strictly narrows what the hand-parsed path will forward.

## Known Stubs

None. The inert `scanV5PublishAlias` stub used to establish RED was replaced in the same
commit; no stub was ever committed.

## Self-Check: PASSED

- `internal/app/server/proxy_v5_rawpublish.go` contains `scanV5PublishAlias` and all three
  new fields in `/Users/khundeck/working/meshtk`
- commits `ddc55ce`, `9aa3b65`, `6f127be`, `5a0eff9` all present on `fix/shared-chain-hardening`
  (branch is 15 ahead of `origin/main`; working tree clean)
- `69-04-SUMMARY.md` written to the phase directory

## Left For Later

- **69-05** extends this same upstream branch (the SUBSCRIBE seam + the CONNECT failure
  branches). Strictly one plan at a time — they share one git working tree.
- **69-06** opens the PR and vendor-syncs `apps/run.mqtt/meshtk`.
- **69-07 must grep production for `action=MQTT5_ALIAS_SCAN_INDETERMINATE` and expect ZERO.**
  A non-zero count is informational, not an alert: it names a client sending a PUBLISH
  property id the walk does not model, with `prop_offset=` pointing at the byte that stopped
  it. The frame was still inspected, decided and clamped. Two or three of these from the
  same `client_id=` would justify extending the modelled id set — against evidence.
- 69-07 should also confirm no `client_id=` or `mqtt_topic=` on this line came back
  **quoted**; a quoted value is the 69-03 sanitizer reporting a tamper attempt.
- WR-03 (relaying frames the proxy knows mosquitto will reject as malformed) remains open
  and is not in MQFX-04.
