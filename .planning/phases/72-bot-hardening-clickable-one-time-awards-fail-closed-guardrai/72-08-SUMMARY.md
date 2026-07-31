---
phase: 72-bot-hardening-clickable-one-time-awards-fail-closed-guardrai
plan: 08
subsystem: ctf
tags: [dynamodb, rotation, sops, ssm, secrets, operator-script, prod-mutation]
requires:
  - "72-04: `ricky-fallback-url` declared in the mqtt secret group in site.hcl"
provides:
  - "the ricky Ctf row carries a fresh answerHash — the publicly-published static code is DEAD"
  - "mqtt.ricky-fallback-url present as ciphertext in .secrets.sops.json"
  - "scripts/rotate-ricky-flag.mts — rotate stage (done) + teardown stage (72-10)"
affects:
  - "72-09: BLOCKED until the secrets apply lands — ECS refuses to start a task whose valueFrom parameter is missing"
  - "72-10: its teardown has ONE target, not two — the Qr row it expects does not exist"
tech-stack:
  added: []
  patterns:
    - "conditional UpdateItem naming only the attributes that change, so preservation is by construction rather than by careful copying"
    - "secret printed exactly once to stdout, extracted into `sops --set` by the shell without ever crossing an agent transcript"
    - "round-trip proof by digest — compare sha256 of the decrypted SOPS value against the script's output, never the values themselves"
key-files:
  created:
    - apps/run.human/webapp/scripts/rotate-ricky-flag.mts
  modified:
    - infra/terraform/live/site/.secrets.sops.json
    - .planning/phases/72-bot-hardening-clickable-one-time-awards-fail-closed-guardrai/deferred-items.md
decisions:
  - "The rotate stage guards on AWS_PROFILE and RUN_DYNAMODB_REGION matching the production pair and exits 2 otherwise, rather than merely printing them — the plan asked for a guard, and a printed value only helps someone who reads the output before it scrolls."
  - "Proved the old code dead by hashing the code scraped from the LIVE public interstitial and comparing it to the row's current answerHash, instead of the plan's browser probe. The probe needs a signed-in session and returns a redirect that proves nothing; the hash comparison is deterministic and is exactly what judgeSolve computes."
  - "Confirmed CTF_ANSWER_SALT is unset on the live run-human task definition before trusting hashAnswer's default salt. Had prod overridden it, the rotation would have written a hash the judge could never match and the new URL would have been born dead."
  - "Shredded the plaintext transcript once the SOPS round-trip was proven by digest, rather than keeping it as a backup — `sops --decrypt --extract` recovers the value, so the backup carried only risk."
metrics:
  duration: ~25 min
  completed: 2026-07-31
status: blocked
---

# Phase 72 Plan 08: Rotate the ricky Flag + Seed the Fallback Secret Summary

The static ricky code that has been published in plaintext at
`defcon.run/qr/rick_astley_loves_desert_running` since 2026-07-30 is **dead in production**,
and its replacement is encrypted in SOPS — but the secrets apply that provisions the SSM
parameter **cannot run from this branch**, so 72-09 is blocked until the infra commits reach
`main`.

## Status: 2 of 3 tasks complete, Task 3 blocked at the apply

| Task | State |
|------|-------|
| 1 — write the rotation script | complete |
| 2 — DRY-RUN review + production write | complete |
| 3 — seed SOPS **and** apply the secrets unit | **SOPS seeded and committed; the apply is BLOCKED** |

## What happened

### 1. The script (`scripts/rotate-ricky-flag.mts`, 285 lines)

Two stages, modelled on `setup-ricky-flag.mts`.

- **rotate** (default, 72-08) — conditional `UpdateItem` on `$run#challenge_ricky` / `$ctf_1`
  in `run-human-electro`, naming only `answerHash` and `updatedAt`.
