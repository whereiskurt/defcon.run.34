---
status: complete
phase: 68-mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa
source: [68-VERIFICATION.md, 68-REVIEW.md]
started: 2026-07-29T22:05:00Z
updated: 2026-07-30T04:56:53Z
---

## Current Test

[testing complete]

## Tests

### 1. DECISION — pre-existing shared-chain nil-cipher panic (68-REVIEW CR-01)
expected: Nil-guard at rules.go `RewriteHelloGoodbye`, `inspect.go` `RewritePayloadString`, plus a per-connection `recover()`; regression test on both codecs.
⚠️ Do NOT probe against production — one crafted PUBLISH with a DECODED (unencrypted) `TEXT_MESSAGE_APP` ServiceEnvelope kills the whole proxy process and drops every connected radio.
result: pass
notes: DECIDED 2026-07-29 — FIX (do not defer). Kurt chose to hotfix all three shared-chain blockers before DEF CON 34, ahead of the flash-registration work. Carried into Phase 69.

### 2. DECISION — pre-existing Data field loss on every rewritten TEXT_MESSAGE (68-REVIEW CR-03)
expected: `RewritePayloadString` mutates `ip.Meshtastic.Decoded` in place instead of rebuilding a fresh `meshtastic.Data` from three fields, so 2.8 tapbacks, threaded replies, delivery-ACK requests and DM routing fields survive; `proto.Marshal`'s error stops being discarded with `_`.
result: pass
notes: DECIDED 2026-07-29 — FIX. Carried into Phase 69.

### 3. DECISION — pre-existing Last-Will inspection bypass (68-REVIEW CR-02)
expected: `WillFlag`/`WillTopic`/`WillMessage`/`WillProperties` cleared and logged in `inspectV5Connect`, mirrored in the 3.1.1 CONNECT branch — or the Will payload routed through `inspectMeshtastic` + `PacketDecider` with a Block refusing the CONNECT.
result: pass
notes: DECIDED 2026-07-29 — FIX. Carried into Phase 69.

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

None that belong to Phase 68. All three items are **pre-existing** defects in the shared
inspection chain (both codecs), independently confirmed by `68-REVIEW.md` (runtime probes in
an isolated module copy) and `68-VERIFICATION.md` (greps against `git archive origin/main`).
None falsifies a Phase-68 must-have — codec symmetry is precisely why SC3's "works
identically on v5" survives them. They are tracked in
`.planning/todos/pending/2026-07-29-meshtk-proxy-shared-chain-blockers.md` and scheduled as
**Phase 69**.

Phase 68's own deliverable is complete and verified: 64/64 must-haves, all four ROADMAP
Success Criteria machine-verified on the production wire at meshtk v0.0.73.

Accepted limitation (from 68-08, deliberately named rather than papered over): the
nine-minute Android idle UAT bar is **structurally unreachable** with the 2.8 client — it
publishes every ~67s, so it never idles past the reaper window. CR-02 is instead proven at a
guaranteed 480s by the `cr02-idle` probe, which FAILED pre-deploy and PASSED post-deploy at
the identical duration.
