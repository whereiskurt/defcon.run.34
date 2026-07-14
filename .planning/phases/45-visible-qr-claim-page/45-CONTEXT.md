# Phase 45: Visible QR Claim Page - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning
**Source:** PRD Express Path (`docs/superpowers/specs/2026-07-13-ctf-judge-and-covert-channel-design.md` §2, §6.1) — discuss-phase skipped; design already answers scope/decisions/success.

<domain>
## Phase Boundary

Build `run.defcon.run/use1/ctf/claim` — the **visible, honest** front door for physical QR scans. Today the q.defcon.run resolver 302-forwards `/ctf/<challenge>/<value>` → `run.defcon.run/use1/ctf/claim?c=<challenge>&v=<guess>`, but that route **404s**. This phase makes it real: read the session, call the Phase-44 `judgeSolve`, and render a visible result.

**In scope (CTF-05, CTF-06):**
- A **public** App Router route at `src/app/[region]/ctf/claim` (or the repo's regional equivalent) that reads `c` (challenge) + `v` (guess) query params, resolves the signed-in RunUser if present, calls `judgeSolve({ user, challenge, guess, channel: "qr" })`, and renders a visible outcome (solved + points + first-blood; already-solved; wrong/disabled; capped-but-celebrated).
- **Unauth handling:** when no session, PARK the flag against a `CtfPending` nonce and show a "sign in to claim your points" CTA; on the user's next signed-in visit the parked nonce is claimed and credited exactly once, then the celebration shows.
- The **shared park-and-claim data helpers** land here (Phase 44 created `CtfPending` as schema-only): `createPending(challenge, guess)` → nonce; `claimPending(nonce, user)` → runs `judgeSolve` + deletes the row; idempotent, TTL-bounded. Phase 46 (covert) reuses these — build them reusable.

**Out of scope:** the covert `text/css` endpoint + `v=`-encoding + CSS-ack + DC33 celebration (Phase 46); admin CRUD/leaderboard (47); CloudFront/infra (48). This phase is a normal visible Next.js page + the pending helpers.
</domain>

<decisions>
## Implementation Decisions (locked from spec)

- **Route is PUBLIC, not `(protected)`** — anonymous QR scanners must reach it (they bounce to a sign-in CTA, not a 404). It reads the session opportunistically: signed-in → attribute + credit now; anon → park + prompt. Do NOT put it under the admin/protected gate.
- **Player key** = `session.user.authUserId` (OIDC sub exposed in `config/auth.ts`), passed to `judgeSolve` as `user`. NEVER the adapter `session.user.id` (namespace mismatch).
- **Query contract** (fixed by the live resolver, do not change): `?c=<challenge>&v=<guess>`. `v` is the raw guess. **Never log `v`** — reuse the Phase-44 `ctfJudgeLog` hygiene path; the page must not console.log/emit the guess.
- **Region/basePath** — the app is `basePath:/${region}` (use1). Follow the existing regional route convention already in `src/app/` (discover it — see constraints).
- **Rendering** — match the existing run.human chrome (HeroUI + Tailwind tokens `bg-content1`/`text-primary`, `font-museo`, teal accent) used by other pages; a focused result card (solved/points/first-blood, or wrong/disabled, or "sign in to claim").
- **Park-and-claim mechanism:** anon submit → `createPending` stores `{challenge, submittedFlagHash, ttl}` and returns a `nonce`; persist the nonce client-side (cookie or localStorage) so the next signed-in load can present it; a signed-in claim path (server action or small route) calls `claimPending(nonce, authUserId)` → `judgeSolve(channel:"qr")` → delete pending. Idempotent: a re-presented/already-claimed nonce no-ops. Store only `submittedFlagHash`, never the raw guess.
- **Idempotent credit:** because `judgeSolve` is itself idempotent (Phase-44 conditional-put), a double claim (refresh, re-scan) never double-scores — the page just re-shows the prior award.
</decisions>

<constraints>
## Constraints & Existing Code (planner: ground these by reading the codebase)

- **Discover the App Router regional convention** — inspect `apps/run.human/webapp/src/app/` for how existing routes handle the `[region]`/basePath segment and where a NEW public (non-`(protected)`) page belongs; mirror it. Look at how `(protected)/admin/*` reads the session for the pattern, but this page is NOT protected.
- **Session read** — `apps/run.human/webapp/src/config/auth.ts` (`auth()` / `session.user.authUserId`).
- **Judge + entities (Phase 44, committed on this branch):** `src/lib/ctf-judge.ts` (`judgeSolve`, `CtfStore`, `defaultStore`), `src/lib/ctf-log.ts` (`ctfJudgeLog`), `src/entities/ctf.ts` (`CtfSolve`, `CtfPending`, `CtfAttempt`), extended `Ctf` in `src/entities/qr.ts`, `src/lib/ctf-hash.ts`. The pending helpers you add should live alongside these (e.g. `src/lib/ctf-pending.ts`) and use `electroClient`.
- **Node/vitest:** `nvm use 23.6.0` before `npx vitest`; `node_modules` already installed.
- **Simplicity-first** (AGENTS.md): <100 lines/file where practical, boring patterns.
- **No infra, no Terraform, no CloudFront** in this phase (the route works via the app's existing `/use1/*` behavior; the dedicated covert-path CloudFront behavior is Phase 48).
</constraints>

<success_criteria>
## Success Criteria (what must be TRUE)

1. `run.defcon.run/use1/ctf/claim?c=<challenge>&v=<correct>` with a signed-in session renders a visible award (points, and first-blood when `n==1`); a wrong/disabled challenge renders a graceful non-award; a capped solve (`n>N`) still celebrates with 0 points.
2. The same URL with NO session parks the flag (a `CtfPending` row with `submittedFlagHash`, never raw guess) and shows a sign-in CTA; after signing in and returning, the parked nonce is claimed and credited **exactly once** (verified: `RunUser.ctfScore`/`Ctf.solveCount` do not double-increment on refresh/re-claim).
3. The raw guess (`v`) never appears in any log line (hygiene test/assertion).
4. `createPending`/`claimPending` are reusable (Phase 46 will call them) and idempotent; `tsc --noEmit` clean on new files; vitest green.
</success_criteria>

<req_ids>
CTF-05, CTF-06
</req_ids>
