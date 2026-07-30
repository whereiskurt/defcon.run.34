---
phase: 69-meshtk-shared-chain-hardening-pre-existing-blockers-found-by
plan: 06
subsystem: meshtk-proxy
tags: [meshtk, mqtt, vendor-sync, upstream, merge-gate, supply-chain]
status: complete
requirements: [MQFX-05]
requires:
  - "69-01..69-05 (the 19-commit upstream branch fix/shared-chain-hardening)"
provides:
  - "upstream whereiskurt/meshtk main @ 8747f1da1d81858365ce35f3f66f07f42a2482e4 (PR #29 merged)"
  - "monorepo overlay at byte-parity with that merge sha (PR #1106 merged, f7d19592)"
  - "the two new overlay source files: logsafe.go, proxy_v5_rawsubscribe.go"
  - "the overlay copies of the six new test files from 69-01..69-05"
  - "a released-code path unblocked for the 69-07 buildpub release"
affects:
  - apps/run.mqtt/meshtk/internal/app/server/ (18 files)
tech-stack:
  added: []
  patterns:
    - "extract from the merge commit's BLOBS (git show <sha>:<path>), never from a working tree"
    - "reverse-direction new-file check, because a forward sweep over files present in both repos is blind to a file never copied"
    - "reproduce the CI overlay composition locally and build it BEFORE the merge"
    - "re-run the merge gate AT merge time rather than trusting an earlier run"
key-files:
  created:
    - apps/run.mqtt/meshtk/internal/app/server/logsafe.go
    - apps/run.mqtt/meshtk/internal/app/server/logsafe_test.go
    - apps/run.mqtt/meshtk/internal/app/server/proxy_recover_test.go
    - apps/run.mqtt/meshtk/internal/app/server/proxy_v5_connect_fail_test.go
    - apps/run.mqtt/meshtk/internal/app/server/proxy_v5_rawsubscribe.go
    - apps/run.mqtt/meshtk/internal/app/server/proxy_v5_rawsubscribe_test.go
    - apps/run.mqtt/meshtk/internal/app/server/rules_rewrite_test.go
    - apps/run.mqtt/meshtk/internal/app/server/will_strip_test.go
  modified:
    - apps/run.mqtt/meshtk/internal/app/server/cmd.go
    - apps/run.mqtt/meshtk/internal/app/server/inspect.go
    - apps/run.mqtt/meshtk/internal/app/server/inspect_v5.go
    - apps/run.mqtt/meshtk/internal/app/server/proxy.go
    - apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go
    - apps/run.mqtt/meshtk/internal/app/server/proxy_v5_rawpublish.go
    - apps/run.mqtt/meshtk/internal/app/server/proxy_v5_rawpublish_test.go
    - apps/run.mqtt/meshtk/internal/app/server/proxy_v5_publish_test.go
    - apps/run.mqtt/meshtk/internal/app/server/proxy_v5_e2e_test.go
    - apps/run.mqtt/meshtk/internal/app/server/rules.go
decisions:
  - "Merge commits (not squash) upstream, so the 19 per-plan commits the five summaries cite by sha remain reachable on main"
  - "gh pr merge --admin on the monorepo: the ONLY block was REVIEW_REQUIRED with zero CI checks defined — exactly the human-review gate the owner's Phase 69 authorization waives; no red check was bypassed"
  - "Forward parity reported as two BUCKETS (content mismatch vs monorepo-only) because VERSION does not exist upstream and cannot be a 'mismatch' in a sweep over files present in both"
metrics:
  duration: ~12m
  tasks: 3
  files: 18
  completed: 2026-07-30
---

# Phase 69 Plan 06: Upstream Merge + Vendor-Sync Summary

The five hardening plans are on upstream `main` and in the monorepo overlay, byte-parity-verified
forward **and** in reverse, behind two mechanical merge gates whose every item is recorded below.
Nothing was released or deployed — that is 69-07, and merging here is what unblocks it.

