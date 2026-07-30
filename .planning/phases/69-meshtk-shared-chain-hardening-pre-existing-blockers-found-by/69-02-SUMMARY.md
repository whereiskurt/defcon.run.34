---
phase: 69-meshtk-shared-chain-hardening-pre-existing-blockers-found-by
plan: 02
subsystem: meshtk-proxy
tags: [meshtk, mqtt, security, dos, resilience, upstream]
status: complete
requirements: [MQFX-01]
requires:
  - "69-01 (tree serialization only, not content) — same upstream branch fix/shared-chain-hardening"
provides:
  - "recoverConn(label, conn) — per-connection panic containment helper"
  - "action=PANIC_RECOVERED — production telemetry line with label, remote, panic value and stack"
  - "recover deferred at all four per-connection goroutine entries + both accept-loop spawns"
  - "proxy_recover_test.go — 3 containment tests (4 assertion points) across both codecs and both directions"
affects:
  - /Users/khundeck/working/meshtk/internal/app/server/proxy.go
  - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5.go
  - /Users/khundeck/working/meshtk/internal/app/server/cmd.go
tech-stack:
  added: []
  patterns:
    - "deferred recover at goroutine ENTRY, never per loop iteration — blast radius is one connection, never one packet"
    - "innermost-recover-wins labelling so v5 crashes are attributable to the v5 codec"
    - "panic value + stack routed through the QUOTING formatter (logrus TextFormatter), never the non-quoting SimpleFormatter"
    - "armable test double (atomic) so one server panics on connection 1 and serves connection 2 normally"
key-files:
  created:
    - /Users/khundeck/working/meshtk/internal/app/server/proxy_recover_test.go
  modified:
    - /Users/khundeck/working/meshtk/internal/app/server/proxy.go
    - /Users/khundeck/working/meshtk/internal/app/server/proxy_v5.go
    - /Users/khundeck/working/meshtk/internal/app/server/cmd.go
decisions:
  - "Recover at goroutine ENTRY only, never inside the frame loops — a per-iteration recover would keep serving a connection whose invariants just broke"
  - "handleProxyV5 gets its OWN recover even though it runs on handleProxy's goroutine, so the innermost recover wins and the label attributes the crash to the right codec"
  - "The stack goes through Config.Log (TextFormatter, quotes) and never through InspectorLogger (SimpleFormatter, no quoting) — proven non-forgeable with a newline-bearing panic value"
  - "recoverConn guards every dereference (nil conn, nil Config, nil Log) because a second panic inside a deferred recover handler is unrecoverable and would reintroduce the exact failure"
  - "assertRecovered takes the action token as a parameter — ONE checking implementation (cannot drift) while each call site states the production log contract it pins"
metrics:
  duration: ~20m
  tasks: 2
  files: 4
  completed: 2026-07-30
---

# Phase 69 Plan 02: Per-Connection Panic Containment (MQFX-01 Layer 3) Summary

Closed 68-REVIEW CR-01's third and last layer: a panic while serving one connection now
kills that connection and logs it loudly, instead of killing the process and dropping every
connected radio on the fleet. Unlike layers 1 and 2 (69-01), this layer is deliberately
independent of the nil-cipher bug — it must hold for the next nil dereference nobody has
found yet, which is the entire point of it.

## Upstream Branch

| Item | Value |
|------|-------|
| Repo | `/Users/khundeck/working/meshtk` (upstream, NOT `apps/run.mqtt/meshtk`) |
| Branch | `fix/shared-chain-hardening` — **extended**, not rebranched |
| Ahead of `origin/main` | 5 commits (3 from 69-01, 2 from this plan) |
| Pushed / PR'd / vendor-synced | **No** — 69-03..05 extend this branch, 69-06 opens the PR |

## Commits

| Sha | Message |
|-----|---------|
| `82e790f` | `fix(69-02): contain a panic to one connection with a per-goroutine recover` |
| `1182a2f` | `test(69-02): prove a panicking decider is contained per connection on both codecs` |

