---
phase: 56-ctf-flag-types-slice-3-wordlist-one-time-codes-ctfcode-entit
plan: 02
subsystem: ctf-judge
tags: [ctf, wordlist, single-use-claim, electrodb, judge, covert-invariant]
requires:
  - "CtfCode ElectroDB entity (pk=challenge, sk=codeHash) — @/entities/ctf (56-01)"
  - "hashAnswer salt seam — lib/ctf-hash"
  - "isRepeatable / scoreBucket flag-type helpers — lib/ctf-flag-types"
  - "computePoints / activeTierCeiling — lib/ctf-scoring"
provides:
  - "CtfStore.claimCode op + defaultStore impl (atomic attribute_not_exists(claimedBy) claim)"
  - "judgeSolve wordlist answer-type branch (validate-by-claim + dedicated finalize)"
  - "isRepeatable(wordlist) === true"
  - "defaultStore.recordScoreEvent upsert (create-then-set) — safe for the repeatable path too"
affects:
  - "56-03 (admin bulk-load hashes codes through the SAME hashAnswer seam the claim uses)"
tech-stack:
  added: []
  patterns:
    - "validate-by-claim: the atomic single-use CtfCode claim IS the wordlist answer check AND the idempotency guard"
    - "dedicated wordlist finalize placed BEFORE the isRepeatable block so it bypasses claimScoreEvent"
    - "ledger row keyed by codeHash (globally single-use ⇒ exactly one scoring event per code)"
key-files:
  created:
    - "apps/run.human/webapp/src/lib/__tests__/ctf-judge-wordlist.test.ts"
    - "apps/run.human/webapp/src/lib/__tests__/ctf-wordlist-covert-invariant.test.ts"
  modified:
    - "apps/run.human/webapp/src/lib/ctf-judge.ts"
    - "apps/run.human/webapp/src/lib/ctf-flag-types.ts"
    - "apps/run.human/webapp/src/lib/__tests__/ctf-flag-types.test.ts"
decisions:
  - "The CtfCode conditional claim replaces claimScoreEvent for wordlist — a player may redeem multiple DISTINCT codes, so the once-per-window claim must NOT gate them"
  - "recordScoreEvent changed patch→upsert: the wordlist finalize has no pre-existing CtfScoreEvent row (PLAN-CHECKER CORRECTION); upsert is idempotent for the repeatable path too"
  - "No perPlayerMax gate on wordlist: the finite code pool + per-code single-use is the natural bound; a byUser count before recordScoreEvent would mis-order"
  - "Ledger row keyed by bucket=codeHash (not a time bucket) — each globally single-use code maps to exactly one CtfScoreEvent"
metrics:
  duration: ~7m
  completed: 2026-07-15
  tasks: 3
  files: 5
status: complete
---

# Phase 56 Plan 02: Judge Wordlist Branch (Atomic Single-Use Claim) Summary

Wired the judge's `wordlist` answer type (CTFT-13): the answer validation IS an atomic single-use `CtfCode` claim (`attribute_not_exists(claimedBy)`), a used/unknown code is a NON_SOLVE byte-indistinguishable from a wrong answer (same shape + same `ctfJudgeLog('no-solve')`, guess/codeHash never logged), a valid first-time code scores through a create/upsert ledger row + accrue, and the covert CSS path stays byte-identical (grep gate). The two-claimers-one-wins race is proven at the store/claim seam.

## What Was Built

**Task 1 — atomic `claimCode` store op + RED race tests** (`ctf-judge.ts`, `ctf-judge-wordlist.test.ts`, commit `5731a89d`)
- Added the OPTIONAL `CtfStore.claimCode?({ challenge, codeHash, user, claimedAt }): Promise<{ claimed: boolean }>` op, documented as the atomic single-use claim that is BOTH the wordlist answer validation AND the idempotency guard (so the wordlist path never touches `claimScoreEvent`).
- `defaultStore.claimCode`: `CtfCode.patch({challenge, codeHash}).set({claimedBy, claimedAt}).where((attr, op) => op.notExists(attr.claimedBy)).go()` → `{claimed:true}`. Catch mirrors `claimSolve`/`claimScoreEvent`: a used-code collision OR a missing row (unknown code) ⇒ `{claimed:false}`; a present-and-still-unclaimed row rethrows so the judge degrades to a non-solve rather than mis-report a win. `op.notExists` confirmed available in ElectroDB 3.5.3 (`quota.ts` uses the same `.where` pattern).
- `defaultStore.recordScoreEvent` changed `patch`→`upsert` (create-then-set) — see the correction below.
- RED tests (in-memory `claimCode` fake over a `Map<codeHash,{claimedBy?}>`, no await between check and set): two-claimers-one-wins race, second distinct code scores, unknown + already-claimed non-solve.

