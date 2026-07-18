# Design — Single-Use OTP CTF flag option

**Date:** 2026-07-18
**Status:** BACKLOG / proposed (not built) — pick up in a fresh session
**Owner:** Kurt (whereiskurt@gmail.com)
**Related:** `didhtp1` OTP flag + `q.defcon.run/c` short link (shipped 2026-07-18)

## One-line

Add a per-flag `otp.singleUse` option so a rotating-OTP CTF flag can be
**first-come-first-served** (one player globally consumes a given code) instead
of the current **shared** behavior (everyone who submits the same code scores).
Enforce it in the **judge (post-login)**, never in the public resolver.

## Motivation

Today `didhtp1` is a shared-secret TOTP flag: `verifyTotp` is a stateless
time-window check, so ANY number of players can submit the SAME 6-digit code
(from one phone call / broadcast) within its validity window (±skew ≈ 4–6 min at
`skew:2`) and each is credited independently (per-player dedup only). That is the
right default for "call once, whole group submits."

A future flag may want the opposite: the code is a **prize** and only the FIRST
player to redeem it wins. That is the single-use option.

## HARD CONSTRAINT (the whole point)

**Single-use enforcement MUST live in the judge (`run.human` `/ctf/claim` →
`judgeSolve`), which only runs for a credentialed `session.user.id`. It MUST NOT
live in the public `q.defcon.run` resolver Lambda.**

Rationale:
- The resolver is **public / unauthenticated**. If it did the single-use write,
  an anonymous bot scanning `q.defcon.run/c?v=…` could **consume codes without
  logging in** — a denial-of-service on legit players AND uncontrolled DDB write
  cost on public traffic.
- The judge already does atomic DDB conditional writes, and only for
  authenticated users. Putting the single-use claim there means **zero DDB writes
  from public traffic** — cost is incurred only on real, logged-in redemptions.
- Keep the resolver a dumb, stateless 302 (its only DDB touch stays the existing
  cached `Qr.get({code})` point-read, 60s TTL — pennies, unavoidable for any
  redirect, and a READ not a write).

This constraint is the reason the feature is cheap and safe. Do not violate it.

## Current behavior (what exists) — code map

- **Flag config:** `Ctf.otp` map — `apps/run.human/webapp/src/entities/qr.ts`
  (`{ secret, digits, period, algorithm, skew }`). Add `singleUse?: boolean` here.
- **Judge:** `apps/run.human/webapp/src/lib/ctf-judge.ts`
  - OTP validity check (`answerType === "otp"`): `verifyTotp(secret, guess, now, {digits, period, skew})` (~line 377). Stateless.
  - **Repeatable path (R)** (~line 440): `bucket = scoreBucket(now, {perPlayerIntervalHours, otpPeriodSeconds})`, then `claimScoreEvent({ challenge, user, bucket })` — an atomic `attribute_not_exists` conditional put on `CtfScoreEvent` keyed `(challenge, user, bucket)`. **Per-player** dedup → different users win independently.
  - **Wordlist path** (~line 410): the pattern to copy. Global single-use is already achieved there via a **code-keyed** atomic claim (`bucket: codeHash`) on the `CtfCode` entity (`attribute_not_exists(claimedBy)`), THEN a `recordScoreEvent` for the winning user. Single-use OTP is the same shape, minus the pre-loaded pool.
- **Store interface:** `CtfStore` in `ctf-judge.ts` (`claimScoreEvent`, `recordScoreEvent`, wordlist code claim). `defaultStore` is the ElectroDB impl.
- **Entities:** `apps/run.human/webapp/src/entities/ctf.ts` — `CtfScoreEvent` (pk `[challenge]`, sk `[user, bucket]`), `CtfCode` (pk `[challenge]`, sk `[codeHash]`, `claimedBy`, atomic single-use).
- **Hash seam:** `hashAnswer` in `src/lib/ctf-hash.ts` (salted SHA-256, `CTF_ANSWER_SALT`). Never store the raw code.
- **Seed builder type:** `CtfSeedOtp` in `src/lib/ctf-seed-rows.ts` — add `singleUse?`.
- **Admin form:** `src/components/admin/ctf-form-model.ts` + `CtfForm.tsx` — add the toggle.

## Proposed design

### 1. Config flag
Add `singleUse?: boolean` (default `false`) to the `otp` map in:
`qr.ts` (`Ctf.otp.properties`), `ctf-judge.ts` (`JudgeOtp`), `ctf-seed-rows.ts`
(`CtfSeedOtp`), and the admin form model. Absent/false ⇒ today's shared behavior
(no migration, no shipped-flag change).

