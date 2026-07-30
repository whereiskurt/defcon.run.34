---
phase: 69-meshtk-shared-chain-hardening-pre-existing-blockers-found-by
plan: 05
subsystem: meshtk-proxy
tags: [meshtk, mqtt, security, tampering, dos, repudiation, parity, upstream]
status: complete
requirements: [MQFX-04]
requires:
  - "69-01..69-04 (same upstream branch fix/shared-chain-hardening; tree serialization only)"
  - "69-03's logSafe sanitizer (the new MQTT5_SUBSCRIBE_HEADER_FAIL line depends on it)"
provides:
  - "parseV5SubscribeFrame(frame) (*v5RawSubscribe, error) — property-agnostic SUBSCRIBE parser"
  - "inspectV5RawSubscribe(socketAddr, *v5RawSubscribe) *InspectorPacket"
  - "RawPacket.MQTT5RawSub — the FOURTH member; at-most-one invariant now spans four"
  - "AllowMQTTControl third branch — a hand-parsed SUBSCRIBE is a control packet"
  - "handleV5SubscribeUplink + the SHARED decideV5Subscribe switch"
  - "connectFromV5Packet — the fourth CONNECT failure branch, made executable"
  - "action=MQTT5_SUBSCRIBE_HEADER_FAIL — new production telemetry line, logSafe-sanitized"
  - "answered=0x81 — new field on the four existing MQTT5_PARSE_FAIL CONNECT lines"
affects:
  - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5.go
  - /Users/khundeck/working/meshtk/internal/app/server/inspect.go
  - /Users/khundeck/working/meshtk/internal/app/server/rules.go
tech-stack:
  added: []
  patterns:
    - "property-agnosticism proven BEHAVIORALLY: two frames differing in exactly ONE byte (the property id) must parse identically — a grep cannot fail when a future edit adds a table"
    - "a defensive branch nobody can execute is a branch nobody knows works — extract it so a test can assert its client-bound bytes"
    - "parity asserted on the matching rule NAME, never on 'not Blocked' — the first inspect rule short-circuits"
    - "fixture-premise assertions: each test first proves the codec genuinely disagrees, so the seam under test is the one production reaches"
key-files:
  created:
    - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5_rawsubscribe.go
    - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5_rawsubscribe_test.go
    - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5_connect_fail_test.go
  modified:
    - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5.go
    - /Users/khundeck/working/meshtk/internal/app/server/inspect.go
    - /Users/khundeck/working/meshtk/internal/app/server/rules.go
decisions:
  - "The empty-filter-list refusal lives in the HAND parser only — paho accepts an empty subscription list (probed, not assumed), and widening fail-closed to frames the codec reads fine is not what MQFX-04 asks for"
  - "Branch 4 of the CONNECT failure set was EXTRACTED into connectFromV5Packet because v5.ReadPacket dispatches on the same nibble readFrame checked, making it socket-unreachable and therefore untestable inline"
  - "The MQTT5_PARSE_FAIL CONNECT lines carry NO new client-controlled string — the plainest way to keep an extended line WR-05-safe is to add none"
  - "handleV5SubscribeUplink mirrors handleV5PublishUplink rather than staying inline, so the header-fail line is unit-testable with the real SimpleFormatter"
metrics:
  duration: ~30m
  tasks: 2
  files: 6
  completed: 2026-07-30
---

# Phase 69 Plan 05: Property-Agnostic SUBSCRIBE Seam + Version-Correct CONNECT Answers Summary

Closed the last two `68-REVIEW.md` warnings that Phase 68's own fixes introduced. **WR-04**:
a SUBSCRIBE the codec could not parse was relayed without ever building an
`InspectorPacket`, so it never reached `PacketDecider`, `MQTT.Topics` was never recorded, and
the first topic Block rule anyone added would silently not apply to it — the *same* three
client-chosen property bytes as CR-04, buying an exemption one layer up. **WR-02**: an
unparseable v5 CONNECT was dropped with **no CONNACK**, so the client got a silent TCP close
and hot-retried — the exact 0x84 retry-loop failure mode Phase 68 existed to remove,
reintroduced one layer down.

Inspection no longer depends on which parser succeeded, and no refusal is answered with
silence.

## Upstream Branch

