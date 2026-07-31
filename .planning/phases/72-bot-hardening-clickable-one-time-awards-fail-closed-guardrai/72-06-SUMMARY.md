---
phase: 72-bot-hardening-clickable-one-time-awards-fail-closed-guardrai
plan: 06
subsystem: meshtk
tags: [meshtk, go, fleet, lyrics, claim-link, mint, ast-guard, race-detector, tracked-overlay]

# Dependency graph
requires: ["72-03"]
provides:
  - "ricky's song ends with two reliable award DMs carrying a short single-use claim link"
  - "a challenge-shaped mint client (POST {\"challenge\": ...}) sharing the ghost mint's transport"
  - "LyricsResponded widened to []map[uint32]*lyricsSession (showtime instant + cached claim url)"
  - "lyric line 01 on the reliable send path; lines 02-58 still single-shot"
  - "the reliable-site guard pinned at exactly 3 with a rewritten rationale"
affects: [72-07, 72-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Award-URL resolution returns a string, never an error: a mint failure has exactly one useful response (degrade), so there is nothing for the caller to branch on"
    - "Explicitly-empty env var as a deliberate kill switch, read via os.LookupEnv so unset and empty differ"

key-files:
  created: []
  modified:
    - apps/run.mqtt/meshtk/internal/app/fleet/cmd.go
    - apps/run.mqtt/meshtk/internal/app/fleet/claimlink.go
    - apps/run.mqtt/meshtk/internal/app/fleet/claimlink_test.go
    - apps/run.mqtt/meshtk/internal/app/fleet/reply_retry_test.go

key-decisions:
  - "LyricsResponded holds *lyricsSession, not lyricsSession — the playback goroutine mints ~3.5 min after launch and must write the url back into the record it was handed; a value map would cache into a copy"
  - "The fallback URL is deliberately NOT cached on the session, so the next showtime retries the real mint instead of being permanently degraded"
  - "MESHTK_RICKY_CHALLENGE read via os.LookupEnv, not os.Getenv: setting it to the empty string is the kill switch that disables the award, which Getenv could not express"
  - "Award tests were added to claimlink_test.go rather than a new file — CI overlays only TRACKED files over a fresh clone, and a new file is one git add away from being silently discarded"
  - "Fixed a pre-existing data race in TestSendSpreadFirstSendIsSynchronous rather than deferring it: the plan's verification requires -race green, and the file was already being edited"

requirements-completed: []  # BOT-01 also needs 72-05 (resolver deploy); BOT-03 also needs 72-07. Not marked here.

coverage:
  - id: D1
    description: "handleLyricsChat has EXACTLY 3 sendPKIReplyReliable sites (line 01, award headline, claim link) and the ~58-line lyric body stays single-shot"
    requirement: BOT-03
    verification:
      - kind: unit
        ref: "internal/app/fleet/reply_retry_test.go#TestLyricsChatReliableSiteCensus (AST walk over the FuncDecl incl. the nested playback goroutine)"
        status: pass
      - kind: unit
        ref: "internal/app/fleet/ack_mode_test.go#TestLyricsCooldownNotOncePerLifetime (>= 2 plain sendPKIReply sites)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The LyricsResponded[fleet][from] double-index access shape survives the map value widening"
    requirement: BOT-03
    verification:
      - kind: unit
        ref: "internal/app/fleet/reply_retry_test.go#TestLyricsDedupKeyedByRequester (nested ast.IndexExpr, inner index must be the identifier `from`)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Mint-by-challenge posts {challenge} with the internal-secret header, errors on every bad response, and makes no request at all when unconfigured"
    requirement: BOT-01
    verification:
      - kind: unit
        ref: "internal/app/fleet/claimlink_test.go#TestMintClaimURLForChallengePostsChallengeWithSecret"
        status: pass
      - kind: unit
        ref: "internal/app/fleet/claimlink_test.go#TestMintClaimURLForChallengeErrorsOnBadResponses (422/500/empty-url/bad-json)"
        status: pass
      - kind: unit
        ref: "internal/app/fleet/claimlink_test.go#TestMintClaimURLForChallengeErrorsWhenUnconfiguredWithoutRequesting (asserts 0 network hits)"
        status: pass
    human_judgment: false
  - id: D4
    description: "At most one mint per radio per cooldown window; mint failure degrades to the fallback URL, and an unset fallback degrades to headline-only rather than a dead link or silence"
    requirement: BOT-01
    verification:
      - kind: unit
        ref: "internal/app/fleet/claimlink_test.go#TestAwardClaimURLMintsOncePerSession (2 resolutions, 1 HTTP call)"
        status: pass
      - kind: unit
        ref: "internal/app/fleet/claimlink_test.go#TestAwardClaimURLFallsBackWhenMintFails (and asserts the fallback is not cached)"
        status: pass
      - kind: unit
        ref: "internal/app/fleet/claimlink_test.go#TestAwardClaimURLReturnsEmptyWithNoMintAndNoFallback"
        status: pass
    human_judgment: false
  - id: D5
    description: "Both award messages stay well under chatHardLimit (200 bytes), which the send path does not check"
    requirement: BOT-03
    verification:
      - kind: unit
        ref: "internal/app/fleet/claimlink_test.go#TestAwardHeadlineFitsTheChatHardLimit (headline measures 52 bytes)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The widened session map is race-free under concurrent playback-goroutine writes"
    requirement: BOT-03
    verification:
      - kind: unit
        ref: "go test ./internal/app/fleet/ -race -count=1 — ok in 1.522s"
        status: pass
    human_judgment: false
  - id: D7
    description: "The change reaches prod: all four files byte-identical between upstream and the monorepo tracked overlay, every one tracked"
    requirement: BOT-03
    verification:
      - kind: automated_ui
        ref: "per-file diff -q loop (4/4 identical); git ls-files count = 4; git status --porcelain '^??' count = 0"
        status: pass
    human_judgment: false
  - id: D8
    description: "A real radio requests the song, receives line 01, plays through line 58, and receives a tappable award link that claims exactly once"
    verification: []
    human_judgment: true
    rationale: "Nothing is deployed by this plan. End-to-end behaviour is only observable on hardware after the 72-09 release, and one-time-ness depends on 72-05's resolver deploy plus 72-07's flag rotation."

# Metrics
duration: 9min
completed: 2026-07-31
status: complete
---

# Phase 72 Plan 06: meshtk ricky award — clickable one-time claim link Summary

**ricky's song now ends with two reliable award DMs carrying a short single-use claim
link instead of reciting a freely-shareable static QR path, and the three messages that
actually matter — line 01 and the two award messages — stop getting dropped.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-31T21:36:29Z
- **Completed:** 2026-07-31T21:45:45Z
- **Tasks:** 3 of 3
- **Files modified:** 4 (in each of the two trees)

## Reliable-site census — the headline number

`handleLyricsChat`, counted by AST walk over the whole FuncDecl (the nested playback
goroutine literal included):

| Path | Before | After | Which sites |
|------|--------|-------|-------------|
| `sendPKIReplyReliable` | **1** | **3** | line 01, award headline, claim link |
| `sendPKIReply` (single-shot) | **4** | **4** | encore notice, decode failure, empty entries, lyric body |

The 1 → 3 move is deliberate and is now the guard test's assertion. Before, the single
reliable site was the FINAL lyric line, back when the flag rode a literal QR path
recited as line 59; 72-03 removed that entry, so there is no longer any special final
line. Lines 02-58 stay single-shot — retrying ~58 lines would produce ~180 sends and
re-create the channel drowning an earlier phase fixed.

## Accomplishments

**Task 1 — widened session record + challenge-shaped mint.**
`LyricsResponded` goes from `[]map[uint32]time.Time` to `[]map[uint32]*lyricsSession`,
where `lyricsSession` carries `at` (the cooldown clock) and `url` (the cached claim
link). Pointer, not value, deliberately: the playback goroutine is launched with the
record already in the map and mints ~3.5 minutes later, so it must write the URL back
into *that* record — a value map would hand it a copy and the cache would never stick.
The cooldown read now handles a nil entry exactly like an absent one.

`claimlink.go` was refactored, not rewritten: the transport (5s timeout, content-type
and `x-internal-secret` headers, status check, decode, empty-url check) moved verbatim
into a shared `mintClaim(ctx, payload)` core, and both the existing `{"ghost": ...}`
shape and a new `{"challenge": ...}` shape are expressed on it. The file header now
documents both shapes and states why the challenge shape needs no raw flag code to
exist anywhere (run.human parks the challenge row's own stored `answerHash`).

**Task 2 — award DMs at song end, line 01 reliable.**
The final-line special case and its "the final line carries the flag" comment are gone.
After the loop completes normally (the termination-timer branch returns without
awarding), the bot resolves the challenge, mints with a bounded context, caches the URL
on the session under the write lock, and sends the headline and the link as **two
separate reliable messages** — separate so a client renders the link as its own
tappable target, and because the per-message ceiling is 200 bytes with no length check
in the send path.

`sendPKIReplyReliable`'s own doc comment, which still described the final lyric line as
"the single exception", was rewritten to match.

**Task 3 — guard moved, rationale rewritten, overlay synced.**
`TestLyricsChatFinalLineUsesReliableRetry` is renamed `TestLyricsChatReliableSiteCensus`
(the old name described a final line that no longer exists) and its comment now
enumerates the census, gives the root cause for the line-01 promotion, and states in
words why the body stays single-send.

## Degradation ladder

Each rung is covered by a test:

| Situation | Requester gets |
|-----------|----------------|
| Mint succeeds | headline + minted `q.defcon.run/a/<nonce>` link |
| Same showtime, resolved twice | the SAME cached link, no second mint |
| Mint fails, `MESHTK_RICKY_FALLBACK_URL` set | headline + fallback link (not cached — next showtime retries the real mint) |
| Mint fails, fallback unset | headline ALONE — never a dead link, never silence |
| `MESHTK_RICKY_CHALLENGE` explicitly empty | no award block at all |
| Termination timer fires mid-song | no mint, no award |

## Task Commits

Committed atomically in **both** trees, upstream first.

| Task | Upstream `~/working/meshtk-p72` | Monorepo overlay |
|------|--------------------------------|------------------|
| 1: widen session record + challenge mint | `863bbb1` (feat) | `9b2b72a6` (feat) |
| 2: award DMs + line 01 reliable | `b28dbfb` (feat) | `34d31b0c` (feat) |
| 3: guard 1 → 3 + overlay sync | `4223234` (test) | `9e875670` (test) |

Upstream PR: **https://github.com/whereiskurt/meshtk/pull/34** (open; the monorepo
overlay is what ships, so this plan is not blocked on it merging).

## Files Created/Modified

Same four files in each tree, byte-identical:

- `internal/app/fleet/cmd.go` — `lyricsSession` struct, `LyricsResponded` field type,
  per-fleet map construction, the cooldown read/write, `rickyChallenge`,
  `awardClaimURL`, `awardHeadline`, `awardMintTimeout`, `defaultRickyChallenge`, the
  playback-loop send decision, the award sequence, and `sendPKIReplyReliable`'s comment.
- `internal/app/fleet/claimlink.go` — shared `mintClaim` core, `mintClaimURLForChallenge`,
  rewritten file header contract.
- `internal/app/fleet/claimlink_test.go` — 10 new tests (challenge shape, error
  branches, no-network-when-unconfigured, headline length, challenge resolution, mint
  caching, both fallback rungs, nil session).
- `internal/app/fleet/reply_retry_test.go` — the renamed census guard with its rewritten
  rationale, and the race fix.

## Verification

All run in `~/working/meshtk-p72` (the only tree with a `go.mod`):

| Gate | Result |
|------|--------|
| `go build ./...` | clean |
| `go vet ./internal/app/fleet/` | clean |
| `gofmt -l` on the 4 changed files | clean |
| `go test ./internal/app/fleet/ -count=1` | **ok** 0.512s |
| `go test ./internal/app/fleet/ -race -count=1` | **ok** 1.522s |
| per-file `diff -q` upstream vs overlay | 4/4 byte-identical |
| `git ls-files` on the 4 overlay files | 4 |
| `git status --porcelain apps/run.mqtt/meshtk/ \| grep -c '^??'` | 0 |
| `git show --stat` grep for `go.mod\|go.sum\|vendor/` on every branch commit | **0** |

Full-branch diffstat (`19444f9..4223234`) is 4 files, 407 insertions, 46 deletions —
all four under `internal/app/fleet/`. **No `go.mod`, `go.sum` or `vendor/` file was
staged in any commit**, so the unrelated dependency bump sitting in the other session's
tree did not ride along.

Never-log audit: `grep` over every `Log.{Info,Error,Debug,Warn}` call in `cmd.go` and
`claimlink.go` for `url`/`nonce` returns nothing. The award error log names only the
failure mode and the challenge.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed a pre-existing data race in `TestSendSpreadFirstSendIsSynchronous`**

- **Found during:** Task 3, running the plan's `-race` verification gate.
- **Issue:** `go test -race` failed. The report named only
  `TestSendSpreadFirstSendIsSynchronous` (reply_retry_test.go:138/146): the test's plain
  `int` counter is written by `sendSpread`'s retry goroutine while the test body reads
  it. Nothing from this plan — `LyricsResponded`, `lyricsSession` and `awardClaimURL`
  appear nowhere in the report.
- **Proved pre-existing** before touching it: checked out baseline `19444f9` into a
  throwaway `git worktree` under the session scratchpad and reproduced the same race
  there, then removed the worktree. Also confirmed by diff that neither the test nor
  `sendSpread` was modified by this plan.
- **Why fixed rather than deferred:** the plan's verification step 3 requires `-race` to
  be `ok`, so it blocked completion; the fix is three lines in a file this plan already
  edits, and it preserves the test's intent exactly.
- **Fix:** counter changed to `atomic.Int64` (`sync/atomic` import added), with a comment
  recording that the race predates the branch.
- **Commit:** `4223234` upstream / `9e875670` overlay.

**2. [Rule 2 - Correctness] Rewrote `sendPKIReplyReliable`'s stale doc comment**

- **Found during:** Task 2.
- **Issue:** the comment asserted "The single exception is the FINAL lyric line: it
  carries the flag" — false once the final-line branch was deleted, and exactly the kind
  of comment a future reader would trust over the code.
- **Fix:** rewritten to name the three real exceptions. Same file and commit as Task 2.
- **Commit:** `b28dbfb` upstream / `34d31b0c` overlay.

### Scope notes (not deviations)

- **Award tests live in `claimlink_test.go`, not a new file.** Task 2's `<files>` lists
  only `cmd.go`, but its behaviour list is testable and the task is `tdd="true"`. A new
  test file is the documented CI landmine (fresh clone + overlay of TRACKED files only —
  an untracked file is silently discarded), so the tests went into a file the plan
  already lists. Net file set is exactly the four the plan names.
- **`internal/app/fleet/guard.go` is unformatted** (`gofmt -l` flags it) at baseline and
  was left alone — out of scope, not touched by this plan, and 72-07 owns that file.

## Issues Encountered

**The plan's env-var contract needed `os.LookupEnv`, not `os.Getenv`.** The plan asks to
"resolve the challenge name from an env override defaulting to the ricky challenge slug"
AND to "skip the whole award block when it resolves empty". With `os.Getenv` those two
are contradictory — an unset var and an empty var are indistinguishable, so the default
would make "empty" unreachable and the kill switch dead code. `rickyChallenge()` uses
`os.LookupEnv` so unset falls through to `ricky` while an explicitly-empty
`MESHTK_RICKY_CHALLENGE` genuinely disables the award. Documented at the function.

**Worktree branch naming.** The pre-commit guard's positive allow-list expects
`worktree-agent-*`; this Claude Code worktree's branch is `worktree-rickyaward` (same
mismatch 72-03 recorded). The safety-critical deny-list check (never `main`/`master`/
`develop`/`trunk`/`release/*`, never detached) was run before every commit and passed,
and the cwd-drift sentinel confirmed each commit was made from the spawn-time worktree
root — which matters here because every build and test ran in a *different* tree.

