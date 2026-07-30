---
phase: 69-meshtk-shared-chain-hardening
reviewed: 2026-07-30T16:07:09Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - apps/run.mqtt/meshtk/internal/app/server/cmd.go
  - apps/run.mqtt/meshtk/internal/app/server/inspect.go
  - apps/run.mqtt/meshtk/internal/app/server/inspect_v5.go
  - apps/run.mqtt/meshtk/internal/app/server/logsafe.go
  - apps/run.mqtt/meshtk/internal/app/server/proxy.go
  - apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go
  - apps/run.mqtt/meshtk/internal/app/server/proxy_v5_rawpublish.go
  - apps/run.mqtt/meshtk/internal/app/server/proxy_v5_rawsubscribe.go
  - apps/run.mqtt/meshtk/internal/app/server/rules.go
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 69: Code Review Report

**Reviewed:** 2026-07-30T16:07:09Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

This phase closes five/six defects across the MQTT broker-proxy: a nil-cipher guard
in `RewritePayloadString`, in-place `meshtastic.Data` mutation to preserve message
metadata, per-connection `recover()`, Last-Will strip on both codecs, a `logSafe`
sanitizer, a topic-alias guard on the hand-parsed PUBLISH path, and
property-agnostic SUBSCRIBE + version-correct CONNECT failure answers.

I traced every byte-boundary in the two hand-parse files, audited every
`InspectorLogger` call site for unsanitized client-controlled strings, and checked
the new rewrite/recover/will paths for nil-dereference and panic reintroduction.
The build is clean (`go build -mod=mod`) and the full package test suite passes
(`go test` OK, 0.558s).

**Verification of the flagged focus areas:**

- **Byte-boundary parsing (`proxy_v5_rawpublish.go`, `proxy_v5_rawsubscribe.go`):**
  Correct. Every index access is bounds-guarded; `scanV5PublishAlias`, `skipV5PropStringOrBinary`,
  `parseV5PublishFrame` and `parseV5SubscribeFrame` all reject truncation with an
  error and no partial view, `decodeV5Varint` has the 4-byte termination guard, the
  `end != len(frame)` invariant is enforced on both, and the property block is
  skipped whole so the alias walk cannot move the payload boundary. No out-of-bounds
  or off-by-one found.
- **`logSafe` injection-safety:** Sound against the stated threat (grep-line
  forgery). `\n`, `\r`, all C0 controls and DEL are stripped before any output, and
  the conditional-quoting preserves the `key=value, key=value` grammar. One residual
  gap in the C1 range — WR-02 below.
- **New nil-deref / panic paths:** None introduced. `RewritePayloadString`'s two new
  nil guards (`Decoded`, `Cipher`) close CR-01; `recoverConn` guards every
  dereference in the deferred handler; `setPublishPayload` and `AllowMQTTControl`
  nil-dispatch across all four `RawPacket` members; the paho.golang error values
  interpolated with `%v` were confirmed integer/wrapped-IO only (no client bytes).

No BLOCKER-class defect was proven. Two WARNINGs and two INFO items follow.

## Warnings

### WR-01: Codec-parsed PUBLISH with non-`*v5.Publish` content is forwarded uninspected

**File:** `apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go:396-400`
**Issue:** In `handleV5PublishUplink`, when `v5.ReadPacket` succeeds but the content
type-assertion fails, the frame is relayed to the broker without inspection:

```go
p, ok := cp.Content.(*v5.Publish)
if !ok {
    n.InspectorLogger.Warnf("action=MQTT5_PARSE_FAIL, ip=%s, mqtt_type=PUBLISH, reason=PUBLISH frame parsed as %T", socketAddr, cp.Content)
    return n.writeToBackend(backendConn, frame)   // <-- forwards UNINSPECTED
}
```