| Item | Value |
|------|-------|
| Repo | `/Users/khundeck/working/meshtk` (upstream, NOT `apps/run.mqtt/meshtk`) |
| Branch | `fix/shared-chain-hardening` — **extended**, not rebranched, not rebased |
| Ahead of `origin/main` | **19** commits (3 from 69-01, 2 from 69-02, 6 from 69-03, 4 from 69-04, 4 from this plan) |
| Pushed / PR'd / vendor-synced | **No** — 69-06 opens the PR and syncs the vendored tree |

## Commits

| Sha | Message |
|-----|---------|
| `75f8990` | `fix(69-05): inspect every v5 SUBSCRIBE, whichever parser succeeded` |
| `8d5071f` | `test(69-05): prove the SUBSCRIBE parse is property-agnostic by BEHAVIOR` |
| `3848d6b` | `fix(69-05): answer every v5 CONNECT failure instead of closing in silence` |
| `5dbdffc` | `test(69-05): one test per CONNECT failure branch, asserting client-bound bytes` |

## The Enumerated CONNECT Failure Branches — **N = 4**, and the baseline **B = 3**

The plan required the count be *found* rather than assumed, because the review prose disagreed
with itself about whether it is three or four. It is **four**, all in `handleProxyV5`:

| # | Branch | Trigger | Reachable from the socket? |
|---|--------|---------|----------------------------|
| 1 | `readFrame` error | remaining-length varint that never terminates, or a packet over the 256 KiB cap | **Yes** |
| 2 | first packet is not a CONNECT | any other fixed-header type on a fresh socket | **Yes** |
| 3 | `v5.ReadPacket` error | a CONNECT property id paho.golang does not model | **Yes — PROVEN**, see below |
| 4 | parsed packet is not a `*v5.Connect` | the codec's type dispatch changing under a vendor bump | **No** — defence in depth |

**Pre-edit baseline `B`:** `grep -c 'writeMqtt5Connack' internal/app/server/proxy_v5.go` = **3**
(the helper's doc line, its declaration, and one reference in `writeMqtt5Disconnect`'s comment).
**Post-edit: 7 = B + N.** `grep -c 'answered='` = **4 = N**.

**Branch 3 is not theoretical, and the test says so before it asserts anything else.**
`peekConnectProtocolVersion` reads level 5 off the very bytes `v5.ReadPacket` then rejects, so
a client sending one unmodelled CONNECT property is routed to `handleProxyV5` and — before this
plan — got silence. `TestV5ConnectFailUnmodelledProperty` asserts both halves of that routing
fact as its premise.

**Branch 4 was extracted into `connectFromV5Packet`.** `v5.ReadPacket` switches on the same
fixed-header nibble `readFrame` already checked, so a `0x1_` frame always yields a
`*v5.Connect` and the branch cannot be reached through a socket. Left inline it would have been
the one branch of four asserted by hope rather than by bytes. Extracted, its test asserts the
identical five-byte CONNACK its three siblings are asserted on — and separately asserts the
unreachability premise, so if a vendor bump ever makes it socket-reachable the test says so.

## The Shipped Log Lines (69-07 greps these in production)

Captured verbatim from real refusals through the **production `SimpleFormatter`**:

```
2026-07-30 10:38:09.902 action=MQTT5_PARSE_FAIL, ip=203.0.113.9:51000, mqtt_type=SUBSCRIBE, reason=EOF
2026-07-30 10:38:09.903 action=MQTT5_SUBSCRIBE_HEADER_FAIL, ip=203.0.113.9:51000, client_id=mqttastic-android-test, frame_bytes=9, reason=topic filter declares 5 bytes, 2 present
2026-07-30 10:38:09.903 action=MQTT5_PARSE_FAIL, ip=203.0.113.11:52000, answered=0x81, reason=CONNECT frame parsed as *packets.Pingreq
2026-07-30 10:38:09.903 action=MQTT5_PARSE_FAIL, ip=203.0.113.11:52000, answered=0x81, reason=malformed remaining length
2026-07-30 10:38:09.903 action=MQTT5_PARSE_FAIL, ip=203.0.113.11:52000, answered=0x81, reason=first packet is type 12, not CONNECT
2026-07-30 10:38:09.903 action=MQTT5_PARSE_FAIL, ip=203.0.113.11:52000, answered=0x81, reason=invalid Prop type 127 for packet 1
```

