# Phase 56 — Deferred Follow-ups (post-deploy UAT + accepted debt)

**Recorded:** 2026-07-15 (autonomous run)
**Phase status:** Code-complete, reviewed (0 blockers), WR-01 fixed. Verification = 4/4 must-haves; `human_needed` only for the admin-form render + live bulk-load→claim round-trip. 635+/60 vitest green, covert path byte-identical.

## Deferred to browser/UAT (no jsdom in this repo)

| # | Check | How to verify post-deploy |
|---|-------|---------------------------|
| UAT-1 | **Wordlist admin bulk-load + count** | In /admin, set a flag's answer type to Wordlist, paste several codes, save → confirm the textarea clears and "N codes loaded · M unclaimed" appears; re-open → codes are NOT prefilled (only the count shows). |
| UAT-2 | **Live claim round-trip** | Submit a loaded code as a player → credited solve; submit the SAME code again (or an unknown one) → silent non-solve (indistinguishable from a wrong answer). |
| UAT-3 | **Concurrency (optional, best-effort)** | Two near-simultaneous submissions of one unclaimed code → exactly one credit. (Proven in unit tests via the conditional race; live confirmation is a bonus.) |

## Accepted debt / deferred code-review items

- **WR-02 (WARNING, DEFERRED) — claim/score non-atomicity.** The wordlist `claimCode` (marks the code claimed) and the subsequent `recordScoreEvent`/`accrue` are NOT in a single DynamoDB transaction. If finalize throws AFTER a successful claim, the code is globally consumed but the player scores nothing, and a retry with the same code reads as already-claimed (indistinguishable non-solve) — the player permanently loses that code. This extends the already-accepted non-transactional accrual pattern (Phase-53 WR-02) but is strictly worse for a single-use global resource. **Deferred** because a correct fix requires wrapping claim+ledger+accrue in a `TransactWriteItems` (ElectroDB transaction), which would also touch the shared `recordScoreEvent`/`accrue` path used by the otp/repeatable flows — too broad/risky for this slice. Probability is low (same request context, same table). Revisit alongside a Phase-53 WR-02 transactional accrual pass.
- **INFO — `getCtfCodeCounts` is an unbounded partition read** (`CtfCode.query.primary(...).go({pages:"all"})`). Fine for admin-scale pools; if a challenge ever loads tens of thousands of codes, replace with a counter attribute or a paginated count. Not in v1 scope.
- **INFO — finalize duplication** between the wordlist finalize and the repeatable finalize in `ctf-judge.ts` (acceptable; a shared helper could dedupe later).
- **INFO — `perPlayerMax` intentionally NOT applied on the wordlist path** — the finite pool + per-code single-use is the natural bound (documented decision in 56-02, not a gap).

## Notes
- WR-01 (swallowed transient error / misleading `added` count in `loadCtfCodes`) was **fixed in this phase** (see `fix(56): WR-01`).
- Earlier-slice follow-ups: `54-FOLLOWUPS.md`, `55-FOLLOWUPS.md`.
