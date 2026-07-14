---
phase: 48-cloudfront-integration-exposure
plan: 03
subsystem: docs / integration-contract
tags: [ctf, integration, dynamodb, electrodb, leaderboard, dc33]
requires:
  - "apps/run.human/webapp/src/entities/ctf.ts (CtfSolve)"
  - "apps/run.human/webapp/src/entities/run-user.ts (RunUser.ctfScore/ctfSolves)"
provides:
  - "docs/ctf-score-integration.md — CTF read contract for the DC33 total-score mapper"
affects:
  - "DC33 total-score migration (separate `leaderboard` worktree, read-only consumer)"
tech-stack:
  added: []
  patterns: ["ElectroDB key encoding documented as read contract, not coupled"]
key-files:
  created:
    - docs/ctf-score-integration.md
  modified: []
decisions:
  - "Documented committed key encodings verbatim (confirmed against ctf-key-parity.test.ts); flagged ElectroDB as authoritative encoder."
  - "Stated ctfScore == sum(CtfSolve.points): trust rollup for speed OR recompute from rows for audit."
  - "Explicit non-goals: global board not built here; our writes not coupled to DC33 schema; q admin board is CTF-only."
metrics:
  duration: ~10m
  completed: 2026-07-14
status: complete
---

# Phase 48 Plan 03: CTF Score Integration Exposure (CTF-14) Summary

A single documentation artifact — `docs/ctf-score-integration.md` — that gives the
separate DC33 total-score mapper (the `leaderboard` worktree) the exact, entity-confirmed
read for a user's CTF contribution: the cheap `RunUser.ctfScore`/`ctfSolves` rollup plus
the auditable `CtfSolve` ledger, with table, entity names, pk/sk composites, the `byUser`
GSI, and runnable sample queries. No app or infra code changed.

## What was built

`docs/ctf-score-integration.md`, structured as a read-only integration contract:

- **Table:** `run-human-electro` (env `RUN_ELECTRO_DBNAME`), region `us-east-1`, ElectroDB
  service `run` / version `1`.
- **Fast rollup — `RunUser`:** primary pk `["userId"]` → `$run#userid_<userId>`,
  sk `[]` → `$runuser_1`; fields `ctfScore` (running total, atomic ADD) and `ctfSolves`
  (count).
- **Source of truth — `CtfSolve`:** primary pk `["challenge"]` → `$run#challenge_<challenge>`,
  sk `["user"]` → `$ctfsolve_1#user_<user>`; `byUser` GSI `gsi1pk-gsi1sk-index`
  gsi1pk `["user"]` → `$run#user_<user>`, gsi1sk `["challenge"]` → `$ctfsolve_1#challenge_<challenge>`.
  Scored attributes: `ordinal`, `points`, `firstBlood`, `tierCeiling`,
  `channel` (`qr`|`covert`), `solvedAt`.
- **Rollup vs. ledger:** `ctfScore == sum(CtfSolve.points)` — trust the rollup for speed
  or recompute from rows for audit.
- **Sample queries:** (a) ElectroDB `CtfSolve.query.byUser({ user }).go()`; (b) raw
  DynamoDB `Query` on `gsi1pk-gsi1sk-index` with `gsi1pk = "$run#user_<user>"`;
  (c) `RunUser.get({ userId })` / raw `GetItem` for the `ctfScore` rollup.
- **Non-goals:** global/total board NOT built here; our writes NOT coupled to the DC33
  schema; the `q` admin leaderboard is CTF-only.
- **Shared-index caveat documented:** `gsi1pk-gsi1sk-index` is table-wide (also
  `RunUser.byHash`); the partition value prefix namespaces CtfSolve rows.

## Confirmation against committed entities

Every key string was confirmed against the source, not invented:

- `apps/run.human/webapp/src/entities/ctf.ts` — `CtfSolve` primary + `byUser` composites,
  attribute list, `channel` union.
- `apps/run.human/webapp/src/entities/run-user.ts` — `RunUser` primary key, `ctfScore`/
  `ctfSolves` defaults, and the "CtfSolve rows are the auditable source of truth" comment.
- `apps/run.human/webapp/src/entities/client.ts` — `ELECTRO_TABLE = RUN_ELECTRO_DBNAME || "run-human-electro"`.
- `apps/run.human/webapp/src/entities/__tests__/ctf-key-parity.test.ts` — pinned the
  exact emitted strings (`$run#challenge_sao`, `$ctfsolve_1#user_user-123`,
  `$run#user_user-123`, index `gsi1pk-gsi1sk-index`), which match the doc verbatim.

## Verification

- Task verify command passed (`VERIFY PASS`): file exists; doc contains `run-human-electro`,
  `gsi1pk-gsi1sk-index`, `ctfScore`, `CtfSolve`; entities contain `gsi1pk-gsi1sk-index`
  (ctf.ts) and `ctfScore` (run-user.ts).
- `git status` confirms only `docs/ctf-score-integration.md` was added — no app/infra code
  touched (STRICT SCOPE honored; no Terraform).

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- FOUND: docs/ctf-score-integration.md
- FOUND commit: a5977ea7
