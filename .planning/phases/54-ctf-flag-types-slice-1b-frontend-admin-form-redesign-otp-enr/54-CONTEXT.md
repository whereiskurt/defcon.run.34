# Phase 54: CTF Flag Types — Slice 1b Frontend (Admin Form Redesign + otp-enroll QR/Rolling-Code Reward Renderer) - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Ship the run.human UI half of the CTF flag-types milestone on top of Phase 53's backend — a shippable run.human PR with its own tests, no covert-CSS blast radius. Two deliverables:

1. A restructured `CtfForm.tsx` (design "A") that exposes the answer-type framework (Static / Rotating OTP), the Static→**Reward on solve → OTP enrollment** seed configurator with a reveal preview, per-24h + per-player-max + global-max limits, unlock/chaining, an always-editable Advanced drawer that presets pre-fill, and a live scoring preview mirroring `computePoints` — while **removing the dead `Points` field** and keeping answers/secrets write-only/masked.
2. A **new client `otp-enroll` reward renderer** wired to the non-covert solve response (which 1a extended to carry `effect`) that draws a real QR of the `otpauth://` seed via the existing `qrcode@^1.5.4` dep, shows the rolling code (previous/current/next + countdown) via `adjacentCodes`, offers an "Add to Authenticator" deep link, and names the `effect.nextFlag` it unlocks.

Delivers the full daily-chain vision *except* time-of-day windows (Slice 2). No infra changes, no data migration (all Phase-53 fields additive; existing rows read as `static`).

**Authoritative design spec:** `docs/superpowers/specs/2026-07-14-ctf-flag-types-and-form-redesign-design.md` (§ "Admin form redesign (folds in 'A', Slice 1)" and § "Reward reveal (client, Slice 1)").

**Requirements (from ROADMAP):**
- **CTFT-07** — `CtfForm.tsx` redesign per design "A": Name + challenge-type presets (Flat points · First-blood race · Timed drop · Easter egg · Custom) that pre-fill scoring; Answer-type section (Static / Rotating OTP) with per-type controls and, for Static, the Reward → OTP enrollment seed configurator + reveal preview; Scoring window & limits section surfacing per-24h + `perPlayerMax` + `globalMax`; Unlock & chaining section (hidden-until-`unlockAfter`); always-editable Advanced drawer (raw curve/tier/anti-spam/effect knobs, presets pre-fill); live scoring preview mirroring `computePoints`; **remove the dead `Points` field**; answers/secrets masked / write-only / never prefilled in edit mode; plain-language help copy for Ceiling, anti-spam, and the one-award/cadence note; edit-mode type + answer-type inference.
- **CTFT-08** — client `otp-enroll` reward renderer: NEW handler keyed on `effect.kind==="otp-enroll"` from the non-covert solve response: real `otpauth://` QR via `qrcode@^1.5.4` client-side (no new dep), rolling code (previous/current/next + `remainingSeconds` countdown) via `adjacentCodes`, an "Add to Authenticator" `otpauth://` deep-link action, and optional next-flag copy from `effect.nextFlag`; covert path unaffected.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — discuss phase was skipped per user setting. Use the ROADMAP phase goal, success criteria, the authoritative design spec above, and codebase conventions to guide decisions.

### Hard invariants (non-negotiable — from Phase 53 + the design)
- **Covert CSS path (`src/lib/covert-egg.ts`) stays byte-identical** — no reward payload leaks onto the covert channel. Grep/test-verify.
- **No new runtime dependency** — QR uses the existing `qrcode@^1.5.4` already in run.human.
- **Answers/secrets are write-only** — never prefilled to the client when editing an existing flag.
- **Additive only** — no changes to Phase 53 backend contracts; the `effect` shape (`{kind:"otp-enroll", otpauth, nextFlag?}`) is already emitted by 1a on the non-covert solve response.
- **The dead `Points` field is removed** (design decision, replaced by the Ceiling concept).

</decisions>

<code_context>
## Existing Code Insights

Codebase context will be gathered during plan-phase research. Key anchors to locate:
- `apps/run.human/webapp` — the Next.js app; admin CTF form lives under the CTF admin area (`CtfForm.tsx`).
- Phase 53 backend: `src/lib/ctf-flag-types.ts`, `src/lib/ctf-otp.ts` (`adjacentCodes`, `totpAt`, `parseOtpauth`), `src/lib/ctf-judge.ts` (`judgeSolve`, `JudgeResult.effect`), and the non-covert solve API route that surfaces `effect`.
- The solve-response client path: today confetti is boolean-driven (`CtfCelebration.tsx` / `EggTrigger.tsx`) and `effect` never reaches the client — this phase adds the FIRST `effect.kind` dispatch.
- `computePoints` (in `ctf-judge.ts`) — the live scoring preview must mirror it (extract a shared pure helper rather than duplicate).

</code_context>

<specifics>
## Specific Ideas

Refer to the ROADMAP phase description, the 5 success criteria, and the design spec's mock (§1 Answer type, §2 Scoring window & limits, §3 Unlock & chaining, Advanced drawer, Live scoring preview). Testing per the spec's Testing section: preset→Advanced mapping; preview-vs-`computePoints`; edit-mode type/answer-type inference; masked secrets never prefilled; `otp-enroll` renders QR + rolling code.

</specifics>

<deferred>
## Deferred Ideas

- Time-of-day / day-of-week scoring windows → **Slice 2 / Phase 55**.
- Wordlist one-time codes → **Slice 3 / Phase 56**.

</deferred>
