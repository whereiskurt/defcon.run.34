---
phase: 53-ctf-flag-types-slice-1a-backend-answer-type-framework-rotati
reviewed: 2026-07-15T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - apps/run.human/webapp/src/entities/ctf.ts
  - apps/run.human/webapp/src/entities/qr.ts
  - apps/run.human/webapp/src/lib/ctf-flag-types.ts
  - apps/run.human/webapp/src/lib/ctf-otp.ts
  - apps/run.human/webapp/src/lib/ctf-judge.ts
  - apps/run.human/webapp/src/lib/qr-admin.ts
  - apps/run.human/webapp/src/lib/qr-errors.ts
findings:
  critical: 1
  warning: 6
  info: 3
  total: 10
status: issues_found
---

# Phase 53: Code Review Report

**Reviewed:** 2026-07-15T00:00:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

This is the flag-types Slice 1a backend: entity schema for `CtfScoreEvent`, pure
flag-type helpers, a RFC-6238 TOTP core, the extended judge, and the admin write
guard. The crown-jewel invariants the prompt calls out mostly hold:

- **Covert byte-identity / reward-free** — enforced at the covert route (proven
  byte-identical with/without `effect` in `covert-egg.test.ts`); the judge does
  attach `effect` on covert-channel results too, which is a defense-in-depth gap
  (WR-05) but not a leak given the route drops it.
- **OTP compare** — routes through a length-guarded `crypto.timingSafeEqual` with
  a non-short-circuiting OR loop; `verifyTotp` never throws. Good.
- **Once-per-window atomicity** — the `CtfScoreEvent` bucket-in-sk conditional put
  is genuinely atomic (claim-before-allocate). Good.
- **Backward compat** — a row with no `answerType` narrows to `static` and routes
  through the unchanged `CtfSolve` path. Good.

The material problems are: (1) the D-07 edit guard contradicts the file's own
no-clobber partial-edit contract (CR-01); (2) the per-player-max and unlock gates
read an **eventually-consistent GSI** while assuming read-after-write (WR-01); (3)
the multi-write score flow is non-atomic with no re-accrue on replay (WR-02); and
(4) `otp.algorithm` is stored/typed but silently ignored by the verifier (WR-03).

## Critical Issues

### CR-01: D-07 transition guard compares full stored row against a PARTIAL input — misfires on legitimate edits of solved repeatable challenges

**File:** `apps/run.human/webapp/src/lib/qr-admin.ts:378-394` (guard call) and
`apps/run.human/webapp/src/lib/ctf-flag-types.ts:71-84` (guard)

**Issue:** `ctfAttributes` is documented and built for **no-clobber partial
edits** — "when the answer field is blank/…/undefined the key is omitted
ENTIRELY… an omitted field never clobbers the stored value" (qr-admin.ts:361).
But `upsertCtf` evaluates the D-07 flip guard as
`assertAnswerTypeTransition(existing.data, input, hasSolves)`, comparing the FULL
stored row (`existing.data`) against the RAW PARTIAL `input`. `isRepeatable(input)`
reads `input.answerType / input.perPlayerMax / input.perPlayerIntervalHours` — all
`undefined` on a partial edit.

