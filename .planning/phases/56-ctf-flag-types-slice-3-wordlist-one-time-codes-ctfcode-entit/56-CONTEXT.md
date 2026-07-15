# Phase 56: CTF Flag Types — Slice 3 Wordlist One-Time Codes (CtfCode Entity + Atomic Single-Use Claim) - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Add a third answer type — `wordlist` — a pool of single-use codes consumed first-come, atomically. New `CtfCode` ElectroDB entity (`pk = challenge`, `sk = codeHash`; attrs `codeHash` [salted with the existing answer scheme], `claimedBy`, `claimedAt`); a claim is a conditional update `attribute_not_exists(claimedBy)` → exactly one winner under concurrency, no read-then-write race. Plaintext codes are **never stored** — the admin bulk-loads pre-hashed codes. The judge's answer-validation step gains a `wordlist` branch: hash the guess and conditional-claim a matching unclaimed `CtfCode`; a used or unknown code is a **non-solve indistinguishable from a wrong answer**. The admin form's Answer-type section gains the **Wordlist** option with bulk code entry. Shippable run.human PR with its own tests including the two-claimers-one-wins race; covert-CSS invariant preserved.

**Authoritative design spec:** `docs/superpowers/specs/2026-07-14-ctf-flag-types-and-form-redesign-design.md` — § "Wordlist — new `CtfCode` entity (Slice 3)" (line ~80), § "Judge design" answer-validation step 5 `wordlist` branch (line ~95), and the form § "Answer type section (+ Wordlist in Slice 3)".

**Requirements (from ROADMAP):**
- **CTFT-12** — new `CtfCode` ElectroDB entity: `pk=challenge`, `sk=codeHash`, attrs `codeHash` [salted, same scheme as answers], `claimedBy`, `claimedAt`; plaintext never persisted.
- **CTFT-13** — judge **`wordlist` answer-type branch** in `judgeSolve`: hash the guess and **atomic conditional-claim** a matching unclaimed `CtfCode` via `attribute_not_exists(claimedBy)` — exactly one concurrent claimer wins; used/unknown code ⇒ non-solve indistinguishable from a wrong answer; scoring event recorded through the existing ledger/accrue path; never log the guess.
- **CTFT-14** — admin form **Wordlist** option in the Answer-type section: bulk-load codes [hashed client- or server-side before storage per the answer-salt scheme], write-only [plaintext never round-tripped to the client], with a loaded/remaining count surfaced.
</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices at Claude's discretion — discuss skipped. Use the ROADMAP goal, success criteria, the design spec, and Phase-53/54/55 codebase conventions.

### Hard invariants (non-negotiable)
- **Atomic single-use claim:** the claim MUST be a DynamoDB conditional update `attribute_not_exists(claimedBy)` (via ElectroDB's condition/patch) — NOT a read-then-write. Exactly one of two concurrent claimers of the same code wins; the loser gets a non-solve. A **race test** (two concurrent claims → one success, one non-solve) is REQUIRED (SC1).
- **Plaintext never stored / never round-tripped:** only salted `codeHash` values persist (same salt scheme as answers via `ctf-hash`). The admin bulk-loads codes that are hashed before storage; the client never receives plaintext codes back. Never log the guess.
- **Indistinguishable non-solve:** a used or unknown code returns the SAME non-solve a wrong answer yields (covert-channel invariant T-53-04-01 intact). The covert CSS path (`covert-egg.ts`) stays byte-identical.
- **Answer-type dispatch is additive:** extend `answerType` to `"static" | "otp" | "wordlist"` at `ctf-judge.ts:109`; add the `wordlist` branch alongside the existing `otp` branch at ~:324 using `ctf-hash` (`verifyAnswer`/`verifyAnswerHash`). Existing static/otp flags are unaffected.
- **Scoring path reuse:** a successful wordlist claim records the scoring event through the existing accrue/`CtfScoreEvent` or `CtfSolve` path exactly as today — no new scoring math.
- **Reuse Phase-54 form seams:** the Wordlist option is a new choice in the existing Answer-type section of `CtfForm.tsx` (+ `ctf-form-model.ts` helpers); do not fork the form.
</decisions>

<code_context>
## Existing Code Insights

Gathered during plan-phase research. Key anchors:
- `apps/run.human/webapp/src/lib/entities/qr.ts` — home of the `Ctf`/`CtfSolve`/`CtfScoreEvent` ElectroDB entities; add `CtfCode` here (`pk=challenge`, `sk=codeHash`) following the existing entity/service pattern (index names, service attach).
- `apps/run.human/webapp/src/lib/ctf-judge.ts` — `answerType` union at :109; answer-validation dispatch at ~:324 (`if answerType === "otp"`). Add the `wordlist` branch; use `CtfStore`/injected-store pattern so the claim is testable (the judge already takes an injectable store for testability).
- `apps/run.human/webapp/src/lib/ctf-hash.ts` — `verifyAnswer` / `verifyAnswerHash` + the salt scheme; reuse for hashing codes at load and at claim time (`CTF_ANSWER_SALT` unset in prod = default salt).
- `apps/run.human/webapp/src/components/admin/CtfForm.tsx` + `ctf-form-model.ts` — the Answer-type section (Static / Rotating OTP today) gains a **Wordlist** option with a bulk textarea; hash before storage; surface loaded/remaining count.
- `apps/run.human/webapp/src/lib/qr-admin.ts` — the admin write path; add the bulk-code-load write (hash each line → `CtfCode.create`/batch put, skipping duplicates).
</code_context>

<specifics>
## Specific Ideas

Testing (design spec Testing §): **wordlist single-use race — two claimers → one wins** (REQUIRED, SC1); used/unknown code ⇒ indistinguishable non-solve (SC2); plaintext never stored/round-tripped (SC3 — assert only codeHash persists, admin sees a count); covert invariant regression stays green; static/otp flags unaffected. The atomic claim must be exercised at the store level (conditional-put `attribute_not_exists(claimedBy)`), not just mocked away.
</specifics>

<deferred>
## Deferred Ideas

- Phase-54 informational polish (IN-01/IN-02) — see `54-FOLLOWUPS.md`. Phase-55 UAT — see `55-FOLLOWUPS.md`.
- This is the LAST slice of the v2.3 milestone; after it, run milestone audit → complete → deploy.
</deferred>