- **teardown** (`--teardown`, 72-10 only) — the `Qr` row delete and the S3 interstitial
  delete. Unreachable without its own flag; the stage selector is a single ternary at the
  bottom of `main()`.

DRY-RUN by default; `--confirm` required for any mutation. Hard-guards on
`AWS_PROFILE=dc34-application` and `RUN_DYNAMODB_REGION=us-east-1`, exiting 2 on either
mismatch, and prints the resolved stage/mode/table/region/profile as its first line.

`grep -c '\.put(' ` is **0**. That is the whole safety argument: a `Put` rewrites the entire
item, so one omitted attribute would silently reset `solveCount` — the ordinal allocator —
to zero. An `UpdateItem` cannot touch an attribute it does not name, so `solveCount`,
`createdAt` and `enabled` are preserved *by construction*. The condition
`attribute_exists(pk) AND attribute_exists(sk)` means a missing row exits non-zero instead of
degrading into a create.

### 2. The production write

DRY-RUN transcript: `/private/tmp/.../scratchpad/ricky-rotate-dryrun.txt`. It printed the
pre-state, named exactly one row, stated it wrote nothing, and contained **no URL and no
code** (`grep -c 'ctf/claim'` = 0, `grep -ci 'nggyu'` = 0). All six of the orchestrator's
hard criteria held, so the `--confirm` run followed without a human round-trip, per the
owner's explicit authorisation.

Read-back evidence, both from `ConsistentRead` GetItems:

| Attribute | Before | After |
|-----------|--------|-------|
| `solveCount` | 0 | 0 |
| `createdAt` | `2026-07-30T14:06:51.724Z` | `2026-07-30T14:06:51.724Z` |
| `enabled` | `true` | `true` |
| `challenge` / `answerType` | `ricky` / `static` | `ricky` / `static` |
| `updatedAt` | `2026-07-30T14:06:51.724Z` | `2026-07-31T22:21:00.265Z` |
| `answerHash` | — | changed (values withheld) |

**The old code is provably dead.** Rather than the plan's browser probe — which needs a
signed-in session and yields a redirect that proves nothing — the code was scraped from the
LIVE public interstitial, hashed with `hashAnswer`, and compared against the row's current
`answerHash`:

```
old public code verifies against live answerHash: NO — DEAD
live row: solveCount=0 createdAt=2026-07-30T14:06:51.724Z enabled=true
```

That is exactly the comparison `judgeSolve` performs for `answerType: "static"`, so it is a
direct statement about the judge's behaviour, not a proxy for it.

**Salt checked first.** `hashAnswer` falls back to a default salt unless `CTF_ANSWER_SALT`
overrides it. Had production overridden it, the rotation would have written a hash the judge
could never match and the replacement URL would have been born dead. The live
`run-human-use1-dc34` task definition has it in neither `environment` nor `secrets` on either
container, matching the 2026-07-14 design spec's statement that it is unset in prod.

### 3. The secret — seeded, encrypted, committed

`mqtt.ricky-fallback-url` written with `sops --set`, which edits in place and never puts
plaintext on disk. The value went from the script's stdout into the SOPS document via shell
variable only — **it was never rendered into this agent's transcript**, and the one line that
would have carried it was filtered through `sed` before display.