## The Shipped Log Line (69-07 greps for this in production)

Emitted from exactly **one** site — `recoverConn` in `proxy.go`
(`grep -c 'action=PANIC_RECOVERED' proxy.go` = 1):

```
n.Config.Log.Errorf("action=PANIC_RECOVERED, label=%s, remote=%s, panic=%v, stack=%s",
    label, remote, r, debug.Stack())
```

Captured verbatim from a real recovery (timestamp suppressed in the probe; production's
`TextFormatter` prepends `time="..."`):

```
level=error msg="action=PANIC_RECOVERED, label=proxy_uplink_v4, remote=198.51.100.66:44444, panic=client-controlled\nBLOCK forged line, stack=goroutine 4 [running]:\nruntime/debug.Stack()\n\t...\n"
```

**Grep target for 69-07:** `action=PANIC_RECOVERED`. Expected count in production is **zero**;
any non-zero count names a live crash with the codec (`label=`), the client (`remote=`) and a
stack in the same record.

The probe above deliberately panicked with a value containing a newline and a forged `BLOCK`
line. It renders as an escaped `\n` **inside the quoted `msg=`** and produces no second log
line — T-69-02-03 demonstrated rather than asserted. The whole record, stack included, is one
physical line.

## Where The Recover Lives

Six deferred sites — the four per-connection goroutines the plan requires, plus two
accept-loop backstops:

| File | Function | Label | Why it needs its own |
|------|----------|-------|----------------------|
| `proxy.go` | `handleProxy` | `proxy_uplink_v4` | 3.1.1 uplink; where the rules engine runs |
| `proxy.go` | `handleBackend` | `proxy_downlink_v4` | **spawned as its own goroutine** — the uplink recover cannot reach it |
| `proxy_v5.go` | `handleProxyV5` | `proxy_uplink_v5` | same goroutine as `handleProxy`, but the innermost recover wins so the label attributes the crash to the v5 codec |
| `proxy_v5.go` | `handleBackendV5` | `proxy_downlink_v5` | **spawned as its own goroutine** by `handleProxyV5` |
| `cmd.go` | `StartProxyServer` accept | `accept_proxy` | outermost backstop — anything that escapes a handler |
| `cmd.go` | `StartProtobufServer` accept | `accept_protobuf` | same class, same process |

Labels are **constants**, so a test asserting "the downlink recover fired" cannot silently
pass on an uplink recovery, and production greps have a fixed vocabulary instead of six
string literals that can drift.

### Ordering in `handleProxy`

The new defer is registered **after** the pre-existing cleanup closure, so LIFO runs the
recover **first** and the ConnTrack delete + `conn.Close()` still run afterwards on a
non-panicking goroutine. The ConnTrack delete is **not** duplicated — the original closure
owns it on both the normal and the recovered path.

### Deliberately NOT per iteration

There is no recover inside any frame loop, and the helper's doc comment says so. A
per-iteration recover would keep serving a connection whose invariants just broke. The blast
radius is one connection, never one packet (T-69-02-05).

### Nothing inside `recoverConn` may panic

A second panic raised inside a deferred recover handler cannot be recovered by that frame and
would kill the process — reintroducing the exact failure the function exists to prevent. So
`conn`, `conn.RemoteAddr()`, `n`, `n.Config` and `n.Config.Log` are each guarded even where a
nil looks impossible. This was added as a correctness requirement, not a stylistic one.

## Tests (`proxy_recover_test.go`, new — 3 tests, 4 assertion points)

| Test | Proves |
|------|--------|
| `TestPanicInDeciderDoesNotEscapeHandleProxy` | real `handleProxy` + panicking decider: contained, logged, socket closed — then **disarms and serves a second connection through the same `ServerCmd`** whose CONNECT must reach the backend |
| `TestPanicInDeciderDoesNotEscapeHandleProxyV5` | the same contract on the real `handleProxyV5`, driven through the existing parity-test session harness against a real dialled backend |
| `TestPanicInDownlinkDoesNotEscape` (`3.1.1`, `v5` subtests) | a client socket whose `Write` panics — the direction the uplink recover **cannot** reach, since both downlink loops are their own goroutines |

