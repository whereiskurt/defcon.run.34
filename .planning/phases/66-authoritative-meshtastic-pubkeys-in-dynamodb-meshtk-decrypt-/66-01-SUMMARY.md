---
phase: 66-authoritative-meshtastic-pubkeys-in-dynamodb-meshtk-decrypt
plan: 01
subsystem: run.human (ElectroDB data layer)
tags: [electrodb, dynamodb, meshtastic, mesh-radio, key-parity]
requires: []
provides:
  - MeshRadio ElectroDB entity (single source of truth for Meshtastic radios)
  - upsertMeshRadio / deleteMeshRadio / getMeshRadio / getMeshRadiosByUser helpers
  - meshRadioKeyFor canonical-key helper
  - parity-locked pk/sk contract for meshtk plan 66-07
affects:
  - Later plans 66-02 (register write), 66-03 (readers), 66-04 (backfill), 66-07 (meshtk Go decrypt)
tech-stack:
  added: []
  patterns:
    - Clone accomplishment.ts GSI-bearing entity onto shared run-human-electro table
    - Clone qr-key-parity.test.ts for offline .params() key-parity locking
key-files:
  created:
    - apps/run.human/webapp/src/entities/mesh-radio.ts
    - apps/run.human/webapp/src/entities/__tests__/mesh-radio-key-parity.test.ts
  modified: []
decisions:
  - MeshRadio.byUser overlays the pre-provisioned gsi1pk-gsi1sk-index (ElectroDB entity-scoped) — NO terraform change (MRAD-08)
  - GSI sort-key carries ElectroDB's entity-marker prefix ($meshradio_1#nodeid_...); the byUser query partition is the plain $run#userid_<id> contract meshtk uses
metrics:
  duration: ~6 min
  completed: 2026-07-19
status: complete
---

# Phase 66 Plan 01: MeshRadio Entity + Key-Parity Lock Summary

First-class `MeshRadio` ElectroDB entity — the single source of truth for Meshtastic radios (LOCKED hard-switch) — modeling full radio state, keyed `pk=nodeId` with a `byUser` GSI, plus a vitest parity test that locks the exact ElectroDB-composed keys as the cross-language contract for meshtk's Go `GetItem` (plan 66-07).

## What was built

- **`mesh-radio.ts`** — `MeshRadio` entity (`model: MeshRadio/1/run`) on the shared `run-human-electro` table. Full-state attributes: `nodeId` (pk), `nodeNum` (uint32), `userId` (byUser pk), `publicKey`, `privateKey`, `verified`, `verificationCode`, `verifiedAt`, `verificationAttempts`, `resendAttempts`, `impersonate`, `showOnMap`, `source` enum `["flash","sync","manual"]`, `createdAt` (default), `updatedAt` (watch-all). Indexes: `primary` pk composite `[nodeId]` / sk composite `[]`; `byUser` on `gsi1pk-gsi1sk-index` pk `[userId]` / sk `[nodeId]`.
- **Sole-write-funnel helpers (L10):** `upsertMeshRadio`, `deleteMeshRadio`, `getMeshRadio`, `getMeshRadiosByUser` — server-only.
- **`meshRadioKeyFor(nodeId)`** — the one programmatic source of the canonical `{ pk, sk }`, read from ElectroDB's own composition (offline, no hand-guessing for the Go side).
- **Module header** documents the parity-locked Go key format and the MRAD-08 no-terraform decision inline.
- **`mesh-radio-key-parity.test.ts`** — 4 cases locking `pk="$run#nodeid_!433d1cec"`, `sk="$meshradio_1"`, byUser `gsi1pk="$run#userid_user-abc"`, the put path, and the `meshRadioKeyFor` helper. Header states these literals are the Go-side contract (L1).

## Verification results

All commands run under Node 22.12.0 from `apps/run.human/webapp`.

- **Task 1 typecheck** — `npx tsc --noEmit -p tsconfig.json | grep mesh-radio` → `no mesh-radio type errors`.
- **Parity test** — `npx vitest run src/entities/__tests__/mesh-radio-key-parity.test.ts` → `Test Files 1 passed`, `Tests 4 passed`.
- **Task 3 gate** — parity test + `grep meshradio_1` + `grep -i "no terraform"` → `GATE_OK`.
- **Full build** — `npm run build` → `✓ Compiled successfully in 7.6s`, `EXIT=0`.

Note: node_modules was absent in this worktree; `npm ci` (969 packages) was run once before gates — an environment prerequisite, not a plan change.

## Deviations from Plan

**1. [Rule 1 - Bug] Corrected an over-specified test assertion for the byUser GSI sort key**
- **Found during:** Task 2 (first parity-test run).
- **Issue:** My initial extra assertion expected `Item.gsi1sk === "$run#nodeid_!433d1cec"`. ElectroDB composes GSI sort keys with the entity-marker prefix, so the real value is `"$meshradio_1#nodeid_!433d1cec"`. The plan-required assertions (pk, sk, byUser gsi1pk) all passed on the first run; only the self-added gsi1sk line was wrong.
- **Fix:** Asserted the true composed value and documented why (the byUser *query* partition `$run#userid_<id>` is the meshtk contract; the GSI sk prefix is ElectroDB-internal). This makes the format explicit rather than guessed.
- **Files modified:** `mesh-radio-key-parity.test.ts`.
- **Commit:** 5ffb4594.

No other deviations — entity attributes, indexes, helpers, and docs match the plan exactly.

## Known Stubs

None. No placeholder data or unwired surfaces; no routes wired (plan 66-02 owns that, per plan scope).

## Threat Flags

None. No new network endpoints, auth paths, or schema at trust boundaries beyond the planned entity. T-66-01 (key-composition tampering) is mitigated by the parity test + `meshRadioKeyFor` single source; T-66-02 (gsi1 slot collision) is accepted and documented (ElectroDB entity-scoping).

## Commits

- f9089868 — feat(66-01): add MeshRadio ElectroDB entity + CRUD helpers
- 5ffb4594 — test(66-01): lock MeshRadio pk/sk parity (TS side of L1)
- af56a67b — feat(66-01): add meshRadioKeyFor canonical-key helper (MRAD-08 doc)

## Self-Check: PASSED

- FOUND: apps/run.human/webapp/src/entities/mesh-radio.ts
- FOUND: apps/run.human/webapp/src/entities/__tests__/mesh-radio-key-parity.test.ts
- FOUND commits: f9089868, 5ffb4594, af56a67b
