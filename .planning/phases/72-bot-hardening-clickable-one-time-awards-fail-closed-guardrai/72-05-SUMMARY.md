---
phase: 72-bot-hardening-clickable-one-time-awards-fail-closed-guardrai
plan: 05
subsystem: infra
tags: [terragrunt, github-actions, lambda, qr-resolver, deploy, regression-probe, prod]

# Dependency graph
requires:
  - phase: 72-01
    provides: the reserved `/a/<nonce>` award namespace in the resolver lib + its 188-test suite
provides:
  - "`/a/<nonce>` and `/A/<nonce>` live on q.defcon.run, 302ing to the run.human claim page"
  - "`probe-qr-resolver.sh` — a committed, re-runnable live probe over the eight live short codes + the award namespace"
  - "a captured pre/post contrast proving zero regression on b c d f g h p r"
affects: [72-02 claim page, 72-03 ricky award DM, 72-09 release]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Capture a REAL pre-change baseline of live behavior before an infra apply; a comparison against an assumed baseline is not evidence"
    - "Assert the change LANDED (award path flipped) as well as that nothing else moved — a guard that passes on a no-op deploy is not a guard"
    - "Probe with the resolver's `x-qr-test` header so verification traffic is not counted as scans"

key-files:
  created:
    - .planning/phases/72-bot-hardening-clickable-one-time-awards-fail-closed-guardrai/probe-qr-resolver.sh
  modified: []

key-decisions:
  - "The apply required a merge to `main`: the `terraform-apply` GitHub environment has a deployment-branch policy of exactly `main`, so the plan's 'push the branch so CI can see it' works for terragrunt-plan (no policy) but is impossible for terragrunt-apply. Resolved with a narrow resolver-only PR rather than by widening the policy."
  - "Merged by SQUASH, not rebase: the `MainProtection` ruleset requires signed commits and linear history, and local git signing is a no-op on this host — a rebase would replay unsigned commits and be rejected, while GitHub signs the squash commit itself."
  - "The probe sends the SSM `x-qr-test` token, so the 22 verification GETs produce no scan log lines and do not pollute the rollup analytics. Test mode suppresses logging only; redirect behavior is identical, so the probe still measures real user behavior."

patterns-established:
  - "Pre-apply plan on the MERGE SHA, read before dispatching the apply — so a plan that proposes destroys is caught before auto-approve applies it, not after."

requirements-completed: [BOT-01]

coverage:
  - id: D6
    description: "Live prod behaviour of the /a/ route and the eight single-letter codes after deploy (the human_judgment item 72-01 deferred to this plan)"
    requirement: "BOT-01"
    verification:
      - kind: manual
        ref: "pre/post probe capture — 8/8 live codes byte-identical (md5 cd9dd638… on both sides), both award paths 404 -> 302"
        status: pass
    human_judgment: true

# Metrics
duration: 21min
completed: 2026-07-31
status: complete
---

# Phase 72 Plan 05: Deploy the `/a/<nonce>` Resolver + Prod Regression Probe Summary

**`q.defcon.run/a/<nonce>` and `/A/<nonce>` are live, 302ing to the run.human claim page — and a real
pre-apply baseline proves all eight live single-letter short codes (`b c d f g h p r`, including the
`didhtp1` payphone on `/c` and the rickroll on `/r`) came through the deploy byte-identical.**

## Performance

- **Duration:** ~21 min of work (21:38Z first commit → 21:59Z verified), plus a blocking checkpoint
  between them for merge authorization
- **Tasks:** 3 of 3
- **Workflow runs:** 4 (2 plan, 1 apply, 0 wasted applies)

## The headline evidence

**Pre/post diff — the ONLY two lines that changed are the award namespace:**

```
10,11c10,11
< /a/probe 404 -
< /A/probe 404 -
---
> /a/probe 302 https://run.defcon.run/use1/ctf/claim?nonce=probe
> /A/probe 302 https://run.defcon.run/use1/ctf/claim?nonce=probe
```

**All eight live short codes are byte-identical**, checked two independent ways — per-line
string equality and an md5 over the whole eight-line block:

```
/b IDENTICAL   /c IDENTICAL   /d IDENTICAL   /f IDENTICAL
/g IDENTICAL   /h IDENTICAL   /p IDENTICAL   /r IDENTICAL

md5 of the 8-code block:  baseline cd9dd6384ee47fd126de526b09a4fa50
                          after    cd9dd6384ee47fd126de526b09a4fa50
```

Baseline as captured (query strings redacted here; the raw capture is in the scratchpad):

```
/b 302 https://bib.defcon.run/
/c 302 https://run.defcon.run/use1/ctf/claim?<c=…>            <- the didhtp1 payphone
/d 302 https://run.defcon.run/use1/api/auth/auto-signin?<callbackUrl=…>
/f 302 https://flash.defcon.run/
/g 302 https://www.youtube.com/watch?<v=…>
/h 302 https://q.defcon.run/r                                  <- chains to the rickroll
/p 302 https://www.youtube.com/watch?<v=…>
/r 302 https://www.youtube.com/watch?<v=…>                     <- the rickroll
/a       404 -
/a/probe 404 -
/A/probe 404 -
```