## Known Stubs

None. Every code path added is wired end to end; the only unexercised branches are the
degradation rungs, each of which has a test.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema change was
introduced. The one new outbound call (`mintClaimURLForChallenge`) reuses the existing
internal-secret-authenticated mint endpoint and its transport verbatim, and is already
in the plan's threat register.

## Threat register disposition

| Threat ID | Mitigation as shipped |
|-----------|----------------------|
| T-72-26 (url in logs) | never-log audit returns nothing; the award error log carries only the failure mode and challenge name |
| T-72-27 (token farming) | url cached on the session, reused within the showtime; the 10-min per-requester cooldown bounds it to ≤1 mint per radio per window; the fallback is not cached |
| T-72-28 (retrying the body) | 3 reliable sites, pinned by `TestLyricsChatReliableSiteCensus`; 4 plain sites, pinned by `TestLyricsCooldownNotOncePerLifetime` |
| T-72-29 (payload ceiling) | headline 52 bytes, link ~35 bytes, both sent separately; asserted against `chatHardLimit` |
| T-72-30 (dependency bump riding along) | `git show --stat` grep = 0 on all three commits; branch diffstat is 4 fleet files |
| T-72-31 (change never ships) | 4/4 `diff -q` byte-parity, 4 tracked, 0 untracked under the overlay |
| T-72-32 (race on the widened map) | all reads under RLock, all writes under Lock, nil-entry guard; `-race` green |

