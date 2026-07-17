# Design — `didhtp1` CTF flag: TOTP submission sourced from SSM `otp_secret`

**Date:** 2026-07-17
**Status:** Approved (design), pending implementation
**Owner:** Kurt (whereiskurt@gmail.com)

## Goal

Configure a CTF challenge, slug **`didhtp1`**, so that a 6-digit TOTP code —
generated **externally** from the shared secret at SSM
`/kmv/secrets/use1/ctf/otp_secret` (account/profile `klanker-application`,
`us-east-1`) — is accepted when submitted through the standard CTF claim URL:

```
https://run.defcon.run/use1/ctf/claim?c=didhtp1&v=<6-digit-code>
```

## Non-goals / already exists

- **The OTP judging logic is already built** and is NOT touched by this work.
  `judgeSolve` (`src/lib/ctf-judge.ts`) already handles `answerType: "otp"` by
  calling `verifyTotp(otp.secret, guess, now, {period, digits, algorithm, skew})`
  with a ±skew window plus the unlock / interval / scoring gates. The only thing
  missing is a **configured flag row** whose `otp.secret` = the SSM value.
- No in-app enrollment (`effect.otp-enroll`) and no `unlockAfter` chain — the
  code is produced by an external generator and pasted straight into the URL,
  so `didhtp1` is a **standalone** OTP flag.
- No new npm dependency (`@aws-sdk/client-ssm` is not present and won't be added).

## Confirmed decisions

| Field | Value | Rationale |
|-------|-------|-----------|
| `challenge` | `didhtp1` | user-chosen slug |
| `answerType` | `"otp"` | rotating TOTP flag |
| `otp` | `{ secret: <SSM>, digits: 6, period: 120, algorithm: "SHA1", skew: 1 }` | **must match the external generator** — meshtk convention (period **120**, not RFC 30) |
| `pointMax` / `pointFloor` | `100` / `100` | flat 100 (no decline) |
| `maxSolves` | `100000` | curve denominator huge so flat never caps |
| `firstBloodBonus` | `0` | no first-blood bonus |
| `perPlayerIntervalHours` | `24` | repeatable at most once per 24h |
| `maxAttempts` / `rateLimitWindow` | `5` / `60` | anti-spam, matching every starter |
| `enabled` | `false` | repo convention — an admin enables before it scores |

> ⚠️ **Period is the classic silent failure.** If the external generator uses a
> different period (e.g. RFC-standard 30s), codes generate fine but **never**
> verify. This design pins **120s** per the user's confirmation that the
> generator follows the meshtk convention.

## Architecture

A single standalone operator script: **`apps/run.human/webapp/scripts/seed-ctf-otp.mts`**,
modeled on `scripts/seed-ctf.mts` (raw `DynamoDBDocument` client + hand-composed
ElectroDB key/markers, because the `Ctf` entity pulls the ESM-only
`@auth/dynamodb-adapter` a standalone `tsx` CJS run cannot require).

### Cross-account split (deliberate)

| Operation | Account / auth | How |
|-----------|----------------|-----|
| **Read secret** | `klanker-application` (SSO) | shell out to the **`aws` CLI** — the exact command the user provided (`execFileSync`, args as an array, no shell interpolation) |
| **Write row** | `dc34-application` (SSO) | `@aws-sdk/lib-dynamodb` `DynamoDBDocument`, default provider chain via `AWS_PROFILE=dc34-application` (same as `seed-ctf.mts`) |

Shelling out for the SSM read reuses the operator's existing SSO for the
`klanker-application` account and avoids adding an SDK dependency or juggling two
credential profiles inside one SDK process.

### Modes (DRY-RUN by default, mirrors `seed-ctf.mts`)

- **DRY-RUN (default):** read the secret, validate it decodes as base32, compose
  the `didhtp1` row, print it **with the secret REDACTED**, and best-effort fetch
  one real `Ctf` row for pk/sk parity. Writes nothing.
- **`--verify`:** compute the current TOTP with the repo's own
  `totpAt(secret, now, {digits:6, period:120})` and assert `verifyTotp` accepts
  it (pure, no DB). Prints the ready-to-paste submission URL with the live code.
  This proves secret+params are self-consistent before prod is touched. (The
  6-digit code is not the secret and is ephemeral — safe to print.)
- **`--confirm`:** `put` the row. Idempotent by key and **live-data-preserving** —
  if the row exists, keep its `solveCount`, `createdAt`, and `enabled` (never
  reset the ordinal allocator or flip off an admin-enabled flag). New rows insert
  `solveCount:0`, fresh timestamps, `enabled:false`.

### Composed DynamoDB item

```
pk:         $run#challenge_didhtp1
sk:         $ctf_1
__edb_e__:  Ctf
__edb_v__:  1
challenge:  didhtp1
answerType: otp
otp:        { secret: <SSM>, digits: 6, period: 120, algorithm: SHA1, skew: 1 }
pointMax: 100  pointFloor: 100  maxSolves: 100000  firstBloodBonus: 0
perPlayerIntervalHours: 24
maxAttempts: 5  rateLimitWindow: 60
enabled: false  solveCount: 0  createdAt/updatedAt: <ISO now>
```

## Security / hygiene

- The secret is **read into memory only**; never hardcoded, never written to a
  log line, never printed (DRY-RUN redacts it). The composed-item print masks
  `otp.secret`.
- The plaintext secret is stored in DynamoDB `otp.secret` — inherent to TOTP
  verification and the SAME trust level as the DC33 seeded flags (documented, not
  a regression).
- Only the single `didhtp1` key is ever written; no scan-and-mutate.

## Verification plan

1. `--verify` locally: `totpAt` → `verifyTotp` round-trip returns true. ✅ gate.
2. DRY-RUN against prod: composed pk/sk matches a real `Ctf` row (D4 parity).
3. `--confirm` writes the row (still `enabled:false`).
4. Admin enables `didhtp1` via `/admin/qr/ctf` (or a follow-up `--enable`).
5. **Manual UAT:** signed-in browser submit of an externally-generated code to
   `…/ctf/claim?c=didhtp1&v=<code>` → visible award. (Real end-to-end needs a
   session; not scriptable here.)

## Deploy recipe (prod)

```bash
cd apps/run.human/webapp
# 1. DRY-RUN — read secret (klanker), compose, parity-check (dc34):
AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 \
  npx tsx scripts/seed-ctf-otp.mts
# 2. Self-consistency — live code round-trips through verifyTotp:
AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 \
  npx tsx scripts/seed-ctf-otp.mts --verify
# 3. Write the row (idempotent, enabled:false):
AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 \
  npx tsx scripts/seed-ctf-otp.mts --confirm
# 4. Admin enables didhtp1 before it scores.
```

Overridable env (defaults shown): `CTF_OTP_SSM_PROFILE=klanker-application`,
`CTF_OTP_SSM_PARAM=/kmv/secrets/use1/ctf/otp_secret`, `CTF_OTP_SSM_REGION=us-east-1`.