Bare `/a` stays `404` on both sides — it degrades to `empty` (the same short-path rule as `ctf`),
which the resolver maps to `notFound()`.

## Accomplishments

- **`probe-qr-resolver.sh` committed** under the phase directory. 87 lines, re-runnable, idempotent.
  Emits `<path> <status> <location>` per target, headers only, **no redirect following** (the Location
  header is the assertion target; following it would hit the claim page and could park a cookie).
  Bounded connect/total timeouts, stable ordering, `-` for a missing Location and `ERR` for a transport
  failure so a network blip can never masquerade as a passing line.
- **A REAL pre-apply baseline was captured**, at 21:38Z, before the branch was even pushed — not
  assumed, not reconstructed. 11 lines, all eight codes 302 with non-empty Locations.
- **The resolver deployed via a scoped CI apply.** `0 added, 1 changed, 0 destroyed`.
- **The W5 case-insensitivity fix is confirmed live in prod** — `/A/probe` 302s rather than 404ing,
  which is the assertion that proves the amended 72-01 code (not some older build) is serving.
- **The nonce survives verbatim through the whole chain**: `/a/probe` and `/A/probe` both land on
  `?nonce=probe`. The resolver normalizes only the letter it owns.

## Task Commits

1. **Task 1: probe script + baseline** — `4290afe1` (on `worktree-rickyaward`)
2. **Task 2: apply via CI** — no repo commit; the deliverable is workflow run `30668311318`
3. **Task 3: post-apply probe** — no repo commit; the deliverable is the captured contrast above

The resolver code + probe reached `main` as squash merge **`cf61501a`** via **PR #1149**.

## Deploy Record

| Item | Value |
|------|-------|
| PR | **#1149** — `feat(72-01): reserve /a/<nonce> on the q.defcon.run resolver` |
| Merge sha | **`cf61501ab3951103cfdcb6a5ccd2c2de34fb918f`** (squash) |
| Plan run (branch) | `30667321432` — success, `0 add / 1 change / 0 destroy` |
| Plan run (merge sha) | `30668215137` — success, `0 add / 1 change / 0 destroy` |
| **Apply run** | **`30668311318`** — success, `Apply complete! Resources: 0 added, 1 changed, 0 destroyed` |
| Lambda | `qr-resolver-dc34-use1` |
| `LastModified` | `2026-07-19T00:29:30.000+0000` → **`2026-07-31T21:58:12.000+0000`** |
| `CodeSha256` | `nnWxoW7T…` → **`Nj1FJBzDW06+KVE97GOiNsQzUBLHsD4FSGiNFr/L0vg=`** (exactly the hash the plan predicted) |
| Function state | `State: Active`, `LastUpdateStatus: Successful` |

The apply touched **only** `aws_lambda_function.resolver`, updated in place. The ALB listener rule,
the target group, the CloudFront distribution (`E4SID56HIMXZW`) and the Route53 alias all refreshed
with **no proposed action** — zero destroys, zero replacements, in both the pre-merge plan, the
on-merge-sha plan, and the apply itself.

## Deviations from Plan

### D1 — the apply required a merge to `main` (plan premise was wrong)

**The plan's Task 2 said "push the branch so CI can see the resolver change," which is true for the
plan half and impossible for the apply half.**

- **Found during:** Task 2, before dispatching anything.
- **Issue:** `terragrunt-apply.yml` runs under `environment: terraform-apply`, which has a deployment
  branch policy of exactly one entry — `main` (`custom_branch_policies: true`, unchanged since
  2025-12-28). `terraform-plan` has no policy at all, which is why the scoped plan ran fine from
  `worktree-rickyaward` and masked the problem.
- **Confirmed empirically, not just from the API:** the Phase 71 session hit this same wall earlier the
  same day. Run `30650567272` (`Terragrunt Apply`, branch `gsd/phase-71-heat-map-layers`) concluded
  `failure` having executed **0 steps** in **2 seconds** (17:17:19Z → 17:17:21Z) with **no logs** — the
  signature of an environment-gate rejection before checkout. That session then applied successfully
  from `main` twice (`30654859050`, `30655157386`).
- **Not auto-fixed.** Adding the worktree branch to the policy would have unblocked it in one API call
  and was explicitly refused: it is a deliberate guardrail, outside the granted authorization, and
  widening it to ship one Lambda would be exactly the wrong trade. Merging to `main` also needs the
  user's explicit approval under AGENTS.md Essential Rule 2, so this was escalated as a blocking
  checkpoint rather than resolved unilaterally.
