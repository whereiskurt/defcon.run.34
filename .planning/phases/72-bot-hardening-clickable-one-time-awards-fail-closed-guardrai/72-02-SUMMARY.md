---
phase: 72-bot-hardening-clickable-one-time-awards-fail-closed-guardrai
plan: 02
subsystem: api
tags: [run-human, ctf, mint, nonce, dynamodb, getitem, vitest, crockford-base32]

# Dependency graph
requires:
  - phase: 45-ctf-park-and-claim
    provides: createPending/claimPending, the PendingDeps injection seam, the T-45-01 hash-only hygiene invariant
  - phase: 46-covert-channel
    provides: the ghost mint route and its answerHash-match challenge resolution
  - phase: 72-01
    provides: the q resolver `/a/<nonce>` award namespace this plan's URLs point at
provides:
  - "newAwardNonce() — 12 Crockford base32 lowercase symbols (60 bits)"
  - "AWARD_LINK_TTL_SECONDS — 3600s, tunable via BOT_CLAIM_LINK_TTL_SECONDS"
  - "PendingDeps.flagHash — parks a caller-supplied hash verbatim, no raw code needed"
  - "POST /api/internal/ctf/mint accepting {challenge} as well as {ghost}, returning https://q.<domain>/a/<nonce>"
  - "MeshGhost.challenge — optional explicit Ctf name from MESHTK_FLAG_CHALLENGES"
  - "claim-page tolerance for a case-mangled ?nonce"
affects: [72-05 ricky rotation script, 72-06 ricky mint in meshtk, 72-07 meshtk award delivery, 72-09 run.human release]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Park a row's OWN answerHash instead of a raw code — the secret never has to be constructed to be awarded"
    - "Bias-free symbol generation by masking low 5 bits (256 is an exact multiple of a 32-symbol alphabet — no reject sampling)"
    - "Normalize-on-read at a single derivation point so every downstream branch inherits it"

key-files:
  created:
    - apps/run.human/webapp/src/lib/__tests__/ctf-award-nonce.test.ts
  modified:
    - apps/run.human/webapp/src/lib/ctf-pending.ts
    - apps/run.human/webapp/src/lib/mesh-ghosts.ts
    - apps/run.human/webapp/src/app/api/internal/ctf/mint/route.ts
    - apps/run.human/webapp/src/app/(ctf)/ctf/claim/page.tsx
    - apps/run.human/webapp/src/lib/__tests__/ctf-pending.test.ts
    - apps/run.human/webapp/src/lib/__tests__/mesh-ghosts.test.ts
    - apps/run.human/webapp/src/app/api/internal/ctf/mint/__tests__/route.test.ts
    - apps/run.human/webapp/src/app/(ctf)/ctf/claim/__tests__/page.test.tsx

key-decisions:
  - "The mint route derives the covert code even on the explicit-challenge ghost path, purely to preserve today's 422 gate on an unconfigured MESHTK_GHOST_KEY_SECRET; the derived code is then unused because the park carries the row's answerHash instead."
  - "A resolved row with NO answerHash 422s rather than parking a nonce (Rule 2 addition, not in the plan). Without this, a rotating-OTP row would silently park hashAnswer(\"\") and hand the player a link that can never award — a failure with no error surface anywhere."
  - "The persona hash-match fallback still parks the DERIVED CODE (not a flagHash) so every pre-existing assertion on that path stays literally intact; hashAnswer(code) === the row's answerHash there by construction, so the stored value is identical either way."
  - "CLAIM_LINK_TTL_SECONDS stays exported and unchanged at 15 minutes, marked legacy. It now has zero importers but removing it was out of scope and would break any future import silently."
  - "createPending keeps crypto.randomUUID() as its DEFAULT generator: the 30-day anonymous park keeps 122 bits, and the 60-bit nonce is injected only through the newNonce seam by the mint route, where it lives for an hour."

metrics:
  duration: ~20 min
  completed: 2026-07-31
  tasks: 3
  files-changed: 9
  tests-added: 22

status: complete
---

# Phase 72 Plan 02: run.human Mint / Pending / Claim Seam Summary

Short single-use award links now mint for **both** ricky (by challenge name) and all 8
persona ghosts, the per-reveal full-table scan is gone from every path an operator can
configure away, and the challenge path never needs a raw flag code to exist anywhere —
it parks the `Ctf` row's own `answerHash`.

## What was built

### Task 1 — `newAwardNonce()`, `flagHash`, `AWARD_LINK_TTL_SECONDS`

`src/lib/ctf-pending.ts` gained three additive exports:

