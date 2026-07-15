---
phase: 56-ctf-flag-types-slice-3-wordlist-one-time-codes-ctfcode-entit
plan: 03
subsystem: ctf-admin-form
tags: [ctf, wordlist, one-time-codes, admin-form, write-only-secret, add-only, electrodb]
requires:
  - "CtfCode ElectroDB entity (pk=challenge, sk=codeHash) — @/entities/ctf (56-01)"
  - "hashAnswer salt seam — lib/ctf-hash (the SAME seam the judge claim uses, 56-02)"
  - "assertAnswerTypeTransition / mergeFlagTypeNextState / isRepeatable — lib/ctf-flag-types"
  - "redactCtfSecrets write-only-secret boundary + CtfForm section seams — 54-01/54-04"
provides:
  - "qr-admin: CtfInput.codes (write-only), pure hashCodeBatch, add-only loadCtfCodes, getCtfCodeCounts"
  - "ctf-form-model: answerType widened to wordlist, inferAnswerType wordlist, codeCounts on Loaded/RedactedCtfRecord"
  - "CtfForm: Static · Rotating OTP · Wordlist segment + Section 3c bulk textarea + count line"
  - "edit page attaches getCtfCodeCounts to the redacted record"
  - "Ctf entity answerType enum widened to [static, otp, wordlist]"
affects:
  - "closes the Slice-3 loop end to end: admin bulk-load → CtfCode pool → judge claim (56-02)"
  - "v2.3 milestone — this is the LAST plan of Phase 56 and the last slice of v2.3"
tech-stack:
  added: []
  patterns:
    - "write-only add-only bulk load: plaintext lines flow ONE WAY (client→server), hashed via hashAnswer, appended to the CtfCode pool; the textarea never prefills on edit (only hashes exist)"
    - "pure hashCodeBatch (no DB) is the unit-test surface; the CtfCode.create write + count read are I/O (mirrors ctfAttributes vs upsertCtf)"
    - "only the aggregate codeCounts round-trips back — redactCtfSecrets carries it like scoreWindow; no plaintext code field exists on the redacted record"
key-files:
  created: []
  modified:
    - "apps/run.human/webapp/src/lib/qr-admin.ts"
    - "apps/run.human/webapp/src/lib/__tests__/qr-admin.test.ts"
    - "apps/run.human/webapp/src/components/admin/ctf-form-model.ts"
    - "apps/run.human/webapp/src/components/admin/__tests__/ctf-form-model.test.ts"
    - "apps/run.human/webapp/src/components/admin/CtfForm.tsx"
    - "apps/run.human/webapp/src/app/(protected)/admin/qr/ctf/[challenge]/page.tsx"
    - "apps/run.human/webapp/src/entities/qr.ts"
decisions:
  - "hashCodeBatch de-dups WITHIN the batch by codeHash (a repeated line ⇒ duplicates, not added); the add-only CtfCode.create skip-dup handles cross-pool dups"
  - "The wordlist bulk load is a SEPARATE CtfCode write in upsertCtf (after the Ctf row create/patch), NOT part of the ctfAttributes .set() payload — codes never land on the Ctf row"
  - "The Ctf entity answerType enum was widened to include wordlist (Slice 1a deliberately deferred it); the resolver .mjs mirror omits answerType entirely, so no parity impact"
  - "The Phase-53 no-flip-after-solve guard is honored for free — ctf-flag-types already treats wordlist as repeatable (isRepeatable), so static↔wordlist flips on a solved flag are rejected by assertAnswerTypeTransition"
  - "The Static answer field is omitted from the posted payload in the wordlist branch (a wordlist flag's answers live in the CtfCode pool, not a single answerHash)"
metrics:
  duration: ~8m
  completed: 2026-07-15
  tasks: 3
  files: 7
status: complete
---

# Phase 56 Plan 03: Admin Wordlist Option (Bulk-Load One-Time Codes) Summary

Added the admin **Wordlist** answer type (CTFT-14): a third segment (Static · Rotating OTP · Wordlist) in the Answer-type section that reveals a write-only, add-only "One-time codes" bulk textarea. On save the non-blank lines are hashed server-side through the SAME `hashAnswer` salt seam the judge (56-02) claims against — so a loaded code and a submitted guess hash identically — and appended add-only to the 56-01 `CtfCode` pool. Editing a wordlist flag shows a read-only "N codes loaded · M unclaimed" count. Plaintext codes are NEVER stored and NEVER round-tripped to the client — only the aggregate counts cross back. This closes the Slice-3 loop end to end (admin → CtfCode → judge claim) and completes Phase 56 and the v2.3 milestone.

