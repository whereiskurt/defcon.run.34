# Phase 53 — Code-Review Follow-ups (deferred to later CTF slices)

Source: `53-REVIEW.md` (standard-depth review, 2026-07-15). Verdicts confirmed by the
orchestrator. **CR-01 (BLOCKER) was fixed in-phase** (commit `fix(53): CR-01 …`) — the
D-07 flip guard now compares the merged next-state. The items below are real but
non-blocking for this backend-only Slice 1a (the flag-types are not yet wired to any
live admin form or judge entry point); they are deferred to the slice that exposes each
surface. All still carry passing tests for the behavior that IS shipped.

| ID | Severity | Summary | Deferred to | Notes |
|----|----------|---------|-------------|-------|
| WR-01 | Warning | `overPerPlayerMax` / `hasScoreFor` read the eventually-consistent `byUser` GSI (no `ConsistentRead` possible there) and `overPerPlayerMax` isn't paginated — the per-player-max / unlock gates assume read-after-write they don't get. Practically bounded by window spacing. | Slice 2/3 (when cadence + chaining go live) | Consider a consistent primary-partition count, or accept the window-bounded race explicitly. `ctf-judge.ts` ~566-576, 601-608. |
| WR-02 | Warning | Score flow is 3–4 non-transactional writes; a failure at `accrue` after `recordScore` leaves the ledger scored but `RunUser` un-accrued, and the idempotent replay branch never re-accrues → permanent silent under-count. | Slice 2/3 | Options: DynamoDB `TransactWrite`, or a reconcile/re-accrue-on-replay path. |
| WR-03 | Warning | `otp.algorithm` is stored/typed/editable but `totpAt` hardcodes SHA1 and the judge never threads it → a non-SHA1 config silently yields an unsolvable flag. | Slice 1b (OTP enroll UI) | Spec permits SHA1-only for 1a with a switch stub; add config-time validation rejecting non-SHA1 until threaded, or thread the algorithm. |
| WR-04 | Warning | Unvalidated OTP/scoring numerics: unbounded `skew` (wider OTP window + CPU cost), `period:0` / bad base32 (dead flag), `pointFloor > pointMax` (negative accrual). | Slice 1b (form redesign / validation) | Add bounds validation at the admin write boundary (`upsertCtf` / `ctfAttributes`). |
| WR-05 | Warning | `effect` is attached even when `channel:"covert"` upstream of the route strip (defense-in-depth). The route DOES strip it (SC-5 verified byte-identical), so not live-exploitable — belt-and-suspenders. | Slice 2/3 | Null `effect` at the judge for covert channel too, not just at the route. |
| WR-06 | Warning | Gate-failure indistinguishability is content-only, not timing-uniform: credited solves do serial writes, leaking win/lose via latency to the covert door. | Slice 2/3 (covert hardening) | Hard problem; constant-time response or async-decouple the writes. Track as covert-channel hardening. |

INFO (CR-scan false positives on `?secret=` in `otpauth://` doc comments/tests) — no action.
