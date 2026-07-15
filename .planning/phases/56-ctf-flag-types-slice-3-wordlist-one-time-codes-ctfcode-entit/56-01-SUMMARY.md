---
phase: 56-ctf-flag-types-slice-3-wordlist-one-time-codes-ctfcode-entit
plan: 01
subsystem: ctf-judge-entities
tags: [ctf, wordlist, electrodb, entity, single-use-claim, schema]
requires:
  - "entities/client.ts (electroClient, ELECTRO_TABLE)"
  - "Phase 53 CtfScoreEvent entity pattern (mirrored)"
provides:
  - "CtfCode ElectroDB entity (pk=challenge, sk=codeHash) — @/entities/ctf"
  - "CtfCodeItem hand-authored item contract"
  - "Pinned (challenge, codeHash) key encoding for the 56-02 atomic claim"
affects:
  - "56-02 (judge wordlist branch — claims against this key via attribute_not_exists(claimedBy))"
  - "56-03 (admin bulk-load of hashed codes)"
tech-stack:
  added: []
  patterns:
    - "single-use claim substrate: codeHash-in-sk makes once-per-code a single conditional update"
    - "offline key-parity lock via .params({table}).Key (no network I/O)"
key-files:
  created: []
  modified:
    - "apps/run.human/webapp/src/entities/ctf.ts"
    - "apps/run.human/webapp/src/entities/__tests__/ctf-key-parity.test.ts"
decisions:
  - "CtfCode persists ONLY the salted codeHash + claim audit — no plaintext code attribute exists on the entity (T-56-01-01 mitigated at the schema level)"
  - "primary index only — no gsi1 byUser; the claim is by the exact (challenge, codeHash) key, so there is no per-user query path"
  - "No updatedAt — a claim is a one-time set (claimedBy/claimedAt absent until won), not a repeated mutation; the row stays minimal"
metrics:
  duration: ~2m
  completed: 2026-07-15
  tasks: 2
  files: 2
status: complete
---

# Phase 56 Plan 01: CtfCode Single-Use Wordlist Entity Summary

Added the `CtfCode` ElectroDB entity (`pk=challenge`, `sk=codeHash`; attrs `codeHash`, `claimedBy?`, `claimedAt?`, `createdAt`) as the storage substrate for Slice-3 wordlist one-time codes (CTFT-12), persisting only the salted hash — never plaintext — and pinned its `(challenge, codeHash)` key encoding with an offline parity test so the 56-02 judge's `attribute_not_exists(claimedBy)` claim target can never silently drift.

## What Was Built

**Task 1 — `CtfCode` entity + `CtfCodeItem` type** (`entities/ctf.ts`, commit `d32571fe`)
- New exported `CtfCode` entity mirroring the `CtfScoreEvent` block verbatim in style: `model.entity "CtfCode"`, `version "1"`, `service "run"`, `{ client: electroClient, table: ELECTRO_TABLE }`.
- Attributes: `challenge` (string, required), `codeHash` (string, required — salted SHA-256 hex from the same `hashAnswer` seam answers use; NO plaintext `code` attribute exists), `claimedBy` (string, absent until claimed), `claimedAt` (string UTC-ISO, absent until claimed), `createdAt` (default-timestamp readOnly). Deliberately NO `updatedAt` — a claim is a one-time set, not a repeated mutation.
- Index `primary` only: `pk` composite `["challenge"]`, `sk` composite `["codeHash"]`. No `byUser` GSI — the claim is by the exact key.
- Anchor comment explains WHY the sk is `codeHash`: the once-per-code single-use claim is a single conditional update on `attribute_not_exists(claimedBy)` — two concurrent claimers collide on that condition and exactly one wins (no read-then-write race), mirroring CtfSolve's idempotent claim but keyed by the code.
- Header comment extended to note `CtfCode` (Slice 3) likewise has NO resolver `.mjs` mirror — run.human-internal.
- `CtfCodeItem` type added alongside `CtfScoreEventItem`: `{ challenge; codeHash; claimedBy?; claimedAt?; createdAt? }`.

**Task 2 — Key-parity lock** (`entities/__tests__/ctf-key-parity.test.ts`, commit `197769ff`)
- Imported `CtfCode`; added a `describe("CtfCode key parity")` block asserting `CtfCode.get({ challenge: "sao", codeHash: "deadbeef" }).params({ table }).Key` equals `{ pk: "$run#challenge_sao", sk: "$ctfcode_1#codehash_deadbeef" }`.
- Pinned sk verified against the encoder's REAL output (ElectroDB lowercases the composite label to `codehash` and the value) — the test locks the actual contract, not a guess.
- One-line comment marks this sk as the `attribute_not_exists(claimedBy)` claim target for the 56-02 judge.

## Verification

- `npx vitest run src/entities/__tests__/ctf-key-parity.test.ts` — 7/7 green (incl. the new CtfCode block).
- Full webapp suite — **611/611 green** (58 files), Node 23.6.0.
- `npx tsc --noEmit` — 0 NEW errors attributable to `entities/ctf.ts`; the 2 known pre-existing out-of-scope errors (`dropdown-user.tsx`, `checkin.test.ts`) untouched.
- Plaintext guard — grep confirms no bare `code:` string attribute on the entity; only `codeHash` persists.

## Threat Mitigations Applied

| Threat ID | Mitigation |
|-----------|-----------|
| T-56-01-01 (info disclosure) | Only the salted `codeHash` persists — no `code`/plaintext attribute on the entity, so a table read never hands over redeemable codes. |
| T-56-01-02 (key drift tampering) | Key-parity test pins the exact sk so the 56-02 claim target can never silently move. |
| T-56-SC (supply chain) | No new packages (reuses existing `electrodb` dep). |

## Deviations from Plan

None — plan executed exactly as written. The plan's guessed sk prefix (`$ctfcode_1#codehash_deadbeef`) matched the encoder's real emitted output, so no pinning adjustment was needed.

## Known Stubs

None. Schema-only plan: the atomic claim (conditional patch) and any DB-mutating helpers intentionally land in 56-02 behind the judge's store seam, as scoped by the plan.

## Self-Check: PASSED

- FOUND: apps/run.human/webapp/src/entities/ctf.ts (CtfCode + CtfCodeItem exported)
- FOUND: apps/run.human/webapp/src/entities/__tests__/ctf-key-parity.test.ts (CtfCode key parity block)
- FOUND commit: d32571fe (feat — entity)
- FOUND commit: 197769ff (test — key parity)