## What Was Built

**Task 1 — qr-admin: codes input, pure hashCodeBatch, add-only bulk write, count read** (`qr-admin.ts`, `qr-admin.test.ts`, `entities/qr.ts`, commit `bf90e823`)
- `CtfInput.answerType` widened to `"static" | "otp" | "wordlist"`; new write-only `codes?: string[]` (documented: hashed before storage, never persisted as plaintext, add-only, not part of the ctfAttributes payload).
- Pure exported `hashCodeBatch(lines)`: trims each line, drops blanks, hashes each survivor with `hashAnswer`, de-dups WITHIN the batch by codeHash. Returns `{ codeHashes, added: codeHashes.length, duplicates: survivingLines - added }`. Never emits plaintext (only 64-hex salted hashes). Kept DB-free so it is unit-testable like `ctfAttributes`.
- `loadCtfCodes(challenge, lines)`: `CtfCode.create({ challenge, codeHash }).go()` per distinct hash inside a try/catch that swallows a duplicate/existence collision (add-only no-op — never overwrites `claimedBy`). Never logs the plaintext lines.
- `getCtfCodeCounts(challenge)`: `CtfCode.query.primary({ challenge }).go({ pages: "all" })` → `{ loaded: rows.length, unclaimed: rows.filter(r => !r.claimedBy).length }`. Aggregate only — no plaintext leaves the server.
- `upsertCtf`: after the Ctf row create/patch, `if (input.codes?.length) await loadCtfCodes(...)` — runs for both create and edit; an empty paste is a no-op.
- `Ctf` entity `answerType` enum widened `["static","otp"]` → `["static","otp","wordlist"]` (Slice 1a deferred it; the resolver `.mjs` mirror omits answerType, so no byte-parity impact — confirmed the resolver `Ctf` mirror only carries key/hot-path attrs).
- Tests: a `hashCodeBatch` describe block — trim/blank-drop/in-batch de-dup, `hashAnswer` parity (a loaded code hashes to the exact value the judge claims on), empty/blank-only input, and a plaintext-never-emitted assertion.

**Task 2 — ctf-form-model: wordlist widening + codeCounts on the record contract** (`ctf-form-model.ts`, `ctf-form-model.test.ts`, commit `82787016`)
- `inferAnswerType` return type widened; returns `"wordlist"` for a wordlist record, `"otp"` for otp, and `"static"` for absent/unknown (matches the backend default).
- `answerType` union widened to include `"wordlist"` on both `LoadedCtfRecord` and `RedactedCtfRecord`.
- Added optional `codeCounts?: { loaded: number; unclaimed: number }` (non-secret aggregate) to BOTH record contracts; `redactCtfSecrets` copies `record.codeCounts` through verbatim (alongside `scoreWindow`). No plaintext code field is introduced.
- Tests: `inferAnswerType` returns `"wordlist"` (and still falls back to `"static"` for an unknown value); `redactCtfSecrets` preserves a provided `codeCounts` while still stripping `otp.secret` + `effect`, and never adds a `codes` field.