### 2. Judge behavior when `otp.singleUse === true`
On a submission to a single-use OTP flag:
1. `verifyTotp(...)` must pass (valid current code) — unchanged.
2. Compute a stable **code identity**: `codeHash = hashAnswer(normalizedGuess)`
   (salted; raw code never stored). The same 6-digit code → same `codeHash`
   regardless of which skew offset matched or who submits it.
3. **Global atomic claim** keyed by CODE, not user:
   a conditional write that succeeds for exactly ONE caller. Two viable shapes —
   the implementer picks one:
   - **(A, preferred) reuse the wordlist path shape:** claim `(challenge,
     codeHash)` as a create-if-absent (`attribute_not_exists(pk)`) on a
     code-keyed entity (extend `CtfCode`, or a lightweight `CtfOtpClaim`
     mirroring it). First writer wins; a second writer's condition fails →
     `NON_SOLVE`. Then `recordScoreEvent({ challenge, user, bucket: codeHash })`
     for the winning user (leaderboard credit) — exactly what wordlist does.
   - **(B) simpler but looser:** `claimScoreEvent` keyed `(challenge, bucket=codeHash)`
     WITHOUT `user` in the sk. Requires the `CtfScoreEvent` claim to drop `user`
     from the key for single-use — a schema/keying wrinkle. (A) avoids this by
     using the already-user-independent code-keyed entity, so prefer (A).
4. Claim wins → award (existing scoring/curve). Claim loses (code already
   consumed) → `NON_SOLVE`, indistinguishable from a wrong code (no info leak).

### 3. Storage / cost
- One conditional `PutItem` per authenticated redemption. Same atomic pattern
  already in use — no new infra, no scan, no per-public-request write.
- **DynamoDB TTL** on the claim row: `now + period·(skew + 2)` seconds (a few
  minutes). The code is invalid past its window anyway (`verifyTotp` fails), so
  the consumed-code marker can auto-expire — no cleanup job, no storage creep.

## Semantics & edge cases
- **Skew:** keying by `codeHash` (the code string) — not by solve-time bucket —
  means the same physical code is one claim even when two players straddle a step
  boundary and match via different skew offsets. This is why (A)/codeHash beats a
  `floor(now/period)` time bucket for single-use precision.
- **Concurrency:** DynamoDB conditional write is the arbiter — exactly one of N
  simultaneous claimers wins; the rest get `NON_SOLVE`. No lock, no queue, no
  race, no double-award.
- **Per-player interaction:** `perPlayerIntervalHours` / `perPlayerMax` still
  apply to the WINNER as usual. A player who lost the global claim simply
  non-solves.
- **Rate limit:** `CtfAttempt` (per `(challenge,user)`, `maxAttempts`/`rateLimitWindow`)
  is unchanged and still per-player — losers spending an attempt is acceptable.
- **Re-submit by the winner:** the winner re-submitting the same code re-hits the
  claim they already own → treat as already-solved (return prior award), not a
  second consumption.

## Testing (TDD)
- **Pure claim/identity logic** in a runtime-pure module (type-only entity
  imports) so it unit-tests without the ElectroDB chain — mirror
  `ctf-solve-merge.ts` / `ctf-seed-rows.ts`. Test: same code → same `codeHash`;
  single-use gate returns win for first, `NON_SOLVE` for second.
- **Judge tests** (`src/lib/__tests__/ctf-judge*.test.ts`): inject a fake store;
  assert first claim wins + awards, second claim → `NON_SOLVE`; assert shared
  (non-single-use) OTP still credits multiple users (regression).
- Env for vitest: worktree needs real `npm ci` + `nvm use 22.12.0` (vitest@4;
  NOT 22.1.0 / 23.6.0).

## Out of scope / open questions
- Whether to extend `CtfCode` vs add a `CtfOtpClaim` entity (implementer's call;
  `CtfCode` is pool-oriented, a fresh tiny entity may be cleaner for claim-on-
  first-use). 
- Admin UI: surfacing "consumed" state / who won a given code (nice-to-have).
- No change to the resolver Lambda or `q.defcon.run` routing — the `/c?v=` and
  ☎️ aliases already forward the raw `v=` and are agnostic to shared vs single-use.

## Pointers
- Shipped context that motivated this: the `didhtp1` OTP flag, `q.defcon.run/c`
  short link, and the shared-vs-single-use discussion (see the auto-memory
  `project_ctf_didhtp1_ssm_otp_flag`).
- Judge concurrency reference implementation: the **wordlist path** in
  `ctf-judge.ts` (code-hash-keyed global single-use claim) is the closest analog —
  read it first.
