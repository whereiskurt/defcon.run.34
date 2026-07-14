---
phase: 44-ctf-judge-core-scoring-engine-data-model
plan: 01
subsystem: run.human/ctf
tags: [ctf, entities, electrodb, data-model, key-parity]
requires: []
provides:
  - "Ctf entity extended: answerHash, pointMax, pointFloor, maxSolves, firstBloodBonus, solveCount, timeTiers[]"
  - "RunUser.ctfScore + RunUser.ctfSolves atomic-rollup counters (+ RunUserItem)"
  - "src/entities/ctf.ts: CtfSolve, CtfPending, CtfAttempt entities + item types"
  - "Key-parity tests locking every CTF key composite"
affects:
  - "44-03 judge (claims CtfSolve, ADDs Ctf.solveCount, ADDs RunUser.ctfScore/ctfSolves, reads CtfAttempt)"
  - "Phase 45 visible claim page (reads Ctf scoring fields)"
  - "Phase 46 covert channel (reads/writes CtfPending by nonce)"
  - "Phase 47 admin CRUD + plaintext->answerHash migration"
tech-stack:
  added: []
  patterns:
    - "ElectroDB entity extension without moving parity-locked primary key"
    - "default-0 atomic-ADD counters (patterned on RunUser.checkInCount)"
    - "run.human-only entities (no resolver .mjs mirror) with offline key-parity locks"
key-files:
  created:
    - apps/run.human/webapp/src/entities/ctf.ts
    - apps/run.human/webapp/src/entities/__tests__/ctf-key-parity.test.ts
  modified:
    - apps/run.human/webapp/src/entities/qr.ts
    - apps/run.human/webapp/src/entities/run-user.ts
    - apps/run.human/webapp/src/entities/__tests__/qr-key-parity.test.ts
decisions:
  - "Legacy Ctf.answer kept as an optional attribute so existing rows still load; plaintext->answerHash migration deferred to Phase 47."
  - "CtfSolve gsi1 accessor named byUser (gsi1pk-gsi1sk-index) for 'all my solves'."
  - "CtfSolve.channel typed as an enum ['qr','covert']; CtfSolve.sk=[user] is the attribute_not_exists idempotency key the 44-03 judge claims against."
  - "CtfPending/CtfAttempt are run.human-only (no .mjs mirror); their emitted keys are pinned by test as the downstream contract."
  - "No DB-mutating helpers in ctf.ts (schema only) — the judge owns conditional-put/atomic-ADD."
metrics:
  tasks_completed: 3
  files_created: 2
  files_modified: 3
  tests_added: 5
  completed: 2026-07-14
status: complete
---

# Phase 44 Plan 01: CTF Data Model & Entities + Key-Parity Tests Summary

Established the Phase-44 CTF data layer on the shared `run-human-electro` table (CTF-01): extended the `Ctf` entity with the scoring/secret fields, added the three run.human-only entities (`CtfSolve`/`CtfPending`/`CtfAttempt`), added the `ctfScore`/`ctfSolves` rollups to `RunUser`, and locked every DynamoDB key composite with offline key-parity tests — the resolver-read `Ctf` key stays byte-identical while the new entities pin the exact keys downstream phases depend on. Entities-only scope: no routes, UI, scoring/judge logic, or Terraform.

## What Was Built

### `Ctf` extended (`src/entities/qr.ts`, CTF-01)
Added attributes: `answerHash` (string), `pointMax`, `pointFloor`, `maxSolves`, `firstBloodBonus` (numbers), `solveCount` (number, default 0 — atomic ordinal allocator), and `timeTiers` (list of `{ from, to, ceiling }` maps). Legacy `answer` kept as an optional attribute with a comment noting `answerHash` supersedes it and the migration lands in Phase 47. The `model` block (entity/version/service) and the `primary` index are untouched — the resolver reads this key on its hot path.

### `RunUser` rollups (`src/entities/run-user.ts`, CTF-03)
Added `ctfScore` and `ctfSolves` (both number, default 0), patterned on the existing `checkInCount` default-0 counter; both added to the exported `RunUserItem` type as optional numbers. No read/write helper added — the judge (44-03) owns the atomic `ADD`.

