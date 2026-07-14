# Phase 46: Covert CSS Channel + Park-and-Claim - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning
**Source:** PRD Express Path (`docs/superpowers/specs/2026-07-13-ctf-judge-and-covert-channel-design.md` §6.2, §7) — discuss-phase skipped; design answers scope/decisions/success.

<domain>
## Phase Boundary

The clandestine in-page submission path. An easter-egg trigger (e.g. the `!!!` triple-tap) fires a request to a **stylesheet-looking** endpoint that always returns `200 text/css`; on a genuine signed-in win the CSS body carries a hidden award marker that the page reads back via `getComputedStyle` and celebrates (DC33-style confetti). Auth/win state must be **invisible in the network tab**.

**In scope (CTF-07, CTF-08, CTF-09):**
- **Covert endpoint** — a run.human App Router route handler that emits `Content-Type: text/css`, always HTTP `200`, `Cache-Control: no-store`. Path *spelling* reads like a cache-busted stylesheet. Reads the session (same-origin `sess_run`), decodes the `?v=` flag, runs `judgeSolve({ channel: "covert" })` (or `createPending` when unauth), and returns either the plain decoy sheet or the marker-bearing sheet.
- **Flag encoding** — `?v=<n>` looks like a build-date / cache-buster but decodes (reversible, total, version-stamp-plausible) to the challenge + guess. Unknown/garbage `v` → decoy (never throws).
- **CSS-ack** — on a credited win, one innocuous-looking CSS custom property (e.g. `:root{--<theme-token>: <points>}`) is present; otherwise absent. Decoy vs win bodies are **byte-plausible** (≈same size).
- **Egg-side client** — a reusable module that, on trigger, injects the `<link rel=stylesheet href=".../theme.css?v=<encoded>">`, waits for load, reads `getComputedStyle(document.documentElement).getPropertyValue('--<token>')`, and on a non-empty/non-zero marker fires the **DC33-style celebration** (confetti + effects; optional "you earned N points"). Unauth → no marker → no celebration in-the-moment (the endpoint parked the flag for later credit).
- **Park-and-claim reuse** — unauth covert hits call the Phase-45 `createPending`/`claimPending` helpers (do NOT duplicate them). Only `submittedFlagHash` is stored, never the raw guess.
- **Wire ONE working trigger on run.defcon.run** so the full signed-in loop (trigger → covert hit → credit → confetti) is demonstrable in-app.

**Out of scope:**
- The **CloudFront behavior** that makes the covert path route to the app origin + `CachingDisabled` + cookie-forward + no `*.css` intercept — that is **Phase 48** (this phase builds/tests the route as a normal Next.js handler; note the path must be one Phase 48 can carve a behavior for).
- Admin CRUD fields / leaderboard (Phase 47).
- Embedding the egg into the separate **static landing** (`apps/static/landing/`, a different app, unauth → deferred credit) — treat as an explicitly-noted FOLLOW-UP, not required for this phase's success, unless it drops in trivially by reusing the built client module.
</domain>

<decisions>
## Implementation Decisions (locked from spec §2, §7)

