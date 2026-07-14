---
phase: 47-admin-ctf-crud-fields-ctf-leaderboard
plan: 01
subsystem: run.human admin CTF CRUD
tags: [ctf, admin, hashing, scoring, security]
requires:
  - "src/lib/ctf-hash.ts (hashAnswer)"
  - "src/entities/qr.ts (extended Ctf: answerHash/pointMax/pointFloor/maxSolves/firstBloodBonus/timeTiers)"
  - "src/components/admin/QrForm.tsx (toLocalInput/fromLocalInput datetime pattern)"
provides:
  - "ctfAttributes hash-on-save + no-clobber write layer (exported, unit-testable)"
  - "CtfForm scoring fields + timeTiers datetime editor + no-plaintext answer entry"
affects:
  - "apps/run.human admin /admin/qr CTF create/edit"
tech-stack:
  added: []
  patterns:
    - "hash-on-save at the write boundary (plaintext answer never persisted)"
    - "omit-key = no-clobber on patch (blank answer keeps stored hash)"
    - "datetime-local UTC round-trip reused from QrForm"
key-files:
  created: []
  modified:
    - apps/run.human/webapp/src/lib/qr-admin.ts
    - apps/run.human/webapp/src/components/admin/CtfForm.tsx
    - apps/run.human/webapp/src/lib/__tests__/qr-admin.test.ts
decisions:
  - "ctfAttributes exported (was module-private) so hash-on-save + no-clobber are unit-testable without a DB"
  - "Answer never prefilled on edit; blank answer omits answerHash key so patch cannot erase a stored hash"
  - "timeTiers validated (from<to, numeric ceiling) in ctfAttributes → QrValidationError before any DB call"
metrics:
  duration: ~15m
  completed: 2026-07-14
status: complete
---

# Phase 47 Plan 01: CtfForm Scoring Fields + Hash-on-Save Summary

Extended the `/admin/qr` CTF write layer and form to hash the answer on save (plaintext never persisted), preserve an existing `answerHash` on a blank-answer edit (no-clobber), and surface the Phase-44 scoring curve fields (`pointMax`/`pointFloor`/`maxSolves`/`firstBloodBonus`) plus a validated `timeTiers[]` datetime editor.

## What Was Built

- **`qr-admin.ts`** — `CtfInput` extended with the four numeric scoring fields + `timeTiers?`; `ctfAttributes(input)` rewritten and **exported**. It (a) emits no plaintext `answer` key, (b) sets `answerHash = hashAnswer(answer)` only for a non-empty trimmed answer and otherwise omits the key entirely, (c) spreads scoring numbers when defined, and (d) validates each tier (`from`/`to` present + parseable, `from < to`, finite `ceiling`) throwing `QrValidationError` before any DynamoDB call. `upsertCtf` is unchanged — the omit-on-blank behavior alone makes `Ctf.patch().set()` no-clobber.
- **`CtfForm.tsx`** — new Scoring card + Time tiers card (add/remove rows, `datetime-local` From/To with the ported `toLocalInput`/`fromLocalInput` UTC round-trip + a DEF CON 34 preset chip, numeric ceiling). Answer field never prefills plaintext on edit and shows a "leave blank to keep" hint gated on `initial?.answerHash`. `onSave` maps rows → `timeTiers` and sends the scoring fields; the server still owns hashing.
- **`qr-admin.test.ts`** — appended a `ctfAttributes hash-on-save` describe block (11 new cases): hash equals `hashAnswer(...)` with no `answer` key, blank/whitespace/undefined omit `answerHash`, valid tier round-trips, `from>=to` and non-numeric/missing ceiling throw, scoring numbers pass through / omit.

## Hash-on-Save + No-Clobber Logic Location

`apps/run.human/webapp/src/lib/qr-admin.ts` → the exported `ctfAttributes(input)` function. The conditional spread `...(answer !== "" ? { answerHash: hashAnswer(input.answer) } : {})` is the single answer-hashing call site on the write path; omitting the key on a blank answer is the entire no-clobber mechanism (a patch `.set()` with no `answerHash` key leaves the stored hash intact).

## Verification

- `tsc --noEmit`: no new errors in `qr-admin.ts` or `CtfForm.tsx` (the 5 pre-existing unrelated errors remain).
- `npx vitest run src/lib/__tests__/qr-admin.test.ts`: **42/42 passing** (31 pre-existing + 11 new).
- `grep -n "answer:" src/lib/qr-admin.ts`: no plaintext `answer:` key emitted on the write payload.

## Threat Mitigations Applied

- **T-47-01 (Info Disclosure)** — plaintext answer removed from write payload; only `answerHash` stored. Asserted (`!("answer" in result)`).
- **T-47-02 (Tampering / clobber)** — blank answer omits `answerHash` entirely; asserted for empty/whitespace/undefined.
- **T-47-03 (Tampering / malformed tier)** — `from<to` + finite ceiling validated → `QrValidationError` (HTTP 400) before any DB call.

## Deviations from Plan

None — plan executed as written. (Strict-scope: touched only `qr-admin.ts`, `CtfForm.tsx`, and their test; did not touch the 47-02 migration script or 47-03 leaderboard files present as untracked in the worktree.)

## Self-Check: PASSED

- Files exist: qr-admin.ts, CtfForm.tsx, qr-admin.test.ts (all modified).
- Commits: 1964c7c6 (feat qr-admin), ce3877d5 (feat CtfForm), 6ac4fbdf (test).
