---
phase: 56-ctf-flag-types-slice-3-wordlist-one-time-codes-ctfcode-entit
reviewed: 2026-07-15T08:39:50Z
depth: deep
files_reviewed: 7
files_reviewed_list:
  - apps/run.human/webapp/src/entities/ctf.ts
  - apps/run.human/webapp/src/entities/qr.ts
  - apps/run.human/webapp/src/lib/ctf-judge.ts
  - apps/run.human/webapp/src/lib/ctf-flag-types.ts
  - apps/run.human/webapp/src/lib/qr-admin.ts
  - apps/run.human/webapp/src/components/admin/CtfForm.tsx
  - apps/run.human/webapp/src/components/admin/ctf-form-model.ts
findings:
  critical: 0
  warning: 2
  info: 4
  total: 6
status: issues_found
---

# Phase 56: Code Review Report

**Reviewed:** 2026-07-15T08:39:50Z
**Depth:** deep
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Reviewed the Phase-56 wordlist one-time-code slice: the new `CtfCode` entity, the
`claimCode` atomic single-use store op and wordlist dispatch/finalize in the judge,
the `isRepeatable` widening, the `hashCodeBatch`/`loadCtfCodes`/`getCtfCodeCounts`
admin plumbing, and the `Wordlist` form option + count line.

The highest-risk path — the `claimCode` conditional-patch error classification — is
**correct**. I traced it against ElectroDB `.patch()` semantics (patch injects
`attribute_exists` on the key, so a missing row and a lost condition both surface as
`ConditionalCheckFailedException`) and the catch re-read discipline correctly:
(a) already-claimed → `claimed:false`; (b) missing row → `claimed:false`;
(c) row present + still-unclaimed after a failed patch → rethrow (genuine transient
error) so the judge degrades to a non-solve rather than mis-report a win. A
successful conditional update never no-ops silently, so a win can never be
misreported as a loss and vice-versa. No misclassification defect found there.

The `recordScoreEvent` `patch → upsert` change is also safe: idempotency for the
repeatable (otp) path is enforced *upstream* by `claimScoreEvent`'s conditional
create (finalize is skipped entirely on a losing claim), so the upsert only ever
updates a row that already exists — no double-accrual, and `scoredAt`/`channel`
set by `claimScoreEvent` are preserved (upsert merges, does not replace).
Plaintext-code hygiene holds: `hashCodeBatch` routes every line through the same
`hashAnswer` seam (trim + lowercase) the judge uses for a guess, so a loaded code
and a later guess hash identically; no plaintext code is ever persisted, logged, or
round-tripped to the client (`CtfCode` has no plaintext attribute; only aggregate
counts cross to the form).

Two WARNINGs and four INFO items remain, all quality/robustness rather than
correctness-breaking. No BLOCKER-tier defect was found in the changed code.

## Warnings

### WR-01: `loadCtfCodes` silently swallows transient `CtfCode.create` errors — a code the admin believes is loaded may never persist

**File:** `apps/run.human/webapp/src/lib/qr-admin.ts:483-491`
**Issue:** The bulk-load loop wraps each `CtfCode.create(...)` in a bare
`catch {}` that swallows *every* error. That is correct for the intended
add-only no-op (an already-present codeHash collides on the create's existence
condition). But it also swallows genuine transient failures (throttling, network,
throttled write capacity): such a code is silently dropped from the pool with no
error surfaced to the admin and no retry. The batch stats returned to the caller
(`added`) come from `hashCodeBatch` (distinct-hash count) computed *before* any
write, so they reflect intended writes, not successful ones — the reported count
can overstate what actually persisted. Net effect: during the event a player
redeems a legit code that was never stored, gets an indistinguishable non-solve,
and the operator has no signal it happened. (Mitigation that limits severity, not
eliminates it: the edit page's `getCtfCodeCounts` reload shows the *true* pool
size, and a re-save is add-only/idempotent, so an attentive admin can notice a
short count and re-paste.)
**Fix:** Distinguish the expected duplicate/existence-collision from other errors,
and only swallow the former; count real outcomes:
```ts
let added = 0, duplicates = 0;
for (const codeHash of codeHashes) {
  try {
    await CtfCode.create({ challenge, codeHash }).go();
    added++;
  } catch (err) {
    if (isConditionalCheckFailed(err)) { duplicates++; continue; } // already in pool — no-op
    throw err; // transient/other → surface so the admin can retry, never silently drop
  }
}
return { added, duplicates: duplicates + hashDupes };
```
At minimum, rethrow non-condition errors so a partial load fails loudly instead of
reporting phantom successes.

### WR-02: Wordlist claim is non-atomic with scoring — a partial finalize failure globally burns a valid code with no retry path

