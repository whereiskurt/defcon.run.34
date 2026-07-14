# Phase 44: CTF Judge Core + Scoring Engine + Data Model - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning
**Source:** PRD Express Path (`docs/superpowers/specs/2026-07-13-ctf-judge-and-covert-channel-design.md`) — approved design; discuss-phase skipped because the spec already answers scope, decisions, and success criteria.

<domain>
## Phase Boundary

Build the **greenfield Phase-5 CTF judge foundation** that every other v2.1 phase depends on: the data model, the scoring math, and the `judgeSolve` core. Today q.defcon.run only *forwards* `/ctf/<challenge>/<value>` → `run.defcon.run/use1/ctf/claim` (which 404s); nothing validates, scores, or records solves. This phase makes solving a challenge a real, attributed, idempotent, cap-safe transaction against the signed-in `RunUser`.

**In scope (CTF-01..04):**
- Extend the `Ctf` ElectroDB entity (scoring fields) and add two new entities `CtfSolve` and `CtfPending`, plus `ctfScore`/`ctfSolves` on `RunUser`. All on the existing `run-human-electro` table (`service:"run"`), TS entities in `apps/run.human/webapp/src/entities/`.
- `computePoints(n, ctf)` — the composed scoring function (time-tier ceiling × linear per-solve decline × max-solves cap + first-blood bonus).
- `judgeSolve({ user, challenge, guess, channel })` — the single core both future front doors (Phase 45 visible claim, Phase 46 covert CSS) will call: attempt-cap/rate-limit → hashed-answer validate → idempotent claim → atomic ordinal → score → accrue.
- Answer hashing (salted) + log hygiene (never log the raw guess).
- Unit tests for scoring boundaries and judge concurrency/idempotency.

**Out of scope (later phases):**
- The visible `/use1/ctf/claim` page (Phase 45).
- The covert `text/css` endpoint, `v=` flag encoding, CSS-ack, DC33 celebration (Phase 46).
- Admin CRUD form field changes + CTF leaderboard UI + the plaintext→`answerHash` **migration script** (Phase 47).
- CloudFront behaviors + q `/admin/*` routing + DC33 integration exposure (Phase 48).
- Any global/total leaderboard (owned by the separate DC33 `leaderboard` worktree — integration-bounded, not built here).

This phase ships **data layer + pure logic + tests only**; no routes, no UI, no infra.
</domain>

<decisions>
## Implementation Decisions

All items below are **locked** (from the approved design spec §3, §4, §5, §10).

### Player identity
- Player = signed-in run.human user, keyed by `session.user.authUserId` (the OIDC sub exposed on the run.human session — see the Phase-43 mid-build fix that surfaced `authUserId` in `config/auth.ts`). NOT the Auth.js adapter `session.user.id` (namespace mismatch: see `reference_auth_id_namespace_mismatch`). `judgeSolve` takes the resolved `authUserId` as `user`; it does not read the session itself (the front doors do that and pass it in).

### Entities (ElectroDB, `run-human-electro`, `service:"run"`, `version:"1"`)
Follow the existing key convention in `apps/run.human/webapp/src/entities/qr.ts` (`$run#...` composites). Keep byte-parity with the resolver's `.mjs` mirror where a shared shape exists (the `entities/__tests__/qr-key-parity.test.ts` pattern) — note the resolver does NOT read `CtfSolve`/`CtfPending`, so those two are run.human-only (no `.mjs` mirror required), but `Ctf`'s **key** shape must stay parity-locked because the resolver reads `Ctf` on its hot path (even though it currently forwards without validating).