This is the exact inspection-bypass class (uninspected PUBLISH → RF flood-radius
control skipped) that CR-04 and this whole phase exist to close. It is unreachable
through the socket today (`v5.ReadPacket` dispatches on the same fixed-header nibble
`readFrame` already confirmed is `0x3`/PUBLISH, so `Content` is always `*v5.Publish`),
but its own sibling on the CONNECT path — `connectFromV5Packet` — documents the
identical "unreachable through the socket today" reasoning and still **fails closed**
(answers, returns `false`). This arm is the odd one out: it should drop the
connection to match the file's stated fail-closed posture, not forward the frame.

**Fix:** Fail closed like `connectFromV5Packet` — drop rather than relay:
```go
p, ok := cp.Content.(*v5.Publish)
if !ok {
    n.InspectorLogger.Warnf("action=MQTT5_PARSE_FAIL, ip=%s, mqtt_type=PUBLISH, reason=PUBLISH frame parsed as %T", socketAddr, cp.Content)
    return false   // do not forward an uninspected PUBLISH
}
```

### WR-02: `logSafe` does not strip C1 control characters (U+0080–U+009F)

**File:** `apps/run.mqtt/meshtk/internal/app/server/logsafe.go:52-61`
**Issue:** The sanitizer's stated purpose is to remove "the runes that can forge a
line or scramble a terminal," but its filter only covers C0 (`r < 0x20`) and DEL
(`r == 0x7f`). The C1 control block U+0080–U+009F is not removed and does not contain
any of the quote-triggering bytes (`space , " =`), so a client-controlled username,
client id or topic carrying e.g. U+009B (CSI) or U+0085 (NEL) passes through
byte-identically into the `SimpleFormatter` log line. This cannot forge a new
grep-parsed line (grep splits on `0x0A` only, which is stripped), so it is not the
WR-05 forgery vector — but a terminal tailing the raw/rotated log can interpret C1
sequences, which is precisely the "scramble a terminal" outcome the function claims
to prevent.

**Fix:** Extend the removal predicate to the C1 range:
```go
if r < 0x20 || r == 0x7f || (r >= 0x80 && r <= 0x9f) {
    modified = true
    return -1
}
```

## Info

### IN-01: `AUTH_REJECT ... err=%v` interpolates the authenticator error without `logSafe`

**File:** `apps/run.mqtt/meshtk/internal/app/server/inspect.go:139`, `apps/run.mqtt/meshtk/internal/app/server/inspect_v5.go:85`
**Issue:** The 69-03 sweep wrapped the `username` field in `logSafe` on these two
AUTH_REJECT lines but left the trailing `err=%v` raw. `err` originates from
`CacheAuthenticator.Verify` → `store.Fetch` (DynamoDB) or the static circuit-breaker
string. I confirmed those errors describe the operation/table and do not echo the
client-controlled username key, so this is not a live forgery vector today. It is
noted only because it is the one interpolated value on a WR-05-class line that is not
routed through the sanitizer, and a future authenticator that wraps the username into
its error would silently reopen the finding. Low risk; document the invariant or wrap
defensively.

**Fix:** Either add a comment pinning "Verify errors must never embed the username,"
or wrap: `logSafe(fmt.Sprintf("%v", err))`.

### IN-02: Vendored `meshtk` copy is missing `paho.golang` (pre-existing / environmental)

**File:** `apps/run.mqtt/meshtk/vendor/modules.txt`
**Issue:** `go.mod` declares `github.com/eclipse/paho.golang v0.23.0` (the v5 codec
used throughout the reviewed files) but `vendor/` only contains
`paho.mqtt.golang`, so a default `go build` (which selects `-mod=vendor` because a
`vendor/` dir exists) fails with "import lookup disabled by -mod=vendor." The build
only succeeds with `-mod=mod`. This predates Phase 69 (the v5 import arrived in
Phase 68, commit `6bbe18c1`) and this directory is a copy-at-build overlay of
upstream `~/working/meshtk`, so it is almost certainly resolved by the real build
pipeline rather than this vendored snapshot. Flagged for visibility only — outside
Phase 69's change scope and consistent with the "import errors are environmental"
note in the review brief.

**Fix:** If this overlay is ever built directly, run `go mod vendor` so the v5 codec
is present, or ensure the copy-at-build step re-vendors.

---

_Reviewed: 2026-07-30T16:07:09Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
