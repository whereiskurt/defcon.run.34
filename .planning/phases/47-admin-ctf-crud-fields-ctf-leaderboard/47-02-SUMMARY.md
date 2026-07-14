---
phase: 47-admin-ctf-crud-fields-ctf-leaderboard
plan: 02
subsystem: ctf-migration
tags: [ctf, migration, security, dynamodb, tsx]
status: complete
requires:
  - "src/lib/ctf-hash.ts (hashAnswer — Phase 44)"
  - "src/entities/qr.ts (Ctf entity attrs answer/answerHash — Phase 44)"
provides:
  - "src/lib/ctf-migration.ts (pure planCtfMigration decision)"
  - "scripts/migrate-ctf-answerhash.mts (one-time idempotent operator migration)"
affects:
  - "existing prod Ctf rows carrying plaintext answer (operator-run, use1)"
tech-stack:
  added: []
  patterns:
    - "reset-payment-data.mjs one-off script lineage (raw @aws-sdk, dry-run/--confirm, fail-loud env)"
    - "pure decision helper + thin I/O shell (testable core)"
key-files:
  created:
    - apps/run.human/webapp/src/lib/ctf-migration.ts
    - apps/run.human/webapp/scripts/migrate-ctf-answerhash.mts
    - apps/run.human/webapp/src/lib/__tests__/ctf-migration.test.ts
  modified: []
decisions:
  - "Script uses the raw @aws-sdk DynamoDBDocument client (not the Ctf ElectroDB entity) because the entity's client.ts imports the ESM-only @auth/dynamodb-adapter, which cannot be required under standalone tsx (webapp is CommonJS). Parity is still guaranteed via planCtfMigration → hashAnswer."
metrics:
  duration: ~15m
  completed: 2026-07-14
---

# Phase 47 Plan 02: Plaintext→answerHash CTF Migration Summary

