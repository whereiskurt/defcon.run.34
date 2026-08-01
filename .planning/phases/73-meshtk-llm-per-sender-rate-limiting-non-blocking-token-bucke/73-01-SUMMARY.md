---
phase: 73-meshtk-llm-per-sender-rate-limiting-non-blocking-token-bucke
plan: 01
subsystem: mesh
tags: [go, meshtk, bedrock, rate-limiting, token-bucket, paho, mqtt, cost-control]

# Dependency graph
requires:
  - phase: 72-bot-hardening-clickable-one-time-awards-fail-closed-guardrai
    provides: "the plain-text CloudWatch marker-token pattern (guard.go's MESHTK_GUARDRAIL_OUTAGE), the stageFullReply refuse-in-words precedent, and the lyric semaphore's non-blocking-acquire + nil-degrades-to-unlimited shape"
provides:
  - "Non-blocking per-(fleet, sender) token bucket in front of generateReply — one radio cannot exceed 60 Bedrock Converse calls/hour against one ghost"
  - "MESHTK_LLM_CALLS_PER_HOUR operator knob with an explicit-zero kill switch and typo-safe fallback"
  - "llmRateLimitReply — an in-character refusal that names no limit, cost, model or control"
  - "MESHTK_LLM_RATE_LIMIT plain-text log marker token, the input 73-02's metric filter and alarm key on"
  - "Prune-on-access bucket state, so per-fleet maps cannot grow over a multi-day fleet lifetime"