- **Host = run.defcon.run** (it minted `sess_run`; verifying + crediting is trivial and the scoring data is local). NOT q.defcon.run (would need to verify the run.human JWT there).
- **Always `200 text/css`.** No `302`, no `401`, no JSON. Identical HTTP status + `Content-Type` across all outcomes: signed-in-win, signed-in-wrong, unauth. The ONLY difference is a value buried in the CSS body, and it reads as a theme token. Decoy and win bodies ≈ same size (pad as needed).
- **Never log the raw guess** (or the decoded flag), and do not emit a differential log line that leaks win/auth state — extend the Phase-44 `ctfJudgeLog` hygiene invariant. `submittedFlagHash` only in `CtfPending`.
- **Player key** = `session.user.authUserId` (present); else unauth → park. Same rule as Phase 45.
- **Reuse** `judgeSolve` (channel `"covert"`), `ctf-hash`, `ctf-log`, and the Phase-45 `createPending`/`claimPending`. This phase adds the endpoint, the flag codec, and the client — not new judge/scoring logic.
- **CSS-ack read is a computed-style read, not a network event** — the celebration must be triggered by `getComputedStyle`, so a network watcher sees only a stylesheet load. Cross-origin computed-style reads of a custom property on an element are allowed (CSSOM rule access is not needed).
- **Flag codec** — pick a reversible, total encode/decode (e.g. an integer transform with a small checksum) that yields a `v` that plausibly reads as a build date/version. `decode(v)` → `{ challenge, guess }` (or a challenge ref + guess); any decode failure → decoy. Document the scheme in the plan.
- **Celebration** — port the DC33 award vibe (confetti burst + a screen effect). It may live as a small self-contained module; gate it strictly behind the computed-style marker. Respect the codebase's existing rain/confetti utilities if present (check `run.human` for an existing cash-rain/confetti helper before adding a new one) — reduced-motion caveat: a user-triggered celebration should NOT be silently suppressed by `prefers-reduced-motion` (see the prod cash-rain lesson).
</decisions>

<constraints>
## Constraints & Existing Code (planner: ground by reading the codebase)

- **Route handler** — build with Next.js App Router `route.ts` returning a `Response` with `Content-Type: text/css`. Discover where a `text/css`-emitting handler belongs under `apps/run.human/webapp/src/app/` given the `/use1` basePath, and choose a path spelling that (a) reads like a stylesheet and (b) Phase 48 can target with a dedicated CloudFront behavior (i.e. under the app-routed prefix, not a spelling a `*.css` static behavior would grab first).
- **Session read in a route handler** — reuse `config/auth.ts` (`auth()`), same as Phase 45.
- **Reuse (committed on this branch):** `src/lib/ctf-judge.ts` (judgeSolve + `guessHash`/`channel`), `src/lib/ctf-hash.ts`, `src/lib/ctf-log.ts`, `src/lib/ctf-pending.ts` (createPending/claimPending), `src/entities/ctf.ts`.
- **Existing celebration helper** — check run.human for the existing rain/confetti component (the cash-rain lesson: a user-triggered rain must not be reduced-motion-gated). Reuse it if present.
- **Node/vitest:** `nvm use 23.6.0` before `npx vitest`; node_modules installed. Test the codec (round-trip + bad-input→decoy), the endpoint (win vs wrong vs unauth → identical status/type/≈size, marker only on win, no guess logged), and the client (marker present → celebrate; absent → no celebrate) with jsdom/unit where practical.
- **Simplicity-first** (AGENTS.md), <100 lines/file where practical. Only new files must be tsc-clean; the 2 pre-existing unrelated errors stay.
</constraints>

<success_criteria>
## Success Criteria (what must be TRUE)

1. A curl matrix over the covert endpoint — signed-in+correct, signed-in+wrong, unauth — returns **identical HTTP status (`200`), `Content-Type: text/css`, and ≈identical body size**; the ONLY difference is the presence of the award custom property on a genuine credited win. No `302`/`401`/JSON, no auth/win tell in status/headers.
2. The flag codec round-trips (`decode(encode(x)) === x`) and is total — any malformed/unknown `v` yields the decoy (endpoint never throws, never 5xx).
3. A signed-in correct hit credits via `judgeSolve(channel:"covert")` (idempotent — re-fire never double-scores); an unauth hit parks a `CtfPending` (submittedFlagHash, never raw) and returns the decoy; the raw guess/flag appears in NO log line.
4. The egg client fires the DC33 celebration ONLY when the computed-style marker is present, via a `getComputedStyle` read (not a parsed fetch response); a reduced-motion user still gets their user-triggered celebration.
5. One working trigger is wired on run.defcon.run demonstrating the full signed-in loop. `tsc` clean on new files; vitest green.
</success_criteria>

<req_ids>
CTF-07, CTF-08, CTF-09
</req_ids>