A standalone, idempotent operator migration that hashes any existing plaintext `Ctf.answer` into `answerHash` (byte-identical to the Phase-44 judge's `hashAnswer`) and removes the plaintext, dry-run by default and writing only with `--confirm`.

## What was built

- **`src/lib/ctf-migration.ts`** — pure `planCtfMigration(row)` returning a discriminated `{ action: "skip" } | { action: "clear-only" } | { action: "hash-and-clear"; answerHash }`. Imports `hashAnswer` from `./ctf-hash` (the exact seam the judge verifies with) so a migrated hash is parity-by-construction, never a re-implementation. No I/O, no dependency beyond ctf-hash → trivially testable. Idempotent by construction: a row with plaintext removed (answerHash set) re-plans to `skip`.
- **`scripts/migrate-ctf-answerhash.mts`** — tsx operator script. Scans `Ctf` rows, runs each through `planCtfMigration`, prints a per-row `challenge → action` line (never the answer/hash value), accumulates counts. DRY-RUN by default; `--confirm` writes (`SET answerHash + updatedAt REMOVE answer` for hash-and-clear, `REMOVE answer` for clear-only, nothing for skip). Fails loud (exit 2) if `RUN_ELECTRO_ID`/`RUN_ELECTRO_SECRET`/`RUN_DYNAMODB_REGION` are missing before any scan. Header documents the exact prod recipe. Not wired into any app/build/request path.
- **`src/lib/__tests__/ctf-migration.test.ts`** — 9 tests: every decision case (hash-and-clear / clear-only / skip incl. empty + whitespace-only answer), the hash-parity assertion (`plan.answerHash === hashAnswer(answer)`), and two idempotency assertions (post-migration row re-plans to skip; applying the plan twice is a no-op).

## Script path + invocation

Path: `apps/run.human/webapp/scripts/migrate-ctf-answerhash.mts`

```bash
cd apps/run.human/webapp
# dry-run (writes nothing, prints the plan + counts):
AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/migrate-ctf-answerhash.mts
# commit the migration (hashes + strips plaintext):
AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/migrate-ctf-answerhash.mts --confirm
# (optional) re-run --confirm → should report all skip (idempotent no-op)
```
Targets us-east-1 / the shared `run-human-electro` table via the `.env` `RUN_ELECTRO_*` vars.

## Test results

`nvm use 23.6.0 && npx vitest run src/lib/__tests__/ctf-migration.test.ts` → **9 passed**, including:
- **Idempotency** — a post-migration row (plaintext removed) re-plans to `skip`; applying twice is a no-op.
- **Hash parity** — `hash-and-clear` produces `answerHash === hashAnswer(answer)` (judge parity).

Beyond the unit gate, the script was exercised **end-to-end against local DynamoDB** (seed a plaintext row → dry-run writes nothing → `--confirm` removes plaintext + sets answerHash with parity TRUE → re-run reports `skip`). Logging emitted only `migtest → <action>`, never the secret value.

`tsc --noEmit` clean on the new source files; the script's isolated nodenext tsc surfaces only the acceptable relative-`../src` module-resolution warnings (the real run is `npx tsx`). The 5 pre-existing unrelated repo errors are untouched.

## Deviations from Plan

**1. [Rule 3 - Blocking module resolution] Script uses raw @aws-sdk instead of the `Ctf` ElectroDB entity**
- **Found during:** Task 2 (running the script under tsx)
- **Issue:** The plan specified importing the `Ctf` entity and writing via `Ctf.patch(...).set({answerHash}).remove(["answer"])`. But `Ctf` (src/entities/qr.ts) imports `src/entities/client.ts`, which imports `@auth/dynamodb-adapter` — an ESM-only package (package.json exports only an `import` condition, no `require`/`default`). The webapp has no `"type":"module"`, so under a standalone `tsx` run its `.ts` files are transpiled to CommonJS and a CJS `require()` of that adapter fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Next.js bundles around this; a bare operator script cannot. (`mint-local-session.mts` avoids it by never importing the entity chain; `reset-payment-data.mjs` — the plan's cited lineage — deliberately uses the raw SDK for the same reason.)
- **Fix:** The script talks to DynamoDB via the raw `@aws-sdk` `DynamoDBDocument` client (mirroring `reset-payment-data.mjs`): it scans `Ctf` rows by ElectroDB's `__edb_e__` entity marker and writes each row by its **own** `pk`/`sk` (read from the scan) via `UpdateExpression`. No key composition → zero entity-key drift risk (the parity contract in `qr-key-parity.test.ts` concerns key derivation, which this never touches). The hashing decision still flows through `planCtfMigration` → `hashAnswer`, so parity with the judge is preserved exactly. The write also bumps `updatedAt`, mirroring the entity's `watch:*` behavior.
- **Files modified:** apps/run.human/webapp/scripts/migrate-ctf-answerhash.mts
- **Commit:** a4e4afec

## Threat mitigations applied

- **T-47-05 (Tampering, destructive write):** dry-run default; `--confirm` required to write; idempotent (already-hashed/no-answer → skip); per-row action logged before any write. Verified end-to-end (dry-run left the row untouched).
- **T-47-06 (Info disclosure, logging):** logs the ACTION only — never the answer or answerHash value. Verified in the local run output.
- **T-47-07 (Correctness, hash divergence):** reuses `hashAnswer` directly (no re-implementation); unit test asserts `plan.answerHash === hashAnswer(answer)`; local run confirmed `answerHash === hashAnswer("SuperSecret Flag")`.
- **T-47-08 (EoP, auto-run in app code):** standalone script; grep confirms no app/build/request module imports it (only the pure helper is imported, by tests).

## Self-Check: PASSED

- FOUND: apps/run.human/webapp/src/lib/ctf-migration.ts
- FOUND: apps/run.human/webapp/scripts/migrate-ctf-answerhash.mts
- FOUND: apps/run.human/webapp/src/lib/__tests__/ctf-migration.test.ts
- FOUND commit 7917600a (test RED), 4062fdf2 (helper GREEN), a4e4afec (script)