**File:** `apps/run.human/webapp/src/lib/ctf-judge.ts:359-372, 397-415`
**Issue:** For `wordlist`, the single-use claim (`claimCode`, which sets
`claimedBy` on the `CtfCode` row) executes in the validation step, *before* the
finalize block allocates the ordinal, records the ledger row, and accrues. If any
of `allocateOrdinal` / `recordScoreEvent` / `accrue` throws after a successful
claim, `judgeSolve`'s outer `catch` returns `NON_SOLVE` — but the code is now
permanently `claimedBy` that user. On retry, `claimCode` fails the condition and
the catch re-read sees `claimedBy` set → `claimed:false` → another `NON_SOLVE`,
**indistinguishable from a wrong answer**. Unlike the static path (whose replay
returns the prior award via `claimSolve.existing`) and unlike the repeatable path
(whose claim is a per-window, retriable-next-window token), a wordlist code is a
*global* single-use resource, so this failure mode destroys the code and the
player's award with no recovery. The same non-atomicity also means a code claimed
just as the `globalMax` cap is crossed is consumed for a zero-point `capped`
result. This extends the codebase's already-accepted non-transactional
accrue pattern (see the deferred phase-53 WR-02), so it is a robustness gap, not a
regression — but it is strictly worse for wordlist than for the repeatable path.
**Fix:** Preferred: defer the claim so it is the *last* mutation
(allocate ordinal + compute points first, then claim, then record + accrue) — but
that reintroduces a read-then-allocate race, so it is non-trivial. Pragmatic
alternative: on a post-claim finalize error, best-effort release the claim
(conditional patch clearing `claimedBy` guarded on `claimedBy = thisUser`) inside
a nested try before letting the error propagate, so the code returns to the pool:
```ts
try {
  const n = await store.allocateOrdinal(challenge);
  // ... record + accrue ...
} catch (err) {
  await store.releaseCode?.({ challenge, codeHash, user }); // guarded on claimedBy===user
  throw err;
}
```
If neither is adopted, document the burn-on-partial-failure as an accepted
tradeoff alongside the existing WR-02 note so it is not mistaken for a bug later.

## Info

### IN-01: `getCtfCodeCounts` reads the entire code partition with `pages: "all"` (unbounded)

**File:** `apps/run.human/webapp/src/lib/qr-admin.ts:497-509`
**Issue:** The count query pages through *every* `CtfCode` row for the challenge on
each admin edit-page render to compute `loaded`/`unclaimed`. For a large wordlist
pool this is an unbounded read that grows with the pool. Performance is out of v1
review scope; flagged per the review request to note unboundedness. Admin-only and
low-frequency, so acceptable for now.
**Fix:** If pools grow large, maintain running counters (e.g., atomic `ADD` on the
`Ctf` row: `codesLoaded`, and decrement `codesUnclaimed` on claim) and read those
instead of scanning the partition. Not required at current scale.

### IN-02: Wordlist finalize duplicates the repeatable finalize (R3/R4) logic

**File:** `apps/run.human/webapp/src/lib/ctf-judge.ts:397-415`
**Issue:** The `(W)` block re-implements ordinal allocation, `globalMax` cap check,
`computePoints`, `firstBlood`, `tierCeiling`, `recordScoreEvent`, `accrue`, logging,
and the `effect`-on-credit return — nearly identical to the `(R3)/(R4)` block. Two
copies of this scoring tail can drift (e.g., a future change to cap or tier logic
applied to one and not the other).
**Fix:** Extract a shared `finalizeScoringEvent({ challenge, user, bucket, channel,
now, ctf, store, log })` helper and call it from both the wordlist and repeatable
finalizes; the only difference is the idempotency source (already resolved before
the call), so the tail is genuinely shared.

### IN-03: `loadCtfCodes` return value is discarded; docstring claims it drives an admin confirmation

**File:** `apps/run.human/webapp/src/lib/qr-admin.ts:475-494, 530-533`
**Issue:** `loadCtfCodes` returns `{ added, duplicates }` and its docstring says it
returns "the batch stats for a non-blocking admin confirmation," but the only
caller (`upsertCtf`) does `await loadCtfCodes(...)` and discards the result. The
admin never sees these stats — the pool status comes solely from
`getCtfCodeCounts`. Dead return value + doc drift (and see WR-01: the `added` count
would be misleading even if surfaced).
**Fix:** Either propagate the stats up through `upsertCtf`'s return and surface them
in the save response, or drop the return type and the "admin confirmation" clause
from the docstring to match reality.

### IN-04: `perPlayerMax` is silently ignored for `wordlist` flags

**File:** `apps/run.human/webapp/src/lib/ctf-judge.ts:388-415`
**Issue:** `isRepeatable` returns true for `wordlist`, but the `(W)` finalize is
placed before the `(R)` block and returns early, so it never consults
`overPerPlayerMax`/`perPlayerMax`. This is documented as intentional ("the finite
code pool + per-code single-use is the natural bound"), but an admin who sets both
`answerType: wordlist` and `perPlayerMax` on the same flag will see the cap
silently do nothing — a config that appears meaningful but is a no-op.
**Fix:** Either enforce a per-player redemption cap in the wordlist finalize
(count this user's `CtfScoreEvent` rows for the challenge before recording), or
have the form disable/hide the `perPlayerMax` control when `answerType === "wordlist"`
and note in the field help that wordlist is bounded by the code pool.

---

_Reviewed: 2026-07-15T08:39:50Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