### `action=MQTT5_SUBSCRIBE_HEADER_FAIL` — the new action string

Emitted from exactly **one** site (`grep -c` = 1), `proxy_v5.go`:

```go
n.InspectorLogger.Warnf("action=MQTT5_SUBSCRIBE_HEADER_FAIL, ip=%s, client_id=%s, frame_bytes=%d, reason=%v",
    socketAddr,
    logSafe(n.trackedClientID(socketAddr)),
    len(frame),
    herr)
```

The one client-controlled string (`client_id=`) goes through 69-03's `logSafe`; the byte count
uses a numeric verb, which cannot carry a newline; `reason=` comes from this package's own
parser and interpolates only integers. Note `client_id=mqttastic-android-test` renders
**unquoted and byte-plain** above — 69-03's conditional-quoting contract holds, so a *quoted*
`client_id=` on this line in production is itself the tamper signal.

**Grep target for 69-07:** `action=MQTT5_SUBSCRIBE_HEADER_FAIL`. Expected production count is
**zero**. A non-zero count names a real client whose SUBSCRIBE length prefixes contradict its
own bytes — a frame mosquitto refuses too — and it is the accepted risk **T-69-05-04** turning
real. `frame_bytes=` and `reason=` together say exactly which prefix disagreed.

### `answered=` — the new field format, exactly as shipped

`answered=%#02x` of the vendored `v5.ConnackMalformedPacket`, which renders as
**`answered=0x81`** and sits **before** `reason=` so the free-form reason stays last on the
line. It exists so 69-07 can distinguish an **answered** failure from the pre-fix silent close
in production telemetry without a second grep: `action=MQTT5_PARSE_FAIL` with `answered=` is
post-fix; the same action *without* it is a pre-fix record, or a PUBLISH/SUBSCRIBE parse-fail
(which are relay/hand-parse paths, not refusals, and correctly carry no `answered=`).

**Why 0x81 and not 0x84.** Written into the code as a comment, not just here: the proxy *does*
speak level 5 — `peekConnectProtocolVersion` read a 5 off these very bytes — so the honest
complaint is about the **frame**, not the version. Answering the unsupported-protocol-version
code to a level-5 CONNECT is the precise lie that made mqttastic retry-loop.

**The four pinned reason codes are unmoved.** Bad credentials (0x87), enhanced auth (0x8C),
level-above-5 (0x84) and the 3.1.1 four-byte CONNACK are fixed by `TestV5ConnackReasonCodes`
**and** by the committed `mqtt5_probe.py` regression check; all four suites re-run green and
`proxy_v5_test.go` is byte-unedited.

## Retired Accepted Risk: **T-68-06-05**

68-06 accepted "relay, do not close" for a SUBSCRIBE the codec refused: *"a SUBSCRIBE carries
no credentials and no topic Block rule exists today, so a loud relay beats tearing down a live
session over one unmodelled property."* That is retired, and the retirement is narrow on
purpose:

- An **unmodelled property id** no longer closes anything — it is exactly the case the hand
  parser now handles, inspects and relays.
- The **only** frames that now fail closed are those whose own length prefixes contradict their
  bytes. mosquitto refuses those too, so the session was doomed one hop later regardless, and
  it is the same bar `action=MQTT5_PUBLISH_HEADER_FAIL` has applied since 68-02.
- The client now receives a **reason code** (v5 DISCONNECT, `0x81`) instead of a silent close.

## Why This Is Not CR-04 Coming Back

`parseV5SubscribeFrame` **reads no property id at all** — unlike 69-04's PUBLISH alias scan,
which needed a bounded id table and justified it. A SUBSCRIBE carries no topic alias, so there
is nothing for a scan to find and no reason for a table to exist here. The property block is
skipped as a **unit** by its own declared length varint, exactly as the PUBLISH framing parser
skips it.

That claim is **falsifiable and tested behaviorally**, which the plan insisted on and which a
grep cannot deliver. `TestParseV5SubscribeFrameIsPropertyAgnostic`:

1. builds two frames and asserts they differ in **exactly one byte** (fails the test otherwise,
   so the fixture cannot silently stop being a controlled comparison);
2. asserts the **codec parses the first and refuses the second** — so the seam under test is
   the one production reaches;