## User Setup Required

Two env vars must be set on the `run-mqtt-ghosts` container before the award works in
prod. Neither blocks this plan — an unset fallback is a tested degradation, not a crash:

- `MESHTK_RICKY_FALLBACK_URL` — printed once by 72-07's rotation script and placed in
  SOPS. Never logged, never committed. Unset means mint failures send the headline alone.
- `MESHTK_RICKY_CHALLENGE` — optional; defaults to `ricky`. Set it to the empty string
  to disable the award entirely.

`MESHTK_RUN_INTERNAL_URL` and `MESHTK_INTERNAL_SECRET` are already wired.

## Next Phase Readiness

- **72-07 is unblocked** and owns the same files upstream. It should branch from
  `4223234` on `feat/phase-72-bot-hardening` (already pushed) so PR #34 accumulates
  rather than diverges. Its rotation script must delete the `Qr` row
  `$run#code_rick_astley_loves_desert_running` and the S3 interstitial, and print the
  fallback URL for SOPS.
- **72-09 (release) is what actually ships this.** Nothing was deployed here. Note that
  between 72-03 and this plan the song awarded nothing at all; both must ship together.
- **The award is not yet genuinely one-time in prod** until 72-05's resolver deploy
  lands — the `/a/<nonce>` namespace has to resolve first.