- **`Ctf`** — extend the existing entity (pk `[challenge]`, sk `[]`, lowercase-normalized). Add attributes:
  - `answerHash` (string) — replaces plaintext `answer` as the stored secret (see hashing below). Do NOT remove the ability to read legacy `answer` yet — the migration lands in Phase 47; this phase's `judgeSolve` validates against `answerHash` and the entity keeps `answer` as an optional legacy attribute so existing rows still load.
  - `pointMax` (number) — curve ceiling when no time tier is active.
  - `pointFloor` (number) — curve floor.
  - `maxSolves` (number, `N`) — the cap AND the curve denominator.
  - `firstBloodBonus` (number) — flat bonus for `n == 1`.
  - `timeTiers` (list of `{ from, to, ceiling }`, UTC-ISO strings) — active window's `ceiling` overrides `pointMax`.
  - `solveCount` (number) — internal atomic ordinal allocator.
  - Keep existing `maxAttempts`, `rateLimitWindow`, `effect`, `enabled`, `createdAt`, `updatedAt`.
- **`CtfSolve`** — NEW, one row per `(user, challenge)`; this row IS the idempotency key.
  - pk = `$run#challenge_<challenge>` (all solvers of a challenge share a partition — enables ordinal + solve list)
  - sk = `$ctfsolve_1#user_<authUserId>` (unique per user)
  - GSI `gsi1`: gsi1pk = `$run#user_<authUserId>`, gsi1sk = `$ctfsolve_1#challenge_<challenge>` ("all my solves" + leaderboard drill-in)
  - attrs: `challenge`, `user`, `ordinal` (n), `points`, `firstBlood` (bool), `tierCeiling` (audit), `channel` (`"qr" | "covert"`), `solvedAt` (UTC-ISO), `createdAt`, `updatedAt`.
- **`CtfPending`** — NEW, park-and-claim for unauth covert hits (Phase 46 consumes; the entity + its create/get/delete helpers land here so 46 has them).
  - pk = `$run#ctfpending_<nonce>`, sk = `$ctfpending_1`
  - attrs: `challenge`, `submittedFlagHash` (hash, never raw), `createdAt`, `ttl` (DynamoDB TTL epoch, e.g. now + 30d).
- **`RunUser`** — add `ctfScore` (number, atomic-`ADD` rollup, fast leaderboard key) + `ctfSolves` (number). `ctfScore` is a rollup; `CtfSolve` rows are the auditable source of truth (a rebuild can recompute `ctfScore = sum(points)`).

### Scoring — `computePoints(n, ctf)`
```
if n > ctf.maxSolves: return 0
ceiling = activeTierCeiling(now, ctf.timeTiers) ?? ctf.pointMax
span    = ceiling - ctf.pointFloor
frac    = (ctf.maxSolves == 1) ? 1 : (1 - (n - 1) / (ctf.maxSolves - 1))   // linear
base    = ctf.pointFloor + span * frac
bonus   = (n == 1) ? ctf.firstBloodBonus : 0
return round(base) + bonus
```
- Time tier = the **ceiling** the per-solve curve decays within (NOT an independent multiplier). Locked.
- Curve is **linear** in v1 (isolated in `computePoints` so a curved decline is a one-function swap later). Locked.
- `activeTierCeiling(now, tiers)` = the `ceiling` of the first `timeTiers` window whose half-open `[from, to)` contains `now`; else `null` → fall back to `pointMax`. Total (never throws); overlapping windows → first match wins.
- `now` must be injectable (pass a clock/timestamp) so tests are deterministic.