3. asserts the hand parser returns an **identical packet id and identical filter list** for
   both.

A grep for "no property table" cannot fail when a future edit adds one. That test can.

## The SUBSCRIBE Seam

| Piece | Where | Note |
|-------|-------|------|
| `parseV5SubscribeFrame` | `proxy_v5_rawsubscribe.go` | length-prefix walking only; cap check before trusting a length; walk must land exactly on the frame end; error and **no partial view** on any inconsistency |
| `v5RawSubscribe{PacketID, Filters}` | same file | filters in **wire order** — order is part of the parity claim |
| `inspectV5RawSubscribe` | same file | `SetConnTrack` (load-bearing), `MQTT.Type` = the same `"SUBSCRIBE"` literal, `MQTT.Topics` in filter order, nothing meshtastic decoded |
| `trackedClientID` | same file | read-only tracker lookup for a refusal path that has no `InspectorPacket`; deliberately does **not** refresh a doomed connection's idle timer |
| `RawPacket.MQTT5RawSub` | `inspect.go` | the **fourth** member; the at-most-one doc comment now enumerates four, and `setPublishPayload` gained an explicit arm so its switch is a real dispatch across every member |
| third `AllowMQTTControl` branch | `rules.go` | the **3.1.1 branch stays FIRST and unedited** |
| `handleV5SubscribeUplink` | `proxy_v5.go` | mirrors `handleV5PublishUplink`; both paths run the **shared** `decideV5Subscribe` |

**`SetConnTrack` is load-bearing, not cosmetic.** The forwarded CONNECT carries the swapped
proxy identity, so without it `Track.Username` is empty and `RequireMQTTUserName` would Block a
subscribe on an already-authenticated session.

**The rejected alternative is recorded in two comments.** Synthesizing a `v5.Subscribe` so the
existing `Raw.MQTT5` branch would match unchanged makes `Raw.MQTT5` **lie about provenance**,
and `RawPacket`'s never-synthesize invariant exists because a synthesized packet is one a rule
can mutate without the mutation ever reaching the wire — meshtk#22, shipped once already.

## RED Evidence (both tasks, tests written before the code)

**Task 1** — an inert stub (`return nil, fmt.Errorf("not implemented")`) so the tests compiled
and failed on assertions rather than on a missing symbol:

```
--- FAIL: TestParseV5SubscribeFrame/property_id_no_MQTT_5.0_table_defines
    parseV5SubscribeFrame(822e0007027f05...) = not implemented           [6/6 subtests]
--- FAIL: TestParseV5SubscribeFrameIsPropertyAgnostic
--- FAIL: TestAllowMQTTControlRawSubscribe
    AllowMQTTControl did not match a hand-parsed v5 SUBSCRIBE
--- FAIL: TestV5RawSubscribeRelayedByteIdentical
    relayed , want the captured frame 822e0015027f0500136d73682f...
--- FAIL: TestV5SubscribeHeaderFailRefused/{length_prefixes_contradict_the_bytes,empty_filter_list}
    a malformed SUBSCRIBE was accepted; the connection should end
--- FAIL: TestV5SubscribeHeaderFailLogCannotBeForged
```

**Task 2** — the pre-fix branch bodies, kept verbatim while the tests were written. All four
reproduce **WR-02 exactly**: the parse-fail line present, and **nothing sent to the client**.

```
--- FAIL: TestV5ConnectFailUnreadableFrame
    the CONNECT failure ended in a SILENT CLOSE ...; log:
    action=MQTT5_PARSE_FAIL, ip=203.0.113.11:52000, reason=malformed remaining length
--- FAIL: TestV5ConnectFailFirstPacketNotConnect
    ... reason=first packet is type 12, not CONNECT
--- FAIL: TestV5ConnectFailUnmodelledProperty
    ... reason=invalid Prop type 127 for packet 1
--- FAIL: TestV5ConnectFailParsedAsAnotherType
    ... reason=CONNECT frame parsed as *packets.Pingreq
```

`git stash` was **never invoked** (prohibited — the stash list is shared across worktrees); the
pre-existing `stash@{0}` in this repo was left alone.

## Tests Added (16 tests / 18 subtests, across two new files)

`proxy_v5_rawsubscribe_test.go`

