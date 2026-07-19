---
phase: 66-authoritative-meshtastic-pubkeys-in-dynamodb-meshtk-decrypt
plan: 03
subsystem: run.human (reader/writer migration + embedded-list retirement)
tags: [meshtastic, mesh-radio, hard-switch, electrodb, migration, mrad-04]
requires:
  - MeshRadio entity + upsert/get/getByUser/delete helpers (plan 66-01)
  - mesh-radio-canonical lib + internal register MeshRadio write (plan 66-02)
provides:
  - MeshRadio as the SINGLE source of truth for all run.human radio reads/writes
  - patchMeshRadio + scanAllMeshRadios helpers on the MeshRadio entity module
  - Fully retired RunUser.meshtasticRadios[] (attr, write helper, type, sanitizer)
affects:
  - Plan 66-04 (backfill populates MeshRadio rows the now-flipped readers consume)
  - Plan 66-07 (meshtk Go decrypt reads the same authoritative MeshRadio rows)
tech-stack:
  added: []
  patterns:
    - Partial-update helper (patchMeshRadio) preserves readOnly createdAt vs a full put
    - Low-frequency entity scan (scanAllMeshRadios) for the app map feed, joined to RunUser identity
    - Client keys each radio on canonical nodeId (retired uuid id removed)
key-files:
  created: []
  modified:
    - apps/run.human/webapp/src/entities/mesh-radio.ts
    - apps/run.human/webapp/src/app/api/meshtastic-radios/route.ts
    - apps/run.human/webapp/src/app/api/meshtastic-radios/resend/route.ts
    - apps/run.human/webapp/src/app/api/internal/meshtastic-radios/route.ts
    - apps/run.human/webapp/src/app/api/internal/mesh-map/route.ts
    - apps/run.human/webapp/src/app/api/user/route.ts
    - apps/run.human/webapp/src/app/(protected)/whoami/page.tsx
    - apps/run.human/webapp/src/components/profile/MeshtasticRadios.tsx
    - apps/run.human/webapp/src/entities/run-user.ts
    - apps/run.human/webapp/src/entities/run-user.test.ts
    - apps/run.human/webapp/src/app/api/internal/mesh-map/route.test.ts
decisions:
  - Added patchMeshRadio (ElectroDB patch, then re-read) so PATCH/resend/re-flash preserve createdAt/showOnMap instead of resetting them via a full-item put
  - Kept the user's own privateKey in the /api/user + GET responses (UI shows it and gates impersonate/showOnMap on its presence); stripped only verificationCode — preserves no-UI-regression while tightening the verificationCode leak the old GET had
  - PATCH/DELETE/resend now scope by radio.userId === session.user.id (getMeshRadio is global-by-nodeId) — closes cross-user mutation
  - Reworded residual doc comments to avoid the literal retired tokens so the grep gate proves a clean zero
metrics:
  duration: ~30 min
  completed: 2026-07-18
status: complete
---

# Phase 66 Plan 03: Reader/Writer Hard-Switch onto MeshRadio Summary

Executed the LOCKED hard-switch (MRAD-04): every enumerated reader and writer of the embedded `RunUser.meshtasticRadios[]` list now reads/writes the first-class `MeshRadio` entity, and the embedded list — its attribute, write helper, item type, and read-back sanitizer — is fully retired from `run-user.ts`. `npm run build` compiles clean with zero references to the retired symbols; no dual-write remains; `MeshRadio` is the single source of truth the whole app agrees on.

## What was built

### Task 1 — user-facing CRUD + resend (commit 4e722f3b)
- **`api/meshtastic-radios/route.ts`** rewritten against MeshRadio helpers:
  - **GET** lists via `getMeshRadiosByUser(session.user.id)`, keeps the `{ radios, quota }` shape, strips `verificationCode` per row (the old GET leaked it).
  - **POST** canonicalizes the nodeId via `normalizeNodeId` (fixes the historically unpadded manual-add path, L2), converts the provided/`derivePublicKey`-derived base64 pubkey to `0x` hex via `publicKeyBase64ToHex` before storing (L3), duplicate-checks with `getMeshRadio`, then `upsertMeshRadio(source:"manual", verified:false, generated verificationCode, explicit nodeNum)`. Pubkey conversion happens before quota consume so a malformed key never costs a quota unit.
  - **PATCH** loads by canonical nodeId, enforces the same 5-attempt verification cap, updates verify/keys/impersonate/showOnMap via `patchMeshRadio`, converts base64→hex when keys change.
  - **DELETE** removes via `deleteMeshRadio(nodeId)`; quota intentionally not restored.