**Task 2 — judge wordlist branch + `isRepeatable`** (`ctf-judge.ts`, `ctf-flag-types.ts`, tests, commit `d4894337`)
- `JudgeCtf.answerType` widened to `"static" | "otp" | "wordlist"`; `narrowCtf` narrows `"wordlist"` (anything else still reads static).
- Answer-validation dispatch: a `wordlist` arm computes `codeHash = guessHash ?? hashAnswer(guess ?? "")` (same seam admin-loaded codes use) then `ok = store.claimCode ? (await store.claimCode(...)).claimed : false`. A false claim (used/unknown/absent-op) falls through the shared `if (!ok)` → NON_SOLVE + identical `ctfJudgeLog('no-solve')`.
- Dedicated wordlist finalize placed BEFORE the generic `if (isRepeatable(ctf))` block so wordlist NEVER calls `claimScoreEvent`: allocate the global ordinal, honor `globalMax` (n > globalMax ⇒ solved:true/points:0/capped/no-accrue), else `computePoints(n, ctf, now)`, record the ledger row via `recordScoreEvent({ bucket: codeHash, ... })`, `accrue`, and carry `effect` only on a credited (points>0) solve.
- `isRepeatable(wordlist) === true` (multiple distinct codes ⇒ ledger, not once-ever CtfSolve; also makes the CTFT-06 flip guard treat static↔wordlist as a genuine repeatable-ness change).
- GREEN tests: valid code scores points>0 + one ledger row keyed by codeHash + one accrue; used/unknown ⇒ exact NON_SOLVE object + same no-solve log with neither guess nor codeHash in the payload; covert `guessHash`-only path solves indistinguishably; `globalMax`-exceeded claim is capped/points:0/no-accrue. Added the `isRepeatable(wordlist)` case to `ctf-flag-types.test.ts`.

**Task 3 — covert-invariant grep gate** (`ctf-wordlist-covert-invariant.test.ts`, commit `ba6fc94f`)
- Mirrors `ctf-reward-covert-invariant.test.ts`: reads each covert source file (covert-egg.ts, EggTrigger.tsx, CtfCelebration.tsx, ctf-covert-css.ts, assets/theme/route.ts) from disk and asserts NONE references any Slice-3 token (`wordlist`, `CtfCode`, `claimCode`, `codeHash`) — the single-use logic stays confined to the visible judge/store path (SC4 / T-53-04-01).

## Plan-Checker Correction Applied

The wordlist finalize bypasses `claimScoreEvent`, so NO `CtfScoreEvent` row pre-exists when the ledger write runs. The prior `defaultStore.recordScoreEvent` was a `.patch()` that REQUIRES a pre-existing row → on the wordlist path it would raise `ConditionalCheckFailed` → judge catch → `NON_SOLVE`, so a VALID first-time code would be marked claimed yet score NOTHING on real DynamoDB — and the in-memory Map fake (a plain array push, no precondition) would NOT catch it. **Fix:** `recordScoreEvent` now UPSERTs (`CtfScoreEvent.upsert(...).set(...)`), which creates the row if absent and is idempotent for the normal repeatable path (which pre-creates it). Verified by reading the actual ElectroDB call — the create-vs-patch distinction is NOT unit-covered by the Map fake, and both the code comment and the wordlist test header call this out.

## Verification

- `npx vitest run` (full webapp suite) — **626/626 green** (60 files; +15 over 56-01's 611: 8 wordlist + 6 covert + 1 flag-types), Node 23.6.0.
- Wordlist + judge + flag-types suites — 46/46 green; both covert-invariant gates — 12/12 green.
- `npx tsc --noEmit` — 0 NEW errors on `ctf-judge.ts` / `ctf-flag-types.ts` / the new test files; only the 2 known pre-existing out-of-scope errors remain (`dropdown-user.tsx` svg module, `checkin.test.ts` `.model`).
- Manual read-through: the wordlist finalize (ctf-judge.ts:402) returns BEFORE the `if (isRepeatable(ctf))` block (:427); `claimScoreEvent` is only reached inside the repeatable block, never on the wordlist path.
- Covert files unchanged since 56-01 (`git diff --name-only` empty for the 5 covert modules).

## Threat Mitigations Applied

| Threat ID | Mitigation |
|-----------|-----------|
| T-56-02-01 (double-claim race) | Claim is a single conditional `attribute_not_exists(claimedBy)` patch — exactly one concurrent winner; proven by the race test (SC1). |
| T-56-02-02 (used/unknown distinguishability) | Used/unknown/absent-op all return the shared NON_SOLVE + identical `ctfJudgeLog('no-solve')`; covert grep gate proves no wordlist token leaks into covert files (SC2/SC4). |
| T-56-02-03 (guess logged) | Wordlist branch reuses `ctfJudgeLog` (no value param); a test asserts neither guess nor codeHash appears in the log payload. |
| T-56-02-04 (double-scoring one code) | The code claim is the sole idempotency guard; the ledger row is keyed by codeHash so a code maps to exactly one scoring event; wordlist bypasses the once-per-window claim by design. |
| T-56-SC (supply chain) | No new packages (reuses electrodb + node crypto via hashAnswer). |

## Deviations from Plan

None beyond the PLAN-CHECKER CORRECTION (which the plan itself mandated): `recordScoreEvent` patch→upsert. All three tasks executed as written.

## Known Stubs

None. The judge wordlist path is fully wired end-to-end behind the store seam. The admin bulk-load UI to populate `CtfCode` rows is the scoped work of 56-03.

## Self-Check: PASSED

- FOUND: apps/run.human/webapp/src/lib/ctf-judge.ts (claimCode op + defaultStore impl + wordlist branch + finalize + narrowCtf wordlist arm)
- FOUND: apps/run.human/webapp/src/lib/ctf-flag-types.ts (isRepeatable recognizes wordlist)
- FOUND: apps/run.human/webapp/src/lib/__tests__/ctf-judge-wordlist.test.ts
- FOUND: apps/run.human/webapp/src/lib/__tests__/ctf-wordlist-covert-invariant.test.ts
- FOUND commit: 5731a89d (feat — claimCode store op + RED tests)
- FOUND commit: d4894337 (feat — judge wordlist branch + isRepeatable)
- FOUND commit: ba6fc94f (test — covert grep gate)
