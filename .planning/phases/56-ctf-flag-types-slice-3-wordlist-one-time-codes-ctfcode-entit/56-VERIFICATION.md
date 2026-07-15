---
phase: 56-ctf-flag-types-slice-3-wordlist-one-time-codes-ctfcode-entit
verified: 2026-07-15T08:39:29Z
status: human_needed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "In a browser, open /admin/qr/ctf/<challenge> as an admin, select the Answer-type 'Wordlist' segment, paste several codes one-per-line, save; then re-open the same flag in edit mode."
    expected: "The Answer-type control shows three segments (Static · Rotating OTP · Wordlist). Selecting Wordlist reveals a 'One-time codes' textarea (empty, never prefilled with existing codes) plus its helper text. After save + reload, a read-only 'N codes loaded · M unclaimed' line renders and the textarea is still empty. Submitting one of the loaded codes as a player scores exactly once; re-submitting the same code does not score again."
    why_human: "The repo has no jsdom/testing-library, so CtfForm.tsx DOM render, the segment toggle, the textarea reveal, and the count-line display are not unit-testable — verified only by tsc + the pure helpers they bind to. The end-to-end admin bulk-load → player-claim round trip needs a running app + DynamoDB. All security-critical logic (hashing, plaintext-never-stored, add-only write, atomic claim) IS proven by tests below; only the visual render + live round trip need eyes."
---

# Phase 56: CTF Flag Types — Slice 3 Wordlist One-Time Codes Verification Report

**Phase Goal:** Add a third answer type — `wordlist` — a pool of single-use codes consumed first-come, atomically. New `CtfCode` ElectroDB entity; atomic conditional-claim (`attribute_not_exists(claimedBy)`) → exactly one winner; plaintext never stored; used/unknown code is a non-solve indistinguishable from a wrong answer; admin Wordlist bulk-load option; covert-CSS invariant preserved.
**Verified:** 2026-07-15T08:39:29Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (from ROADMAP SC1–SC4 + CTFT-12/13/14) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | SC1 — A wordlist flag admits each code exactly once: two concurrent submissions of the same unclaimed code → exactly one solve + one non-solve (atomic `attribute_not_exists(claimedBy)`), proven by a race test | ✓ VERIFIED | `defaultStore.claimCode` (ctf-judge.ts:749-770) is a real conditional: `CtfCode.patch(...).set({claimedBy,claimedAt}).where((attr,op)=>op.notExists(attr.claimedBy)).go()` — no read-then-write. Race test `ctf-judge-wordlist.test.ts:112-128` runs two `Promise.all` `judgeSolve` calls on the SAME code; fake models the conditional with NO await between presence-check and set (lines 97-106); asserts `winners.length===1`, `losers.length===1`, `accrueCalls===1`, `ledger.length===1`. Suite green. |
| 2 | SC2 — A previously-claimed/unknown code is a non-solve indistinguishable from a wrong answer; a valid unclaimed code scores through the existing accrue path and marks `claimedBy`/`claimedAt`; guess never logged | ✓ VERIFIED | Judge wordlist arm (ctf-judge.ts:362-375) — validation IS the claim; a false claim falls through the shared `if(!ok)` → `NON_SOLVE` + identical `ctfJudgeLog('no-solve')`. Test (lines 194-210) asserts `r` equals exact `{solved:false,points:0,ordinal:null,firstBlood:false,capped:false}`, same log payload, and neither `guess` nor `hashAnswer(guess)` appears in any log arg. Valid code scores via wordlist finalize (:402-417) → `recordScoreEvent` upsert + `accrue`, ledger keyed by `codeHash` (test :180-192). claim marks `claimedBy`/`claimedAt` via the conditional set. |
| 3 | SC3 — Plaintext codes never stored, never round-tripped to client; only salted `codeHash` persists; admin bulk-loads codes + sees loaded/remaining count | ✓ VERIFIED (logic) | `CtfCode` entity (ctf.ts:158-191) has ONLY `codeHash`/`claimedBy`/`claimedAt`/`createdAt` — no plaintext `code` attribute. `hashCodeBatch` (qr-admin.ts:431-449) hashes via `hashAnswer`, emits only hashes. `loadCtfCodes` (:460-475) add-only `CtfCode.create` skip-dup, never logs plaintext. `getCtfCodeCounts` (:483-493) returns aggregate `{loaded,unclaimed}`. `redactCtfSecrets` (ctf-form-model.ts:384-410) is whitelist-style — carries only `codeCounts`, no `codes` field. `CtfForm` `codesText` is `useState("")`, never prefilled from `initial` (CtfForm.tsx:141); count line reads `initial?.codeCounts` (:634). Visual render → human item. |
| 4 | SC4 — Covert CSS path stays byte-identical; static/otp flags unaffected; guess never logged | ✓ VERIFIED | `git diff --name-only 495be4a3..HEAD` touches NO covert source file (covert-egg.ts, EggTrigger.tsx, CtfCelebration.tsx, ctf-covert-css.ts, assets/theme/route.ts). Direct grep: none reference `wordlist`/`CtfCode`/`claimCode`/`codeHash`. Covert-invariant grep-gate test `ctf-wordlist-covert-invariant.test.ts` green. Full `ctf-judge`/`ctf-flag-types` suites green (static/otp unchanged — wordlist finalize returns BEFORE the isRepeatable block, :402-418). guess-never-logged asserted (truth 2). |

