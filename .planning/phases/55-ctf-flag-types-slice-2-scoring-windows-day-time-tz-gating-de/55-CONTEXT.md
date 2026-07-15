# Phase 55: CTF Flag Types — Slice 2 Scoring Windows (Day/Time/TZ Gating + DEF CON Run-Hours Quick Set) - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Add time-of-day / day-of-week scoring windows to the CTF judge as a new ordered gate, additive to the `Ctf` entity and the (Phase-54) redesigned admin form — a shippable run.human PR with its own tests, covert-CSS invariant preserved. Adds an optional `scoreWindow` config `{ days, startTime, endTime, tz }` where `tz` is an **IANA zone** (e.g. `America/Los_Angeles`); the judge evaluates `now` in `scoreWindow.tz` via `Intl.DateTimeFormat` (DST automatic) as gate **step 3** — if `scoreWindow` is set and `now` is outside the day/time window → **non-solve, indistinguishable from a wrong answer**. The admin form's **Scoring window & limits** section (a Phase-54 placeholder note today) gains the day/time/tz picker (PT/ET/UTC → stored as IANA id) and the **"DEF CON run hours" quick set** (Thu–Sun 6–8 AM PT). Absent `scoreWindow` ⇒ always-open (every existing flag unchanged).

**Authoritative design spec:** `docs/superpowers/specs/2026-07-14-ctf-flag-types-and-form-redesign-design.md` — § "Judge design" (gate step 3, line ~90), § "Timezone handling (decision)" (IANA zone + `Intl.DateTimeFormat`, DST automatic, PT/ET/UTC picker), and the form § "Scoring window & limits (§2)".

**Requirements (from ROADMAP):**
- **CTFT-09** — `Ctf` additive optional `scoreWindow` field `{ days:number[]|weekday-set, startTime, endTime, tz:IANA-id }`, backward-compatible: absent ⇒ always scorable; distinct from cadence/caps.
- **CTFT-10** — judge **scoring-window gate** as ordered step 3 in `judgeSolve`: evaluate `now` in `scoreWindow.tz` via `Intl.DateTimeFormat`, DST-correct; outside window ⇒ non-solve indistinguishable from a wrong answer (covert invariant intact); never log the guess.
- **CTFT-11** — admin form **day/time/tz picker** in the Scoring window & limits section: weekday multi-select + start/end time + tz selector (PT/ET/UTC → stored IANA id) + **"DEF CON run hours" quick set** chip = Thu–Sun 6–8 AM `America/Los_Angeles`; round-trips through save/edit; live preview reflects window state.
</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — discuss skipped. Use the ROADMAP goal, success criteria, the design spec, and Phase-54 codebase conventions.

### Hard invariants (non-negotiable)
- **Ordered gate placement:** the scoring-window gate is judge **step 3** (after the unlock gate, before answer validation) per the design spec's `judgeSolve` gate order. A closed window is a **non-solve indistinguishable from a wrong answer** — the covert CSS channel invariant (T-53-04-01) MUST hold; never log the guess or secret.
- **Additive & backward-compatible:** `scoreWindow` is optional; absent ⇒ always-open. No shipped flag's behavior changes. No data migration.
- **DST correctness:** evaluate `now` in `scoreWindow.tz` (IANA id) via `Intl.DateTimeFormat` so "6–8 AM PT" is PDT in August and PST off-season automatically. Store the IANA id (`America/Los_Angeles` for PT), not a fixed offset.
- **Covert path untouched:** no edits to `covert-egg.ts` / the covert response.
- **Reuse Phase-54 form seams:** extend the `CtfForm` "Scoring window & limits" section (currently a placeholder note) and the `ctf-form-model.ts` pure helpers; do not fork the form. The window is part of the existing live-preview state where relevant.
</decisions>

<code_context>
## Existing Code Insights

Gathered during plan-phase research. Key anchors:
- `apps/run.human/webapp/src/lib/ctf-judge.ts` — `judgeSolve` ordered gates; insert window eval as step 3 (unlock is step 2, answer validation step 5). Additive to the loaded `Ctf`/`JudgeCtf`.
- `apps/run.human/webapp/src/components/admin/CtfForm.tsx` — the Phase-54 "Scoring window & limits" section carries a Slice-2 placeholder note to replace with the real picker.
- `apps/run.human/webapp/src/components/admin/ctf-form-model.ts` — pure form seam; add scoreWindow ↔ form-state helpers + the "DEF CON run hours" quick-set constant here (testable, no jsdom).
- The `Ctf` entity definition (additive optional attribute, same pattern Phase 53 used for `answerType`/`otp`/limits).
- A new pure `ctf-score-window.ts` seam is the natural home for `isWithinScoreWindow(scoreWindow, nowMs)` (Intl-based) — unit-tested against DST boundaries.
</code_context>

<specifics>
## Specific Ideas

Testing (design spec Testing §): judge window gate inside/outside + a DST-boundary case; the "DEF CON run hours" quick set resolves to Thu–Sun 6–8 AM `America/Los_Angeles`; round-trip save→edit; covert invariant regression stays green. tz picker offers PT/ET/UTC, stores IANA id.
</specifics>

<deferred>
## Deferred Ideas

- Wordlist one-time codes → **Slice 3 / Phase 56**.
- Phase-54 informational polish (IN-01 effect-kind hint, IN-02 preview First-solve=0) — see `54-FOLLOWUPS.md`.
</deferred>
