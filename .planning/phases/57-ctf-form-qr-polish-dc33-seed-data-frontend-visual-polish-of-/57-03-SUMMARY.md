---
phase: 57-ctf-form-qr-polish-dc33-seed-data
plan: 03
subsystem: run.human / CTF operator tooling
tags: [ctf, seed-data, operator-script, dynamodb, tdd]
requires:
  - src/lib/ctf-hash.ts (hashAnswer seam)
  - Ctf entity index shape (src/entities/qr.ts)
provides:
  - src/lib/ctf-seed-rows.ts (pure buildSeedRows() DC33 starter builder)
  - scripts/seed-ctf.mts (raw-SDK DRY-RUN/--confirm/--remove writer)
affects:
  - Ctf rows in run-human-electro (only under an explicit --confirm operator run)
tech-stack:
  added: []
  patterns:
    - raw @aws-sdk DynamoDBDocument operator script (mirrors reset-ctf-user.mts)
    - pure/entity-free row-builder factored for vitest
    - DRY-RUN-by-default with composed-key parity print (D4 landmine guard)
key-files:
  created:
    - apps/run.human/webapp/src/lib/ctf-seed-rows.ts
    - apps/run.human/webapp/src/lib/__tests__/ctf-seed-rows.test.ts
    - apps/run.human/webapp/scripts/seed-ctf.mts
  modified: []
decisions:
  - "Row-builder is import-pure (hashAnswer only, no entity/AWS chain) so it is vitest-safe and key-composition lives solely in the .mts script."
  - "Local CtfSeedRow type mirrors the Ctf attribute set instead of importing the entity (avoids the @auth/dynamodb-adapter ESM chain that breaks a tsx CJS run)."
  - "goldstein / goldstein-otp seeded with points:100 each (D3 leaves points unspecified for the OTP reward; a scorable reward needs a positive award)."
  - "grace-hopper timeTier window set to 2026-08-06..2026-08-10 UTC (DEF CON 34) with ceiling 500."
  - "Best-effort parity scan bounded by a 5s Promise.race timeout so DRY-RUN stays offline-safe (no creds / unreachable table never hangs or aborts)."
metrics:
  duration: ~5m
  completed: 2026-07-15
  tasks: 2
  files: 3
status: complete
---

# Phase 57 Plan 03: DC33 CTF Seed Script + Pure Row-Builder Summary

Adds `scripts/seed-ctf.mts` — a raw-SDK operator script that seeds six REAL DC33 CTF starter flags (one per flag type, all `enabled:false`, deletable via the existing admin Delete button) — backed by a pure, unit-tested `buildSeedRows()` builder that salts-hashes answers through the shared `ctf-hash` seam.

## What Was Built

**Task 1 — pure `buildSeedRows()` + vitest (TDD).**
`src/lib/ctf-seed-rows.ts` exports `buildSeedRows(): CtfSeedRow[]` returning the six curated DC33 starters (57-CONTEXT.md D3), one per flag type:
- `goldstein` — static flat 100, `answerHash(hackers4evr)`, `effect{kind:"otp-enroll", otpauth, nextFlag:"goldstein-otp"}`.
- `goldstein-otp` — `answerType:"otp"`, `otp{secret,digits:6,period:120,algorithm:"SHA1",skew:1}`, `unlockAfter:"goldstein"`, `perPlayerIntervalHours:24`, no static answer/hash.
- `mudge` — first-blood race, `answerHash(0g3l33t)`, pointMax 1000 / floor 100 / maxSolves 100 / firstBloodBonus 250.
- `condor` — flat award 100, `answerHash(fr33k3v1n)`.
- `grace-hopper` — timed drop, `answerHash(d3bugth3system)` (D3's `d3bugth3sYstem` normalized — hashAnswer trim+lowercases), pointMax 100 / floor 1, `timeTiers[{2026-08-06..2026-08-10Z, ceiling:500}]`.
- `turing` — easter egg award 10, `answerHash(3n1gim@)`, `effect{kind:"confetti", intensity:11}`.

Every row ships `enabled:false` + anti-spam defaults `maxAttempts:5`/`rateLimitWindow:60`. No plaintext `answer` is ever stored. The module imports ONLY `hashAnswer` from `@/lib/ctf-hash` — no ElectroDB/entity/AWS imports — and a local `CtfSeedRow` type mirrors the Ctf attribute set to keep it entity-free. `src/lib/__tests__/ctf-seed-rows.test.ts` (9 tests) asserts the full contract; hash assertions compare against `hashAnswer(...)` computed live, so they are salt-independent.

**Task 2 — `scripts/seed-ctf.mts` raw-SDK writer.**
Mirrors `reset-ctf-user.mts`: raw `DynamoDBDocument`, `creds()` SSO-fallback, `RUN_ELECTRO_*`/`RUN_DYNAMODB_REGION` env contract, optional `RUN_ELECTRO_ENDPOINT`, region-guard (exit 2). Imports the pure builder by relative path (`../src/lib/ctf-seed-rows`) so a tsx CJS run resolves it without the ESM entity chain. Composes each row's raw key to match the Ctf entity — `pk=$run#challenge_<name>` (lowercased), `sk=$ctf_1`, markers `__edb_e__:"Ctf"`/`__edb_v__:"1"` — merged with entity defaults (`solveCount:0`, `createdAt`/`updatedAt`) and the builder attributes. DRY-RUN by default: unconditionally composes + prints all six rows (the D4 key-parity artifact, works fully offline), then a best-effort real-row parity scan (5s-bounded, never aborts). `--confirm` puts (idempotent by name), `--remove` deletes the six by composed key. Header carries the PROD RUN RECIPE + prod-salt / no-localhost-`.env` (D4) landmine.

## Verification

- `ctf-seed-rows.test.ts`: 9/9 green under Node 23.6.0 (`nvm use 23.6.0`).
- `RUN_DYNAMODB_REGION=us-east-1 npx tsx scripts/seed-ctf.mts` (offline): prints `DRY-RUN`, all six composed rows incl. `$run#challenge_goldstein` / `$ctf_1` + markers, parity-fallback note, wrote nothing → `SEED_DRYRUN_OK`.
- Missing `RUN_DYNAMODB_REGION` → exit code 2 (fails loud).

## Deviations from Plan

None — plan executed exactly as written. Two under-specified values were chosen and documented (not deviations): `goldstein`/`goldstein-otp` `points:100` (D3 omits points for the OTP reward; a scorable reward needs a positive award), and the grace-hopper timeTier window (2026-08-06..2026-08-10Z, DEF CON 34). The 5s parity-scan timeout was added so DRY-RUN is offline-safe (supports the plan's "never abort DRY-RUN on scan failure" requirement).

## Operator Follow-up (deferred, NOT part of this build)

A prod `--confirm` run is a gated operator step: DRY-RUN against prod first and confirm the composed `pk/sk` + `__edb_*` markers match a real Ctf row, using `AWS_PROFILE=dc34-application` and prod's `CTF_ANSWER_SALT` (do NOT `--env-file` the localhost `.env`). Seeded rows land `enabled:false` — an admin must enable each before it scores.

## Known Stubs

None. All rows carry real DC33 data; no placeholder/mock values flow to any UI.

## Self-Check: PASSED

- FOUND: apps/run.human/webapp/src/lib/ctf-seed-rows.ts
- FOUND: apps/run.human/webapp/src/lib/__tests__/ctf-seed-rows.test.ts
- FOUND: apps/run.human/webapp/scripts/seed-ctf.mts
- FOUND commit 8e00ce9d (test RED), f6cec176 (builder GREEN), 4b43ab3d (seed script)
