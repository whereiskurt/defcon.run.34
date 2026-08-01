---
phase: 72-bot-hardening-clickable-one-time-awards-fail-closed-guardrai
plan: 07
subsystem: meshtk
tags: [meshtk, go, fleet, lyrics, semaphore, backpressure, guardrail, observability, ast-guard, race-detector, tracked-overlay]

# Dependency graph
requires: ["72-06"]
provides:
  - "a global non-blocking cap of 12 concurrent lyric performances (MESHTK_LYRICS_MAX_CONCURRENT)"
  - "an over-cap reply that does NOT burn the requester's encore cooldown"
  - "guardRefusalMessage: an outage degrades in-persona, a policy block keeps the canned refusal"
  - "the MESHTK_GUARDRAIL_OUTAGE marker token on all four outage branches"
  - "outage logging on the status and decode branches, which previously logged nothing"
affects: [72-04, 72-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Buffered-channel semaphore sized ONCE at construction, with nil meaning unlimited so a bare &FleetCmd{} in a unit test degrades instead of panicking or refusing everything"
    - "Non-blocking acquire AND non-blocking release: the drain's select/default makes an over-release harmless rather than a deadlock"
    - "Degrading a reply by swapping the message ARGUMENT at an existing call site, so an AST call-site census stays pinned"
    - "A plain-text log marker written literally at each emission site rather than hoisted into a constant, because the consumer is a plain-text CloudWatch metric filter and a grepping operator"

key-files:
  created:
    - apps/run.mqtt/meshtk/internal/app/fleet/lyrics_semaphore_test.go
  modified:
    - apps/run.mqtt/meshtk/internal/app/fleet/cmd.go
    - apps/run.mqtt/meshtk/internal/app/fleet/guard.go
    - apps/run.mqtt/meshtk/internal/app/fleet/guard_test.go

key-decisions:
  - "os.Getenv, not os.LookupEnv, for MESHTK_LYRICS_MAX_CONCURRENT — the OPPOSITE of 72-06's MESHTK_RICKY_CHALLENGE call. There, explicitly-empty was a kill switch, so unset and empty had to differ. Here a zero cap would silence ricky entirely, so there is deliberately NO kill switch and unset/empty/non-numeric/non-positive must all mean 12"
  - "The slot is acquired BEFORE the cooldown is marked. Marking first would lock a refused requester out for ten minutes and hand them no song at all — the worst of both mechanisms"
  - "The over-cap refusal uses the PLAIN send path, keeping handleLyricsChat's reliable census at exactly 3; a dropped 'stage is full' costs the requester nothing but a retry"
  - "Release is a non-blocking drain, so an over-release is a no-op rather than a deadlock — the helper is called from four places and one double-call would otherwise wedge the whole cap permanently"
  - "The MESHTK_GUARDRAIL_OUTAGE token is written literally in each of the four log format strings rather than hoisted into a constant: the consumer is 72-04's PLAIN-TEXT metric filter, and a constant would make the token appear once in the file where neither grep nor a reviewer would find it at the emission sites"
  - "The build-error branch was given the marker too, though the plan enumerated only three. A malformed guardrail URL is an outage that would otherwise fail closed in total silence with no alarm"

requirements-completed: []  # BOT-02 and BOT-03 both still need the 72-09 release. Not marked here.

coverage:
  - id: D1
    description: "The cap defaults to 12 and a missing, blank, non-numeric or non-positive override falls back to 12, never to zero"
    requirement: BOT-02
    verification:
      - kind: unit
        ref: "internal/app/fleet/lyrics_semaphore_test.go#TestLyricsMaxConcurrentFallsBackToDefaultNeverZero (table over '', '   ', 'banana', '0', '-1', '12.5')"
        status: pass
      - kind: unit
        ref: "internal/app/fleet/lyrics_semaphore_test.go#TestLyricsMaxConcurrentHonorsPositiveOverride"
        status: pass
    human_judgment: false
  - id: D2
    description: "Acquiring the cap-th slot succeeds, the next fails, and one release lets the next through; acquisition never blocks"
    requirement: BOT-02
    verification:
      - kind: unit
        ref: "internal/app/fleet/lyrics_semaphore_test.go#TestLyricSlotAcquireCapsAndRecoversAfterRelease"
        status: pass
      - kind: unit
        ref: "internal/app/fleet/lyrics_semaphore_test.go#TestLyricSlotsIsASingleProcessWideChannel (no fleet index anywhere in the acquire path)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A slot is released on every exit path, and a nil channel or an over-release is harmless"
    requirement: BOT-02
    verification:
      - kind: unit
        ref: "internal/app/fleet/lyrics_semaphore_test.go#TestLyricSlotReleasedOnEveryExitPath (AST: release >= 3, acquire == 1)"
        status: pass
      - kind: unit
        ref: "internal/app/fleet/lyrics_semaphore_test.go#TestLyricSlotNilChannelDegradesToUnlimited"
        status: pass
      - kind: unit
        ref: "internal/app/fleet/lyrics_semaphore_test.go#TestLyricSlotReleaseWithoutAcquireIsHarmless"
        status: pass
    human_judgment: false
  - id: D4
    description: "An over-cap requester gets a reply and does NOT burn their cooldown"
    requirement: BOT-02
    verification:
      - kind: unit
        ref: "internal/app/fleet/lyrics_semaphore_test.go#TestOverCapRefusalDoesNotBurnTheCooldown (AST: the acquire guard ends in a return AND precedes the LyricsResponded write)"
        status: pass
      - kind: unit
        ref: "internal/app/fleet/ack_mode_test.go#TestLyricsCooldownNotOncePerLifetime (plain sites >= 2; now 5)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Each of the four internally-generated outage reasons selects the degradation line; a policy reason and an empty reason keep the canned refusal"
    requirement: BOT-03
    verification:
      - kind: unit
        ref: "internal/app/fleet/guard_test.go#TestGuardRefusalMessageDistinguishesOutageFromPolicyBlock (7-row table)"
        status: pass
      - kind: unit
        ref: "internal/app/fleet/guard_test.go#TestGuardTextReportsOutageOnBadStatus (live httptest 502)"
        status: pass
      - kind: unit
        ref: "internal/app/fleet/guard_test.go#TestGuardTextReportsOutageOnUndecodableBody (live httptest non-JSON)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The degradation line does not disclose that a control is unavailable, and fits the 200-byte ceiling"
    requirement: BOT-03
    verification:
      - kind: unit
        ref: "internal/app/fleet/guard_test.go#TestGuardDegradedReplyDoesNotDiscloseTheControl (differs from cannedRefusal; free of guard/sidecar/filter/down/unavailable/error/offline/timeout/500/502; under chatHardLimit)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The marker token appears on outage branches in guard.go only, and never in cmd.go, so 72-04's metric counts outages rather than refusals"
    requirement: BOT-03
    verification:
      - kind: unit
        ref: "internal/app/fleet/guard_test.go#TestGuardOutageMarkerOnlyOnOutageBranches (guard.go count 4 >= 3; cmd.go count 0)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The pinned reply-path censuses survive: 3 reliable in handleLyricsChat, 3 reliable / 0 plain in FleetNodeHandler"
    requirement: BOT-03
    verification:
      - kind: unit
        ref: "internal/app/fleet/reply_retry_test.go#TestLyricsChatReliableSiteCensus"
        status: pass
      - kind: unit
        ref: "internal/app/fleet/reply_retry_test.go#TestOneShotReplyPathsUseReliableRetry"
        status: pass
      - kind: unit
        ref: "internal/app/fleet/guard_test.go#TestGuardReplySitesUseTheSelector (exactly 2 argument swaps, so neither site grew a branch)"
        status: pass
    human_judgment: false
  - id: D9
    description: "The change reaches prod: all seven files byte-identical between upstream and the monorepo tracked overlay, the new test file tracked"
    requirement: BOT-02
    verification:
      - kind: automated_ui
        ref: "per-file diff -q loop (7/7 identical); git ls-files count = 7; git status --porcelain '^??' count = 0"
        status: pass
    human_judgment: false
  - id: D10
    description: "Twelve concurrent performances genuinely bound aggregate RF airtime at a crowded con, and the over-cap line reads acceptably on a real radio"
    verification: []
    human_judgment: true
    rationale: "The arithmetic (12 x 58 / 214s = ~3.3 msg/s) is a model, not a measurement. Nothing is deployed by this plan; the airtime claim is only testable on hardware after the 72-09 release, ideally with more than twelve radios requesting the song at once."

# Metrics
duration: 5min
completed: 2026-07-31
status: complete
---

# Phase 72 Plan 07: meshtk backpressure + guardrail outage degradation Summary

**A crowd can no longer collapse the LoRa channel by all asking ricky for the same song
at once, and a guardrail that has stopped answering now says something different from a
guardrail that has decided to refuse you — to the player, and to the alarm.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-31T21:55:05Z
- **Completed:** 2026-07-31T22:00:29Z
- **Tasks:** 3 of 3
- **Files modified:** 3 changed + 1 created (in each of the two trees)

## The call-site census — before and after

Measured by AST walk over each whole `FuncDecl` (nested goroutine literals included),
`4223234` (72-06's HEAD) versus `c97fddb` (this plan's HEAD):

| Function | Path | Before | After | Guard |
|----------|------|--------|-------|-------|
| `handleLyricsChat` | `sendPKIReplyReliable` | **3** | **3** | `TestLyricsChatReliableSiteCensus` (exactly 3) |
| `handleLyricsChat` | `sendPKIReply` | 4 | **5** | `TestLyricsCooldownNotOncePerLifetime` (>= 2) |
| `FleetNodeHandler` | `sendPKIReplyReliable` | **3** | **3** | `TestOneShotReplyPathsUseReliableRetry` (exactly 3) |
| `FleetNodeHandler` | `sendPKIReply` | **0** | **0** | same test (exactly 0) |
| `handleLLMChat` | `sendPKIReplyReliable` | 0 | 0 | — |
| `handleLLMChat` | `sendPKIReply` | 3 | 3 | — |

**Both pinned censuses are unchanged.** The only movement is the fifth plain site in
`handleLyricsChat` — the over-cap reply, which the plan predicted exactly.

Two structural reasons it held:

1. The guardrail degradation is an **argument swap**, `cannedRefusal` →
   `guardRefusalMessage(reason)`, at both existing sites. `guardRefusalMessage` is a
   bare `*ast.Ident` call, not a `SelectorExpr`, so `calleeNames` does not even see it.
   An if/else with a second send would have broken `FleetNodeHandler`'s pinned 3/0.
2. The over-cap refusal deliberately took the **plain** path. A dropped "stage is full"
   costs the requester nothing but a retry, whereas a fourth reliable site would have
   broken 72-06's exactly-3 assertion.

New helper call sites in `handleLyricsChat`: `acquireLyricSlot` **1**, `releaseLyricSlot`
**3** — the decode failure, the empty-entry parse, and the goroutine defer.

## Accomplishments

**Task 1 — a global, non-blocking performance cap.**

`FleetCmd` gains `LyricSlots chan struct{}`, sized once in `NewFleets` from
`lyricsMaxConcurrent()`. One channel, not one per fleet: the resource being defended is
RF airtime, which knows nothing about fleet indices, and a per-fleet cap would silently
multiply by the fleet count.

`acquireLyricSlot` is a `select` with a `default`, so an over-cap request is refused in
the packet handler rather than queued — a backlog would outlive the requester's interest
and then burst at a radio that stopped listening. `releaseLyricSlot` is a non-blocking
drain, which makes a double release a no-op instead of a deadlock; that matters because
the helper is called from four places and one mistake would wedge a twelfth of the stage
for the life of the process. Both helpers treat a nil channel as unlimited so the
existing bare-`&FleetCmd{}` tests degrade rather than panic.

Placement is the load-bearing detail: the acquire sits **after** the cooldown read and
**before** the cooldown write, and the refusal returns. A refused requester keeps a clean
slate and can retry the moment a slot frees. Marking first would have locked them out for
ten minutes and given them no song at all.

**Task 2 — an outage that is legible.**

The plan's framing was right and worth restating: both guard sites already replied, so
nothing was ever silently dropped. What was missing was the *distinction*. `guardText`
mints four reasons itself when it could not reach a verdict and passes the sidecar's own
reason through otherwise; those four are now named constants, and `guardRefusalMessage`
maps them to an in-persona degradation line while everything else — including an empty
reason — keeps `cannedRefusal`.

The degradation line is `👻 …static on the line. try me again.` It names nothing: no
guardrail, no sidecar, no failure mode, no status code. A block that visibly degraded
would tell an attacker probing the bot exactly when a control had stopped answering.

Every outage branch now carries `MESHTK_GUARDRAIL_OUTAGE`. The status and decode branches
previously logged **nothing at all**, so a sidecar returning 502s was invisible to
operators; a 502 is as much an outage as a refused connection.

**Task 3 — overlay synced and proved.**

Full suite green under `-race`, seven files byte-identical across the two trees, the new
test file explicitly `git add`-ed and tracked.

## Task Commits

Committed atomically in **both** trees, upstream first.

| Task | Upstream `~/working/meshtk-p72` | Monorepo overlay |
|------|--------------------------------|------------------|
| 1: global lyric semaphore + over-cap reply | `7af1f8b` (feat) | `09dcf8d5` (feat) |
| 2: outage vs policy block + marker token | `c97fddb` (feat) | `6c9e277f` (feat) |
| 3: verification + overlay parity | *(no code delta — the sync landed with tasks 1 and 2, per the lead's "commit atomically in both trees" instruction and 72-06's precedent)* | — |

Upstream branch `feat/phase-72-bot-hardening` now sits at `c97fddb`, continuing from
72-06's `4223234` exactly as instructed, so PR
**https://github.com/whereiskurt/meshtk/pull/34** accumulates rather than diverges.

⚠️ **Both commits are LOCAL — nothing was pushed.** The plan does not include a push and
the lead's brief said to stay out of anything outward-facing while another executor is
mid-merge. `git push` on `feat/phase-72-bot-hardening` is a one-liner whenever the lead
wants PR #34 updated. The monorepo overlay is what actually ships, so nothing is blocked.

## Files Created/Modified

Same set in each tree, byte-identical:

- `internal/app/fleet/cmd.go` — `LyricSlots` field, `defaultLyricsMaxConcurrent`,
  `stageFullReply`, `lyricsMaxConcurrent()`, `acquireLyricSlot`/`releaseLyricSlot`, the
  `NewFleets` sizing, the acquire guard and three release sites in `handleLyricsChat`,
  and the two guard-reply argument swaps.
- `internal/app/fleet/guard.go` — four reason constants, `guardDegradedReply`,
  `isGuardOutageReason`, `guardRefusalMessage`, the nil-safe `logGuard` helper, and the
  marker token on all four outage branches. (Also now `gofmt`-clean; see below.)
- `internal/app/fleet/guard_test.go` — 6 new tests including the 7-row selector table.
- `internal/app/fleet/lyrics_semaphore_test.go` — **NEW**, 8 tests.

Branch delta `4223234..c97fddb`: 4 files, 494 insertions, 16 deletions, all under
`internal/app/fleet/`.

## Verification

All Go gates run in `~/working/meshtk-p72` (branch `feat/phase-72-bot-hardening`); the
poisoned `~/working/meshtk` clone was never touched.

| Gate | Result |
|------|--------|
| `go build ./...` | clean |
| `go vet ./internal/app/fleet/` | clean |
| `gofmt -l internal/app/fleet/` | clean (no output) |
| `go test ./internal/app/fleet/ -count=1 -race` | **ok** 1.631s |
| `grep -c MESHTK_LYRICS_MAX_CONCURRENT cmd.go` | **1** (required exactly 1) |
| `grep -c MESHTK_GUARDRAIL_OUTAGE guard.go` | **4** (required >= 3) |
| `grep -c MESHTK_GUARDRAIL_OUTAGE cmd.go` | **0** (required 0) |
| per-file `diff -q` upstream vs overlay | **7/7** byte-identical |
| `git ls-files` on those 7 overlay files | **7** |
| `git ls-files ...lyrics_semaphore_test.go` | **1** (the CI landmine) |
| `git status --porcelain apps/run.mqtt/meshtk/ \| grep -c '^??'` | **0** |
| `git show --stat` dep-file grep, every branch commit | **0** on all 5 |
| both trees clean after commit | confirmed |

**Dep-file audit, per commit on the branch:** `c97fddb` 0, `7af1f8b` 0, `4223234` 0,
`b28dbfb` 0, `863bbb1` 0. **No `go.mod`, `go.sum` or `vendor/` file was staged in any
commit** — the other session's dependency bump did not ride along.

**Never-log audit:** neither the guarded text nor any player message reaches a log call.
The four outage lines carry only the direction (`input`/`output`), the transport error or
status code, and the failmode.

## The bound, stated honestly

12 concurrent performances x 58 messages / ~214s ≈ **3.3 messages/second** aggregate,
against ≈ **13.8 msg/s** at fifty uncapped talkers. This is arithmetic on the LRC blob's
own timing, not a measurement — real airtime depends on SF, duty cycle and how many
listeners are on the channel. The cap is a bound on the *bot's* contribution, which is
the part meshtk controls.

## Deviations from Plan

### Auto-fixed / adjusted

**1. [Rule 2 - Missing critical functionality] Added the marker to the build-error branch too**

- **Found during:** Task 2.
- **Plan said:** emit the token on "the non-200 status and decode-failure branches",
  enumerating three outage branches total.
- **Issue:** `guard-build-error` fires when `MESHTK_GUARDRAIL_URL` is malformed. Under
  the fail-closed flip 72-04 is about to apply, that would block every message while
  logging absolutely nothing — a total outage completely invisible to the alarm.
- **Fix:** the fourth branch logs the marker as well. This only *raises* the plan's
  `>= 3` acceptance count (now 4) and cannot cause a false positive: the branch is
  unreachable unless the URL is genuinely broken.
- **Commit:** `c97fddb` upstream / `6c9e277f` overlay.

**2. [Rule 2 - Missing error handling] Added a nil-safe `logGuard` helper**

- **Found during:** Task 2.
- **Issue:** the existing outage log was wrapped in a manual
  `n != nil && n.Config != nil && n.Config.Log != nil` chain. Adding three more emission
  sites meant three more copies of it, and one omission panics the process — `guardText`
  runs with a bare `&FleetCmd{}` in tests.
- **Fix:** one guarded `logGuard` method; the marker token stays at each call site (see
  the key decision on why it is not a constant).
- **Commit:** same.

**3. [Rule 1 - Correctness] `guard.go` is now `gofmt`-clean**

- 72-06 recorded `guard.go` as unformatted at baseline and deliberately left it, noting
  72-07 owns the file. Rewriting it here formatted it as a side effect. The doc comment's
  contract block is now a `gofmt`-style indented code block; no behaviour changed.

### Scope notes (not deviations)

- **Task 3 produced no separate commit.** The lead's brief said "commit atomically in
  both trees, upstream first", and 72-06 set the precedent of syncing the overlay
  per-task. Task 3's substance — the full `-race` run, the seven-file parity loop, the
  tracked-file assertions and the dep-file audit — was all executed and is tabulated
  above; there was simply nothing left uncommitted to commit.
- **Nothing was pushed and no workflow was dispatched**, per the lead's instruction.
- **`STATE.md` and `ROADMAP.md` were deliberately NOT updated** — the lead rolls those
  up centrally to avoid the concurrent-phase merge hazard.

## Issues Encountered

**The env-var contract is the mirror image of 72-06's.** 72-06 flagged that
`os.LookupEnv` vs `os.Getenv` matters for this class of contract, and the brief passed
that note along. Working it through, the answer here is the *opposite* of 72-06's:
`MESHTK_RICKY_CHALLENGE` needed `LookupEnv` because explicitly-empty is its kill switch,
so unset and empty had to differ. `MESHTK_LYRICS_MAX_CONCURRENT` has no kill switch by
design — a zero cap would refuse every request and silence ricky entirely — so unset,
blank, non-numeric and non-positive must all collapse to 12, and `os.Getenv` expresses
that directly. Documented at the function so the next reader does not "fix" it.

**Proving the cooldown is not burned needed an AST test, not a behavioural one.**
`handleLyricsChat` cannot be driven from a unit test without a live MQTT client, so the
guarantee is proved structurally instead: the `if !n.acquireLyricSlot()` branch must end
in a `return`, and its position must precede the `LyricsResponded` assignment. Together
those two facts mean a refused requester provably never reaches the cooldown write. This
matches the file's existing convention — `reply_retry_test.go` and `ack_mode_test.go` are
both AST guards for exactly this reason.

**Two self-inflicted slips during the `guard.go` rewrite**, both caught before any
build: a pointless `cannedRefusal_orDegraded` indirection and a nonsense `err2body(&out)`
typo in the decode call. Removed and corrected in place; the file never compiled in that
state and nothing was committed until `go build`, `go vet`, `gofmt` and the full `-race`
suite were all green.

**Worktree branch naming**, same as 72-03 and 72-06 recorded: the monorepo worktree's
branch is `worktree-rickyaward`, which fails the commit protocol's positive allow-list
(`worktree-agent-*`). The safety-critical deny-list check — never `main`/`master`/
`develop`/`trunk`/`release/*`, never detached — was run before **both** monorepo commits
and passed, and the cwd-drift sentinel confirmed each commit was made from the spawn-time
worktree root. That check earns its keep here, because every build and test ran in a
*different* tree.

**One injection-scan hook fired** while reading `guard_test.go`, on the string
`"ignore previous instructions"`. That is the existing jailbreak payload
`TestGuardTextBlocksOnSidecarBlock` feeds to a fake sidecar — a test fixture, not an
instruction. Noted and disregarded.

## Known Stubs

None. Every path added is wired end to end. The one thing that exists but is not yet
consumed is the marker token, which is deliberate: 72-04 authored the metric filter that
keys on it, and 72-09 ships the image that emits it.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema change. The only
new outbound surface is additional log output on paths that already made the same HTTP
call.

## Threat register disposition

| Threat ID | Mitigation as shipped |
|-----------|----------------------|
| T-72-33 (uncapped concurrency) | global 12-slot channel sized at construction; bounds the bot to ~3.3 msg/s |
| T-72-34 (slot leak) | acquire/release helpers, 3 release sites incl. the goroutine defer covering both normal completion and the termination timer; AST count guard + behavioural recovery test + harmless-over-release test |
| T-72-35 (over-cap blackhole) | plain-path reply with the locked verbatim string; cooldown provably not marked (AST ordering + return) |
| T-72-36 (degradation leaking that a control is down) | line names no guardrail, sidecar, failure mode or status; a genuine block keeps the identical-to-before canned refusal, so probing does not separate them; asserted by a leak-word table |
| T-72-37 (outage invisible to operators) | marker token on all FOUR outage branches (plan asked three); status and decode logged nothing before |
| T-72-38 (breaking the pinned census) | argument swap only, proved two ways: the census tests pass, and `TestGuardReplySitesUseTheSelector` pins exactly 2 swap sites |
| T-72-39 (new test file discarded by CI) | `git add`-ed explicitly; `git ls-files` = 1, untracked count = 0 |

## User Setup Required

`MESHTK_LYRICS_MAX_CONCURRENT` is **optional** — unset means 12, which is the intended
production value. Nothing needs to be set for this plan to work correctly.

72-06's two award env vars (`MESHTK_RICKY_FALLBACK_URL`, `MESHTK_RICKY_CHALLENGE`) are
unchanged by this plan and still stand.

## Next Phase Readiness

- **72-04's metric filter must key on the literal `MESHTK_GUARDRAIL_OUTAGE`** as plain
  text, not a JSON selector. It appears on four branches in `guard.go` and nowhere else
  in the fleet package. The token is emitted at `Errorf` level.
- **72-09 (release) is what ships all of this.** Nothing was deployed. Note that the
  guardrail degradation only becomes observable once 72-04's failmode flip is applied —
  under `open`, an outage allows rather than refusing, so the degradation line is
  correctly never sent.
- **Neither BOT-02 nor BOT-03 is marked complete** — both need the 72-09 release.
- **The upstream branch is committed but unpushed.** One `git push` on
  `feat/phase-72-bot-hardening` updates PR #34 whenever the lead is ready.
- **Worth a UAT ask:** the cap is only genuinely exercised with more than twelve radios
  requesting the song simultaneously, which is a hard thing to arrange outside the con.

## Self-Check: PASSED

Files:
- `apps/run.mqtt/meshtk/internal/app/fleet/cmd.go` — FOUND
- `apps/run.mqtt/meshtk/internal/app/fleet/guard.go` — FOUND
- `apps/run.mqtt/meshtk/internal/app/fleet/guard_test.go` — FOUND
- `apps/run.mqtt/meshtk/internal/app/fleet/lyrics_semaphore_test.go` — FOUND (and tracked)

Commits (monorepo): `09dcf8d5`, `6c9e277f` — both FOUND
Commits (upstream): `7af1f8b`, `c97fddb` — both FOUND

Assertions:
- `handleLyricsChat` 3 reliable / 5 plain; `FleetNodeHandler` 3 reliable / 0 plain — CONFIRMED by AST census before and after
- 7/7 overlay files byte-identical, 7 tracked, 0 untracked — CONFIRMED
- 0 `go.mod`/`go.sum`/`vendor/` files in any of the 5 branch commits — CONFIRMED
- `go test -race` ok (1.631s) — CONFIRMED
- both trees have clean working directories — CONFIRMED

---
*Phase: 72-bot-hardening-clickable-one-time-awards-fail-closed-guardrai*
*Completed: 2026-07-31*