**Task 3 — CtfForm Wordlist segment + bulk textarea + count line; edit page attaches counts** (`CtfForm.tsx`, edit `page.tsx`, commit `39588467`)
- Form `AnswerType` widened; a third `["wordlist", "Wordlist"]` segment added to the answer-type radiogroup (reusing the existing `cls.segment` tokens + `role="radio"` markup).
- Section 3c (rendered when `answerType === "wordlist"`, a sibling branch of the static/otp conditional): the sub-hint "A pool of single-use codes, consumed first-come."; a native `<textarea className={cls.textarea}>` bound to a new `codesText` state labeled "One-time codes" with the UI-SPEC helper ("One code per line. … Codes are hashed on save — they are never stored or shown in plaintext."). Write-only + add-only — never prefills existing codes on edit. Below it the read-only "{N} codes loaded · {M} unclaimed." line from `initial.codeCounts` when present, else the create-time empty-state hint ("Paste codes above — they'll be hashed and added when you save.").
- `onSave`: when `answerType === "wordlist"`, split `codesText` on newlines into trimmed non-empty `codes` and include them only when non-empty (server hashes + de-dups; the client never hashes). The Static `answer` field is omitted from the wordlist payload.
- Edit page: for a wordlist flag, `const codeCounts = record.answerType === "wordlist" ? await getCtfCodeCounts(record.challenge) : undefined;` then `redactCtfSecrets({ ...(record as LoadedCtfRecord), codeCounts })` so the count line rehydrates. Plaintext codes never cross to the client — only the aggregate counts.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Widened the `Ctf` entity `answerType` enum to include `wordlist`**
- **Found during:** Task 1 (tsc gate)
- **Issue:** The `Ctf` ElectroDB entity declared `answerType: { type: ["static", "otp"] as const }` (Slice 1a deliberately deferred wordlist). Widening `CtfInput.answerType` produced two NEW tsc errors on `upsertCtf`'s `.set(attrs)` / `Ctf.create` because the entity's stored attribute type rejected `"wordlist"`.
- **Fix:** Widened the entity enum to `["static", "otp", "wordlist"]`. Verified the run.qr resolver `.mjs` `Ctf` mirror omits `answerType` entirely (only key/hot-path attrs), so there is NO byte-parity impact — the flag-type attributes are run.human-internal, exactly as Slice 1a added `answerType` without a resolver change. Re-ran `ctf-key-parity`/`qr-key-parity` (13 tests) green.
- **Files modified:** `apps/run.human/webapp/src/entities/qr.ts`
- **Commit:** `bf90e823`

No other deviations — the Phase-53 no-flip-after-solve guard required no code change (ctf-flag-types already treats `wordlist` as repeatable, so `assertAnswerTypeTransition` rejects a static↔wordlist flip on a solved flag for free).

## Verification Evidence

- `npx vitest run src/lib/__tests__/qr-admin.test.ts` — 57 passed (52 prior + 5 new hashCodeBatch).
- `npx vitest run src/components/admin/__tests__/ctf-form-model.test.ts` — 40 passed (36 prior + 4 new).
- Full webapp suite: **635 passed (60 files)**, Node 23.6.0.
- `npx tsc --noEmit` — 0 errors on the plan's touched files (`qr-admin.ts`, `entities/qr.ts`, `ctf-form-model.ts`, `CtfForm.tsx`, edit page); the only remaining errors are the 2 KNOWN pre-existing out-of-scope files (`dropdown-user.tsx`, `checkin.test.ts`).
- Grep gate (SC3): the redacted record + client form carry NO plaintext code field — `RedactedCtfRecord` exposes only `codeCounts`; `redactCtfSecrets` never copies a bare `codes` field; `CtfForm` reads only `initial.codeCounts`, never `initial.codes`.

## Threat-Model Mitigations Applied

- **T-56-03-01 (info disclosure — plaintext round-trip):** codes flow ONE WAY (client→server); the textarea never prefills on edit; only `codeCounts` (aggregate) returns via `redactCtfSecrets` — no plaintext code field exists on the redacted record.
- **T-56-03-02 (tampering — bulk load overwrites/claims existing codes):** add-only `CtfCode.create` with skip-dup on collision; never a `.set()`/overwrite of `claimedBy`; in-batch de-dup via `hashCodeBatch`.
- **T-56-03-03 (spoofing/EoP — client-side hashing bypass):** hashing is server-only (`hashAnswer` in `qr-admin`); the client posts plaintext lines and never a hash — the server owns the salt scheme.
- **T-56-SC (supply chain):** no new packages (native `<textarea>` + existing deps) — legitimacy gate N/A.

## Known Stubs

None. The Wordlist option is wired end to end — the admin bulk-loads codes (hashed on save, add-only), the count line reads the live pool status, and the judge (56-02) claims from the same pool.

## Self-Check: PASSED
- Files modified exist: `qr-admin.ts`, `qr-admin.test.ts`, `ctf-form-model.ts`, `ctf-form-model.test.ts`, `CtfForm.tsx`, edit `page.tsx`, `entities/qr.ts` — all present.
- Commits exist on `gsd/ctf-admin-form-clarity`: `bf90e823`, `82787016`, `39588467`.