### New entities (`src/entities/ctf.ts`, CTF-01)
Schema-only file, no DB-mutating helpers, mirroring the `qr.ts` header (imports `electroClient`/`ELECTRO_TABLE`). All three `version:"1"`, `service:"run"`:
- **`CtfSolve`** — one row per `(challenge, user)`; `primary` pk=`[challenge]` sk=`[user]` (idempotency key), `gsi1` (`byUser`, index `gsi1pk-gsi1sk-index`) pk=`[user]` sk=`[challenge]` ("all my solves"). Attrs: `ordinal`, `points`, `firstBlood`, `tierCeiling`, `channel` (enum `qr|covert`), `solvedAt`, `createdAt`/`updatedAt`.
- **`CtfPending`** — park-and-claim; `primary` pk=`[nonce]` sk=`[]`. Attrs: `challenge`, `submittedFlagHash` (hash, never raw guess), `createdAt`, `ttl`.
- **`CtfAttempt`** — short-TTL attempt counter; `primary` pk=`[challenge]` sk=`[user]`. Attrs: `count` (default 0), `expiresAt`, `ttl`.
Exported `CtfSolveItem`/`CtfPendingItem`/`CtfAttemptItem` hand-authored types.

## ElectroDB Key Composites (the downstream contract)

Every key below is proven by a passing offline `.params({table}).Key` assertion (`table = "run-human-electro"`):

| Entity | Access | pk | sk / index |
|--------|--------|----|-----------|
| `Ctf` | `get({challenge:"sao"})` | `$run#challenge_sao` | `$ctf_1` (unchanged — parity-locked) |
| `CtfSolve` | `get({challenge:"sao", user:"user-123"})` | `$run#challenge_sao` | `$ctfsolve_1#user_user-123` |
| `CtfSolve` | `query.byUser({user:"user-123"})` | `$run#user_user-123` | IndexName `gsi1pk-gsi1sk-index` |
| `CtfPending` | `get({nonce:"n-abc"})` | `$run#nonce_n-abc` | `$ctfpending_1` |
| `CtfAttempt` | `get({challenge:"sao", user:"user-123"})` | `$run#challenge_sao` | `$ctfattempt_1#user_user-123` |

Composite-value casing follows ElectroDB's default lowercasing (e.g. `sao`, `user-123`, `n-abc` are already lowercase). `CtfSolve.sk` (`$ctfsolve_1#user_<u>`) is the `attribute_not_exists(sk)` idempotency key the Phase-44-03 judge claims against.

## Test Results

`npx vitest run` (Node 23.6.0) on both key-parity files — **10 tests, 2 files, all green**:
- `qr-key-parity.test.ts` (6): existing Qr/Ctf/Qrstat locks intact (incl. `$run#challenge_sao`/`$ctf_1` unchanged after extension) + new assertion that `Ctf.put({...new scoring attrs...})` encodes offline (key unmoved, `answerHash`/`timeTiers` accepted).
- `ctf-key-parity.test.ts` (4): CtfSolve primary + gsi1, CtfPending, CtfAttempt keys pinned to exact emitted strings.

## Verification

- **tsc:** the 5 edited/created files produce **0 errors**. `npx tsc --noEmit` reports 5 errors, all pre-existing in unrelated untouched files (`components/header/dropdown-user.tsx` missing-svg-module decl; `entities/__tests__/checkin.test.ts` ElectroDB `.model` typing ×4) — out of scope per the scope boundary; logged to `deferred-items.md`, not fixed.
- **Resolver parity:** `Ctf.model` block and `primary` index in `qr.ts` are unchanged; the resolver `.mjs` mirror (`apps/run.qr/lambda/resolver/lib/entities.mjs`) needs no change because only non-key attributes were added and the resolver forwards `/ctf/...` without reading them.
- **Schema-only:** `ctf.ts` contains no `electroClient` write calls (`.create/.put/.update/.patch/.go`).

## Deviations from Plan

None — plan executed exactly as written.

## Threat Mitigations Applied

- **T-44-01** (Ctf primary-key drift): key-parity test asserts `$run#challenge_sao`/`$ctf_1` unchanged after the attribute extension.
- **T-44-02** (CtfPending raw-guess disclosure): entity stores only `submittedFlagHash`; no raw-guess attribute exists.
- **T-44-SC** (dependency supply chain): no new dependency — entities use existing `electrodb`; no install task.

## Self-Check: PASSED
- FOUND: apps/run.human/webapp/src/entities/ctf.ts
- FOUND: apps/run.human/webapp/src/entities/__tests__/ctf-key-parity.test.ts
- FOUND: apps/run.human/webapp/src/entities/qr.ts (modified)
- FOUND: apps/run.human/webapp/src/entities/run-user.ts (modified)
- FOUND: apps/run.human/webapp/src/entities/__tests__/qr-key-parity.test.ts (modified)
- FOUND commit 15df7336 (feat T1 Ctf + RunUser)
- FOUND commit d7db3c0a (feat T2 CtfSolve/CtfPending/CtfAttempt)
- FOUND commit 3edd59a9 (test T3 key-parity)