Concrete break: a repeatable challenge (`perPlayerMax: 3`) with solves. An admin
edits only `points` (or `enabled`), and the form omits the repeatable-defining
fields. Then `isRepeatable(existing) === true`, `isRepeatable(input) === false`,
`hasSolves === true` ⇒ the guard **throws** `QrValidationError` ("Cannot change
this challenge between static and repeatable…") even though the admin never
intended a flip. Because no-clobber would have preserved the stored fields, the
persisted state stays repeatable — so the guard rejects an edit it should allow.
The guard's own premise (that `input` is the complete next state) is violated by
the file's no-clobber contract. This makes any solved repeatable challenge
effectively un-editable through a partial form, and defeats the very D-07 gate it
implements.

**Fix:** Evaluate the guard against the *merged* next state, not the raw partial
input — reuse the same fields `ctfAttributes` will actually write:

```ts
// upsertCtf, before patch:
const attrs = ctfAttributes(input);
// Overlay only the provided flag-type fields onto the stored row.
const next: FlagTypeShape = {
  answerType: attrs.answerType ?? existing.data.answerType,
  perPlayerMax: attrs.perPlayerMax ?? existing.data.perPlayerMax,
  perPlayerIntervalHours:
    attrs.perPlayerIntervalHours ?? existing.data.perPlayerIntervalHours,
};
assertAnswerTypeTransition(existing.data, next, hasSolves);
```

(If the form is in fact guaranteed to always POST the complete flag-type field set,
this drops to a WARNING — but the no-clobber design in this same file documents the
opposite, so the mismatch must be resolved explicitly.)

## Warnings

### WR-01: perPlayerMax / unlock gates read an eventually-consistent GSI but assume read-after-write

**File:** `apps/run.human/webapp/src/lib/ctf-judge.ts:566-576, 601-608`

**Issue:** `overPerPlayerMax` comments "The just-claimed row is included, so an
at-cap player reads count > max" and `hasScoreFor` relies on the freshly-written
row being visible — but both use `CtfScoreEvent.query.byUser(...)`, a **Global
Secondary Index** query. DynamoDB GSIs are *always* eventually consistent
(`ConsistentRead` is not permitted on a GSI), so the just-claimed row may not yet
be replicated when the count runs. Under replication lag the count can undershoot
and let a player exceed `perPlayerMax` (or an unlock gate can briefly under-report).
Additionally `overPerPlayerMax` calls `.go()` with no `{ pages: "all" }`, so it
counts only the first page — a player with a very large ledger could undercount and
bypass the cap. Practical exploitability is low (per-window claim spacing ≥
`otp.period`/interval is far larger than GSI lag), but the invariant is stated as a
guarantee it does not actually have.

**Fix:** Count via a strongly-consistent read of the **primary** index
(`CtfScoreEvent.query.primary({ challenge })` filtered to `user`, or maintain an
atomic per-(challenge,user) counter à la `CtfAttempt`), and paginate the count.
Do not phrase GSI reads as read-after-write in comments.

### WR-02: Non-atomic score flow — a mid-flow write failure leaves the ledger scored but RunUser un-accrued, and the idempotent replay never re-accrues

**File:** `apps/run.human/webapp/src/lib/ctf-judge.ts:376-418` (static) and
`329-373` (repeatable)

**Issue:** The scoring flow performs independent, non-transactional awaited writes:
`claimSolve` → `allocateOrdinal` → `recordScore` → `accrue` (and the ledger
equivalent). If `accrue` (RunUser `ADD ctfScore/ctfSolves`) throws after
`recordScore` committed, the outer `catch` degrades to `NON_SOLVE`, but the
`CtfSolve`/`CtfScoreEvent` row is already scored while `RunUser.ctfScore` was never
incremented. A retry then hits the "already claimed" branch (line 380-394) or the
same-window collision (line 336-342), returns the prior award/`NON_SOLVE`, and
**never re-runs `accrue`** — so the player's global total is permanently short even
though `recordScore` shows the award (and a replay re-surfaces `effect`/points). The
persisted CtfSolve/CtfScoreEvent ledger and `RunUser` rollup silently diverge.

**Fix:** Make accrual reconcilable: either (a) fold the score-record + accrue into a
DynamoDB `TransactWrite`, or (b) make the replay path re-verify/repair accrual (e.g.
mark the row `accrued: true` only after `accrue` succeeds and re-accrue on replay
when the flag is unset), so a partial failure self-heals instead of under-counting.

### WR-03: `otp.algorithm` is stored, typed, and admin-editable but silently ignored by the verifier (SHA1 hardcoded)

**File:** `apps/run.human/webapp/src/lib/ctf-otp.ts:103-131` and
`apps/run.human/webapp/src/lib/ctf-judge.ts:301-308`

**Issue:** `Ctf.otp.algorithm` (qr.ts:147), `JudgeOtp.algorithm` (ctf-judge.ts:97),
and `CtfInput.otp.algorithm` all exist and pass through `ctfAttributes` unchanged.
But `TotpOptions` has no `algorithm` field, `totpAt` hardcodes
`const algorithm = DEFAULT_ALGORITHM` ("SHA1"), and the judge's dispatch passes only
`{ digits, period, skew }` — never `algorithm`. So configuring `algorithm: "SHA256"`
has **zero effect on verification**: the judge always computes SHA1. If the paired
enrollment `otpauth://` URL (authored on `effect`, honored by the Slice-1b renderer
and standard authenticator apps) declares SHA256, the user's codes will never match
and the flag becomes silently unsolvable, with no error surfaced anywhere.

**Fix:** Either thread `algorithm` through `TotpOptions`→`totpAt` (the switch at
ctf-otp.ts:113 is already the documented seam) and pass `otp.algorithm` in the judge
dispatch, or reject any non-SHA1 `otp.algorithm` at write time in `ctfAttributes`
so a misconfiguration fails loudly instead of producing a dead flag.

### WR-04: OTP and scoring numeric fields are written with no validation — several values silently disable a flag or weaken the OTP

**File:** `apps/run.human/webapp/src/lib/qr-admin.ts:362-371` (passthrough) and
`apps/run.human/webapp/src/lib/ctf-otp.ts:188-205`

**Issue:** `ctfAttributes` passes `otp`, `perPlayerMax`, `globalMax`,
`perPlayerIntervalHours`, `rateLimitWindow`, etc. straight through with no bounds
checks (unlike `timeTiers` and destinations, which are validated). Consequences:
- `otp.skew` is unbounded — a large value both **widens the acceptance window**
  (many codes valid at once, weakening the OTP) and makes `verifyTotp` do O(skew)
  HMAC computations per attempt (CPU DoS via config).
- `otp.period === 0` ⇒ `Math.floor(unixSeconds / 0)` = `Infinity` ⇒ `BigInt(Infinity)`
  throws ⇒ `verifyTotp` returns false forever (unsolvable flag). Note `?? DEFAULT`
  does not catch `0`.
- A non-base32 `otp.secret` ⇒ `base32Decode` throws ⇒ permanently unsolvable.
- `pointFloor > pointMax` (or a tier `ceiling < pointFloor`) yields a negative
  `computePoints` result that accrues negative score to `RunUser.ctfScore`.

All are admin-gated inputs, so severity is bounded, but the module's stated pattern
is "validators throw before any DynamoDB call."

**Fix:** Validate in `ctfAttributes`: clamp/reject `otp.skew` to a small max
(e.g. ≤ 2), require `otp.period > 0` and a decodable base32 `otp.secret`, require
`perPlayerMax`/`globalMax` ≥ 0 and integral, and require `pointFloor <= pointMax`
and each tier `ceiling >= pointFloor`.

### WR-05: Judge attaches `effect` to the result even for `channel === "covert"` — covert reward-free invariant is enforced only downstream

**File:** `apps/run.human/webapp/src/lib/ctf-judge.ts:373, 392, 418`

**Issue:** `judgeSolve` returns `effect: points > 0 ? ctf.effect : undefined`
irrespective of `input.channel`. The covert reward-free guarantee (T-53-04-01) is
therefore upheld *only* because the covert route ignores `result.effect` when
building the CSS sheet (proven in `covert-egg.test.ts`). Any future covert code path
that reads `result.effect` would leak the reward payload into the covert channel.
Defense-in-depth is cheap here.

**Fix:** Suppress the payload at the source for covert solves:

```ts
const carryEffect = channel !== "covert" && points > 0 ? ctf.effect : undefined;
return { solved: true, points, ordinal: n, firstBlood, capped, effect: carryEffect };
```

Apply at all three return sites (repeatable credited, static replay, static credited).

### WR-06: Gate-failure indistinguishability is content-only, not timing-uniform; a credited solve's serial awaited writes make it latency-distinguishable

**File:** `apps/run.human/webapp/src/lib/ctf-judge.ts:252-418`

**Issue:** The prompt requires locked-gate / over-cap / bad-OTP / wrong-answer to be
"indistinguishable from a plain wrong answer." The *result shape* is identical
(good), but the *timing* is not uniform: the unlock gate (step 1b) and attempt-cap
(step 2) return **before** answer validation, so they skip the hash/HMAC compare and
the extra DB reads a wrong-answer path incurs. More significantly, a *credited*
solve performs 3-4 sequential awaited writes (`claim`→`allocate`→`record`→`accrue`)
while a decoy/miss performs one read — so any caller that awaits `judgeSolve` before
responding (including the always-200 covert route) leaks win/lose and gate-state via
response latency. The per-compare microsecond delta is swamped by network jitter, but
the multi-write vs single-read delta is large and observable.

**Fix:** For the covert front door, dispatch scoring off the response path (fire-and-
park, respond with a fixed-shape decoy immediately) or pad to a constant response
time, so covert latency does not correlate with win/lose. At minimum, document that
indistinguishability here is response-content only, not timing-constant.

## Info

### IN-01: `JudgeOtp.algorithm` is a dead field

**File:** `apps/run.human/webapp/src/lib/ctf-judge.ts:97`
**Issue:** Declared in the interface but never read anywhere in the dispatch (see
WR-03). Either wire it or drop it to avoid implying it is honored.
**Fix:** Remove, or consume it once `totpAt` accepts an algorithm.

### IN-02: Over-cap repeatable submits leave orphan `CtfScoreEvent` rows with no TTL

**File:** `apps/run.human/webapp/src/lib/ctf-judge.ts:336-350`;
`apps/run.human/webapp/src/entities/ctf.ts:90-134`
**Issue:** The once-per-window claim (R1) commits a `CtfScoreEvent` row *before* the
`overPerPlayerMax` (R2) and `globalMax` (R3) checks. A correct-but-over-cap submit
therefore persists a `points: 0` ledger row that is never patched, and
`CtfScoreEvent` has no `ttl` attribute (unlike `CtfAttempt`/`CtfPending`), so these
rows accumulate permanently. They also count toward `hasScoreFor` (unlock), which is
arguably correct (the player did answer correctly) but worth confirming as intended.
**Fix:** Consider a TTL on `CtfScoreEvent`, or run the cap checks before the claim if
orphan rows are undesirable (accepting the small window-race tradeoff).

### IN-03: Post-conditional-put `.get()` uses an eventually-consistent read

**File:** `apps/run.human/webapp/src/lib/ctf-judge.ts:524, 595`
**Issue:** After a conditional-put failure, `claimSolve`/`claimScoreEvent` re-read
the row with a default (eventually-consistent) `.get()` to distinguish
already-solved from a real error. A stale read can miss the just-written row and
rethrow → `NON_SOLVE` instead of returning the prior award. Both outcomes are
`NON_SOLVE`-shaped for the loser, so no correctness/observability break, but a
genuine idempotent replay could transiently miss its prior award / celebration.
**Fix:** Use `.go({ consistent: true })` on the primary-key re-read to make the
already-exists branch deterministic.

---

_Reviewed: 2026-07-15T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
