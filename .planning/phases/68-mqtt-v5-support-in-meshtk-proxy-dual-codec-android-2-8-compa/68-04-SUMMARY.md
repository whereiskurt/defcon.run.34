---
phase: 68-mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa
plan: 04
subsystem: infra
tags: [mqtt, mqtt5, meshtk, vendor-sync, overlay, golang, monorepo, release-prep]

# Dependency graph
requires:
  - phase: 68-01
    provides: readFrame, handleProxyV5/handleBackendV5, inspectV5Connect, reason codes, the pre-change v4 golden
  - phase: 68-02
    provides: inspectV5Publish, handleV5PublishUplink, setPublishPayload, logDownlinkV5 + self-echo suppression
  - phase: 68-03
    provides: "whereiskurt/meshtk main @ c5341ce — the merged dual codec, the paho.golang v0.22.0 pin and the vendored codec, plus the live-mosquitto e2e"
provides:
  - "monorepo main @ 6bbe18c — the tracked apps/run.mqtt/meshtk/ overlay mirrors upstream main for every tracked Go source"
  - "apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go + inspect_v5.go (new vendored overlay files)"
  - "5 new vendored overlay test files incl. proxy_v4_golden_test.go and the gated proxy_v5_e2e_test.go"
  - "a reproduced-CI-overlay build gate: fresh upstream clone + tracked overlay untarred on top, go build/vet/test all exit 0"
  - "/Users/khundeck/working/dc34-mqtt5 — release worktree prepared with env.local.sh, content byte-identical to merged main"
affects: [68-05 buildpub/deploy/UAT]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Derive the overlay set from `git ls-files` at execution time, never from a count written down at planning time"
    - "Verify a vendored snapshot by byte-comparison (`cmp -s`) against the upstream working tree, file by file — not by eyeballing a diff"
    - "Prove a two-repo composition by reproducing it: tar the tracked overlay, clone upstream fresh, untar on top, then build the composed tree"
    - "Assert the untouchable path is untouched with `git diff --numstat <base> -- <path>` producing NO output, as a gate rather than a review note"

key-files:
  created:
    - apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go
    - apps/run.mqtt/meshtk/internal/app/server/inspect_v5.go
    - apps/run.mqtt/meshtk/internal/app/server/proxy_v5_test.go
    - apps/run.mqtt/meshtk/internal/app/server/proxy_v5_publish_test.go
    - apps/run.mqtt/meshtk/internal/app/server/inspect_v5_test.go
    - apps/run.mqtt/meshtk/internal/app/server/proxy_v4_golden_test.go
    - apps/run.mqtt/meshtk/internal/app/server/proxy_v5_e2e_test.go
  modified:
    - apps/run.mqtt/meshtk/internal/app/server/proxy.go
    - apps/run.mqtt/meshtk/internal/app/server/inspect.go
    - apps/run.mqtt/meshtk/internal/app/server/rules.go
    - apps/run.mqtt/meshtk/internal/app/server/README.md

key-decisions:
  - "68-04: the plan's headline premise — that the monorepo overlay is 36 commits stale and a sync would revert meshtk#22/#23 — was TRUE of this session's checkout (release/2026-07-26-230957, VERSION v0.0.66) but FALSE of origin/main, which was already at v0.0.71 with both fixes. Branching from origin/main as instructed is exactly what neutralised the risk; the sync therefore moved 3 files rather than dozens."
  - "68-04: internal/app/server/README.md was synced too, beyond the plan's literal '.go or .tmpl' mirror scope. It is the only other tracked file under internal/, and 68-03 deliberately wrote the dual-codec operator section into it. Leaving it stale would have let the overlay SHADOW the new ops documentation out of the production image tree — the exact failure mode this plan exists to prevent, applied to docs."
  - "68-04: internal/app/server/testdata/ was deliberately NOT added, per the plan. It is not gitignored (the `meshtk/*` pattern only matches top-level entries, so everything under `internal/` is trackable), so this is a choice, not a constraint — the fresh clone supplies it and the e2e that reads it is env-gated off by default."
  - "68-04: `go test ./...` was run in the composed tree in addition to the plan's `go build` + `go vet`. It costs 40s and it is the only place the new vendored tests ever execute against the cloned go.mod/vendor; a vendored test file that does not compile would otherwise reach production undetected."
  - "68-04: the PR was squash-merged (`gh pr merge --admin --squash`). The monorepo's per-task history has no bisect value here — the branch is one commit — and squash keeps main's first-parent log one-line-per-change, matching the repo's convention."
  - "68-04: the worktree was left on feat/meshtk-mqtt5-vendor-sync rather than moved to main. Its tree hash is IDENTICAL to merged main (7a9a10e), `main` is already checked out in another worktree, and no destructive reset was needed to make the content correct."