- **`resend/route.ts`** loads the row by nodeId, bumps `resendAttempts`/regenerates the code via `patchMeshRadio` — no key change, same 5-verify/3-resend caps.
- **`mesh-radio.ts`** gained two SERVER-ONLY helpers within the granted "helper factoring" discretion: `patchMeshRadio` (partial update that preserves the readOnly `createdAt` a full `put` would reset) and `scanAllMeshRadios` (low-frequency entity scan for the map feed).

### Task 2 — readers (commit 33c3270b)
- **`internal/mesh-map/route.ts`** now enumerates `scanAllMeshRadios()` for `verified && showOnMap`, reads `nodeNum` straight off the row (no `hexToNodeNum`), and joins user identity via a `scanAllRunUsers()` map for `displayName`/`mqttUsertype`/`pinIcon`/`pinColor`. Same output contract + `no-store` header; only presentation-safe fields emitted (never key material). The meshtk no-Scan rule does not apply to this app feed.
- **`api/user/route.ts`** adds an explicit `radios` field from `getMeshRadiosByUser(userId)` (parallelized in the existing `Promise.all`), presentation-safe (verificationCode stripped).
- **`whoami/page.tsx`** sources the `radios` prop from the new `userData.radios` field (interface field renamed off `meshtasticRadios`).
- **`components/profile/MeshtasticRadios.tsx`** keys every radio on `nodeId` (the retired uuid `id` removed from the interface); PATCH/DELETE/resend send `nodeId`; all UI behavior (list/add/verify/resend/delete/impersonate/showOnMap) is unchanged.

