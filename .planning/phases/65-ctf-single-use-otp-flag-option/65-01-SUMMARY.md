# 65-01 SUMMARY — config flag + CtfOtpClaim entity + runtime-pure helper

**Status:** Complete
**Requirements:** CTFT-15 (persisted half), CTFT-16

## What shipped
- `lib/ctf-otp-claim.ts` — runtime-pure helper (`import type` for the entity):
  `otpCodeHash` (salted code identity via `hashAnswer`), `otpClaimTtlSeconds`
  (`floor(now/1000)+period·(skew+2)`, meshtk defaults period 120 / skew 1),
  `applyOtpClaim` (create-if-absent first-wins/second-loses model — reused by the
  65-02 judge test fake), `resolveOtpClaimOutcome` (credit/non-solve gate).
- `entities/ctf.ts` — new `CtfOtpClaim` entity (pk=challenge, sk=codeHash;
  `claimedBy`, `claimedAt`, `ttl` [DynamoDB TTL], `createdAt`) + `CtfOtpClaimItem`
  type. Create-if-absent (NOT the patch-if-exists `CtfCode` pool). No `.mjs` mirror.
- `entities/qr.ts` — `singleUse: { type: "boolean" }` added to the `Ctf.otp` map.
- `lib/ctf-seed-rows.ts` — `CtfSeedOtp.singleUse?: boolean`; no seed row sets it.

## Tests (36 passed)
- `__tests__/ctf-otp-claim.test.ts` (9) — identity determinism + equals `hashAnswer`;
  TTL defaults/explicit/zero-period; first-wins/second-loses + winner-resubmit-loses
  + distinct-code independence; gate decision.
- `entities/__tests__/ctf-key-parity.test.ts` (+1) — pins
  `$run#challenge_sao` / `$ctfotpclaim_1#codehash_deadbeef`.
- `__tests__/ctf-seed-rows.test.ts` (+1 assertion) — DC33 OTP chains build with
  `otp.singleUse` undefined (default-off / SC2).

## Verify
`nvm use 22.12.0 && npx vitest run src/lib/__tests__/ctf-otp-claim.test.ts src/entities/__tests__/ctf-key-parity.test.ts src/lib/__tests__/ctf-seed-rows.test.ts` → 3 files, 36 tests green.

## Notes
- No new packages (electrodb + node crypto via hashAnswer).
- Default-off invariant locked at the seed + entity layer; nothing changes judge or
  admin behavior yet (65-02 / 65-03 build on this).