**Score:** 4/4 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/entities/ctf.ts` — `CtfCode` entity + `CtfCodeItem` | pk=challenge, sk=codeHash, no plaintext | ✓ VERIFIED | Entity :158-191; type :283-289. Only codeHash/claimedBy/claimedAt/createdAt. primary index only. |
| `src/entities/__tests__/ctf-key-parity.test.ts` | pinned sk encoding | ✓ VERIFIED | CtfCode key-parity block; full parity suite green (offline `.params({table}).Key`). |
| `src/lib/ctf-judge.ts` — claimCode op + wordlist branch + recordScoreEvent upsert | atomic claim + finalize | ✓ VERIFIED | `claimCode` :749-770 (real conditional); wordlist branch :362-375; finalize :402-418; `recordScoreEvent` upsert :743-745; `narrowCtf` wordlist arm :569-573. |
| `src/lib/ctf-flag-types.ts` — isRepeatable(wordlist) | recognizes wordlist | ✓ VERIFIED | :36-40 returns true for `answerType==="wordlist"`. |
| `src/lib/__tests__/ctf-judge-wordlist.test.ts` | race + indistinguishability + scoring | ✓ VERIFIED | 8 tests: race, second-distinct-code, unknown, already-claimed, valid-scores, indistinguishable+no-leak, covert guessHash, globalMax cap. Green. |
| `src/lib/__tests__/ctf-wordlist-covert-invariant.test.ts` | covert grep gate | ✓ VERIFIED | Reads 5 covert files, asserts no Slice-3 token. Green. |
| `src/lib/qr-admin.ts` — hashCodeBatch, loadCtfCodes, getCtfCodeCounts, CtfInput.codes | bulk-load add-only | ✓ VERIFIED | :431-493 + upsertCtf hook :534-535. |
| `src/components/admin/ctf-form-model.ts` — wordlist + codeCounts | widened + redaction | ✓ VERIFIED | inferAnswerType :213; codeCounts on both records; redactCtfSecrets whitelist :408. |
| `src/components/admin/CtfForm.tsx` — Wordlist segment + textarea + count | UI seam | ⚠️ render human-only | Compiles (tsc clean); codesText/onSave/count-line logic present; browser render not jsdom-testable → human item. |
| `src/entities/qr.ts` — Ctf.answerType enum widened | includes wordlist | ✓ VERIFIED | :140 `["static","otp","wordlist"]`. Resolver .mjs mirror omits answerType — no byte-parity impact. |
| edit `page.tsx` — attaches getCtfCodeCounts | count rehydrate | ✓ VERIFIED | :35-37 fetch, :57 passed into redactCtfSecrets. |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| admin bulk-load (qr-admin) | judge claim (ctf-judge) | shared `hashAnswer` seam | ✓ WIRED | Both `hashCodeBatch` (:443) and the judge codeHash (`guessHash ?? hashAnswer(guess)`, ctf-judge.ts:352) use `hashAnswer` — a loaded code and a submitted guess hash identically. |
| judge wordlist finalize | CtfScoreEvent ledger | `recordScoreEvent` upsert | ✓ WIRED | Plan-checker correction landed: `.upsert(...).set(...)` (:743-745) creates the row when absent (wordlist bypasses claimScoreEvent); idempotent for repeatable path (claimScoreEvent R1 still gates :434-440). |
| judge claim | CtfCode row | `attribute_not_exists(claimedBy)` conditional patch | ✓ WIRED | claimCode :755-758. |
| edit page | count line | `getCtfCodeCounts` → codeCounts → redactCtfSecrets | ✓ WIRED | Aggregate only; no plaintext crosses back. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Full webapp suite | `npx vitest run` (Node 23.6.0) | 635 passed (60 files) | ✓ PASS |
| No new tsc errors | `npx tsc --noEmit` (excl. 2 known pre-existing) | 0 new errors | ✓ PASS |
| Covert files clean of Slice-3 tokens | grep across 5 covert files | none matched | ✓ PASS |
| SC4 covert diff | `git diff --name-only 495be4a3..HEAD` | no covert source files touched | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| CTFT-12 | 56-01 | `CtfCode` entity (pk=challenge, sk=codeHash; codeHash/claimedBy/claimedAt; plaintext never persisted) | ✓ SATISFIED | Entity ctf.ts:158-191; key-parity test green. |
| CTFT-13 | 56-02 | judge `wordlist` branch: hash guess + atomic conditional-claim; used/unknown = indistinguishable non-solve; scores via ledger; never log guess | ✓ SATISFIED | Branch + finalize + claimCode + race/indistinguishability tests green. |
| CTFT-14 | 56-03 | admin Wordlist option: bulk-load hashed codes (write-only, add-only), loaded/remaining count | ✓ SATISFIED (logic) — visual render is human item | qr-admin + form-model + CtfForm seam; count via getCtfCodeCounts. |

### Anti-Patterns Found

None. No TBD/FIXME/XXX markers introduced. No stubs — every artifact is wired end to end (admin bulk-load → CtfCode pool → judge claim). Known-stubs sections in all three SUMMARYs report "None" and this is confirmed by the code.

### Human Verification Required

**1. Admin Wordlist UI render + end-to-end bulk-load → player-claim round trip**

**Test:** In a browser, open `/admin/qr/ctf/<challenge>` as an admin, select the Answer-type "Wordlist" segment, paste several codes one-per-line, save; re-open the flag in edit mode; then submit one loaded code as a player twice.
**Expected:** Three answer-type segments (Static · Rotating OTP · Wordlist); selecting Wordlist reveals an empty "One-time codes" textarea (never prefilled) + helper text; after save+reload a read-only "N codes loaded · M unclaimed" line renders with the textarea still empty; a player submitting a loaded code scores exactly once, and a re-submit of the same code does not score again.
**Why human:** No jsdom/testing-library in the repo — CtfForm.tsx DOM render is verified only by tsc + the pure helpers it binds to. The live admin→pool→claim round trip needs a running app + DynamoDB. All security-critical logic (hashing, plaintext-never-stored/round-tripped, add-only write, atomic single-use claim, indistinguishable non-solve) IS proven by the tests above; only the visual render + live flow need eyes.

### Gaps Summary

No gaps. All four success criteria and all three requirements (CTFT-12/13/14) are verified against the codebase. The atomic single-use claim is a genuine DynamoDB conditional (`op.notExists(attr.claimedBy)`), not a mock; the two-claimers-one-wins race is exercised by a test that faithfully models the conditional (no await between check and set); the indistinguishable non-solve is asserted byte-for-byte with a no-leak log assertion; plaintext is absent from the entity, the redacted record, and the never-prefilled textarea; the plan-checker correction (recordScoreEvent patch→upsert) landed and is idempotent for the repeatable path (the once-per-window `claimScoreEvent` guard still gates it); and the covert CSS path is byte-identical (no covert source file touched, grep-gated). Full suite 635/635 green, tsc clean. The single outstanding item is the browser-only render of the admin Wordlist form + the live end-to-end round trip, which cannot be exercised without jsdom or a running stack — routed to human verification per the autonomous-mode instruction.

---

_Verified: 2026-07-15T08:39:29Z_
_Verifier: Claude (gsd-verifier)_