- **`newAwardNonce()`** — 12 symbols from `0123456789abcdefghjkmnpqrstvwxyz` (Crockford
  base32 lowercase, no `i`/`l`/`o`/`u`), 60 bits. Bytes come from
  `crypto.getRandomValues`; because 256 is an exact multiple of the 32-symbol alphabet,
  masking the low five bits is *already* a uniform mapping, so there is no modulo skew
  and no reject-sampling loop (T-72-11).
- **`PendingDeps.flagHash`** — parks a caller-supplied hash verbatim, bypassing
  `hashAnswer(guess)`. This stays inside the T-45-01 hygiene invariant: a hash goes in,
  a hash is stored, no raw guess is retained.
- **`AWARD_LINK_TTL_SECONDS`** — 3600s, read once at module load from
  `BOT_CLAIM_LINK_TTL_SECONDS`, clamping non-numeric / zero / negative back to the
  default so a typo in the env cannot mint an already-expired award.

`createPending`'s default generator is untouched (`crypto.randomUUID`, 122 bits, 30-day
park). `CLAIM_LINK_TTL_SECONDS` remains exported and unchanged, marked legacy.

### Task 2 — Two-shape mint, zero scans on the configurable paths

`POST /api/internal/ctf/mint` now reads `ghost` and `challenge` from one body parse
(the 403 secret gate still runs strictly first, before any parse or data access).

| Body | Resolution | Scans |
|------|-----------|-------|
| `{challenge}` | `getCtf()` — one GetItem | **0** |
| `{ghost}` with `challenge` on the blob | `getCtf()` — one GetItem | **0** |
| `{ghost}` without one | `listCtf()` answerHash match | 1 (unavoidable) |
| both keys | `challenge` wins | **0** |

The two GetItem paths park via `createPending(row.challenge, "", { flagHash:
row.answerHash, … })` — the guess argument is never hashed, so **no raw flag code is
constructed at all** (T-72-08). Redemption works because `judgeSolve` compares
`verifyAnswerHash(guessHash, ctf.answerHash)` for `answerType: "static"`.

The `listCtf` fallback is retained verbatim, including its enabled-row preference, with
a comment stating plainly why it must not be removed: persona challenge names don't
uniformly derive from fleet ids (`grace-hopper` ↔ `ghost.hopper`).

URLs are `https://q.<siteDomain>/a/<nonce>` (override: `AWARD_LINK_BASE_URL`). In dev
the route keeps returning the direct claim-page URL, because no q resolver runs locally.
`Cache-Control: private, no-store` is preserved. No logging was added anywhere.

`MeshGhost.challenge` is overlaid additively in `mesh-ghosts.ts` — the env blob is read
fresh per call, so an un-updated `MESHTK_FLAG_CHALLENGES` yields `undefined` and keeps
today's fallback behaviour exactly.

### Task 3 — Case-tolerant claim links

`?nonce` is lowercased once at the `linkNonce` derivation, so **both** the signed-in
redeem branch (N1) and the anonymous park branch (N2) inherit it — the cookie N2 parks
now matches what branch (B) later looks up. Every nonce this system has ever generated
is already lowercase (`randomUUID` hex; the Crockford lowercase alphabet), so this can
only repair a mangled link, never break a good one. The `ctf_pending` cookie branch
still reads its value verbatim. The page's zero-`console.` invariant holds.

## Integration with 72-01

Verified the two halves join up: `parse-path.mjs:108` matches the award letter with
`first.toLowerCase() === "a"` and passes the nonce through verbatim, so an uppercased
link (`/A/K7M3…`) reaches the claim page and this plan's lowercasing redeems it.

72-01 originally specified a verbatim-lowercase letter and revised it to case-insensitive
under its own review item W5 (`5caa4cc5`), explicitly so this plan's `?nonce` lowercasing
would not be dead code. Both halves agree; nothing outstanding.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] 422 on a row with no `answerHash`**
- **Found during:** Task 2
- **Issue:** `resolveMintableRow` as specified checked only existence and `enabled`. A
  row with no `answerHash` (e.g. `answerType: "otp"`, or a partially-seeded row) would
  pass, `flagHash` would be `undefined`, and `createPending` would silently fall back to
  parking `hashAnswer("")`. The bot would get a 200 and hand the player a link that can
  never award, with no error anywhere in the system.
- **Fix:** treat a missing `answerHash` as unmintable → 422, so the bot falls back to its
  static-code reveal like every other miss.
- **Files modified:** `src/app/api/internal/ctf/mint/route.ts`
- **Commit:** `66e4654b`