Design notes that carry weight:

- **Every handler under test runs in its own goroutine**, as production runs it. That is what
  makes the assertion honest: an unrecovered panic in a goroutine cannot be caught by the test
  function, so a regression does not fail politely — it takes the test binary down.
- **Every assertion is on the recovered LOG LINE**, never merely on "the call returned". A call
  returns for many reasons (read error, Block decision, closed pipe) and they are
  indistinguishable from outside; only the recover writes that line.
- **One shared `assertRecovered`** so the 3.1.1 and v5 assertions cannot drift — the same
  reason 69-01's six-field comparison is a single helper. It checks the action token, the
  label, the injected sentinel, `stack=` and `remote=`.
- The **socket-closed** assertion distinguishes closure from **timeout**. A socket left open
  would also fail a read, just with a timeout; treating that as success would make the
  assertion vacuous.
- `panicDecider` is **armable** (atomic), which is what lets one server panic on connection 1
  and serve connection 2 normally — "the process keeps serving other connections" asserted on
  real forwarded bytes rather than on the absence of a crash.
- Existing harnesses reused rather than reinvented: `syncBuf`, `splitFrames`, `waitFrames`,
  `startV5Session`, `v5ParityServer`, `v5PublishFrame`, `nodeInfoEnvelope`, `captureLogger`,
  `newTestServerCmd`.

## RED Evidence (the tests are load-bearing)

The fix and the tests could not be ordered RED-first here — the tests reference the label
constants the fix introduces, so they would not compile against pre-fix code (the same
situation 69-01 hit with its signature change). RED was established instead by **deleting the
four deferred recovers** from the committed fix and re-running:

```
panic: meshtk-recover-test-sentinel-69-02

goroutine 9 [running]:
...server.(*panicDecider).Decide(...)
	proxy_recover_test.go:60
...server.(*ServerCmd).handleProxy(...)
	proxy.go:259
created by ...TestPanicInDeciderDoesNotEscapeHandleProxy
FAIL	github.com/whereiskurt/meshtk/internal/app/server
```

The binary **crashes** rather than reporting a failed assertion — which is precisely the
production failure mode being fixed. Files were restored with a targeted
`git checkout HEAD -- <files>`; `git stash` was not used (prohibited: the stash list is shared
across worktrees).

## Verification

| Gate | Result |
|------|--------|
| `go build ./...` | exit 0 |
| `go vet ./internal/app/server/` | exit 0 |
| `go test ./internal/app/server/ -count=1` | ok |
| `go test ./internal/app/server/ -count=3` | ok |
| `go test -race ./internal/app/server/ -count=1` | ok |
| `go test -run 'TestPanicIn' -count=1 -v` | 3 top-level PASS + 2 subtests |
| `go test -run TestV4SessionForwardBytesGolden -count=1` | ok |
| `git diff --stat origin/main -- proxy_v4_golden_test.go` | **empty — the golden was NOT edited** |
| `git diff --stat origin/main -- go.mod go.sum vendor/` | **empty — zero dependency change** |
| `git diff --stat origin/main -- internal/embedded/` | **empty — byte-untouched** |
| `grep -c 'recover()' proxy.go` | 2 (was 0 in non-test source before this plan) |
| `grep -c 'action=PANIC_RECOVERED' proxy.go` | 1 — single emission site |
| `grep -c 'PANIC_RECOVERED' proxy_recover_test.go` | 4 |
| `gofmt -l internal/app/server/` | `cmd.go inspect.go inspect_auth_test.go proxy_mqtt5_test.go` — the **same pre-existing** set as `origin/main`; `gofmt -d cmd.go` shows only pre-existing struct alignment and trailing whitespace in untouched regions. New file `proxy_recover_test.go` is gofmt-clean |