| Test | Proves |
|------|--------|
| `TestParseV5SubscribeFrame` (6 subtests) | packet id + filters in order, across empty / modelled / unmodelled / multi-byte-varint property blocks, and a zero-length filter **reported, not judged** |
| `TestParseV5SubscribeFrameRejects` (12 subtests) | every framing inconsistency → error and **no partial view**, including the empty filter list |
| `TestParseV5SubscribeFrameIsPropertyAgnostic` | **the decisive one** — see above |
| `TestV5RawSubscribeInspectorRecordsFilters` | `MQTT.Type`, filter order, tracked username, and that **exactly one** `RawPacket` member is set |
| `TestV5RawSubscribeMatchesSameRuleAsCodecAndV4` | the same rule **by NAME** across hand-parsed v5, codec v5 and 3.1.1 |
| `TestAllowMQTTControlRawSubscribe` | the third branch matches; the no-codec tail still answers false |
| `TestV5RawSubscribeRelayedByteIdentical` | the **captured** frame relays; nothing is written to the client; the parse-fail signal survives |
| `TestV5CodecSubscribeStillRelayedByteIdentical` | the parseable path is untouched and reports no parse failure |
| `TestV5SubscribeHeaderFailRefused` (2 subtests) | contradictory prefixes **and** an empty filter list → no bytes to the broker, a DISCONNECT carrying `0x81`, and the header-fail line |
| `TestV5CodecParseableEmptyFilterListStillRelays` | **the scope fence** — see Deviations |
| `TestV5SubscribeHeaderFailLogCannotBeForged` | one frame = one physical line through the real `SimpleFormatter`, with a newline-bearing forged-`ALLOW` client id |

`proxy_v5_connect_fail_test.go`

| Test | Proves |
|------|--------|
| `TestV5ConnectFailUnreadableFrame` | branch 1 answers `2003008100` |
| `TestV5ConnectFailFirstPacketNotConnect` | branch 2 answers `2003008100` |
| `TestV5ConnectFailUnmodelledProperty` | branch 3 answers `2003008100`, **and** that `peekConnectProtocolVersion` still returns 5 for it |
| `TestV5ConnectFailParsedAsAnotherType` | branch 4 answers `2003008100`, **and** the unreachability premise |
| `TestV5MalformedAnswerDistinctFromThePinnedCodes` | `0x81` collides with none of the pinned answers, and encodes to the pinned five bytes |
| `TestV5ConnectParseFailLineCannotBeForged` | the extended line yields exactly ONE physical line for a CONNECT whose client id is a fully-formed forged `MQTT5_CONNECT` record |