## Artifacts

| Item | Value |
|------|-------|
| Upstream PR | [whereiskurt/meshtk#29](https://github.com/whereiskurt/meshtk/pull/29) — **MERGED** 2026-07-30T14:46:25Z |
| Upstream branch base sha | `609a5c547a57442c17672264c7d5497d9c6f47e7` |
| **Upstream merge sha** | **`8747f1da1d81858365ce35f3f66f07f42a2482e4`** (`8747f1d`) |
| Monorepo PR | [defcon.run.34#1106](https://github.com/whereiskurt/defcon.run.34/pull/1106) — **MERGED** 2026-07-30T14:52:46Z |
| Monorepo branch | `gsd/phase-69-vendor-sync-meshtk-hardening`, base `3ca053e16d3f79a0235ac5566a28de2ec18a0155` |
| **Monorepo merge sha** | **`f7d19592f6adb26d36aa540a9a7e06d92daea229`** (`f7d1959`) |
| Vendor-sync commit | `576a1e1d` |
| `apps/run.mqtt/meshtk/VERSION` | `v0.0.75` — **untouched**; buildpub owns the bump in 69-07 |

`8747f1d` is the sha `apps/build.sh resolve_meshtk` now shallow-clones on every release.

## UPSTREAM MERGE GATE — verbatim results

Run from the branch tip (`609a5c5..5dbdffc`, 19 commits), then items 1–8 re-run from the merged
`main`. Item 9 is a pre-merge condition and does not apply after.

| # | Item | From the branch tip | From the merged main |
|---|------|---------------------|----------------------|
| 1 | `git status --porcelain` | empty (clean tree) | empty (clean tree) |
| 2 | `go build ./...` | exit 0 | exit 0 |
| 3 | `go vet ./internal/app/server/` | exit 0 | exit 0 |
| 4 | `go test ./internal/app/server/ -count=1` | `ok … 0.527s` | `ok … 0.489s` |
| 5 | `go test -race ./internal/app/server/ -count=1` | `ok … 1.504s` | `ok … 1.477s` |
| 6 | `go test -run TestV4SessionForwardBytesGolden -count=1` | `ok … 0.346s` | `ok … 0.339s` |
| 6 | golden diff vs base | **empty — not edited** | **empty** (`git log --follow` = **1** commit) |
| 7 | `git diff --stat <base> -- go.mod go.sum vendor/` | **empty** | **empty** |
| 8 | `git diff --stat <base> -- internal/embedded/` | **empty** | **empty**; `git show --stat HEAD -- internal/embedded/` lists no file |
| 9 | `origin/main` == recorded base `609a5c5` | **confirmed** — base unmoved since 69-01 branched | n/a (pre-merge condition) |

**Every item was green before the merge. No item was red at any point, so no stop was triggered.**

### Live-mosquitto e2e: **RAN — not skipped**

`MESHTK_E2E=1 go test ./internal/app/server/ -run TestE2EDualCodec -count=1` executed against a
real **mosquitto 2.0.22** (Homebrew, `/opt/homebrew/sbin/mosquitto`; the test brings up its own
broker on a free port). **15/15 subtests PASS, zero SKIPs**, from the branch tip **and** again
from the merged main.

Subtests include `v5_unmodelled_property_publish_is_clamped_end_to_end` — the end-to-end form of
the CR-04-stays-closed guarantee this phase had to preserve while 69-04 added a property-id table
to the alias walk.

This is recorded as a genuine RUN, not coverage inferred from a SKIP.

## MONOREPO MERGE GATE — verbatim results, re-run AT merge time

Re-run against the branch as it stood at the moment of merge rather than trusted from Task 2 —
the gate must be true when the merge happens, not at some earlier moment.

| # | Item | Result at merge time |
|---|------|----------------------|
| 1 | Forward per-file sha256 parity vs `git show 8747f1d:<path>` | **PASS** — 167 tracked overlay files; **100 compared** (present in both); **1 content mismatch**: `internal/embedded/gpx/embedded.go`; **67 monorepo-only**, including `VERSION`. Two named exceptions, **no third**. |
| 2 | Reverse-direction new-file check | **PASS** — **8 files, 0 missing**, every blob hash matching |
| 3 | `embedded.go` sha256 == pre-sync value | **PASS** — `98679cba…624b` identical |
| 4 | `git diff --name-only origin/main -- {VERSION,go.mod,go.sum,vendor/,internal/embedded/}` | **PASS** — empty |
| 5 | Overlay `proxy_v4_golden_test.go` == merge-sha blob | **PASS** — both `e49ae2ed7c93f62c0607aa04aa34c6c0521dbe88c0e147eba2f3b904951757d6` |
| 6 | Composed CI tree builds; composed `embedded.go` is the monorepo copy | **PASS** — `go build ./...` exit 0; hash matches |
| 7 | `grep -c 'GPXFile:' Dockerfile.meshtk` | **PASS** — **4** (≥ 1) |

**All seven green. The merge followed a fully green gate; no item was red, so no stop was triggered.**

### Item 1 — forward parity sweep, in full

Compared against **merge-commit blobs** (`git show 8747f1d:<path>`), never an upstream working
tree, so a stray uncommitted local edit upstream could not leak in.

```
tracked overlay files total : 167
present in BOTH (compared)  : 100
MISMATCHES                  : 1
   MISMATCH: internal/embedded/gpx/embedded.go
monorepo-only (no upstream) : 67
```

The 67 monorepo-only files are the con-config overlay `resolve_meshtk` exists to layer:
`VERSION`, `Dockerfile.meshtk`, `internal/app/fleet/gpx_routes_test.go`, the 43-file GPX route
tree (`ghosts/`, `runs/`, `city/`, `dc33/`), `meshtk.dc34.yaml`, `meshtk.localdev.yaml`, and the
22 ghost/rabbit node seed JSONs. All pre-existing and **byte-untouched by this sync** — the
branch diff is exactly the 18 server files.

### Item 2 — reverse-direction new-file check, in full

A forward sweep over files present in **both** repositories cannot see a file that was never
copied at all, and six of the eight new files are test files — precisely that class.

| Plan | File | sha256 (first 16) | Present |
|------|------|-------------------|---------|
| 69-01 | `rules_rewrite_test.go` | `7c2ad65add82c869…` | OK |
| 69-02 | `proxy_recover_test.go` | `58d7c53d78f46d14…` | OK |
| 69-03 | `logsafe.go` | `051c6bb107448124…` | OK |
| 69-03 | `logsafe_test.go` | `cae88ffa1ed1eb45…` | OK |
| 69-03 | `will_strip_test.go` | `5640869df4614718…` | OK |
| 69-05 | `proxy_v5_rawsubscribe.go` | `b9605f1271662dd7…` | OK |
| 69-05 | `proxy_v5_rawsubscribe_test.go` | `3a907198f5ffbda4…` | OK |
| 69-05 | `proxy_v5_connect_fail_test.go` | `0fd93145faabe05c…` | OK |

**count: 8 — missing: 0.** 69-04 created no new files; it extended `proxy_v5_rawpublish.go`,
`proxy_v5_rawpublish_test.go` and `proxy_v5_publish_test.go`.

Independently corroborated before the copy: exactly these 8 paths were `ABSENT` from the overlay
and the other 10 were `TRACKED`, which is the same 8/10 split the five summaries record.

### Item 3 — `embedded.go` sha256, the #1009 regression class

```
BEFORE           : 98679cbaf354f31028a3a1b4b64ef9c1e250baa4c3fb4daa0356a7d72561624b
AFTER            : 98679cbaf354f31028a3a1b4b64ef9c1e250baa4c3fb4daa0356a7d72561624b
COMPOSED CI TREE : 98679cbaf354f31028a3a1b4b64ef9c1e250baa4c3fb4daa0356a7d72561624b
```

Byte-identical in all three positions, and `internal/embedded/` is absent from the branch
diffstat **and** from the merge diff. This file is monorepo-authoritative (upstream's version
embeds only `example/*.gpx`); overwriting it is what stranded all 24 GPX-driven sim nodes
**twice** (#1009, fixed by #1028/#1029). Proven unchanged by hash, never assumed.

### Item 6 — composed CI tree, in full

`resolve_meshtk` clones upstream **first** and untars the `git ls-files` overlay **second**,
which is why an overlay file always shadows its upstream counterpart. Reproduced exactly:

```
git archive 8747f1d              → 2319 upstream files
+ overlay untarred on top        →  167 tracked overlay files
= composed                          2386 files

go build ./...                              exit 0
go test ./internal/app/server/              ok  (0.504s)
go test ./internal/app/fleet/               ok  (0.415s)
```

`2319 + 67 = 2386` — the file arithmetic independently cross-checks the sweep's
100-in-both / 67-monorepo-only split.

`TestDC34FleetGPXRoutesResolve` passing **in the composed tree** is the strongest available
evidence the GPX embed survived: all 24 referenced routes resolve in the tree CI will actually
build, not merely in the monorepo checkout.

Run before the PR was opened and again at merge time — an `inconsistent vendoring` failure is
cheap to catch here and expensive mid-release.

### Merge scope — the merge touched only the server package

```
git diff --name-only f7d1959^ f7d1959 | grep -v '^apps/run.mqtt/meshtk/internal/app/server/'
  → (nothing)
```

18 files, all under `apps/run.mqtt/meshtk/internal/app/server/` (10 modified, 8 new).
`git diff --name-only f7d1959^ f7d1959 -- VERSION go.mod go.sum vendor/ internal/embedded/`
prints nothing. `git merge-base --is-ancestor f7d1959 origin/main` exits **0** (it *is*
`origin/main`).

## Landmines Actively Avoided

| Landmine | How it was avoided | Evidence |
|----------|--------------------|----------|
| Stale `release/2026-07-26-230957` overlay (v0.0.66, **no v5 files**) silently reverting meshtk#22/#23/#27 | branched explicitly from `origin/main` (`3ca053e`), never from the release checkout | `git merge-base --is-ancestor origin/release/2026-07-26-230957 HEAD` exits **non-zero** |
| `go.mod` change without a matching `vendor/` update → `inconsistent vendoring` at image build (`COPY . .`) | zero dependency change **asserted**, not assumed, in both repos; composed tree built locally first | empty diffs in both repos; `go build ./...` exit 0 in the composed tree |
| Clobbering `internal/embedded/gpx/embedded.go` — the #1009 regression, shipped twice | never synced; hash captured before the first copy and asserted after, at merge time, and in the composed tree | three identical sha256s + `TestDC34FleetGPXRoutesResolve` green in the composed tree |
| Hand-editing `VERSION` into an immutable-ECR-tag collision | not touched; left at `v0.0.75` | empty diff on the branch and in the merge diff |
| `main` pinned by another worktree | branched from `origin/main` by name, never assumed `main` was checked out | branch base recorded as `3ca053e` = `origin/main` |
| A file never copied at all, invisible to a forward sweep | reverse-direction check over all 8 new files | 8 present, 0 missing, hashes matching |
| Uncommitted upstream working-tree edits leaking in | every file extracted with `git show <merge-sha>:<path>` | upstream tree asserted clean at the merge sha |

## Deviations from Plan

**None behavioral.** Three shape notes:

1. **Forward parity is reported as two buckets, not "exactly two mismatches".** The gate's
   wording asks for "exactly two mismatches, named `VERSION` and
   `internal/embedded/gpx/embedded.go`". A sweep over files present in **both** repositories
   structurally cannot report `VERSION` as a mismatch, because upstream has no such path — the
   plan's own item text acknowledges this ("`VERSION` (monorepo-only; upstream has no such
   file)"). So the sweep reports **1 content mismatch** (`embedded.go`) plus **`VERSION` in the
   monorepo-only bucket**, and asserts both by name. That is the same two named exceptions the
   gate demands, measured the only way the measurement can be taken. **A third exception of
   either kind would have stopped the plan**; there was none.

2. **`VERSION` is `v0.0.75`, not `v0.0.74`.** The plan's `read_first` records `v0.0.74`; the file
   on `origin/main` reads `v0.0.75` (bumped by the derived-scoring release after this phase was
   planned). Immaterial to every assertion — the requirement is that `VERSION` is **unchanged**,
   which holds, and buildpub owns the bump in 69-07 either way. Recorded so 69-07 bumps from the
   right floor.

3. **`gh pr merge --admin` was required on the monorepo PR.** `gh pr merge --merge` was refused:
   *"the base branch policy prohibits the merge."* Before reaching for `--admin`, the block was
   diagnosed rather than bypassed: `gh pr checks 1106` reports **"no checks reported"** and
   `mergeStateStatus: BLOCKED` / `reviewDecision: REVIEW_REQUIRED`. **Zero CI checks are defined
   on this repo and none was red** — the sole block was the required-human-review rule, which is
   exactly the gate the owner's recorded Phase 69 authorization waives and which the seven-item
   mechanical gate stands in for. `--admin` was used as the mechanism the plan explicitly
   anticipates, **not** as a licence to merge past a red gate. Had a check existed and been red,
   the plan would have stopped.

**Task 1 produced no monorepo commit** — it is branch/PR/merge work in `/Users/khundeck/working/meshtk`
only, and its `<files>` entry says so ("no source edits"). Its evidence lives in this summary and
in PR #29.

## Scope Boundary Honoured

- **Nothing released, nothing deployed, no `terragrunt apply`.** `VERSION` unbumped; no
  `build.sh` / `release-all.sh` invocation; `git status --porcelain` shows no terraform state
  artifacts. 69-07 owns the release and the deploy.
- `git stash` **never invoked** in either repository; the pre-existing `stash@{0}` in the meshtk
  repo (`WIP on main: 0033004`) was left untouched, as 69-03/04/05 also recorded.
- No `git clean`, no force-push, no `reset --hard`. Upstream merged with a merge commit so the 19
  per-plan commits the five summaries cite by sha stay reachable on `main`.
- No package-manager install ran in either repo. `go.mod`, `go.sum` and `vendor/` are byte-unchanged.
- Only `apps/run.mqtt/meshtk/internal/app/server/` was written in the monorepo.

## Threat Register Outcome

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-69-06-01 (Tampering, clobbering `embedded.go` — #1009, shipped twice) | mitigate | **Closed.** sha256 identical before, after, at merge time and in the composed CI tree; `internal/embedded/` absent from both the branch diffstat and the merge diff; `TestDC34FleetGPXRoutesResolve` green in the composed tree. |
| T-69-06-02 (Tampering, syncing from the stale `release/2026-07-26-230957` overlay) | mitigate | Branched from `origin/main`; the stale branch is **not** an ancestor of HEAD (assertion exits non-zero); base `3ca053e` is an ancestor of `origin/main`. |
| T-69-06-03 (Tampering, overlay drifting from the reviewed upstream state) | mitigate | Per-file sha256 over all 100 files present in both, against merge-sha **blobs**; exactly two named exceptions; a third would have stopped the plan. |
| T-69-06-04 (Tampering, a file never copied at all) | mitigate | Reverse-direction check: 8/8 present with matching blob hashes, 0 missing; corroborated by the pre-copy 8-ABSENT/10-TRACKED split. |
| T-69-06-05 (Tampering, uncommitted upstream edits leaking in) | mitigate | Every file extracted via `git show <merge-sha>:<path>`; upstream tree clean at the merge sha. |
| T-69-06-06 (EoP, no human reviews before both default branches) | accept | As planned. Owner's recorded Phase 69 authorization; residual bounded by two mechanical gates, both fully green and both recorded item by item. `--admin` bypassed a review requirement, never a check result. |
| T-69-06-07 (Tampering, merging past a red gate — cheap to do by accident under autonomy) | mitigate | Every item of both gates recorded verbatim; the monorepo gate **re-run at merge time** rather than trusted from Task 2; no assertion was edited to make anything pass. |
| T-69-06-08 (Tampering, a stale phase-branch base) | mitigate | `origin/main` re-fetched and confirmed still at `609a5c5` immediately before the merge — unmoved since 69-01 branched, so no rebase was needed. |
| T-69-06-09 (DoS, `inconsistent vendoring` surfacing mid-release) | mitigate | Zero dependency change asserted in both repos; CI composition reproduced and **built twice** — before the PR and again at merge time. |
| T-69-06-10 (Tampering, hand-editing `VERSION` into an immutable ECR tag collision) | mitigate | `VERSION` untouched at `v0.0.75` on the branch and in the merge diff. |
| T-69-06-SC (Tampering, dependency substitution during the sync) | mitigate | No package-manager install ran; `go.mod`/`go.sum`/`vendor/` byte-unchanged in both repositories. |

## Threat Flags

None. This plan copied reviewed bytes between two git repositories and merged two PRs; it
introduced no network endpoint, auth path, file access pattern or schema change of its own. The
security-relevant surface it *carries* is the 69-01..69-05 work, whose threat registers are
recorded in those summaries.

## Known Stubs

None.

## Self-Check: PASSED

- `apps/run.mqtt/meshtk/internal/app/server/logsafe.go` — exists, sha256 `051c6bb1…` matches the merge blob
- `apps/run.mqtt/meshtk/internal/app/server/proxy_v5_rawsubscribe.go` — exists, sha256 `b9605f12…` matches
- all six new test-file overlay copies — exist, hashes matching (reverse check, 8/8)
- upstream merge sha `8747f1da1d81858365ce35f3f66f07f42a2482e4` — present, PR #29 MERGED
- monorepo merge sha `f7d19592f6adb26d36aa540a9a7e06d92daea229` — present, PR #1106 MERGED, ancestor of `origin/main`
- vendor-sync commit `576a1e1d` — present in history
- `69-06-SUMMARY.md` — written to the phase directory

## Left For Later

- **69-07** releases and deploys: buildpub bumps `VERSION` from **`v0.0.75`**, then
  `deploy.yml`. Nothing in this plan bumped it, so the next tag is free.
- 69-07's production greps, all expecting **ZERO**, now that the code is in the release path:
  `action=PANIC_RECOVERED`, `action=WILL_STRIPPED`, `action=MQTT5_ALIAS_SCAN_INDETERMINATE`,
  `action=MQTT5_SUBSCRIBE_HEADER_FAIL`, and `action=MQTT5_PARSE_FAIL` lines carrying
  `answered=0x81`.
- 69-07 should also confirm no `client_id=` / `username=` / `mqtt_topic=` value came back
  **quoted** — a quoted value is 69-03's sanitizer reporting a tamper attempt, not a bug.
- **WR-03 remains open** (both relay paths handing mosquitto frames the proxy knows are
  malformed) and is not in MQFX-04. WR-06, WR-07, WR-09..WR-13 also remain open, including the
  pre-existing `gofmt` wart (WR-12).
- The 10 local `docs(69-*)` commits on `local-main-track` are still unpushed, as they have been
  since 69-01; the session close pushes them.
