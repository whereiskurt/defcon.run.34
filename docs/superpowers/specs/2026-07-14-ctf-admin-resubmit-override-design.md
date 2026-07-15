# CTF admin re-submit override — design

**Date:** 2026-07-14
**Branch:** `gsd/ctf-admin-resubmit-override`
**Goal:** Let CTF operators (admins) re-submit an already-solved flag any number of
times to test challenge setups — re-scored against the challenge's *current*
config and idempotent on the board (no runaway score) — and not be rate-limited
while iterating. Non-admin players are completely unaffected.

## Motivation

Discovered during Part-A reset work: a repeat submit is **not** hard-blocked
today. `judgeSolve` already returns `solved:true` on a replay and the UX already
re-celebrates. But a replay returns the **cached** prior award — it does not
re-run scoring — so an operator cannot verify a *changed* challenge config by
resubmitting, and a burst of test submits can trip the per-challenge attempt cap.

## Decisions (owner, 2026-07-14)

1. **Replay behavior for admins:** re-score against the challenge's CURRENT
   config; adjust `RunUser.ctfScore` by the **net delta** (single award reflecting
   the live setup, never additive), reuse the existing ordinal (never bump
   `Ctf.solveCount`), re-celebrate. Idempotent: unchanged config → delta 0.
2. **Attempt cap:** admins bypass the per-challenge rate-limit/attempt cap.
3. **Correctness is NOT bypassed:** an admin must still submit the correct answer
   — the override only relaxes the *dedup* and the *rate-limit*, never the hash
   check. A wrong admin guess is still a graceful non-solve.
4. **Who is an admin:** membership in `CTF_ADMIN_GROUPS = ["admin","runadmin",
   "ctfadmin"]` on `session.user.services` (the run.auth groups model). NOTE:
   `ctfadmin` does not exist in run.auth today — it is included so the override
   lights up automatically if/when that group is added; `admin`/`runadmin` are the
   effective gates now. Uses the existing sync `isMemberOf` (no live revalidation
   in the hot path — the override grants no data access, only a re-submit of the
   operator's own flag).

## Architecture

The judge stays pure and testable. The **front door** decides admin-ness from the
session and passes a boolean into `judgeSolve` — the judge never reads the
session, mirroring how it already trusts the front-door-resolved `user`.

### `src/lib/admin-gate.ts`
- Add `export const CTF_ADMIN_GROUPS = [...ADMIN_GROUPS, "ctfadmin"] as const;`
- Add `export function isCtfAdmin(session: SessionLike): boolean` = `isMemberOf(session, CTF_ADMIN_GROUPS)`.

### `src/lib/ctf-judge.ts`
- `judgeSolve` input gains `admin?: boolean` (default false).
- **Step 2 (attempt cap):** run only when `!admin`. Admins are never over-limit.
- **Step 4 (claim fails → already solved):**
  - `!admin` → unchanged: return the prior award (existing replay path).
  - `admin` **and** a valid prior ordinal (`>= 1`) → **re-score path**:
    - `n = prior.ordinal` (reuse; do NOT `allocateOrdinal`, so `solveCount` is untouched)
    - `points = computePoints(n, ctf, now)`; `firstBlood = n === 1`;
      `tierCeiling = activeTierCeiling(now, ctf.timeTiers) ?? ctf.pointMax`
    - `recordScore({...})` to overwrite the solve row's score/audit fields
    - `reaccrue({ user, delta: points - prior.points })` (net delta; `ctfSolves`
      unchanged — still one solve)
    - log `result: "re-score"`; return `{ solved:true, points, ordinal:n, firstBlood, capped: points===0 }`
  - `admin` but **no** usable prior ordinal → fall back to returning the prior
    award as-is (cannot safely re-score without an ordinal).
- **`CtfStore` gains** `reaccrue(args: { user: string; delta: number }): Promise<void>`.
  Default impl: `if (delta === 0) return;` else `RunUser.patch({ userId: user }).add({ ctfScore: delta }).go()`
  (DynamoDB `ADD` accepts a negative delta → decrement). Never touches `ctfSolves`.

### Front doors
- **Visible** `src/app/(ctf)/ctf/claim/page.tsx`: `const admin = isCtfAdmin(session)`;
  pass `admin` into the branch-A `judgeSolve` call. (Deferred park-claim branch B
  is single-use and left as-is.)
- **Covert** `src/app/(ctf)/assets/theme/route.ts`: widen `CovertSession` to
  `{ user?: { id?: string; services?: string[] } }`; `const admin = isCtfAdmin(session)`;
  pass `admin` into the `judge(...)` call. The win-sheet gate stays `points > 0`
  (channel-honest: a re-score that the current config caps to 0 shows the decoy).

## Tests (TDD)

New/extended, all against the in-memory fake `CtfStore` (no DynamoDB):
- **admin re-score reflects CURRENT config:** solve under config A; re-submit as
  admin under config B (different ceiling) → points match B, ordinal reused,
  `solveCount` unchanged, `ctfScore` moved by exactly the delta, `ctfSolves`
  unchanged.
- **admin re-submit, unchanged config → delta 0:** `ctfScore` unchanged, still
  `solved:true` with same points (idempotent).
- **non-admin replay unchanged (regression):** prior award returned, no re-score,
  no `reaccrue`.
- **admin bypasses attempt cap:** `maxAttempts:0` + admin correct guess → solves;
  non-admin same input → NON_SOLVE.
- **admin still needs the right answer:** admin + wrong guess → NON_SOLVE.
- **admin first-ever solve == normal path:** fresh ordinal, accrue once.
- **`isCtfAdmin`** unit: true for admin/runadmin/ctfadmin, false otherwise / no session.

The existing `makeStore` fake gains a `reaccrue` implementation (adjust the
per-user points by `delta`, leave `solves` count untouched).

## Out of scope
- Adding a real `ctfadmin` group to run.auth (separate change).
- Any UI to toggle the override; it is implicit from group membership.
- Deferred park-claim (branch B) admin re-score.