patterns-established:
  - "Composed-tree reproduction as the release gate for any overlay/vendor mechanism — neither repo alone is what gets compiled"
  - "Byte-comparison sweep of the entire tracked overlay, reported as SAME/DIFFERS/MISSING_UPSTREAM counts, so 'mirrors upstream' is a measurement and not a claim"

requirements-completed: []

coverage:
  - id: D1
    description: "The vendor-sync branch is based on origin/main, not on the stale release branch in this worktree"
    requirement: "MQV5-07"
    verification:
      - kind: other
        ref: "`git worktree add /Users/khundeck/working/dc34-mqtt5 -b feat/meshtk-mqtt5-vendor-sync origin/main` -> HEAD at 2d83142; `git merge-base --is-ancestor origin/main HEAD` exits 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every tracked Go/tmpl file in the monorepo meshtk overlay is byte-identical to its counterpart on upstream meshtk main"
    requirement: "MQV5-07"
    verification:
      - kind: other
        ref: "`cmp -s` sweep over all 78 tracked .go/.tmpl paths under internal/ excluding internal/embedded/ -> SAME=78 DIFF=0 MISSING_UPSTREAM=0 (pre-sync: SAME=75 DIFF=3)"
        status: pass
      - kind: other
        ref: "grep gates on the synced tree: peekConnectProtocolVersion=3, RemarshalEnvelope=2, 'func readFrame'=1, inspectV5Connect=2 — meshtk#22 and #23 provably not reverted"
        status: pass
    human_judgment: false
  - id: D3
    description: "internal/embedded/gpx/embedded.go is byte-unchanged from origin/main — the go:embed con routes are intact"
    requirement: "MQV5-07"
    verification:
      - kind: other
        ref: "`git diff --numstat origin/main -- apps/run.mqtt/meshtk/internal/embedded/` empty on the branch AND `git diff origin/main~1 origin/main -- <same path>` empty across the merge commit"
        status: pass
      - kind: other
        ref: "in the composed tree the overlaid embedded.go still carries `//go:embed dc33/*.gpx ghosts/*.gpx city/*.gpx runs/*.gpx example/*.gpx` and all five directories resolve (four from the overlay, example/ from the clone)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A local reproduction of the CI overlay (fresh upstream clone plus the tracked overlay files) compiles"
    requirement: "MQV5-07"
    verification:
      - kind: build
        ref: "composed tree (clone HEAD c5341ce + 154-file overlay untarred on top): `go build ./...` exit 0, `go vet ./internal/app/server/` exit 0, `go test ./...` exit 0 (ok internal/app/server 0.633s)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The vendor-sync PR is merged to monorepo main so a buildpub run from main picks it up"
    requirement: "MQV5-07"
    verification:
      - kind: other
        ref: "PR whereiskurt/defcon.run.34#1072 state=MERGED, squash commit 6bbe18c; from origin/main: proxy_v5.go readFrame=1, proxy.go peekConnectProtocolVersion=3, inspect.go RemarshalEnvelope=2, inspect_v5.go inspectV5Connect=2; VERSION untouched at v0.0.71"
        status: pass
    human_judgment: false
  - id: D6
    description: "The release worktree is prepared with env.local.sh so 68-05 does not hit the exit-255 S3-sync landmine"
    verification:
      - kind: other
        ref: "`test -f /Users/khundeck/working/dc34-mqtt5/env.local.sh` exits 0; it defines TF_VAR_profile_prefix; the file is gitignored so `git status --porcelain` in the worktree stays empty"
        status: pass
    human_judgment: false
  - id: D7
    description: "The production image actually contains the dual codec and the 3.1.1 fleet is uninterrupted across the deploy"
    verification: []
    human_judgment: true
    rationale: "Nothing is built or deployed by this plan. It lands the overlay on monorepo main; buildpub/deploy/prod-verification and Kurt's Android 2.8.0 APK UAT are 68-05. The composed-tree build is the strongest machine-verifiable evidence available before a release."

# Metrics
duration: 15min
completed: 2026-07-29
status: complete
---

# Phase 68 Plan 04: meshtk Overlay Vendor-Sync Summary