`internal/credcache` is out of the gate by design: `TestSingleflight_DeduplicatesConcurrentFetches`
is a pre-existing flake with zero meshtk dependencies (recorded in 68-06 and 69-01).

## Deviations from Plan

**None behavioral.** Two shape notes:

1. **`assertRecovered` takes the action token as a parameter.** The plan's acceptance criterion
   is `grep -c 'PANIC_RECOVERED' proxy_recover_test.go` ≥ 3, whose stated intent is "each of the
   three tests asserts on the log substring". A single shared helper met that intent but
   returned a literal count of 1. Duplicating the assertion logic three times would have been a
   regression — three copies can drift, one cannot. Passing the token from each call site
   satisfies the criterion literally (count 4), keeps ONE checking implementation, and makes each
   test state the production log contract it pins rather than hiding it three frames down.
2. **The plan named three tests; the third has two subtests** (`3.1.1`, `v5`) because the
   downlink contract must hold on both codecs and one test body cannot assert two independent
   containments cleanly. Still 3 top-level tests, as the criterion requires.

## Scope Boundary Honoured

- `proxy.go` was modified, which the plan explicitly allows: the frozen artifact is
  `proxy_v4_golden_test.go` (byte-unedited and green), not `proxy.go`. A deferred recover writes
  no byte on the wire.
- CR-02 (Last Will bypass), MQFX-04's warnings and the vendor sync are untouched — later plans.
- Nothing pushed, PR'd, vendor-synced or deployed. `apps/run.mqtt/meshtk` and
  `internal/embedded/` are byte-untouched.
- No package installed; `runtime/debug` is standard library.

## Threat Register Outcome

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-69-02-01 (DoS, panic kills the process) | mitigate | Closed at all four goroutine entries + both accept spawns; proven on both codecs and in the downlink direction. |
| T-69-02-02 (Repudiation, silent recovery) | mitigate | `action=PANIC_RECOVERED` with label, remote, panic value and stack; every test asserts on that line, not on the call returning. |
| T-69-02-03 (Repudiation, forged log lines) | mitigate | **Demonstrated**, not assumed: a panic value carrying `\nBLOCK forged line` renders escaped inside the quoted `msg=` and emits no second line. |
| T-69-02-04 (DoS, recover masks a bug into a reconnect loop) | accept | As planned — recovery is strictly per connection and always closes the socket, so a looping client is visible as repeated lines with the same `remote=`. |
| T-69-02-05 (DoS, per-iteration recover) | mitigate | Deliberately not done; recorded in the helper's doc comment and enforced by the absence of any recover inside the frame loops. |
| T-69-02-06 (Tampering, 3.1.1 byte drift) | mitigate | Golden byte-unedited (`git diff` empty) and green. |
| T-69-02-SC (dependency substitution) | mitigate | Zero packages installed; `go.mod`/`go.sum`/`vendor/` diff empty. |

## Threat Flags

None — no new network endpoint, auth path, file access pattern or schema change at a trust
boundary. The change strictly narrows the blast radius of an existing failure.

## Known Stubs

None.

## Self-Check: PASSED

- `internal/app/server/proxy_recover_test.go` exists in `/Users/khundeck/working/meshtk`
- commits `82e790f` and `1182a2f` both present on `fix/shared-chain-hardening`
- `69-02-SUMMARY.md` written to the phase directory

## Left For Later

- 69-03 through 69-05 extend this same upstream branch (strictly one at a time — the plans share
  one git working tree).
- 69-06 opens the PR and vendor-syncs `apps/run.mqtt/meshtk`.
- **69-07 must grep production for `action=PANIC_RECOVERED` and expect ZERO.** A non-zero count
  after the deploy names a live crash the fleet was previously eating as a full outage — the
  `label=` and `remote=` fields plus the stack make it diagnosable from the log alone.