affects: [73-02, 73-03, meshtk-llm, bedrock-cost, ghosts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-function + FleetCmd-method split (takeLLMToken/pruneLLMBuckets vs allowLLMCall), mirroring dedupRequest/isRetransmit — time is a parameter, so refill is testable with no clock seam and no sleep"
    - "LookupEnv for knobs with kill-switch semantics (rickyChallenge idiom), deliberately contrasted in-code with lyricsMaxConcurrent's Getenv"
    - "Process-wide invariant resolved once in NewFleets (LyricSlots precedent) so a mid-flight env change cannot move a ceiling"

key-files:
  created:
    - apps/run.mqtt/meshtk/internal/app/fleet/llm_ratelimit.go
    - apps/run.mqtt/meshtk/internal/app/fleet/llm_ratelimit_test.go
  modified:
    - apps/run.mqtt/meshtk/internal/app/fleet/cmd.go

key-decisions:
  - "Explicit '0' in MESHTK_LLM_CALLS_PER_HOUR IS the operator kill switch — the deliberate departure from lyricsMaxConcurrent, which coerces 0 to its default. Rationale written into the code comment, not left in the plan: a zero lyric cap silences ricky with no operator upside, whereas a zero call cap still answers in words and merely stops costing money."
  - "Only a cleanly parsed zero reaches the kill switch. Blank, whitespace-only, non-numeric, negative and fractional values all fall back to 60, so a typo can never silence the fleet."
  - "Capacity equals the hourly rate (bucket of 60, refilling 60/hour) so the knob reads as one sentence, and a fresh bucket starts FULL."
  - "Refusal rides the PLAIN sendPKIReply path with Warnf, not Errorf — a tripped ceiling is the system working, and the 73-02 alarm is count-gated on volume."
  - "allowLLMCall bounds-checks BOTH parallel slices, deliberately stricter than isRetransmit's bare RecentReq[toFleetIdx] index."
  - "Upstream-first authoring in a dedicated ~/working/meshtk-p73 worktree, then a byte-identical overlay mirror — build.sh's CI resolve_meshtk deletes the overlay dir, clones meshtk fresh, and re-overlays only repo-TRACKED files."

patterns-established:
  - "Marker-token log line front-loaded in the format string for a plain-text CloudWatch metric filter, with attacker-controlled text deliberately excluded"
  - "AST ordering assertion (callPositions helper) proving a guard precedes a paid call, independent of line numbers"

requirements-completed: [RATE-01, RATE-02, RATE-03, RATE-04]

coverage:
  - id: D1
    description: "A single radio cannot exceed MESHTK_LLM_CALLS_PER_HOUR (default 60) Bedrock Converse calls per hour against one ghost; the next call in the window makes ZERO model calls"
    requirement: RATE-01
    verification:
      - kind: unit
        ref: "internal/app/fleet/llm_ratelimit_test.go#TestTakeLLMTokenAllowsCapacityThenRefuses, #TestTakeLLMTokenRefillsContinuously, #TestTakeLLMTokenNeverAccumulatesBeyondCapacity, #TestNewFleetsAllocatesOneLLMBucketPerFleet"
        status: pass
      - kind: unit
        ref: "internal/app/fleet/llm_ratelimit_test.go#TestLLMRateGuardRunsBeforeGenerateReply (AST: guard provably precedes generateReply)"
        status: pass
    human_judgment: false
  - id: D2
    description: "An over-cap requester is answered in words on the plain send path, never blackholed and never queued; a different radio talking to the same ghost is unaffected"
    requirement: RATE-02
    verification:
      - kind: unit
        ref: "internal/app/fleet/llm_ratelimit_test.go#TestHandleLLMChatRefusesInWords, #TestLLMRateAllowBucketsAreIndependentPerRadioAndFleet, #TestLLMRateLimitReplyRevealsNoControl"
        status: pass
    human_judgment: false
  - id: D3
    description: "Setting MESHTK_LLM_CALLS_PER_HOUR to exactly 0 is a deliberate operator kill switch; blank, non-numeric, negative and fractional values fall back to the default instead"
    requirement: RATE-03
    verification:
      - kind: unit
        ref: "internal/app/fleet/llm_ratelimit_test.go#TestLLMCallsPerHourZeroIsTheOperatorKillSwitch, #TestLLMCallsPerHourTypoNeverBecomesAKillSwitch, #TestLLMCallsPerHourDefaultsWhenUnset, #TestLLMRateAllowZeroCapacityRefusesEveryCall"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every refusal emits one log line carrying the plain-text MESHTK_LLM_RATE_LIMIT marker token that 73-02's metric filter keys on, and never the requester's message text"
    requirement: RATE-04
    verification:
      - kind: other
        ref: "grep -c 'MESHTK_LLM_RATE_LIMIT' cmd.go == 1; grep -n 'MESHTK_LLM_RATE_LIMIT' cmd.go contains neither userMessage nor %s"
        status: pass
    human_judgment: true
    rationale: "The end-to-end link (refusal line -> ghosts CloudWatch log group -> 73-02 metric filter -> tripwire alarm) can only be confirmed against a live deployment, which is 73-03's gated ship. Until then the metric reads a correct real zero."
  - id: D5
    description: "Overlay and upstream stay at zero Go divergence, and both new files are in the CI git ls-files overlay set"
    verification:
      - kind: other
        ref: "diff -rq overlay vs ~/working/meshtk-p73 == 1 line (gpx_routes_test.go only); git ls-files count == 2; git status --porcelain '??' count == 0"
        status: pass
    human_judgment: false

# Metrics
duration: 40min
completed: 2026-08-01
status: complete
---

# Phase 73 Plan 01: meshtk LLM per-sender rate limiting Summary

**A non-blocking per-`(fleet, sender)` token bucket now sits immediately in front of `generateReply`, so one mesh radio can drive at most 60 paid Bedrock `Converse` calls an hour against one ghost — and the 61st is refused in character, at zero model cost, with a marker token 73-02's alarm can see.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-08-01T06:00Z (approx.)
- **Completed:** 2026-08-01T06:40Z
- **Tasks:** 3/3
- **Files modified:** 6 (3 upstream + 3 byte-identical overlay mirrors)

## Accomplishments

- **The first bound of any kind on Bedrock spend from a single radio.** `llm.go` had no limiter; the only throttle in the path was the 30s `requestDedupWindow`, which collapses byte-identical repeats and is defeated by varying one character. `handleLLMChat` now consults `allowLLMCall` at line 1373, ahead of `generateReply` at line 1379, so a refused request makes **zero** `Converse` calls.
- **The fleet is never globally silenced.** Buckets key on `(fleet, sender)`, so an exhausted abusive radio takes nothing away from anybody else — asserted directly, including the same radio holding independent buckets across two fleets.
- **A deliberate, documented kill switch at zero.** `MESHTK_LLM_CALLS_PER_HOUR` is read with `LookupEnv` so "absent" and "explicitly set" are distinguishable. An explicit `0` refuses every model call while the ghosts keep answering in words; blank, whitespace-only, `banana`, `-1`, `12.5`, `0x0`, `60s` and `sixty` all fall back to 60. The contrast with `lyricsMaxConcurrent` (which coerces 0 to its default, and is named in the code comment) is written into the source, not left in the plan.
- **Nil state degrades to unlimited, not to a panic and not to refuse-everything.** Every existing test in the package constructs a bare `&FleetCmd{}`, whose slices are nil; a bare value now allows 100 consecutive calls, as does a nil `*FleetCmd`, an out-of-range fleet index, a short mutex slice and a nil per-fleet map.
- **Bucket state cannot grow unbounded.** Prune-on-access under the per-fleet mutex drops every radio idle a full window (provably back at capacity, so its state carries no information): 500 idle radios collapse to the one entry being touched.
- **The refusal is tokenised and carries no attacker text.** One `Warnf` — not `Errorf`, because a tripped ceiling is the system working and the 73-02 alarm is count-gated on volume — front-loading `MESHTK_LLM_RATE_LIMIT` and carrying only the fleet index and radio id.
- **Overlay↔upstream Go divergence stayed at ZERO.** Authored upstream first in a dedicated worktree, then mirrored byte-identically; the only whole-directory difference remains the con-specific `gpx_routes_test.go`.

## Task Commits

The plan deliberately defers **all** committing to Task 3 (its acceptance requires upstream `HEAD` to be a single commit touching exactly three fleet files), so Tasks 1–2 produced verified working state rather than commits. TDD RED/GREEN gates were still run and are recorded below.

1. **Task 1: Per-sender token bucket core with a zero-value kill switch** — no commit by design; RED/GREEN evidence below
2. **Task 2: Wire the bucket in front of generateReply and refuse in words** — no commit by design; RED/GREEN evidence below
3. **Task 3: Commit upstream and mirror the overlay at byte parity**
   - Upstream `~/working/meshtk-p73` on `feat/phase-73-llm-rate-limit`: **`02f9649`** (`feat(fleet): bound per-radio Bedrock spend with a non-blocking token bucket`) — 3 files, 650 insertions, **not pushed** (73-03 owns the PR)
   - Monorepo `worktree-rickyaward`: **`927ebe78`** (`feat(73-01): bound per-radio Bedrock spend with a non-blocking token bucket`) — 3 files, 650 insertions

### TDD gate evidence

| Gate | Task | Evidence |
|------|------|----------|
| RED | 1 | `go test` failed to build: `undefined: llmBucket`, `undefined: llmCallsPerHour`, `f.LLMBuckets undefined`, `unknown field LLMCallsPerHour` (exit 1) |
| GREEN | 1 | `gofmt -l` clean, `go build ./...`, `go vet`, `go test -run 'LLMRate\|LLMToken\|LLMBucket\|LLMCallsPerHour' -count=1 -race` → **ok**, 16/16 PASS |
| RED | 2 | 3 named failures for the right reasons: "handleLLMChat never consults the limiter", "never sends llmRateLimitReply", "len(LLMBuckets) = 0, want 2" (exit 1) |
| GREEN | 2 | Full fleet suite `-count=1 -race` → **ok**; 127 PASS, 0 FAIL |

## Files Created/Modified

Upstream `~/working/meshtk-p73/internal/app/fleet/` and, byte-identically, `apps/run.mqtt/meshtk/internal/app/fleet/`:

- `llm_ratelimit.go` (new, 181 lines) — `defaultLLMCallsPerHour = 60`, `llmRateWindow = time.Hour`, `llmRateLimitReply`, `type llmBucket{tokens float64; last time.Time}`, `llmCallsPerHour()`, pure `takeLLMToken()` / `pruneLLMBuckets()`, and the nil-safe `(*FleetCmd).allowLLMCall()`.
- `llm_ratelimit_test.go` (new, 19 tests) — env matrix, capacity/refill/clamp/backwards-clock, 500→1 prune (both pure and prune-on-access), nil/out-of-range degradation, per-radio and per-fleet independence, refusal-copy leak scan, AST ordering, refusal-in-words, and a real `NewFleets` construction test that burns a 7-call ceiling end to end.
- `cmd.go` (modified) — three `FleetCmd` fields (`LLMBuckets`, `LLMBucketMux`, `LLMCallsPerHour`), their allocation in the `NewFleets` per-fleet loop, `f.LLMCallsPerHour = llmCallsPerHour()` resolved once after the loop beside `LyricSlots`, and the guard + tokenised refusal in `handleLLMChat`.

`llm.go` was **not** touched: `git diff --stat origin/main -- internal/app/fleet/llm.go` is empty. The guard lives at the caller, not inside the Bedrock client.

## Decisions Made

All substantive decisions were pre-specified by the plan and `73-CONTEXT.md` and were implemented as written. Two judgement calls the plan left to Claude's discretion:

- **A classic token bucket with capacity == hourly rate**, rather than a sliding window: it lets a legitimate conversational burst through immediately while still bounding the hour, and it refills continuously so a throttled radio is back in ~1 minute rather than waiting for a window boundary.
- **`tokens` as a `float64`**, so the continuous refill needs no integer-truncation special case; the refill is ordered `elapsed.Seconds() * capacity / window.Seconds()` so the half-window case lands on exactly 30.0 rather than accumulating float drift.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Task 1's `-run` filter silently under-covered five tests**

- **Found during:** Task 1 (verification)
- **Issue:** The plan's gate is `go test -run 'LLMRate|LLMToken|LLMBucket|LLMCallsPerHour'`. My five `TestAllowLLMCall*` names matched **none** of those alternatives (`LLMCallsPerHour` needs the full string; `TestAllowLLMCallPrunesOnAccess` only contains `LLMCall`). The gate reported `ok` while never running the nil-degrades-to-unlimited, out-of-range, zero-capacity, prune-on-access and per-radio-independence assertions — precisely the ones the plan's own acceptance criteria call out. A green gate that runs none of the tests it names is the silent-green class the plan explicitly warns against.
- **Fix:** Renamed the five tests to `TestLLMRateAllow*` so the plan's filter selects them. Assertions unchanged — the gate was strengthened, not weakened.
- **Files modified:** `internal/app/fleet/llm_ratelimit_test.go`
- **Verification:** `go test -run '...' -v` now reports 16 `--- PASS` lines where it previously reported 11; all pass under `-race`.
- **Committed in:** `02f9649` / `927ebe78`

**2. [Rule 3 - Blocking] Task 1's field comments broke Task 2's `allowLLMCall` census**

- **Found during:** Task 2
- **Issue:** The `LLMBucketMux` and `LLMCallsPerHour` doc comments I wrote in Task 1 both named `allowLLMCall`, which would have made Task 2's acceptance criterion `grep -c 'allowLLMCall' cmd.go` return 3 instead of 1 — masking a genuine stray-call-site check behind prose.
- **Fix:** Reworded both comments to say "the limiter" instead. Same meaning, and the census now measures call sites rather than mentions.
- **Files modified:** `internal/app/fleet/cmd.go`
- **Verification:** `grep -c 'allowLLMCall' cmd.go` == 1; the three field declarations still grep as exactly 3.
- **Committed in:** `02f9649` / `927ebe78`

### Structural deviations (not auto-fixes)

**3. Tasks 1–2 produced no commit.** The plan's Task 3 acceptance requires upstream `HEAD` to show exactly three `internal/app/fleet/` files and `git status --porcelain` to be empty, i.e. one clean commit. Per-task RED/GREEN commits would have left `HEAD` showing a subset and failed that gate. All four TDD gates were still run and their real output is tabulated above. The monorepo received its commit at Task 3 as the plan directs.

**4. Struct fields were written with blank-line separation and doc comments.** `gofmt`'s tabwriter aligns adjacent struct fields with multiple spaces, which would have broken the plan's `grep -c 'LLMBuckets \[\]map\|LLMBucketMux \[\]sync\|LLMCallsPerHour int'` (it requires a single space). Separating each field with a blank line and a doc comment puts each in its own alignment group — and matches the existing style of the `Pending`/`LastSeen`/`BurstLocks`/`LyricSlots` fields lower in the same struct.

---

**Total deviations:** 2 auto-fixed (1x Rule 1, 1x Rule 3) + 2 structural notes
**Impact on plan:** No scope creep. Both auto-fixes repaired verification gates that would otherwise have gone green without measuring what they claimed to measure. Nothing declined by Kurt was added: no global fleet cap, no daily token/spend ceiling, no AWS Budgets or `InvocationCount` backstop, under any name.

## Issues Encountered

- **The overlay tree cannot be compiled locally.** `apps/run.mqtt/meshtk/` on disk holds only the con-config subset (103 `.go` files, all tracked) with no `go.mod` — CI supplies the module from the fresh `git clone`. So there is no local `go build` of the overlay to run. The substitute is stronger than a smoke build: the three overlay files are proven **byte-identical** to an upstream tree that builds clean and passes 127 tests under `-race`, and the whole-directory `diff -rq` shows zero drift beyond `gpx_routes_test.go`.
- **A shell guard blocked an incidental `rm -rf`** in one compound command (scratchpad cleanup). Nothing needed was lost; the substantive parts of that command ran.
- No authentication gates. No package-manager installs — `go.mod`, `go.sum` and `vendor/` were excluded from every commit and the upstream `show --stat HEAD` greps 0 for them, so the Package Legitimacy Gate did not apply.

## Verification Results

Every gate below was run as written and its real output recorded.

| # | Gate | Result |
|---|------|--------|
| 1 | `cd ~/working/meshtk-p73 && go build ./... && go vet ./internal/app/fleet/` | **clean** (exit 0) |
| 2 | `go test ./internal/app/fleet/ -count=1 -race` | **ok** — 127 PASS, 0 FAIL (baseline on `main` was 108; +19 is exactly this plan's new test file) |
| 3 | `gofmt -l internal/app/fleet/` | **no files listed** |
| 4 | Limiter provably precedes `generateReply` (AST, not line numbers) | `TestLLMRateGuardRunsBeforeGenerateReply` **PASS**; line check corroborates (1373 < 1379) |
| 5 | Env matrix: unset/blank/`   `/`banana`/`-1`/`12.5`/`0x0`/`60s`/`sixty` → 60; `0` and ` 0 ` → 0; `120` → 120 | **PASS** |
| 6 | Nil-slice `&FleetCmd{}` allows 100 calls without panicking | **PASS** |
| 7 | Pre-existing regression guards `TestOneShotReplyPathsUseReliableRetry`, `TestLyricsCooldownNotOncePerLifetime`, `TestRetransmitGuardRunsBeforeChatbotPaths` | all three **PASS**, unchanged |

Acceptance greps (run under both the session's `ugrep` wrapper and BSD `/usr/bin/grep`, identical results):

| Criterion | Want | Got |
|---|---|---|
| `func ... allowLLMCall` decl in `llm_ratelimit.go` | 1 | **1** |
| `func takeLLMToken\|pruneLLMBuckets\|llmCallsPerHour` | 3 | **3** |
| `LLMBuckets []map\|LLMBucketMux []sync\|LLMCallsPerHour int` in `cmd.go` | 3 | **3** |
| `os.LookupEnv` in comment-stripped `llm_ratelimit.go` | ≥1 | **1** |
| `os.Getenv` in comment-stripped `llm_ratelimit.go` | 0 | **0** |
| `lyricsMaxConcurrent` contrast written into the code | ≥1 | **2** |
| `time.Sleep\|go func\|chan ` in comment-stripped `llm_ratelimit.go` | 0 | **0** |
| `allowLLMCall` sites in `cmd.go` | 1 | **1** |
| `MESHTK_LLM_RATE_LIMIT` in `cmd.go` | 1 | **1** |
| `MESHTK_LLM_RATE_LIMIT` in `llm.go` | 0 | **0** |
| refusal log line containing `userMessage` or `%s` | 0 | **0** |
| `LLMBuckets\|LLMBucketMux\|LLMCallsPerHour` refs in `cmd.go` | ≥6 | **9** |
| `git diff --stat origin/main -- internal/app/fleet/llm.go` | empty | **empty** |
| `diff -q` per file, upstream vs overlay | 3 identical | **3 identical** |
| `diff -rq` whole fleet dir | 1 line, `gpx_routes_test.go` | **1 line, `gpx_routes_test.go`** |
| `git ls-files` count for the two new overlay files | 2 | **2** |
| untracked (`??`) under `apps/run.mqtt/meshtk/` | 0 | **0** |
| upstream `show --stat HEAD` matching `go.(mod\|sum)\|vendor/` | 0 | **0** |
| upstream `show --stat HEAD` matching `internal/app/fleet/` | 3 | **3** |
| upstream `git status --porcelain` after commit | empty | **empty** |

## Known Stubs

None. Every code path this plan added is wired end to end and exercised by a test.

## Threat Flags

None. This plan added no new network endpoint, auth path, file-access pattern or schema change at a trust boundary. It **removes** surface at the `mesh radio -> Bedrock` boundary by bounding it. Every `mitigate` disposition in the plan's threat register (T-73-01/02/03/04/06/07/08/09/10/11) has a corresponding test or grep gate above; T-73-05 and T-73-12 are the plan's recorded `accept` dispositions and were not implemented against, by design.

## Accepted Residual Risk (recorded, not an oversight)

This bounds **one radio**. Aggregate spend across many distinct radios each sitting just under the bucket remains **unbounded**, and nothing in this phase alarms on cost — 73-02's alarm counts refusals, not dollars. A global fleet cap, a daily token/spend ceiling with kill switch, and an AWS Budgets / CloudWatch `InvocationCount` backstop were each offered to Kurt on 2026-08-01 and each explicitly declined. They were not added back under another name.

## User Setup Required

None from this plan. `MESHTK_LLM_CALLS_PER_HOUR` is optional — unset yields the 60/hour default. 73-02 owns wiring the ECS env var and the CloudWatch metric filter + alarm.

## Next Phase Readiness

**Ready.** The upstream branch `feat/phase-73-llm-rate-limit` holds one clean commit (`02f9649`) and is **unpushed** — 73-03 owns the push, the upstream PR, the release and the deploy, all behind a human approval gate. The overlay is byte-identical and fully tracked, so CI's clone-and-overlay step will carry both new files.

**Nothing is deployed.** No PR was merged, no release script was run, no `terragrunt apply` and no `deploy.yml` invocation. Until 73-03 ships, 73-02's metric filter reads a real, correct zero.

One coordination note for 73-02: the marker token in the live log line is exactly `MESHTK_LLM_RATE_LIMIT`, front-loaded in the format string, emitted at `Warn` level via logrus — so the metric filter must be **plain text**, not a `$.evt` JSON selector (the 72-04 lesson).

## Self-Check: PASSED

Every file and commit this summary claims was verified to exist on disk / in git:

- `apps/run.mqtt/meshtk/internal/app/fleet/llm_ratelimit.go` — FOUND
- `apps/run.mqtt/meshtk/internal/app/fleet/llm_ratelimit_test.go` — FOUND
- `apps/run.mqtt/meshtk/internal/app/fleet/cmd.go` — FOUND
- `~/working/meshtk-p73/internal/app/fleet/llm_ratelimit.go` — FOUND
- `~/working/meshtk-p73/internal/app/fleet/llm_ratelimit_test.go` — FOUND
- `.planning/phases/73-.../73-01-SUMMARY.md` — FOUND
- Commit `927ebe78` (monorepo `worktree-rickyaward`) — FOUND
- Commit `02f9649` (upstream `feat/phase-73-llm-rate-limit`) — FOUND, 1 commit ahead of `origin/main`, **unpushed**
- Test-function count 19 — confirmed

One claim was corrected during self-check: `llm_ratelimit.go` is 181 lines, not the 172 first written.

---
*Phase: 73-meshtk-llm-per-sender-rate-limiting-non-blocking-token-bucke*
*Completed: 2026-08-01*