| Check | Result |
|-------|--------|
| key present in `.secrets.sops.json` | yes, `ENC[AES256_GCM,…]`, 211 chars |
| decrypted value == what the script printed | **yes** — sha256 prefixes both `d6965a878127f7a9` |
| other `mqtt` values changed | **none** (`guardrails-token`'s diff line is a trailing comma; the value byte-compares identical) |
| other secret groups changed | none |
| `git diff \| grep -ciE 'nggyu\|ctf/claim\?c=ricky'` | **0** |
| `git grep -qiE 'nggyu\|ctf/claim\?c=ricky' HEAD -- infra/terraform/live/site` | **no match** |
| plaintext scratch files remaining | 0 (shredded after the digest proof) |

Committed as ciphertext in `bc0beeea` and pushed.

## BLOCKER: the secrets apply cannot run from this branch

`gh workflow run terragrunt-apply.yml --ref worktree-rickyaward -f region=us-east-1 -f modules=secrets`
produced run **`30669743120`**, which **failed 2 seconds after start with zero steps executed
and no job log**. There is no error message anywhere in the run — it looks like an
infrastructure flake, and it is not.

Root cause: `terragrunt-apply.yml` declares `environment: terraform-apply`, and that
environment carries a custom deployment-branch policy whose **only** allowed entry is `main`.

```
$ gh api repos/:owner/:repo/environments/terraform-apply
  protection_rules: ["branch_policy"], custom_branch_policies: true
$ gh api .../deployment-branch-policies
  main
```

Corroborated by history: every `main` dispatch of this workflow succeeded; both non-`main`
dispatches failed identically (`30669743120` here, `30650567272` on
`gsd/phase-71-heat-map-layers`).

**There is no workaround inside the workflow.** `workflow_dispatch` declares no `ref` input —
only the `workflow_call` path does — so a `main`-triggered run cannot be pointed at this
branch's config:

```
$ gh workflow run terragrunt-apply.yml --ref main ... -f ref=worktree-rickyaward
HTTP 422: Unexpected inputs provided: ["ref"]
```

And applying from `main` as it stands would provision nothing: `main` has **neither** the
`ricky-fallback-url` key in `site.hcl` (72-04's commit `610194b5`, unmerged) **nor** the
encrypted value.

**So the apply requires the phase's infra commits to be on `main` first.** That is a
merge-to-`main` decision — reserved for the owner by AGENTS.md Essential Rule 2, and
overlapping 72-09 Task 1, which opens the phase PR. It was therefore **not** taken
unilaterally. Handed to the orchestrator.

The plan's own verify one-liner for Task 3 (`aws ssm get-parameter …`) currently returns
`ParameterNotFound`, which is the correct and expected reading of this blocked state.

### Why this matters for sequencing

`modules/secrets/v1.0.0/locals.tf:48` resolves an undeclared key to `""`, and AWS rejects an
empty `SecureString`; separately ECS refuses to start a task whose `valueFrom` parameter does
not exist. **72-09's `deploy.yml` must not run until this parameter exists**, or the ghosts
task will fail to start. 72-09 already encodes this check ("If it is absent, stop: 72-08's
secrets apply did not land").

## Discovery: 72-10's teardown has one target, not two

The `Qr` row `72-10-PLAN.md` expects at `pk = "$run#code_rick_astley_loves_desert_running"`,
`sk = "$qr_1"` **does not exist**. A `GetItem` returns nothing and a full `__edb_e__ = "Qr"`
scan lists 16 codes, none of them ricky's. `$run#code_rick` is a different, unrelated row —
the 2026-07-12 rickroll redirect to `https://r.defcon.run` — and **must not be deleted**.
`setup-ricky-flag.mts` intended to create the long-code row (it is the second item in that
script's put loop) but it never landed.

No code change needed: the teardown stage already reports `Qr row present: no (already gone)`
and skips the delete rather than erroring, as its DRY-RUN transcript
(`scratchpad/ricky-teardown-dryrun.txt`) shows. But 72-10's acceptance criterion "it must name
exactly two targets" should be relaxed to one, and the row's existence must not be used as
evidence the teardown ran. Logged in `deferred-items.md`.

## Deviations from Plan

**1. [Rule 2 — missing critical check] Verified the prod answer salt before trusting the write.**
Not in the plan. `hashAnswer` reads `CTF_ANSWER_SALT` with an in-code default; a prod
override would have made the rotation write a hash the judge can never match, producing a
silent, undetectable failure — the row would look correctly rotated and the new URL would
never award. Confirmed unset on both containers of `run-human-use1-dc34`.

**2. [Rule 1 — the plan's verification could not prove its claim] Replaced the "old code is
dead" browser probe with a hash comparison.** Plan verification item 3 asks for a signed-in
load of the legacy claim URL and a check for "a graceful non-award". That requires a browser
session this executor does not have, and a non-award is also what an unauthenticated redirect
looks like — it cannot distinguish "code rejected" from "not signed in". Substituted the
deterministic equivalent: scrape the code from the live public interstitial, hash it, compare
to the live `answerHash`. Same predicate `judgeSolve` evaluates, no session required.

**3. [blocked, not deviated] The Task 3 apply.** See BLOCKER above. Not worked around, not
forced, not substituted with a hand-rolled `aws ssm put-parameter` — that would be exactly
the out-of-band infra mutation AGENTS.md Essential Rule 4 forbids, and would leave terraform
state disagreeing with reality.

## Known Stubs

None.

## Threat Flags

None beyond the plan's `<threat_model>`. Dispositions as built:

| Threat | Mitigation as built |
|--------|---------------------|
| T-72-40 reset the ordinal allocator | `UpdateItem` naming 2 attributes; pre/post read-back printed; `.put(` count 0 |
| T-72-41 create instead of update | `attribute_exists(pk) AND attribute_exists(sk)`; absent row exits 2 |
| T-72-42 new code leaking | printed once; DRY-RUN prints none; SOPS-only; diff + `git grep` at HEAD both clean; plaintext scratch shredded; never entered the agent transcript |
| T-72-43 echoing the SecureString | the SSM read requests only `Type` and `Version`; the SOPS round-trip was proven by sha256 prefix, not by value |
| T-72-44 ECS refusing to start | **NOT yet discharged** — the parameter does not exist. Surfaced as a hard blocker on 72-09 rather than assumed away |
| T-72-45 premature teardown | teardown never invoked with `--confirm`; the interstitial still serves 200 |
| T-72-46 wrong table/region | hard guard on profile + region, exit 2 on mismatch; both printed first |

## Verification

| # | Check | Result |
|---|-------|--------|
| 1 | DRY-RUN reviewed, `solveCount: 0` confirmed before any write | PASS |
| 2 | `--confirm` pre/post `solveCount`/`createdAt`/`enabled` identical | PASS |
| 3 | old static code no longer verifies against the live `answerHash` | PASS (`NO — DEAD`) |
| 4 | no plaintext code in the diff or in `HEAD -- infra/terraform/live/site` | PASS |
| 5 | `terragrunt-apply.yml modules=secrets` succeeded; SSM parameter exists | **FAIL — blocked, see BLOCKER** |

## Next action (owner decision required)

Merge this phase's infra commits to `main` — at minimum 72-04's `610194b5` (the `site.hcl`
key declaration) and this plan's `bc0beeea` (the encrypted value) — then dispatch
`terragrunt-apply.yml -f region=us-east-1 -f modules=secrets` **from `main`**, confirm
`/dc34/secrets/use1/mqtt/ricky-fallback-url` exists as a `SecureString`, and only then let
72-09 run `deploy.yml`. Merging the whole phase branch is 72-09 Task 1 and would satisfy this
too; a narrow infra-only PR would also work and keeps the release diff unchanged.

## Commits

| Task | Commit | Scope |
|------|--------|-------|
| 1 | `ed611bfe` | `feat(72-08): add the two-stage ricky flag rotation script` — 1 file, +285 |
| 3 | `bc0beeea` | `feat(72-08): seed the ricky mint-failure fallback URL into SOPS` — 1 file, +4/-3 |

Task 2 is a production data mutation with no repository artifact of its own; its evidence is
the read-back table above.

## Self-Check: PASSED

All 4 files present on disk; both commits found in `git log`. `git grep -lE 'nggyu-[0-9a-f]{24}'`
across the whole tree at HEAD returns **nothing** — the rotated code appears in no tracked
file, and the superseded public code lives only in the S3 HTML, never in git.
