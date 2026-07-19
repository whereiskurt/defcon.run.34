---
phase: 66-authoritative-meshtastic-pubkeys-in-dynamodb-meshtk-decrypt
plan: 04
subsystem: run.human (one-off operator backfill)
tags: [meshtastic, mesh-radio, backfill, migration, base64-hex, key-parity, mrad-03]
requires:
  - MeshRadio ElectroDB entity + meshRadioKeyFor parity helper (plan 66-01)
  - Pure mesh-radio-canonical lib (canonicalNodeId / normalizeNodeId / nodeNumFromNodeId / publicKeyBase64ToHex) (plan 66-02)
provides:
  - scripts/backfill-mesh-radios.mts — idempotent, re-runnable, dry-run-default backfill of MeshRadio from embedded RunUser.meshtasticRadios[]
  - Pure exported toMeshRadioItem(userId, radio, now?) transform (embedded radio -> parity-locked MeshRadio raw item | null)
affects:
  - Plan 66-07 (meshtk flips fallback=none AFTER this backfill seeds the entity — deploy-time sequencing, L7)
tech-stack:
  added: []
  patterns:
    - Clone migrate-ctf-answerhash.mts / reset-ctf-user.mts raw @aws-sdk one-off (bare tsx, ESM-adapter-free, L9)
    - Read SOURCE data raw off the DynamoDB row (attribute removed from the entity by 66-03; still on-disk)
    - Hand-composed ElectroDB-parity raw item (pk/sk/gsi1pk/gsi1sk + __edb_e__/__edb_v__) locked to the entity by a vitest parity test (L1)
    - import.meta.url/argv guard so the script's main() never runs on test import
key-files:
  created:
    - apps/run.human/webapp/scripts/backfill-mesh-radios.mts
    - apps/run.human/webapp/scripts/__tests__/backfill-mesh-radios.test.mts
  modified: []
decisions:
  - "source=\"manual\" for every backfilled radio: embedded meshtasticRadios[] entries carry no reliable flash marker, so the safe default is manual (documented in-code)"
  - "toMeshRadioItem returns null (skip) for absent nodeId, absent pubkey, OR a non-32-byte decode — a malformed/empty key is not fatal to the run (plan action text; L3 guard)"
  - "Raw-item fallback (not entity write) is the REAL path here: client.ts imports the ESM-only @auth/dynamodb-adapter at module top, so a bare tsx import of the MeshRadio entity fails (L9). The hand-composed item includes ElectroDB's internal markers so app-side reads hydrate a backfilled row identically to a route-written one."
  - "Idempotency is belt-and-suspenders: get-first short-circuit AND a conditional put (attribute_not_exists(pk)) so a race / re-run is last-writer-safe"
  - "Test imports the script with a .mjs specifier so tsc bundler resolution finds the .mts sibling (extensionless failed TS2307); vitest/esbuild resolves it too"
metrics:
  duration: ~20 min
  completed: 2026-07-19
status: complete
---

# Phase 66 Plan 04: MeshRadio Backfill Script + Parity Test Summary

A one-off, idempotent, dry-run-by-default operator script (`scripts/backfill-mesh-radios.mts`) that seeds the first-class `MeshRadio` entity from every existing embedded `RunUser.meshtasticRadios[]` entry, so the entity is fully populated before meshtk flips `fallback=none` at deploy time (spec §8, L7). The per-radio transform is a PURE exported function locked, field-for-field, against the real ElectroDB entity by a vitest parity test — so a hand-composed backfill row can never drift from a route-written one (L1).

## What was built

- **`scripts/backfill-mesh-radios.mts`** — cloned from `migrate-ctf-answerhash.mts` / `reset-ctf-user.mts`:
  - **Raw @aws-sdk `DynamoDBDocument`** (NOT the ElectroDB entity): `client.ts` imports the ESM-only `@auth/dynamodb-adapter` at module top, which a bare `tsx` CJS run cannot `require()` (L9). Credentials resolve from `RUN_ELECTRO_ID`/`SECRET` when both present, else the default AWS provider chain so `AWS_PROFILE=dc34-application` (SSO) drives a prod run. Fails loud (exit 2) if `RUN_DYNAMODB_REGION` is missing, before any scan.
  - **Source is the RAW embedded field:** plan 66-03 removed `meshtasticRadios` from the RunUser *entity*, but the attribute still lives on existing DynamoDB rows. The script scans RunUser rows by their ElectroDB `__edb_e__` marker (`"RunUser"`, paginated) and reads `row.meshtasticRadios` off the raw item. `userId` is read from the row's own primary-key attribute — never composed.
  - **`toMeshRadioItem(userId, radio, now?)`** — PURE exported transform, unit-testable without DDB. Returns `null` (skip) for a missing `userId`/`nodeId`, an absent `publicKey`, or a `publicKey` that fails the 32-byte decode guard (`publicKeyBase64ToHex`, L3). Otherwise composes the FULL parity item: `nodeId` -> pad-8 lowercase (`normalizeNodeId`, L2/L12), `nodeNum` -> uint32, `publicKey` -> `0x` hex, verification/flags carried over with entity-default fill, `source:"manual"`, original `createdAt` preserved / `updatedAt` = now, and the hand-composed `pk`/`sk`/`gsi1pk`/`gsi1sk` + `__edb_e__`/`__edb_v__` internal markers so an app-side ElectroDB read hydrates it identically.
  - **Idempotency:** get-first short-circuit (`doc.get` by `pk`/`sk`; existing -> "already migrated" skip) AND a conditional `put` (`attribute_not_exists(pk)`) so a re-run / race is last-writer-safe. `ConditionalCheckFailedException` is treated as skipped-existing.
  - **Dry-run by default; `--confirm` to write.** Prints a per-radio action line and a summary: `N users scanned (M with radios), R radios found; created/would-create K | skipped-existing S | skipped-malformed E | errors`. Never logs key material.
  - **`main()` is guarded** by `process.argv[1] === fileURLToPath(import.meta.url)` so importing `toMeshRadioItem` from the test triggers no scan.