- **Resolution:** Kurt approved a narrow, resolver-only PR (#1149) cherry-picked onto `main`.

### D2 — one extra commit in the cherry-pick (12, not the 11 specified)

`19c0ef09` (`docs(72-01): complete the reserved /a/<nonce> award namespace plan`) was added to the
approved 11. It is the commit that **creates** `72-01-SUMMARY.md`; without it the two approved docs
commits (`5caa4cc5`, `6a416340`) modify a file that does not exist on `main` and conflict. It adds only
that one `.planning/` file (+299 lines), so it stays inside the approved gate. With it the cherry-pick
applied **clean, zero conflicts**.

### D3 — squash merge rather than rebase

The `MainProtection` ruleset on `main` enforces `required_signatures` + `required_linear_history`, and
git signing is a no-op on this host — a rebase merge would have replayed 12 unsigned commits and been
rejected. GitHub signs the squash commit itself, so squash satisfies both rules. The TDD RED→GREEN
history is preserved on `worktree-rickyaward` and in PR #1149.

**Total deviations:** 3, all process/mechanics. **Zero** deviations to the resolver code — the tree
that deployed is byte-identical to the tree 72-01 produced.

## Verification

Every plan-level step executed and passing:

1. **Scoped plan read before applying** — twice. On the branch (`30667321432`) and again on the exact
   merge sha (`30668215137`). Both `Plan: 0 to add, 1 to change, 0 to destroy`, the single change being
   `aws_lambda_function.resolver` in-place. **Zero destroys of the ALB listener rule, target group or
   CloudFront distribution** in either.
2. **Apply concluded `success`** — `30668311318`, `Apply complete! Resources: 0 added, 1 changed, 0
   destroyed`.
3. **Deploy actually took** — `LastModified` advanced off `2026-07-19T00:29:30.000+0000`, and
   `CodeSha256` matches the hash the plan predicted. CI green was not treated as proof.
4. **Pre/post diff shows only the two award lines changed** — plus an independent per-line and md5
   check of the eight-code block.
5. **Live award probe returns 302 to the claim page carrying the nonce** — both `/a/probe` and
   `/A/probe` → `?nonce=probe`.
6. **Unit suite green on the merged tree** — `vitest run` → 10 files, **188 tests, 0 failures**.
7. **Merge gate** — `git diff --name-only origin/main...HEAD` outside
   `apps/run.qr/lambda/resolver/` and `.planning/` was **empty**. Additionally, the resolver tree on the
   PR branch hashed identical (`8c557431…`) to the sha the plan was computed against, so the plan output
   was valid for exactly the code that shipped.

## Threat Mitigations Applied

| Threat ID | Mitigation | Evidence |
|-----------|-----------|----------|
| T-72-23 (DoS on live short codes) | Real pre-apply baseline + byte-identical post-apply diff on all eight letters | md5 `cd9dd638…` identical both sides; 8/8 per-line IDENTICAL; diff shows only the 2 award lines |
| T-72-24 (unscoped apply) | `modules=qr-resolver` + `region=us-east-1` explicit on every dispatch; scoped plan read first | 3 runs, all scoped; no apply-all, no local apply, no `-target` widening. Refused to widen the deployment-branch policy |
| T-72-25 (assuming CI green = deployed) | `LastModified` + `CodeSha256` confirmed to move before probing | `2026-07-19T00:29:30` → `2026-07-31T21:58:12`; `CodeSha256 = Nj1FJBzD…` as predicted |

No new security-relevant surface beyond the register. No threat flags.

## Known Stubs

None.

## Notes for Downstream Plans

- **`/c` and the award path share one page.** `/c` resolves to
  `https://run.defcon.run/use1/ctf/claim?c=<challenge>` — the same claim page 72-02 adds `?nonce=` to.
  Checked and safe: `app/(ctf)/ctf/claim/page.tsx` destructures `c`, `v` and `nonce` separately and
  branches nonce-first, so the payphone path and the award path coexist. Any future edit to that page
  must keep the `?c=` branch intact or it breaks a live con artifact.
- **72-09's release** should note that `main` already carries the 72-01 resolver code as `cf61501a`;
  re-landing it from `worktree-rickyaward` will be a no-op for those files.
- **Re-running the probe** after any future resolver change is one command; the script is committed at
  `.planning/phases/72-…/probe-qr-resolver.sh`. Export `QR_TEST_TOKEN` (SSM
  `/dc34/infra/use1/qr/test_token`, needs `--with-decryption`) to keep the GETs out of scan analytics.

## User Setup Required

None.

## Self-Check: PASSED

Artifacts verified present on disk:

- `.planning/phases/72-…/probe-qr-resolver.sh` — FOUND (also on `main` via `cf61501a`)
- `<scratchpad>/qr-resolver-baseline.txt` — FOUND, 11 lines
- `<scratchpad>/qr-resolver-after.txt` — FOUND, 11 lines

Commits verified in `git log`: `4290afe1` (probe, `worktree-rickyaward`) and `cf61501a` (squash merge on
`main`) — both FOUND.

Workflow runs verified via `gh api`: `30667321432` success, `30668215137` success, `30668311318`
success. Live behavior re-verified post-apply, not inferred from the workflow conclusion.

---
*Phase: 72-bot-hardening-clickable-one-time-awards-fail-closed-guardrai*
*Completed: 2026-07-31*