**The tracked `apps/run.mqtt/meshtk/` overlay on monorepo main now mirrors upstream meshtk main for every tracked Go source — 11 files, 3,306 insertions — with `internal/embedded/` provably byte-untouched and the composition that CI actually compiles (fresh upstream clone + this overlay untarred on top) reproduced locally and green on `go build`, `go vet` and `go test`.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-29T06:46Z
- **Completed:** 2026-07-29T07:01Z
- **Tasks:** 2
- **Files:** 7 created, 4 modified (all vendored)
- **Overlay size:** 147 tracked files → **154**

## Accomplishments

- **The overlay mirrors upstream, measured file by file.** A `cmp -s` sweep over every tracked `.go`/`.tmpl` path under `internal/` outside `internal/embedded/` reports **SAME=78, DIFF=0, MISSING_UPSTREAM=0**. Before the sync it was SAME=75, DIFF=3 — `proxy.go`, `inspect.go`, `rules.go`.
- **The composed tree — the thing CI actually builds — was reproduced and is green.** `git ls-files` → tar (154 files) → `git clone --depth 1 whereiskurt/meshtk` (HEAD `c5341ce`) → untar on top → `go build ./...`, `go vet ./internal/app/server/`, `go test ./...` all exit 0. That is a single check proving three separate things: the overlay compiles against the **cloned** `go.mod`/`vendor/` (so the `paho.golang v0.22.0` pin really did travel via upstream main in 68-03), the overlaid `embedded.go` still resolves its `go:embed` GPX trees, and no vendored file references a symbol that exists only in a stale copy.
- **The ghost-at-0,0 landmine did not fire, and that is asserted rather than hoped.** `git diff --numstat origin/main -- apps/run.mqtt/meshtk/internal/embedded/` is empty on the branch *and* across the merge commit. In the composed tree the overlaid `embedded.go` still declares `//go:embed dc33/*.gpx ghosts/*.gpx city/*.gpx runs/*.gpx example/*.gpx` and all five directories are present — four supplied by the overlay, `example/` by the clone.
- **Nothing was reverted.** `peekConnectProtocolVersion` greps 3 in `proxy.go` (meshtk#23) and `RemarshalEnvelope` greps 2 in `inspect.go` (meshtk#22), on the branch and again read back out of merged `origin/main`.
- **`VERSION` was left alone at `v0.0.71`.** buildpub owns the bump and the Release PR; ECR repos are immutable, so a hand bump here would have burned a tag and failed 68-05's build on an already-published one.
- **Merged and readable from main.** [PR #1072](https://github.com/whereiskurt/defcon.run.34/pull/1072) is `MERGED` at `6bbe18c`, and the merge changed **exactly** the 11 intended files — nothing under `vendor/`, `cmd/`, `go.mod` or `go.sum`.
- **68-05's release worktree is pre-armed.** `/Users/khundeck/working/dc34-mqtt5` has `env.local.sh` copied in, and its tree hash (`7a9a10e`) is **identical** to merged main.

## Task Commits

| # | Task | SHA | Type |
|---|------|-----|------|
| 1 | Vendor the dual codec into the run.mqtt overlay | `12ddd44c` | feat |
| 2 | Composed-CI-overlay reproduction, PR, merge | *(no code change)* | — |
| — | **Squash merge to monorepo main (PR #1072)** | **`6bbe18c`** | merge |

Task 2 produced no tracked file change by design: it is a verification, a PR and a merge. Its artifact is the merge commit and the (gitignored) `env.local.sh` in the release worktree.

Commits are on `feat/meshtk-mqtt5-vendor-sync` in `/Users/khundeck/working/dc34-mqtt5`, branched from `origin/main` @ `2d83142`. Plan metadata is committed separately on `release/2026-07-26-230957`.

## Recorded artifacts

### The overlay set actually synced

```
apps/run.mqtt/meshtk/internal/app/server/proxy.go                  M   (+3 / v5 dispatch in both read loops)
apps/run.mqtt/meshtk/internal/app/server/inspect.go                M   (v5 CONNECT cred swap + PUBLISH seam)
apps/run.mqtt/meshtk/internal/app/server/rules.go                  M   (+7 / codec-agnostic rewrite plumbing)
apps/run.mqtt/meshtk/internal/app/server/README.md                 M   (+72 / dual-codec operator section)
apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go               A
apps/run.mqtt/meshtk/internal/app/server/inspect_v5.go             A
apps/run.mqtt/meshtk/internal/app/server/proxy_v5_test.go          A   (616 lines)
apps/run.mqtt/meshtk/internal/app/server/proxy_v5_publish_test.go  A
apps/run.mqtt/meshtk/internal/app/server/inspect_v5_test.go        A
apps/run.mqtt/meshtk/internal/app/server/proxy_v4_golden_test.go   A
apps/run.mqtt/meshtk/internal/app/server/proxy_v5_e2e_test.go      A
                                                    11 files, +3306 / -22
```

Deliberately NOT synced: `internal/embedded/**` (monorepo-authoritative), `VERSION`, `Dockerfile.meshtk`, `meshtk.*.yaml`, `nodes.*.json` (con config), `internal/app/server/testdata/` (supplied by the clone).

### The four grep gates

On the branch, and re-read out of merged `origin/main`:

```
$ grep -c peekConnectProtocolVersion .../internal/app/server/proxy.go       -> 3
$ grep -c RemarshalEnvelope          .../internal/app/server/inspect.go     -> 2
$ grep -c 'func readFrame'           .../internal/app/server/proxy_v5.go    -> 1
$ grep -c inspectV5Connect           .../internal/app/server/inspect_v5.go  -> 2

$ git show origin/main:apps/run.mqtt/meshtk/VERSION                         -> v0.0.71
$ git diff --numstat origin/main -- .../internal/embedded/                  -> (empty)
$ git diff origin/main~1 origin/main -- .../internal/embedded/              -> (empty)
$ git diff --name-only origin/main~1 origin/main -- .../VERSION             -> (empty)
```

### Composed-CI-overlay reproduction

```
$ git ls-files apps/run.mqtt/meshtk | sed 's#^apps/run.mqtt/meshtk/##'  ->  154 files
$ tar -C apps/run.mqtt/meshtk -cf overlay.tar -T files.txt
$ git clone --depth 1 https://github.com/whereiskurt/meshtk.git composed
    HEAD -> c5341ce39154ee87e937b6fd2ae2bb7b2d120efb   (== upstream main, PR #25 merge)
$ tar -C composed -xf overlay.tar

$ go build ./...                    exit 0   (no output)
$ go vet ./internal/app/server/     exit 0   (no output)
$ go test ./...                     exit 0   ok github.com/whereiskurt/meshtk/internal/app/server 0.633s
                                             (e2e SKIPs without MESHTK_E2E=1)

$ grep -n 'go:embed' composed/internal/embedded/gpx/embedded.go
  12://go:embed dc33/*.gpx ghosts/*.gpx city/*.gpx runs/*.gpx example/*.gpx
$ ls composed/internal/embedded/gpx/
  city  dc33  embedded.go  example  ghosts  runs
```

No `inconsistent vendoring` — the 68-03 upstream pin plus `go mod vendor` output carried correctly through the clone, exactly as designed.

### Merge verification

```
$ gh pr view 1072 --repo whereiskurt/defcon.run.34 --json state -q .state  -> MERGED
$ git rev-parse origin/main                                                -> 6bbe18c1...
$ git diff --name-only origin/main~1 origin/main                           -> the 11 files above, nothing else
$ test -f /Users/khundeck/working/dc34-mqtt5/env.local.sh                   -> exit 0
$ git rev-parse HEAD^{tree}  ==  git rev-parse origin/main^{tree}          -> 7a9a10e8... (identical)
```

## Files Created/Modified

All eleven are vendored copies taken byte-for-byte from `whereiskurt/meshtk` main @ `c5341ce`; none were authored or edited here. See the overlay table above.

## Decisions Made

See `key-decisions` in the frontmatter. The three that matter downstream:

- **The plan's premise was right about the risk and wrong about the blast radius.** The overlay in *this session's checkout* (`release/2026-07-26-230957`) really is stale at `v0.0.66`, with zero hits for `peekConnectProtocolVersion`. But `origin/main` was already at `v0.0.71` carrying meshtk#22, #23 and #24. Branching from `origin/main` — the single instruction the plan flagged as the one mistake that ships a regression — is precisely what turned a potential dozens-of-files revert into a clean 3-file update. The gate did its job by *not* firing.
- **`README.md` was synced beyond the plan's literal mirror scope.** It is the only other tracked file under `internal/`, and 68-03 wrote the dual-codec operator section (protocol table, log actions, reason codes with verified wire bytes, how to run the e2e) into it specifically for the person reading logs at 3am. The overlay shadows upstream on every conflicting path, so *not* syncing it would have deleted that documentation from the production image tree.
- **`go test ./...` was added to the composed-tree gate.** The plan asked for `go build` + `go vet`. Seven of the eleven synced files are tests; they compile nowhere else in this pipeline, and a vendored test that does not build is a landmine armed for whoever next runs the suite from a release image tree.

## Deviations from Plan

### Auto-fixed / additive

**1. [Rule 2 - Missing critical functionality] `internal/app/server/README.md` added to the sync set**

- **Found during:** Task 1, while enumerating the tracked overlay
- **Issue:** the plan scoped the mirror to files "with a `.go` or `.tmpl` extension". `README.md` is the only other tracked file under `internal/`, and it differed from upstream by the entire 72-line dual-codec operator section that plan 68-03 created. Because the overlay shadows upstream at build time, shipping it stale would have removed the new ops documentation from the image tree — the same class of failure (overlay silently reverting upstream work) that this plan's threat register is built around, applied to docs instead of code.
- **Fix:** synced it with the other ten files.
- **Files modified:** `apps/run.mqtt/meshtk/internal/app/server/README.md`
- **Verification:** `cmp -s` against upstream reports identical; the section renders in the merged main
- **Commit:** `12ddd44c`

**2. [Additive verification] `go test ./...` run in the composed tree**

- **Found during:** Task 2
- **Issue:** the plan's composed-tree gate was `go build ./...` + `go vet ./internal/app/server/`. Neither compiles `_test.go` files in the other packages, and seven of the eleven synced files are tests.
- **Fix:** ran the full suite in the composed tree as well. Exit 0, `ok internal/app/server 0.633s`.
- **Files modified:** none
- **Commit:** n/a (verification only)

### Plan-shape adaptations (no functional deviation)

1. **The overlay count is 154, not a number asserted in advance.** The plan explicitly forbade hardcoding a count and told the executor to read `git ls-files` at execution time; it was 147 before the sync and 154 after. Recorded here as an observation, never as a gate.

2. **`internal/app/server/testdata/` is not gitignored.** The plan's rationale ("it does not match the negation glob") is inaccurate — `meshtk/*` matches only top-level entries, so everything under `internal/` is trackable and `git check-ignore` reports the testdata path as NOT IGNORED. The plan's *instruction* was still followed (do not add it) and is still correct: the fresh clone supplies it, and the only consumer is the env-gated e2e. Recorded so nobody later "fixes" a non-existent gitignore rule.

3. **Squash merge rather than a merge commit.** 68-03 deliberately used a merge commit upstream so this plan had a bisectable history to vendor from. That reasoning does not transfer: the monorepo branch is one commit, and the repo's main log is one-line-per-change.

4. **No `git reset`/branch surgery on the worktree.** The plan said to leave the worktree in place for 68-05. Its branch tree hash is identical to merged main (`7a9a10e`), so its content already *is* main; `main` is checked out in a different worktree anyway and no destructive operation was needed or performed.

---

**Total deviations:** 1 Rule 2 addition (README), 1 additive verification, 4 plan-shape adaptations with no behavioral effect.
**Impact on plan:** every acceptance criterion in both tasks is satisfied literally. No scope creep.

## Issues Encountered

- **The plan's stale-overlay warning was calibrated to the wrong ref.** It cited "36 commits stale, VERSION v0.0.66, zero `peekConnectProtocolVersion`" — all true of `release/2026-07-26-230957`, none of it true of `origin/main`. Anyone re-reading the plan after the fact will see a dire warning next to a 3-file diff and may conclude the gate was skipped. It was not: the greps were run pre-sync (3 and 2, already correct on `origin/main`) and post-sync. The lesson is narrow and worth keeping — *a staleness claim is a property of a ref, not of a repository*, and the plan's own remedy (branch from `origin/main`) is what made the claim moot.
- **`gh pr merge --admin --squash` printed nothing on success.** State had to be read back with `gh pr view --json state`. Not a failure, but a silent success is easy to mistake for a silent failure in an autonomous run.
- **The monorepo PR had no CI checks** (`gh pr checks 1072` → "no checks reported"). As upstream in 68-03, the local gates are the entire gate — which is why the composed-tree build was re-run before the merge rather than trusted from an earlier step.

## Known Stubs

None. Every file in this plan is a verbatim vendored copy of already-merged, already-tested upstream code.

## Threat Flags

None. No new network endpoint, auth path, file-access pattern or schema change was introduced by this plan — it moves already-reviewed code between repositories. All six `mitigate` dispositions in the plan's threat register are implemented:

| Threat | Status |
|---|---|
| T-68-04-01 (stale overlay reverting shipped fixes) | Mitigated — branched from `origin/main` in a fresh worktree; `merge-base --is-ancestor` verified; both grep gates asserted pre- and post-sync and again from merged main |
| T-68-04-02 (`embedded.go` clobbered) | Mitigated — `internal/embedded/**` excluded from the mirror; `git diff --numstat` empty on the branch and across the merge; the composed tree's `go:embed` directives and all five asset dirs verified present |
| T-68-04-03 (compiles in neither repo alone but breaks composed) | Mitigated — full `resolve_meshtk` reproduction; `go build` + `go vet` + `go test` all exit 0 |
| T-68-04-04 (`inconsistent vendoring`) | Mitigated — did not occur; the composed build read the cloned `go.mod`/`vendor/` and succeeded, so the 68-03 pin travelled intact. No module file was committed to the monorepo |
| T-68-04-05 (hand-bumped VERSION collides with the immutable ECR tag) | Mitigated — `VERSION` untouched at `v0.0.71`, asserted by an empty `git diff --name-only` across the merge |
| T-68-04-SC (CI clones upstream main — the supply chain *is* upstream main) | Mitigated — the reproduction cloned upstream and recorded the resolved HEAD (`c5341ce`, the PR #25 merge from 68-03); the composed build would have failed had the `paho.golang` pin been absent or altered |

## User Setup Required

None for this plan. State of the world: the dual codec is on **monorepo main**, but **nothing is built and nothing is deployed**. `mqtt.defcon.run:4433` is still running the v0.0.71 image, which still rejects v5 CONNECTs with `0x84`.

## Next Phase Readiness

**Ready for 68-05 (buildpub → deploy → prod verification → UAT):**

- Monorepo `main` is at `6bbe18c` and carries the dual codec in the overlay. `buildpub` must run **from main** — that is where the overlay lives.
- `apps/run.mqtt/meshtk/VERSION` is `v0.0.71` and **unbumped on purpose**; buildpub performs the bump and opens the Release PR. Do **not** `--skip-bump` onto v0.0.71 — ECR is immutable and that tag is already published.
- `/Users/khundeck/working/dc34-mqtt5` is checked out at content identical to main with `env.local.sh` present, so a local `release-all.sh` fallback will not die at the post-build S3 sync with exit 255.
- CONTEXT-locked release sequence: `gh workflow run buildpub.yml -f apps=run.mqtt -f regions=use1` → `gh workflow run deploy.yml -f region=us-east-1 -f pr_number=skip -f invalidate_cache=false` → `aws ecs wait services-stable --cluster app-use1-dc34 --services run-mqtt-use1`. Cluster is `app-use1-dc34`; meshtk log group is `/ecs/run-mqtt-meshtk-run-mqtt-use1-dc34`.

**Landmines carried forward:**

- **Verify the deployed image, not the workflow's green tick.** ECS does a rolling replace; the old task drains while the new one health-checks.
- **Prod verification recipe (proven for v0.0.70):** raw v5 CONNECT via `python3` ssl socket to `mqtt.defcon.run:4433` must now complete auth with real creds instead of returning `2003008400`; then confirm `action=MQTT5_REJECT` stops appearing for v5 attempts while 3.1.1 `action=ALLOW` fleet traffic continues uninterrupted across the deploy.
- **Pre-existing, still deliberately unfixed:** `RewritePayloadString` dereferences `*ip.Meshtastic.Cipher` unconditionally, so `RewriteHelloGoodbye` panics on a non-encrypted `TEXT_MESSAGE_APP` packet. Predates this phase; affects 3.1.1 identically.
- **cac1 is out of scope** — S3 asset sync is broken there for run.mqtt; use1-only is standing practice.

**Carried forward:**

- MQV5-07 (release half) — buildpub/deploy use1 → prod v5 CONNECT verification → Kurt's Android 2.8.0-open.6 APK UAT (68-05).

## Self-Check: PASSED

All 11 vendored files exist on disk in `/Users/khundeck/working/dc34-mqtt5` and resolve from `origin/main` (`git show origin/main:<path>` succeeds for `proxy_v5.go`, `inspect_v5.go`, `proxy.go`, `inspect.go`); commit `12ddd44c` and merge commit `6bbe18c` both resolve; PR #1072 reports `MERGED`; `git status --porcelain` in the vendor-sync worktree is empty; the composed-tree `go build`/`go vet`/`go test` all exited 0; `env.local.sh` is present in the release worktree.

---
*Phase: 68-mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa*
*Completed: 2026-07-29*