- **`scripts/__tests__/backfill-mesh-radios.test.mts`** — 9 cases:
  - Conversion: 32-byte base64 pubkey + unpadded `!abcdef` nodeId -> `!00abcdef`, `nodeNum 0x00abcdef`, `0x`+64-hex publicKey, verbatim flag carry-over, preserved `createdAt` / `updatedAt`=now.
  - Entity-default fill when embedded flags are absent; absent optionals omitted (not written as `undefined`).
  - Malformed/empty SKIP signal: 31-byte, 33-byte, absent pubkey, absent nodeId, absent userId all -> `null`.
  - **Parity lock (L1):** `toMeshRadioItem(...)` equals `MeshRadio.put(...).params({table}).Item` field-for-field on `pk`/`sk`/`gsi1pk`/`gsi1sk`/`__edb_e__`/`__edb_v__`/`nodeId`/`nodeNum`/`userId`/`publicKey`, plus the exact literals meshtk composes in Go (`$run#nodeid_!433d1cec`, `$meshradio_1`, `$run#userid_user-abc`, `$meshradio_1#nodeid_!433d1cec`) and agreement with `meshRadioKeyFor`.

## Verification results

All commands run under Node 22.12.0 (`nvm use 22.12.0`) from `apps/run.human/webapp`. No live DDB write access was used; the `--confirm` backfill is a deploy-time op and was NOT run.

- **Task 1 typecheck** — `npx tsc --noEmit -p tsconfig.json | grep -i backfill-mesh-radios` -> `NO backfill-mesh-radios type errors`.
- **Task 1 parse + fail-loud guard** — `env -u RUN_DYNAMODB_REGION npx tsx scripts/backfill-mesh-radios.mts` -> `Missing required env var: RUN_DYNAMODB_REGION`, `exit=2`. Proves the script parses, loads the pure lib, and `main()` runs without throwing (the region guard precedes any scan).
- **Task 2 unit test** — `npx vitest run scripts/__tests__/backfill-mesh-radios.test.mts` -> `Test Files 1 passed`, `Tests 9 passed`.
- **Task 1+2 combined typecheck** — `npx tsc --noEmit -p tsconfig.json | grep -i backfill-mesh-radios` -> `NO backfill type errors (script + test)`.

## How to run it (deploy-time — do NOT run against prod from this worktree)

```bash
cd apps/run.human/webapp
# 1. dry-run — inspect the plan (writes nothing):
AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/backfill-mesh-radios.mts
# 2. commit the backfill (creates missing MeshRadio rows):
AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/backfill-mesh-radios.mts --confirm
# 3. (optional) re-run --confirm to prove idempotency — should report all skip.
```
Sequencing (L7): this backfill MUST run+seed MeshRadio BEFORE meshtk (plan 66-07) flips `fallback=none`, or pre-phase radios miss. The `.env` must point `RUN_ELECTRO_*` at the use1 prod table (`run-human-electro`).

## Deviations from Plan

**1. [Rule 3 - Blocking] Test imports the script with a `.mjs` specifier (extensionless failed tsc resolution)**
- **Found during:** Task 2 combined typecheck.
- **Issue:** `import ... from "../backfill-mesh-radios"` (extensionless) resolved fine under vitest/esbuild but tsc `moduleResolution: bundler` could not resolve the `.mts` sibling (`TS2307: Cannot find module`).
- **Fix:** Imported with the TS output-extension idiom `from "../backfill-mesh-radios.mjs"` — resolves cleanly for BOTH tsc and vitest (the test still passes). Also cast the parity comparison through `unknown` (`item as unknown as Record<string, unknown>`) to satisfy `TS2352` given the item's literal-typed `__edb_e__`/`__edb_v__`.
- **Files modified:** `scripts/__tests__/backfill-mesh-radios.test.mts`.
- **Commit:** e87a40a7.

Otherwise the plan executed as written. The one discretionary choice (within plan bounds): the entity-write path was NOT attempted because `client.ts` imports the ESM-only adapter at module top (a bare-tsx import fails, L9) — the plan's raw-key fallback, locked by the parity test, is the realized path (and the test locks the full item incl. internal markers, not just pk/sk, so drift is impossible).

## Known Stubs

None. `toMeshRadioItem` is a real transform with real conversion/guards; the harness performs real scans/gets/puts (gated behind `--confirm`). No placeholder data or unwired surface. The `--confirm` prod run is intentionally deferred to deploy time (operator step), not a stub.

## Threat Flags

None beyond the plan's registered threats. T-66-09 (drifting key) is mitigated by the field-for-field parity test against the entity + `meshRadioKeyFor` (L1). T-66-10 (accidental bulk write) is mitigated by the dry-run default + explicit `--confirm` + fail-loud region guard. No new network surface, auth path, or package install.

## Commits

- 4847c81f — feat(66-04): backfill MeshRadio from embedded RunUser.meshtasticRadios[]
- e87a40a7 — test(66-04): lock backfill transform + MeshRadio key parity (L1)

## Self-Check: PASSED

- FOUND: apps/run.human/webapp/scripts/backfill-mesh-radios.mts
- FOUND: apps/run.human/webapp/scripts/__tests__/backfill-mesh-radios.test.mts
- FOUND commits: 4847c81f, e87a40a7