Every failure test asserts on **captured client-bound BYTES** in hex, never on a helper's
return value — the failure mode this phase keeps rediscovering is code that updates state and
never reaches the wire (meshtk#22).

## Verification

| Gate | Result |
|------|--------|
| `go build ./...` | exit 0 |
| `go vet ./internal/app/server/` | exit 0 |
| `go test ./internal/app/server/ -count=1` | ok |
| `go test ./internal/app/server/ -count=3` | ok |
| `go test -race ./internal/app/server/ -count=1` | ok |
| `go test -run TestV5ConnectFail -count=1 -v` | **exactly 4 PASS** — one per enumerated branch |
| `go test -run 'TestAllowMQTTControlV4Unchanged\|TestAllowMQTTControlV5\|TestV5SubscribeMatchesSameRuleAsV4'` | ok |
| `go test -run 'TestV5ConnackReasonCodes\|TestWriteMqtt5ConnackMatchesUnsupportedLiteral\|TestV5EnhancedAuthRejected\|TestV5ConnectInvalidCredsRejected'` | ok — **no pinned reason code moved** |
| `go test -run TestV4SessionForwardBytesGolden -count=1` | ok |
| `git diff --stat origin/main -- proxy_v4_golden_test.go` | **empty — the golden was NOT edited** |
| `git diff --stat origin/main -- proxy_v5_parity_test.go` | **empty — not edited** |
| `git diff --stat origin/main -- proxy_v5_test.go` | **empty — not edited** |
| `git diff --stat origin/main -- go.mod go.sum vendor/` | **empty — zero dependency change** |
| `git diff --stat origin/main -- internal/embedded/` | **empty — byte-untouched** |
| `grep -n 'MQTT5RawSub' inspect.go` | field at line 71 + the four-field doc comment + the `setPublishPayload` arm |
| `grep -c 'MQTT5RawSub' rules.go` | **1** (criterion: ≥ 1); the 3.1.1 branch verified by reading to still be **first** |
| `grep -c 'action=MQTT5_SUBSCRIBE_HEADER_FAIL' proxy_v5.go` | **1** — single emission site |
| `grep -c 'writeMqtt5Connack' proxy_v5.go` | **7 = B(3) + N(4)** |
| `grep -c 'answered=' proxy_v5.go` | **4 = N** |
| `gofmt -l internal/app/server/` | `cmd.go inspect.go inspect_auth_test.go proxy_mqtt5_test.go` — the **same pre-existing** set as `origin/main`; `gofmt -d inspect.go` shows only the pre-existing `Meshtastic` struct alignment, and all three new files are gofmt-clean |
| `git diff origin/main -- '*_test.go' \| grep -c '^-[^-]'` | **11 — unchanged from 69-04**, so this plan removed **zero** lines from any pre-existing test file |

### E2E: **RAN** (not skipped)

A local mosquitto was available, so `MESHTK_E2E=1 go test -run TestE2EDualCodec -count=1`
executed for real and passed — **15/15 subtests**, zero SKIPs.

`internal/credcache` is out of the gate by design: `TestSingleflight_DeduplicatesConcurrentFetches`
is a pre-existing flake with zero meshtk dependencies (recorded in 68-06 and 69-01..69-04).

## Deviations from Plan

**None behavioral.** Four shape notes:

1. **The empty-filter-list refusal is hand-parse-only, and that asymmetry is asserted rather
   than hidden.** The plan lists "a SUBSCRIBE with an empty filter list is refused the same
   way" under the parser's behavior. It is — but a *probe* (not an assumption) showed
   paho.golang parses `8203001500` happily, so a bare empty-filter SUBSCRIBE never reaches the
   hand parser at all. Refusing it on the codec path too would widen fail-closed to frames the
   codec reads fine, which the plan's own scope fence rules out. So the fixture carries an
   unmodelled property id to reach the seam, and a **new test**
   (`TestV5CodecParseableEmptyFilterListStillRelays`) pins the other half so a future widening
   must be a deliberate edit rather than drift. Documented in the parser's doc comment.

2. **The SUBSCRIBE arm was extracted into `handleV5SubscribeUplink`.** The plan's action only
   required extracting the decide/log switch (done — `decideV5Subscribe`, shared by both
   paths). Lifting the whole arm out of the read loop as well mirrors `handleV5PublishUplink`
   exactly, and is what makes the header-fail line unit-testable against the real
   `SimpleFormatter` instead of only through a full socket session.

3. **CONNECT branch 4 was extracted into `connectFromV5Packet`.** The plan asked for one test
   per branch asserting captured bytes; branch 4 is socket-unreachable (proven, not assumed),
   so left inline it could not have one. The extraction preserves the criterion's grep counts —
   all four `writeMqtt5Connack` calls and all four `answered=` fields are in `proxy_v5.go`.

4. **`setPublishPayload` gained an explicit `MQTT5RawSub` arm** (returning a clear error — a
   SUBSCRIBE has no payload) rather than letting it fall into the tail. `RawPacket`'s doc
   comment names `setPublishPayload` as one of the two readers that dispatch across *all*
   members; with a fourth member that promise is only true if the switch actually names it. The
   tail's message was reworded accordingly.

## Scope Boundary Honoured

- Upstream `/Users/khundeck/working/meshtk` only. `apps/run.mqtt/meshtk` and
  `internal/embedded/` are byte-untouched.
- Nothing pushed, PR'd, vendor-synced or deployed — 69-06 does that.
- **WR-03 not touched** (both relay paths handing mosquitto frames known to be malformed) —
  explicitly out of scope per the plan's scope fence, and not in MQFX-04.
- WR-06 through WR-13 untouched, including the `gofmt` wart (WR-12).
- No package installed; `encoding/binary` and `fmt` are standard library.
- `git stash` never invoked; the pre-existing `stash@{0}` left alone. No rebase, no
  force-push, no `git clean`.

## Threat Register Outcome

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-69-05-01 (Tampering, unparseable SUBSCRIBE relayed uninspected — WR-04) | mitigate | **Closed.** Hand parser + inspector + third `AllowMQTTControl` branch; parity asserted on the matching rule **NAME** across all three paths. |
| T-69-05-02 (DoS, unparseable CONNECT dropped with no CONNACK — WR-02) | mitigate | **Closed on all four branches.** `0x81` answered before every return; `answered=` recorded; RED reproduced the silent close on each. |
| T-69-05-03 (Tampering, a fourth member / third branch perturbing the 3.1.1 sequence) | mitigate | 3.1.1 branch first and unedited; `TestAllowMQTTControlV4Unchanged` and the byte-and-decision golden both green with the golden file **byte-unedited**. |
| T-69-05-04 (DoS, the new fail-closed path tearing down a live session) | accept | As planned, and narrowed: only self-contradictory length prefixes reach it, mosquitto refuses those too, and the client now gets a reason code. 69-07 asserts the counter is zero on real client ids. |
| T-69-05-05 (Tampering, a synthesized `v5.Subscribe` making `Raw.MQTT5` lie) | mitigate | Rejected by design; own `RawPacket` member; the rejected alternative recorded in `inspectV5RawSubscribe` **and** in the rules branch, and asserted by the exactly-one-member check. |
| T-69-05-06 (Repudiation, the new/extended lines reopening WR-05) | mitigate | The one new client string through `logSafe`; counts numeric; the CONNECT lines add **no** client string at all; one injection test per line, each through the real `SimpleFormatter`. |
| T-69-05-07 (Tampering, reading a property id in the new parser — the CR-04 class) | mitigate | **No id table exists in this file.** The block is skipped by its length varint only, proven by the two-frames-differing-in-one-byte test, not by a grep. |
| T-69-05-08 (Info Disclosure, answering a specific reason code) | accept | As planned. `0x81` is the MQTT 5.0 answer for this condition and discloses nothing about credentials or topology. |
| T-69-05-SC (dependency substitution) | mitigate | Zero packages installed; `go.mod`/`go.sum`/`vendor/` diff empty. |

## Threat Flags

None — no new network endpoint, auth path, file access pattern or schema change at a trust
boundary. Both changes strictly narrow what the proxy will forward uninspected, and add an
answer where there was silence.

## Known Stubs

None. The inert `parseV5SubscribeFrame` / `connectFromV5Packet` bodies used to establish RED
were replaced within the same commit; no stub was ever committed.

## Self-Check: PASSED

- `internal/app/server/proxy_v5_rawsubscribe.go`, `proxy_v5_rawsubscribe_test.go` and
  `proxy_v5_connect_fail_test.go` all exist in `/Users/khundeck/working/meshtk`
- commits `75f8990`, `8d5071f`, `3848d6b`, `5dbdffc` all present on `fix/shared-chain-hardening`
  (branch is 19 ahead of `origin/main`; working tree clean)
- `69-05-SUMMARY.md` written to the phase directory

## Left For Later

- **69-06** opens the PR and vendor-syncs `apps/run.mqtt/meshtk`. This plan is the last one that
  touches the upstream source, so the branch is now complete at 19 commits.
- **69-07 must grep production for `action=MQTT5_SUBSCRIBE_HEADER_FAIL` and expect ZERO.** A
  non-zero count is accepted risk T-69-05-04 turning real: it names a client sending a SUBSCRIBE
  whose length prefixes contradict its own bytes, with `frame_bytes=` and `reason=` saying which
  prefix disagreed. Those sessions now end — mosquitto would have ended them a hop later anyway.
- **69-07 should count `action=MQTT5_PARSE_FAIL` lines carrying `answered=0x81`.** Any non-zero
  count is a client whose CONNECT the codec refuses; before this plan those clients were
  hot-retrying against a mute socket and were invisible except as connection churn. A rising
  count from one `ip=` is the WR-02 retry loop **visible for the first time**.
- 69-07 should also confirm no `client_id=` on the header-fail line came back **quoted** — a
  quoted value is the 69-03 sanitizer reporting a tamper attempt, not a bug.
- **WR-03 remains open** (both relay paths handing mosquitto frames the proxy knows are
  malformed) and is not in MQFX-04.
