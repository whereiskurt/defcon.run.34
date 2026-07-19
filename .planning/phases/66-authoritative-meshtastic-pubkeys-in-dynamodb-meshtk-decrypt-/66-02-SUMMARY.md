---
phase: 66-authoritative-meshtastic-pubkeys-in-dynamodb-meshtk-decrypt
plan: 02
subsystem: run.human (internal register write path)
tags: [meshtastic, mesh-radio, base64-hex, nodeid-canonicalization, mrad-02]
requires:
  - MeshRadio ElectroDB entity + upsertMeshRadio helper (plan 66-01)
provides:
  - Pure mesh-radio-canonical lib (canonicalNodeId, nodeNumFromNodeId, normalizeNodeId, publicKeyBase64ToHex)
  - Authoritative MeshRadio upsert wired into the internal register-radio route (base64→0x hex boundary)
affects:
  - Plan 66-03 (readers flip; retires the embedded list this plan still dual-writes)
  - Plan 66-04 (backfill reuses the pure canonical lib)
  - Plan 66-07 (meshtk Go decrypt reads the 0x-hex MeshRadio.publicKey)
tech-stack:
  added: []
  patterns:
    - Pure, adapter-free lib module importable from a bare tsx script (L9)
    - Single base64→hex conversion boundary at the server-to-server write path (L3)
key-files:
  created:
    - apps/run.human/webapp/src/lib/mesh-radio-canonical.ts
    - apps/run.human/webapp/src/lib/__tests__/mesh-radio-canonical.test.ts
  modified:
    - apps/run.human/webapp/src/app/api/internal/meshtastic-radios/route.ts
decisions:
  - Validate/reject a present-but-not-32-byte pubkey with HTTP 400 before ANY mutation (both writes); an absent pubkey skips the hex field so the route stays resilient
  - upsertMeshRadio placed in BOTH the re-flash (update) and new-radio (create) branches, mirroring impersonate (existing-or-true) and verified:true, source:"flash"
  - Kept the existing updateMeshtasticRadios embedded-list write (transitional dual-write; embedded list retires in plan 66-03 — not permanent)
metrics:
  duration: ~7 min
  completed: 2026-07-19
status: complete
---

# Phase 66 Plan 02: Register-Radio MeshRadio Write + Canonicalization Lib Summary

Wired the single authoritative write path: the internal `register-radio` endpoint run.flash calls now upserts the first-class `MeshRadio` entity, converting the device's base64 X25519 pubkey to `0x` hex once at this boundary (L3, guarded 32-byte decode) and canonicalizing `nodeId` to pad-8 lowercase with an explicit uint32 `nodeNum` (L2). The two pure transforms are factored into a standalone, adapter-free lib (`mesh-radio-canonical.ts`) so the backfill (plan 66-04) and any future writer reuse identical logic.

## What was built

- **`mesh-radio-canonical.ts`** — PURE module (Node `Buffer` only, no ElectroDB/`@auth/dynamodb-adapter` import, so it is importable from a bare `tsx` backfill per L9):
  - `canonicalNodeId(nodeNum)` → `"!" + (nodeNum >>> 0).toString(16).padStart(8,"0")` lowercase (L2 pad-8).
  - `nodeNumFromNodeId(nodeId)` → strips a leading `"!"`, parses hex as unsigned 32-bit (mirrors `mesh-map/route.ts` `hexToNodeNum`).
  - `normalizeNodeId(nodeId)` → routes a bare-hex OR `"!hex"` id through nodeNum so padding/casing are applied consistently.
  - `publicKeyBase64ToHex(base64)` → base64-decodes, asserts exactly 32 bytes (throws a descriptive `Error` otherwise — V5 validation), returns `"0x"` + 64 lowercase hex chars.
- **`mesh-radio-canonical.test.ts`** — 13 cases: full-width + leading-zero (`!00abcdef`, the L2 case) canonicalization, `0xffffffff` unsigned coercion, nodeNum round-trip, `normalizeNodeId` bare/`!hex`/uppercase → canonical, `publicKeyBase64ToHex` 32-byte round-trip + 31-byte and 33-byte guard throws.
- **`internal/meshtastic-radios/route.ts` POST** — after resolving `adapterUserId` + RunUser:
  - Computes `canonicalNodeId` + `canonicalNodeNum` from the incoming `nodeId`.
  - Marks the base64→`0x` hex conversion as the MRAD-02/L3 boundary; a present pubkey that fails the 32-byte decode returns **400** (before any write); an absent pubkey skips the hex field.
  - Calls `upsertMeshRadio({ nodeId: canonical, nodeNum, userId: adapterUserId, publicKey: hex, privateKey, verified: true, source: "flash", impersonate })` in BOTH the re-flash (update) and new-radio (create) branches.
  - **Retains** the existing `updateMeshtasticRadios` embedded-list write (transitional dual-write; plan 66-03 retires the list). No key material logged.

## Verification results

All commands run under Node 22.12.0 from `apps/run.human/webapp` (node_modules from plan 66-01).

- **Task 1 typecheck** — `npx tsc --noEmit -p tsconfig.json | grep -i mesh-radio-canonical` → `no canonical type errors`.
- **Task 2 unit test** — `npx vitest run src/lib/__tests__/mesh-radio-canonical.test.ts` → `Test Files 1 passed`, `Tests 13 passed`.
- **Task 3 build** — `npm run build` → `✓ Compiled successfully in 8.3s`, `BUILD_EXIT=0`; `/api/internal/meshtastic-radios` route present in the manifest.

## Deviations from Plan

None — the plan executed exactly as written. The only implementation choices left to discretion (all within plan bounds): the 400 validation + canonicalization prep are hoisted above the update/create branch split so a malformed key is rejected before any mutation, and the pubkey hex field is spread conditionally (`...(publicKeyHex ? { publicKey } : {})`) so an absent key is simply omitted rather than written empty.

## Known Stubs

None. Both write branches call the real `upsertMeshRadio`; no placeholder data or unwired surface. The embedded-list write remaining alongside the MeshRadio write is intentional transitional dual-write (documented in-code and in CONTEXT), retired by plan 66-03 — not a stub.

## Threat Flags

None beyond the plan's registered threats. T-66-03 (pubkey encoding tampering) is mitigated by the single guarded 32-byte base64→hex boundary + 400 rejection; T-66-04 (who may write) is unchanged (existing `x-internal-secret` gate); T-66-05 (key material in logs) is upheld — no `console.log` emits `privateKey`/`publicKey`, enforced by in-code comments.

## Commits

- 17ba23d9 — feat(66-02): add pure MeshRadio canonicalization + base64→hex lib
- 87b1bfbe — test(66-02): unit-test MeshRadio canonicalization + base64→hex lib
- 6419fcaa — feat(66-02): upsert authoritative MeshRadio in internal register route

## Self-Check: PASSED

- FOUND: apps/run.human/webapp/src/lib/mesh-radio-canonical.ts
- FOUND: apps/run.human/webapp/src/lib/__tests__/mesh-radio-canonical.test.ts
- FOUND (modified): apps/run.human/webapp/src/app/api/internal/meshtastic-radios/route.ts
- FOUND commits: 17ba23d9, 87b1bfbe, 6419fcaa