### Task 3 — retire the embedded list + migrate tests (commit 5289cee6)
- **`internal/meshtastic-radios/route.ts`** (writer #6, the plan-checker blocker) is now MeshRadio-only: removed the embedded-list read `(user.meshtasticRadios||[]).map(sanitizeRadio)`, both `updateMeshtasticRadios(...)` writes, and the `updateMeshtasticRadios, sanitizeRadio, type MeshtasticRadio` imports (kept `getRunUser` for adapterUserId existence). Create vs re-flash now branches on `getMeshRadio`; re-flash patches keys+verified (preserving createdAt/showOnMap/impersonate); create consumes quota then upserts. Also dropped the now-unused `crypto` and `checkQuota` imports.
- **`run-user.ts`** — removed the embedded `meshtasticRadios` attribute, `updateMeshtasticRadios()`, the `MeshtasticRadio` type export, `sanitizeRadio()`, `RunUserItem.meshtasticRadios`, and the stale scan-reconcile comment.
- **`run-user.test.ts`** — the sanitizer is gone; replaced its two `sanitizeRadio` cases with pure `activityDelta` cases so the suite still exercises a RunUser export.
- **`mesh-map/route.test.ts`** — fixtures rebuilt as MeshRadio rows (with `nodeNum`/`userId`) mocked through `scanAllMeshRadios`, joined to `scanAllRunUsers` identity; added a no-RunUser-row fallback case and a `not.toHaveProperty("userId")` assertion; still asserts zero key-material leak.

## Verification results

All under Node 22.12.0 from `apps/run.human/webapp`.

- **Clean build (blocker proof)** — `npm run build` → `✓ Compiled successfully in 9.1s`, `BUILD_EXIT=0`. No dead imports after the run-user symbols were removed.
- **Grep gate (zero live references)** — `grep -rnE 'meshtasticRadios|updateMeshtasticRadios|sanitizeRadio' src | grep -v '^\s*//' | grep -v -c 'mesh-radio'` → **0**. A broader scan across the whole webapp (src + scripts + tests, excluding `mesh-radio*`) → **ZERO**.
- **Migrated tests** — `vitest run src/entities/run-user.test.ts src/app/api/internal/mesh-map/route.test.ts` → `Test Files 2 passed`, `Tests 4 passed`.
- **Entity regression (touched mesh-radio.ts)** — `vitest run mesh-radio-key-parity.test.ts mesh-radio-canonical.test.ts` → `17 passed` (pk/sk parity contract intact).

## Deviations from Plan

**1. [Rule 3 - Helper factoring] Added `patchMeshRadio` for in-place field updates**
- **Found during:** Task 1 (PATCH/resend design).
- **Issue:** `upsertMeshRadio` uses `MeshRadio.put` (full-item replace), which regenerates the readOnly `createdAt` default and drops any field not passed — resetting `createdAt`/`showOnMap` on every verify/resend/re-flash.
- **Fix:** Added `patchMeshRadio(nodeId, fields)` (ElectroDB `patch().set()` then re-read) to the entity module, used by PATCH, resend, and the internal re-flash path. `upsertMeshRadio` (put) remains the create/register funnel. Same pk/sk composition, so the meshtk contract is unaffected. CONTEXT grants "exact helper factoring in run.human" to Claude's discretion.
- **Files:** `mesh-radio.ts`, all three write routes. **Commits:** 4e722f3b, 5289cee6.

**2. [Reconciliation with must_have] Kept the user's own `privateKey` in `/api/user`+GET responses**
- **Found during:** Task 2.
- **Issue:** The plan's parenthetical said strip `verificationCode/privateKey` from `/api/user`, but the whoami UI gates the impersonate and showOnMap toggles (and the private-key reveal) on `radio.privateKey` — stripping it would remove those controls, a direct regression of the must_have "impersonate/showOnMap behaves identically." The prior embedded list already carried privateKey to the user's own profile.
- **Fix:** Strip only `verificationCode` (a real secret the UI never displays; the old GET actually leaked it). Keep the user's own `privateKey` — it is byUser-scoped, never another user's. This honors the stronger no-UI-regression must_have while still tightening the verificationCode surface. The cross-user leak surface (mesh-map → gpx) emits no key material at all.
- **Files:** `api/user/route.ts`, `api/meshtastic-radios/route.ts`. **Commit:** 4e722f3b, 33c3270b.

**3. [Rule 2 - Access control] Scoped PATCH/DELETE/resend to the caller's own radio**
- **Found during:** Task 1/3.
- **Issue:** The old code found radios inside `user.meshtasticRadios`, so mutations were inherently user-scoped. `getMeshRadio(nodeId)` is global-by-nodeId.
- **Fix:** Every PATCH/DELETE/resend checks `radio.userId === session.user.id` → 404 otherwise. Closes T-66-08 (cross-user mutation) beyond the register's mitigate note.
- **Files:** `api/meshtastic-radios/route.ts`, `resend/route.ts`. **Commits:** 4e722f3b.

**4. [Housekeeping] Reworded residual doc comments**
- The retired token strings survived only in explanatory comments; the plan gate does not strip block comments. Reworded four route comments + the test header to avoid the literal `meshtasticRadios`/`sanitizeRadio` tokens so the gate proves an unambiguous zero. **Commit:** 5289cee6.

## Known Stubs

None. Every route reads/writes real MeshRadio rows; no placeholder data. The internal register route is MeshRadio-only with no transitional dual-write remaining.

## Threat Flags

None beyond the plan's registered threats. T-66-06 (half-migrated readers) is closed by the atomic migration + zero-grep gate before retire; T-66-07 (key-material leak in mesh-map/user) is upheld (mesh-map emits no key material; /api/user emits only the user's own privateKey, byUser-scoped, verificationCode stripped); T-66-08 (cross-user mutation) is now actively mitigated via the userId ownership check (Deviation 3). No new network endpoints, auth paths, or trust-boundary schema introduced.

## Note on prerequisite artifacts

`src/entities/mesh-radio.ts` was untracked on this branch at plan start (66-01's commit landed on a different branch); it entered this branch's tree via the Task 1 commit with the full 66-01 entity content plus the two new helpers. All four prerequisite artifacts (`mesh-radio.ts`, `mesh-radio-key-parity.test.ts`, `mesh-radio-canonical.ts`, `mesh-radio-canonical.test.ts`) are now tracked and their suites pass.

## Commits

- 4e722f3b — feat(66-03): migrate user CRUD + resend onto MeshRadio
- 33c3270b — feat(66-03): migrate readers (mesh-map, /api/user, whoami, client) to MeshRadio
- 5289cee6 — feat(66-03): retire embedded meshtasticRadios list from RunUser (hard-switch)

## Self-Check: PASSED

- FOUND: apps/run.human/webapp/src/app/api/meshtastic-radios/route.ts
- FOUND: apps/run.human/webapp/src/app/api/internal/meshtastic-radios/route.ts
- FOUND: apps/run.human/webapp/src/entities/run-user.ts (retired symbols removed)
- FOUND commits: 4e722f3b, 33c3270b, 5289cee6
- Grep gate: 0 live references to retired symbols in run.human src
- Build: ✓ Compiled successfully; migrated + entity tests pass
