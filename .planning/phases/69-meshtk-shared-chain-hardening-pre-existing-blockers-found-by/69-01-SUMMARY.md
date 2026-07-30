---
phase: 69-meshtk-shared-chain-hardening-pre-existing-blockers-found-by
plan: 01
subsystem: meshtk-proxy
tags: [meshtk, mqtt, security, dos, data-integrity, upstream]
status: complete
requirements: [MQFX-01, MQFX-02]
requires:
  - upstream meshtk origin/main @ 609a5c5 (post meshtk#27 + #28)
provides:
  - "RewritePayloadString() error — nil-safe, field-preserving, error-honest"
  - "RewriteHelloGoodbye declines a rewrite it cannot perform"
  - "rules_rewrite_test.go — 5 cross-codec regression tests"
  - "upstream branch fix/shared-chain-hardening (plans 69-02..05 extend it)"
affects:
  - /Users/khundeck/working/meshtk/internal/app/server/inspect.go
  - /Users/khundeck/working/meshtk/internal/app/server/rules.go
tech-stack:
  added: []
  patterns:
    - "in-place mutation of the parsed protobuf message instead of a field-enumerating rebuild"
    - "matcher-level decline + helper-level guard (two independent layers for one crash)"
    - "deferred-recover anti-panic wrapper so a SIGSEGV regression is a named test failure"
key-files:
  created:
    - /Users/khundeck/working/meshtk/internal/app/server/rules_rewrite_test.go
  modified:
    - /Users/khundeck/working/meshtk/internal/app/server/inspect.go
    - /Users/khundeck/working/meshtk/internal/app/server/rules.go
    - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5_publish_test.go
    - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5_e2e_test.go
decisions:
  - "Signature changed (error, bool) -> error: the bool was false on every return path"
  - "Guard at BOTH layers (matcher + helper), not one — the matcher keeps the packet away from the crash site, the helper survives a future matcher edit"
  - "Layer 3 of CR-01 (a recover() around the per-connection goroutine) is deliberately NOT in this plan"
metrics:
  duration: ~25m
  tasks: 3
  files: 5
  completed: 2026-07-30
---

# Phase 69 Plan 01: Shared-Chain Criticals (Nil Cipher + Data Field Loss) Summary

Closed the nil-cipher dereference that let one authenticated plaintext text message
SIGSEGV the whole proxy process, and the three-field `Data` rebuild that silently stripped
`reply_id`/`emoji`/`dest`/`source`/`request_id`/`want_response` off every rewritten text
message on the fleet — both proven fixed by a decrypt round trip on **both** codecs.

## Upstream Branch

| Item | Value |
|------|-------|
| Repo | `/Users/khundeck/working/meshtk` (upstream, NOT `apps/run.mqtt/meshtk`) |
| Branch | `fix/shared-chain-hardening` |
| Base sha | `609a5c547a57442c17672264c7d5497d9c6f47e7` (`origin/main`, post meshtk#27 + #28) |
| Pushed / PR'd / vendor-synced | **No** — 69-02..05 extend this branch, 69-06 opens the PR |

Branching from `origin/main` was load-bearing: the `release/2026-07-26-230957` checkout
carries a stale v0.0.66 overlay with no v5 files, and branching from it would have silently
reverted meshtk#22/#23/#27.

## Commits

| Sha | Message |
|-----|---------|
| `72c5506` | `fix(69-01): make RewritePayloadString nil-safe, field-preserving and error-honest` |
| `2f62e61` | `fix(69-01): make RewriteHelloGoodbye decline a rewrite it cannot perform` |
| `ce07c66` | `test(69-01): pin the nil-cipher non-crash and six-field preservation on both codecs` |

## What Changed

### Task 1 — `inspect.go` `RewritePayloadString`

- **Signature `(error, bool)` → `error`.** The `bool` was `false` on every existing return
  path, so it carried no information, and its only caller discarded both values (WR-08).
- **Two fail-fast guards** ahead of any dereference, keeping the PKI guard first: nil
  `Meshtastic.Decoded` and nil `Meshtastic.Cipher` each return a descriptive error. The doc
  comment records that `Cipher` is assigned in exactly one place — `inspectMeshtastic`'s
  *decrypt* branch — so a packet that arrived with a decoded (unencrypted) payload reaches
  the rewrite with it nil. That is CR-01, and with no `recover()` on the proxy read loop it
  killed the process and every connected radio, not one connection.
- **In-place mutation replaces the three-field rebuild.** `ip.Meshtastic.Decoded` gets the
  censored bytes assigned to `Payload` and *that* message is marshalled, so every other
  field — plus protobuf unknown fields — survives. `Portnum` and `Bitfield` come along for
  free, which **subsumes** rather than removes the `Bitfield` line meshtk#21 added for the
  2.8 pre-hop drop. The comment states why enumerating fields was the wrong fix shape.
- **Ordering is load-bearing** and commented as such: the marshal happens *before*
  `PayloadVariant` is reassigned to the encrypted variant, because on a decoded packet the
  parsed `Data` is reachable through that same variant.
- **`proto.Marshal`'s error is wrapped and returned** instead of discarded with `_`.
- `ip.Meshtastic.Payload` still holds the pre-rewrite bytes (`WriteDecisionLog` reads it) —
  assigning a new slice header to `data.Payload` does not disturb it.

### Task 2 — `rules.go` `RewriteHelloGoodbye`

- Early-return condition extended with `!ip.Meshtastic.WasEncrypted` and
  `ip.Meshtastic.Cipher == nil`; existing conditions and their order untouched. The word
  replacement stays gated on the `public` username — neither widened nor narrowed
  (`grep -c 'Username == "public"'` = 1).
- Comment records why declining is the only honest outcome (the censor's contract is
  re-encrypt-then-forward; an unencrypted packet has no cipher to re-encrypt with) **and**
  why the defect was fleet-wide rather than rare: the replacement was username-gated but the
  rewrite *call* never was, so every text message from every user traversed both the crash
  site and the field-dropping rebuild.
- The error from `RewritePayloadString` is now consumed — logged via `ip.Log.Errorf` with a
  `payload censor failed` prefix, then `return false`, the same shape `RewriteHopLimit` uses
  for `RemarshalEnvelope`. Returning true after a failed rewrite is the meshtk#22 silent-no-op
  class (rule reports Rewrote, original bytes forward).

### Task 3 — `rules_rewrite_test.go` (new, 5 tests / 9 cases)

| Test | Proves |
|------|--------|
| `TestRewritePayloadStringNilCipherReturnsError` | error returned, no panic, PUBLISH payload byte-unchanged, `WireRewritten` not set |
| `TestRewritePayloadStringPreservesDataFields` | six fields survive a decrypt round trip off the forwarded **3.1.1** bytes |
| `TestDataFieldsSurviveRewriteOnV5Uplink` | the SAME assertion driven through the real `handleV5PublishUplink` (ROADMAP SC-2 "on both codecs") |
| `TestRewriteHelloGoodbyeDeclinesDecodedTextMessage` | matcher returns false on 3.1.1 **and** v5, nothing mutated |
| `TestDecodedTextMessageSurvivesBothCodecs` | `PacketDecider.Decide` returns Allow on 3.1.1; `handleV5PublishUplink` returns true and forwards bytes on v5 |

- The six-field comparison is **one shared helper** (`assertSixFields`) called by both
  preservation tests, so the 3.1.1 and v5 assertions cannot drift and a regression names the
  same field on either codec. Each field is asserted individually with a message naming the
  user-visible feature it breaks (tapbacks, threaded replies, delivery ACKs, DM routing).
- `mustNotPanic` (deferred recover → `t.Fatalf` with the stack) wraps every call that used to
  SIGSEGV, so a regression is a named failure instead of a crashed test binary.
- Existing harnesses reused, not reinvented: `newHopTestPacket`'s shape for 3.1.1,
  `v5PublishServer` / `v5PublishFrame` / `wireEnvelope` / `writerConn` for v5,
  `DecryptMeshtastic` for the round trip.
- `addTestChannel` uses reflection to grow `config.Meshtastic.Channels` because it is a slice
  of an **anonymous** struct — a composite literal would have to repeat the field tags byte
  for byte (one of them even carries a trailing space) and would break on any tag edit.
  `DecryptMeshtastic` indexes `Channels` in lockstep with `Ciphers`, so both grow together.
- Two stale helper comments corrected (comment lines ONLY — `git diff | grep '^-[^-]'`
  returns 7 lines, all comments, zero assertions or fixtures):
  - `proxy_v5_publish_test.go` `nodeInfoEnvelope` — no longer claims a TEXT_MESSAGE fixture
    is unusable; the choice is now about keeping the fixture free of channel-key setup.
  - `proxy_v5_e2e_test.go` `e2eEnvelope` — keeps the still-true `BlockInvalidEncryption`
    reason, drops the "panics on a non-encrypted packet" claim.

## RED Evidence (before the fix)

A throwaway probe (`zz_red_probe_test.go`, run against unmodified `origin/main` code, then
deleted — never committed) reproduced both defects exactly as 68-REVIEW described:

```
=== RUN   TestRedProbeFieldLoss
    WIRE Data: payload="bye there" want_response=false dest=0x00000000 source=0x00000000
               request_id=0x00000000 reply_id=0x00000000 emoji=0
    RED CONFIRMED: fields lost across the rewrite
--- FAIL: TestRedProbeFieldLoss

=== RUN   TestRedProbeNilCipherPanic
    RED CONFIRMED: panic judging a decoded TEXT_MESSAGE:
                   runtime error: invalid memory address or nil pointer dereference
--- FAIL: TestRedProbeNilCipherPanic
```

The committed tests cannot themselves be run against pre-fix code — the signature change from
`(error, bool)` to `error` is part of the fix, so they would not compile. The probe is how RED
was established. **The rules.go guard was separately proven load-bearing**: reverting only
`rules.go` to `origin/main` (with the fixed `inspect.go` in place) fails both decline cases —

```
--- FAIL: TestRewriteHelloGoodbyeDeclinesDecodedTextMessage/3.1.1
        matcher entered a rewrite it cannot perform (no channel cipher)
--- FAIL: TestRewriteHelloGoodbyeDeclinesDecodedTextMessage/v5
        matcher entered a rewrite it cannot perform (no channel cipher)
```

## Six-Field Before / After (v5 uplink, decrypted off the forwarded frame)

Sender's `Data`, and what the mesh actually receives after the rewrite:

| Field | Sender | POST-FIX wire | PRE-FIX wire (CR-03) |
|-------|--------|---------------|----------------------|
| `portnum` | `TEXT_MESSAGE_APP` | `TEXT_MESSAGE_APP` | `TEXT_MESSAGE_APP` |
| `payload` | `"hi there"` | `"bye there"` ← the only field meant to change | `"bye there"` |
| `want_response` | `true` | `true` | `false` **LOST** |
| `dest` | `0x11112222` | `0x11112222` | `0x00000000` **LOST** |
| `source` | `0x33334444` | `0x33334444` | `0x00000000` **LOST** |
| `request_id` | `0x55556666` | `0x55556666` | `0x00000000` **LOST** |
| `reply_id` | `0x77778888` | `0x77778888` | `0x00000000` **LOST** |
| `emoji` | `1` | `1` | `0` **LOST** |
| `bitfield` | `1` | `1` | `1` (the one field meshtk#21 had enumerated) |

Captured from the real `handleV5PublishUplink` path: encrypted six-field TEXT_MESSAGE_APP in,
forwarded frame re-parsed with `v5.ReadPacket`, `ServiceEnvelope` unmarshalled, encrypted
payload decrypted with `DecryptMeshtastic`.

## Verification

| Gate | Result |
|------|--------|
| `go build ./...` | exit 0 |
| `go vet ./internal/app/server/` | exit 0 |
| `go test ./internal/app/server/ -count=1` | ok |
| `go test ./internal/app/server/ -count=3` | ok |
| `go test ./internal/app/server/ -race -count=1` | ok |
| 5 named tests (`-count=1 -v`) | 9 PASS lines (5 top-level + 4 subtests) |
| `go test -run TestV4SessionForwardBytesGolden -count=1` | ok |
| `git diff --stat origin/main -- proxy_v4_golden_test.go` | **empty — the golden was NOT edited** |
| `git diff --stat origin/main -- go.mod go.sum vendor/` | **empty — zero dependency change** |
| `git diff --name-only origin/main -- internal/app/server/` | exactly the 5 expected files |
| `gofmt -l internal/app/server/` | `cmd.go inspect.go inspect_auth_test.go proxy_mqtt5_test.go` — the **same pre-existing** set as `origin/main`; no new offender, and `gofmt -d inspect.go` shows only the pre-existing `Meshtastic` struct alignment |

`internal/credcache` is out of the gate by design: `TestSingleflight_DeduplicatesConcurrentFetches`
is a pre-existing flake with zero meshtk dependencies (recorded in 68-06).

## Deviations from Plan

**None.** All three tasks executed as written. Two small shape notes, neither a behavior change:

1. The plan's acceptance criterion `grep -c 'Username == "public"' rules.go` must return 1. The
   first draft of the new comment contained that literal string and made the grep return 2; the
   comment was reworded to "gated on the `public` username" so the criterion holds literally.
2. `addTestChannel` uses `reflect` rather than a composite literal, because the config field is a
   slice of an anonymous struct whose tags would otherwise have to be duplicated exactly. Reason
   documented in the test file.

## Scope Boundary Honoured

- CR-01's **layer 3** (a `recover()` around the per-connection goroutine in `proxy.go` /
  `proxy_v5.go`) is deliberately NOT in this plan — the plan scopes MQFX-01 to "guard layers 1
  and 2". A panic anywhere else in the read loop still takes the process; that belongs to a
  later plan in this phase.
- CR-02 (Last Will bypass) is untouched — a separate plan.
- Nothing pushed, PR'd, vendor-synced or deployed. `apps/run.mqtt/meshtk` and
  `internal/embedded/` are byte-untouched.

## Threat Register Outcome

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-69-01-01 (DoS, nil-cipher deref) | mitigate | Closed at two layers, pinned on both codecs. Never probed against production. |
| T-69-01-02 (Tampering, Data field loss) | mitigate | Closed by in-place mutation, each field asserted individually after a decrypt round trip. |
| T-69-01-03 (Tampering, discarded errors) | mitigate | Marshal error propagated; matcher logs and returns false. |
| T-69-01-04 (Repudiation, silent censor failure) | accept | `ip.Log.Errorf` at the call site, as planned. |
| T-69-01-05 (Tampering, 3.1.1 byte drift) | mitigate | Golden byte-unedited and green. |
| T-69-01-06 (DoS, decoded plaintext no longer censored) | accept | It could never have been censored (the censor re-encrypts); the packet is still judged by every inspect rule and still clamped by `RewriteHopLimit`. |
| T-69-01-SC (dependency substitution) | mitigate | Zero packages installed; `go.mod`/`go.sum`/`vendor/` diff empty. |

## Threat Flags

None — no new network endpoint, auth path, file access pattern or schema change at a trust
boundary. The change strictly narrows what the rewrite path will attempt.

## Known Stubs

None.

## Self-Check: PASSED

- `internal/app/server/rules_rewrite_test.go` exists in `/Users/khundeck/working/meshtk`
- commits `72c5506`, `2f62e61`, `ce07c66` all present on `fix/shared-chain-hardening`
- `69-01-SUMMARY.md` written to the phase directory

## Left For Later

- 69-02 through 69-05 extend this same upstream branch (strictly one at a time — five plans
  sharing one git working tree).
- 69-06 opens the PR and vendor-syncs `apps/run.mqtt/meshtk`.
- A `recover()` on the per-connection goroutine (CR-01 layer 3) is still absent.
