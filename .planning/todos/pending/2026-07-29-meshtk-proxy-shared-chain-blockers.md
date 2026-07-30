---
created: 2026-07-29T21:30:00Z
title: "meshtk proxy — 3 runtime-proven blockers live in prod (shared inspection chain)"
area: run.mqtt
priority: high
---

Phase 68's code review (`68-REVIEW.md`, status `issues_found`, 3 blocker / 13 warning)
runtime-proved three defects that are **live in production as meshtk v0.0.73** and sit in
the **shared** inspection chain — they affect the 3.1.1 path as well as the new v5 path, so
they are **pre-existing**, not regressions from phase 68. All three were previously logged
as "hardening candidates" (old CR-01 / CR-05 / WR-17); this review escalated them with
executed probes.

Kurt's call 2026-07-29: **hotfix all three first**, before the flash-registration work.

## CR-01 — remote whole-process kill (worst)
`RewriteHelloGoodbye` (`rules.go:152`) calls `ip.RewritePayloadString()` **unconditionally**
— outside the `ip.Track.Username == "public"` gate at `rules.go:164` — and that method
dereferences `*ip.Meshtastic.Cipher` (`inspect.go:368`), which is **nil for any decoded
(unencrypted) packet**. One authenticated PUBLISH of a plaintext `TEXT_MESSAGE_APP`
envelope panics the process. There is **no `recover()` anywhere in the proxy path**, so the
whole broker proxy dies and every radio drops. Proven trace:
`handleV5PublishUplink → decideV5Publish → rules.go:170`.
Two shipped test helpers (`proxy_v5_publish_test.go:66-68`, `proxy_v5_e2e_test.go:576-581`)
document the crash and pick fixtures that dodge it — so the green suite is not evidence.
Fix = gate the rewrite on an encrypted packet (or nil-check the cipher) **and** add a
`recover()` guard on the per-connection goroutine so no single frame can take the fleet down.

## CR-02 — Last Will bypasses the entire inspection chain
`inspectV5Connect` touches only `AuthMethod`, credentials and `TopicAliasMaximum`; the
CONNECT's Will payload is re-encoded to mosquitto untouched, never reaching the decider or
`RewriteHopLimit`. Proven: a `hop_limit=7 / hop_start=9` envelope reached the broker inside
a CONNECT — a total bypass of the RF flood-radius cap at `rules.go:119-127`. Affects both
codecs. Previously filed as `WR-17`.

## CR-03 — silent mesh data loss on every censored text message
`RewritePayloadString` rebuilds `Data{}` from three fields, dropping `want_response`,
`dest`, `source`, `request_id`, `reply_id` and `emoji` on **every** text message the censor
touches (the call is not gated on `username == "public"`). Proven by decrypting the
re-encrypted wire payload. The `Bitfield:` line added in phase 68 shows the class was
understood; the fix enumerated one field instead of preserving the message. Previously `CR-05`.

## Also in the review (13 warnings, not blockers)
Introduced by phase 68's own fixes: the CR-04 hand-parse path omits the topic-alias guard
its sibling has while claiming to mirror it "decision for decision" (proven `allowed=true`);
the WR-04 fix relays an unparseable SUBSCRIBE uninspected; both new relay paths hand
mosquitto frames known-malformed per MQTT 5.0 §2.2.2 (the e2e asserts the broker then
disconnects the client); an unparseable v5 CONNECT closes with **no CONNACK**, recreating
the retry loop phase 68 existed to fix; and `client_id`/`username`/`auth_method` are logged
unescaped through `SimpleFormatter`, making the `action=ALLOW`/`AUTH_REJECT` telemetry
forgeable (proven: one CONNECT → two log lines).

Code lives upstream at `/Users/khundeck/working/meshtk` (main @ `5769031`) and vendor-syncs
byte-identical into `apps/run.mqtt/meshtk/`. Phase-68 test gate: `go test ./internal/app/server/`
(`internal/credcache` has a pre-existing singleflight flake). Reusable prod verifier:
`.planning/phases/68-*/68-08-probes/mqtt5_probe.py`.

**Next command:** `/gsd-plan-phase 69`