- **Neither BOT-01 nor BOT-03 is complete.** BOT-01 also needs 72-05; BOT-03 also needs
  72-07. Left unmarked deliberately.

## Self-Check: PASSED

Files:
- `apps/run.mqtt/meshtk/internal/app/fleet/cmd.go` — FOUND
- `apps/run.mqtt/meshtk/internal/app/fleet/claimlink.go` — FOUND
- `apps/run.mqtt/meshtk/internal/app/fleet/claimlink_test.go` — FOUND
- `apps/run.mqtt/meshtk/internal/app/fleet/reply_retry_test.go` — FOUND

Commits (monorepo): `9b2b72a6`, `34d31b0c`, `9e875670` — all FOUND
Commits (upstream): `863bbb1`, `b28dbfb`, `4223234` — all FOUND

Assertions:
- reliable-site census 3, plain-site census 4 — CONFIRMED by AST guard and by grep
- 4/4 overlay files byte-identical, 4 tracked, 0 untracked — CONFIRMED
- 0 `go.mod`/`go.sum`/`vendor/` files in any commit — CONFIRMED
- `go test -race` ok — CONFIRMED
- both trees have clean working directories — CONFIRMED

---
*Phase: 72-bot-hardening-clickable-one-time-awards-fail-closed-guardrai*
*Completed: 2026-07-31*