**2. [Scope] `route.test.ts` URL expectation updated**
- The pre-existing happy-path test asserted
  `url: "https://run.defcon.run/use1/ctf/claim?nonce=nonce-1"`. Changing that URL shape
  is the plan's whole point, so the expectation now asserts the award shape. Every
  *behavioural* pre-existing assertion (hash-match challenge resolution, enabled-row
  preference, 403-before-parse, the four 422 triggers) is retained unchanged.

**3. [Style] `unmintable()` as a plain function**
- Initially written as `NextResponse.json.bind(...)`; rewritten as an ordinary helper to
  match the file's direct style and avoid `this`-binding subtleties. No behaviour change.

## Test Results

```
npx vitest run src/lib/__tests__ "src/app/api/internal/ctf" "src/app/(ctf)"
  Test Files  52 passed (52)
       Tests  619 passed (619)
```

Per-task verification commands from the plan, all green:

| Task | Command | Result |
|------|---------|--------|
| 1 | `vitest run ctf-award-nonce ctf-pending ctf-pending-ttl` | 23 passed |
| 2 | `vitest run mint/__tests__/route.test.ts mesh-ghosts.test.ts` | 31 passed |
| 3 | `vitest run "(ctf)/ctf/claim/__tests__/page.test.tsx"` | 12 passed |

Acceptance greps:

```
grep -c 'export function newAwardNonce' src/lib/ctf-pending.ts   → 1
grep -c 'AWARD_LINK_TTL_SECONDS'        src/lib/ctf-pending.ts   → 5  (>= 2)
grep -c 'crypto.randomUUID'             src/lib/ctf-pending.ts   → 1
grep -c 'console\.'  "src/app/(ctf)/ctf/claim/page.tsx"          → 0
```

**Typecheck:** `npx tsc --noEmit` reports 10 errors, **all pre-existing** in files this
phase never touched (`dropdown-user.tsx`, `entities/__tests__/checkin.test.ts`,
`lib/leaderboard-drill.test.ts`) — confirmed against `git diff --name-only cc799ffd..HEAD`.
Zero errors in any file this plan changed.

**Lint:** the app does **not** lint clean at baseline — `npm run lint` reports 63 errors
and 46 warnings app-wide, none in files this plan touched. Scoped to the 9 changed files:
0 errors, 1 pre-existing unused-var warning. The plan's "`npm run lint` — clean" step was
therefore not achievable at this baseline; logged in `deferred-items.md`.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: configuration | `mint/route.ts` | New `AWARD_LINK_BASE_URL` env override controls the host every minted award link points at. Operator-controlled, same trust level as the pre-existing `RUN_PUBLIC_URL`, but a mis-set value would silently send every bot award to the wrong host. Worth pinning in the 72-09 deploy checklist. |

T-72-07 (one shared internal secret can mint any flag) remains **accepted and deferred**
per the design owner; the gate still runs first-in-handler so an unauthenticated call
touches no data. T-72-12 (attribution keyed to `session.user.id`) is untouched.

## Known Stubs

None.

## Not in this plan

Releasing or deploying run.human (that is 72-09), the ricky rotation script (72-05), and
the meshtk-side mint call (72-06/72-07). No production data was touched.

## Self-Check: PASSED

Files verified present:
- `apps/run.human/webapp/src/lib/ctf-pending.ts` — FOUND
- `apps/run.human/webapp/src/lib/mesh-ghosts.ts` — FOUND
- `apps/run.human/webapp/src/app/api/internal/ctf/mint/route.ts` — FOUND
- `apps/run.human/webapp/src/app/(ctf)/ctf/claim/page.tsx` — FOUND
- `apps/run.human/webapp/src/lib/__tests__/ctf-award-nonce.test.ts` — FOUND

Commits verified in `git log`:
- `3a1aaab6` test(72-02): failing tests for award nonce, flagHash park, award TTL — FOUND
- `bffc8712` feat(72-02): short award nonce, verbatim flagHash park, env-tunable TTL — FOUND
- `caaf8f36` test(72-02): failing tests for two-shape mint + explicit-challenge overlay — FOUND
- `66e4654b` feat(72-02): mint by challenge via GetItem, keep persona hash-match fallback — FOUND
- `6eb4d9aa` test(72-02): failing tests for claim-page nonce case tolerance — FOUND
- `9e5678f7` feat(72-02): lowercase the ?nonce query param — FOUND

## TDD Gate Compliance

All three tasks ran RED → GREEN with separate commits. Gate sequence present in git log:
`test(72-02)` → `feat(72-02)` × 3. No REFACTOR commits were needed (the one style
cleanup was folded into its GREEN commit before it landed).
