# 65-02 SUMMARY — judge single-use OTP path

**Status:** Complete
**Requirements:** CTFT-17, CTFT-15 (JudgeOtp half)

## What shipped (`lib/ctf-judge.ts`)
- `JudgeOtp.singleUse?: boolean` + `narrowCtf` otp param widened (passthrough carries it).
- `CtfStore.claimOtpCode?` optional op (create-if-absent contract, catch discipline
  documented — distinct from the patch-if-exists wordlist `claimCode`).
- `defaultStore.claimOtpCode` — `CtfOtpClaim.create({challenge, codeHash, claimedBy,
  claimedAt, ttl})` (ElectroDB create ⇒ `attribute_not_exists` on the key); on
  condition failure read the row → present ⇒ `{claimed:false, claimedBy}`, absent ⇒
  rethrow (degrade to NON_SOLVE), mirroring `claimSolve`.
- **Single-use OTP finalize** (`(SU)` block) placed BEFORE the generic `isRepeatable`
  block and AFTER the step-4 `verifyTotp` gate. Guard: `answerType==="otp" &&
  otp?.singleUse===true`. Flow: `otpCodeHash(guess)` → `claimOtpCode` (ttl =
  `otpClaimTtlSeconds(now, otp)`) → `!claimed` ⇒ NON_SOLVE → `allocateOrdinal` →
  globalMax cap → `computePoints` → `recordScoreEvent(bucket=codeHash)` (upsert) →
  `accrue` → credited return (effect only when points>0). Reuses the wordlist
  finalize shape verbatim. Local hash var named `otpHash` (N1 — avoids shadowing the
  outer `codeHash`).

## Tests (82 green across the run)
- NEW `__tests__/ctf-judge-otp-singleuse.test.ts` (7): winner scores once + correct
  TTL + codeHash-keyed ledger; **race** (two concurrent same-code → exactly one
  winner, one accrue); consumed-code sequential → indistinguishable NON_SOLVE (log
  byte-identical to a wrong code; guess/codeHash never in the log); winner re-submit →
  NON_SOLVE, accrue exactly once (no double-award); wrong code → NON_SOLVE + claim
  never called; globalMax cap; **shared-OTP regression** (singleUse false → both users
  score, claim never called).
- NEW `__tests__/ctf-otp-singleuse-covert-invariant.test.ts`: covert files reference
  no `singleUse`/`CtfOtpClaim`/`claimOtpCode`; **resolver `.mjs` untouched** gate
  (W2 — walks `apps/run.qr/lambda/resolver/**/*.mjs`, asserts zero single-use tokens).
- Regression: ctf-judge, ctf-judge-gates, ctf-judge-wordlist, ctf-flag-types,
  ctf-reward-covert-invariant, ctf-wordlist-covert-invariant — all green.

## Verify
`nvm use 22.12.0 && npx vitest run <the 8 suites>` → 82 passed.
`npx tsc --noEmit` → no NEW errors on `ctf-judge.ts` (5 pre-existing errors in
`dropdown-user.tsx` / `checkin.test.ts` are unrelated).

## Fidelity to plan-checker fixes
- W1 (RED-by-design): store op + finalize landed together → tests green in one pass.
- W2 (resolver gate): added an automated resolver-untouched grep gate.
- N1 (shadowing): finalize local renamed `codeHash` → `otpHash`.