### Judge — `judgeSolve({ user, challenge, guess, channel })`
Return shape: `{ solved, points, ordinal, firstBlood, capped }`. Flow (order is load-bearing):
1. Load `Ctf`. If missing or `!enabled` → non-solve (`solved:false`); return a result the covert channel can render as a decoy.
2. **Attempt-cap / rate-limit** — read/increment a short-TTL per-user attempts counter (key e.g. `$run#ctfattempt_<challenge>_<user>`, TTL = `rateLimitWindow`); over `maxAttempts` in the window → non-solve (do NOT reveal the reason to callers — covert invisibility).
3. **Validate** — `hash(guess) == ctf.answerHash` (constant-time compare where practical). Mismatch → non-solve. **Never log `guess`.**
4. **Claim** — conditional put of the `CtfSolve` row with `attribute_not_exists(sk)`. If it FAILS (already solved) → no-op scoring, return `solved:true` with the **previously-awarded** `points`/`ordinal`/`firstBlood` (idempotent re-trigger still celebrates, never double-scores).
5. **Allocate ordinal** — atomic `ADD ctf.solveCount 1` → `n`. Only reached for genuinely-new solvers (step 4 gates), so the counter is gap-free.
6. **Score** — `points = computePoints(n, ctf)`; patch the `CtfSolve` row with `ordinal=n`, `points`, `firstBlood=(n==1)`, `tierCeiling`, `channel`; atomic `ADD RunUser.ctfScore points`, `ADD RunUser.ctfSolves 1`.
7. Return.
- `judgeSolve` must NEVER throw on a bad guess / missing challenge — degrade to `solved:false`. (Mirrors the resolver's never-throw contract.)
- Idempotency/cap-safety is the crux: distinct concurrent users → distinct ordinals; same user double-submit → one solve; replay → prior points, no double-count.

### Hashing & hygiene (CTF-04)
- Answers stored **salted-hashed** (`answerHash`). Use a hashing approach already available in the app's deps (prefer a keyed/salted SHA-256 or the platform's crypto; do NOT invent crypto). A per-answer or per-app salt is acceptable — document the choice; the goal is "a table leak doesn't hand over flags," not password-grade KDF.
- The **raw guess is never logged** anywhere in the judge — extend the resolver's `ctfHandoffLog` no-`value` invariant (see `apps/run.qr/lambda/resolver/lib/logline.mjs`) to the run.human judge. Add a hygiene test asserting no code path logs `guess`.
- `CtfPending.submittedFlagHash` stores a hash, not the raw guess.
</decisions>

<constraints>
## Constraints & Existing Code

- **Table/client:** run.human writes `run-human-electro` via `electroClient` in `apps/run.human/webapp/src/entities/` (same client that Phase-43 admin + QR admin CRUD use). No new AWS resources, no Terraform in this phase.
- **Entity source of truth:** `apps/run.human/webapp/src/entities/qr.ts` (Qr/Ctf/Qrstat today). Resolver mirror: `apps/run.qr/lambda/resolver/lib/entities.mjs`. Parity test: `src/entities/__tests__/qr-key-parity.test.ts` — extend it for the `Ctf` key shape; `CtfSolve`/`CtfPending` are run.human-only (no mirror).
- **Validation/data-layer home:** put judge + scoring in a new module alongside `src/lib/qr-admin.ts` (e.g. `src/lib/ctf-judge.ts` + `src/lib/ctf-scoring.ts`), pure and unit-testable; entities in `src/entities/`.
- **Node/vitest:** tests run on Node ≥22.12 — `nvm use 23.6.0` before `npx vitest` (see `reference_node_version_for_bib_tests`). `npm install` first if the worktree webapp has no `node_modules`.
- **Keep it simple:** <100 lines per module where possible, boring patterns, single-file until proven insufficient (AGENTS.md rule 3).
</constraints>

<success_criteria>
## Success Criteria (what must be TRUE)

1. `computePoints` is correct across: time-tier boundaries (in-window vs fallback `pointMax`), first-blood (`n==1` adds bonus), cap edges (`n==N` floor, `n==N+1`→0), and `N==1` (full ceiling + bonus). Proven by unit tests.
2. `judgeSolve` idempotency/cap-safety proven by test: same-user double-submit scores exactly once (returns prior points on the second call); distinct concurrent users receive distinct, gap-free ordinals; a replay never double-increments `RunUser.ctfScore` or `Ctf.solveCount`.
3. No plaintext answer and no raw guess is ever persisted (answers are `answerHash`; `CtfPending` stores `submittedFlagHash`) or logged (hygiene test passes).
4. `Ctf` key-parity test still passes with the extended attributes; `CtfSolve`/`CtfPending` entities create/get/query cleanly (gsi1 "all my solves" resolves).
5. `tsc` + eslint clean; vitest green.
</success_criteria>

<req_ids>
CTF-01, CTF-02, CTF-03, CTF-04
</req_ids>
