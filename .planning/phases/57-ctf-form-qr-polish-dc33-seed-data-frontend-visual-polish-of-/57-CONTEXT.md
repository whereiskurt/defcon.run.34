# Phase 57: CTF Form/QR Polish + DC33 Seed Data - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning
**Mode:** Brainstormed with Kurt (design spec approved), captured here for planning.

<domain>
## Phase Boundary

Additive polish + starter data over the shipped v2.3 CTF surfaces. **In scope:** restyle the admin `CtfForm`, restyle the player OTP reward reveal (`CtfOtpEnroll` + `ClaimClient` solved-branch), and add `scripts/seed-ctf.mts`. **Out of scope (must NOT change):** the judge (`ctf-judge.ts`), scoring (`ctf-scoring.ts`), the `Ctf`/`CtfSolve`/`CtfScoreEvent`/`CtfCode` entities, `/api/admin/qr` route + `upsertCtf`/`ctfAttributes`, and the covert CSS channel (`covert-egg.ts`, `ctf-covert-*`). The `ctf_upsert`/`ctf_delete` payloads and `computePoints` are frozen.

Full design: `docs/superpowers/specs/2026-07-15-ctf-form-qr-polish-dc33-seed-design.md`.
</domain>

<decisions>
## Implementation Decisions (locked with Kurt)

### D1 — Visual fidelity: **Hybrid** (Kurt, 2026-07-15)
- **Admin form (Slice A):** adopt the mockup's *structure polish* but stay in the existing **HeroUI tokens** (`cls` from `@/components/admin/qr-ui`). It must keep matching the rest of `/admin` — do NOT introduce the mockup's raw `#0b0d10` dark palette here. Restyle only: segment selection glow, two-line type labels, stat-tile live-scoring preview, framed QR, mono uppercase labels, tighter card rhythm. The form already HAS the structure (segmented picker, `presetToAdvanced`, `previewPoints`, Advanced drawer) — this is restyle, not rebuild.
- **Player OTP reveal (Slice B):** go **full bespoke-dark** — it's a standalone dramatic moment, so it commits to a scoped dark palette regardless of the viewer's app theme. Rolling-code hero (mono tabular-nums ~40px), prev/next flanks, **gradient progress-ring** countdown (replacing the plain "New code in Ns" line), "✓ Correct — {name} solved" header, "＋ Add to Authenticator" accent button, cyan "🔗 This unlocks: {nextFlag}" callout.

### D2 — QR scannability guard (HARD constraint)
The mockup's QR is a FAKE dark-inverted canvas. The REAL enrollment QR MUST stay **dark modules on a light/white quiet-zone** — keep `qr.toDataURL(otpauth, {color:{light:"#ffffff",dark:"#000000"}, errorCorrectionLevel:"M", margin:2})` unchanged. Polish is **framing only** (rounded border, optional soft OUTER glow around the white card) — never recolor modules, never restyle pupils, never invert. **Ship gate:** scan the rendered QR in a real Google Authenticator / Authy install and confirm a working rolling code before merge. (Same trap as `project_runner_qr_card` / `project_qr_sheet_designer`.)

### D3 — Seed data: **curated set of six REAL DC33 flags** (Kurt, 2026-07-15)
Source real data from `~/working/meshtk/meshtk.bak.yaml` (each persona has a static flag code in its system prompt + a real `OtpUrl` TOTP seed). One flag per type, all `enabled:false`, deletable via the existing admin Delete button (no new delete UI — `ctf_delete` already exists):
- `goldstein` — static, answer `hackers4evr`; `effect:{kind:"otp-enroll", otpauth:"otpauth://totp/Emmanuel%20Goldstein?secret=GZRGQNKGKN4DINQ&issuer=Defcon.run&algorithm=SHA1&digits=6&period=120", nextFlag:"goldstein-otp"}`; flat 100.
- `goldstein-otp` — `answerType:"otp"`, `otp:{secret:"GZRGQNKGKN4DINQ",digits:6,period:120,algorithm:"SHA1",skew:1}`, `unlockAfter:"goldstein"`, `perPlayerIntervalHours:24`.
- `mudge` — first-blood race, answer `0g3l33t`; pointMax 1000/floor 100/maxSolves 100/firstBloodBonus 250.
- `condor` — flat, answer `fr33k3v1n`; award 100.
- `grace-hopper` — timed drop, answer `d3bugth3sYstem`; base pointMax 100/floor 1 + timeTier DEF CON 34 window ceiling 500.
- `turing` — easter egg, answer `3n1gim@`; award 10 + `effect:{kind:"confetti",intensity:11}`.
Anti-spam default on all: maxAttempts 5, rateLimitWindow 60.

### D4 — Seed script shape
Mirror `scripts/reset-ctf-user.mts`: raw `DynamoDBDocument` (NOT the ESM entities), rows written by their own composed `Ctf` pk/sk, **DRY-RUN by default**, `--confirm` to write, `--remove` to bulk-delete the seeded set, SSO-cred fallback (default AWS provider chain), same env contract. Hash answers via `import { hashAnswer } from "@/lib/ctf-hash"` (crypto-only, tsx-safe). Idempotent by challenge name. Factor a pure row-builder for unit tests.

### D5 — Delete UI already exists
`CtfForm` has a working Delete button (`ctf_delete` action). No new delete UI needed — seeded rows are removable as-is.
</decisions>

<code_context>
## Existing Code Insights (verified 2026-07-15)

- **`src/components/admin/CtfForm.tsx`** (1111 lines) — already has: segmented "Challenge type" control (`cls.segment`/`cls.segmentActive`/`cls.segmentIdle`), preset pre-fill (`presetToAdvanced`), answer-type segments, collapsible Advanced drawer, "Live scoring preview" (`previewPoints`), one-award note, and `onDelete`/`ctf_delete`. Slice A restyles these; it adds no structure.
- **`src/components/admin/qr-ui.ts`** — the `cls` token layer (HeroUI). Slice A tweaks tokens here + Tailwind in `CtfForm`.
- **`src/components/ctf/CtfOtpEnroll.tsx`** — the reward card. QR via `qr.toDataURL` (dark-on-white, EC "M"); rolling codes via `adjacentCodesAsync` (`codes.previous/current/next` + `remaining`/`period`); algo-unsupported fallback (WR-02); silent no-op on unparseable; `aria-live` roll announcement; `nextFlag` prop. Preserve ALL of this.
- **`src/app/(ctf)/ctf/claim/ClaimClient.tsx`** — mounts `CtfOtpEnroll` on the credited-solve branch (`result.solved && result.points>0`, `effect` narrowed by `asOtpEnrollEffect`). Slice B also tightens the solved-branch success card.
- **`src/entities/qr.ts` `Ctf` entity** — fields the seed writes: `answer`(legacy)/`answerHash`, `pointMax`/`pointFloor`/`maxSolves`/`firstBloodBonus`, `answerType`(static|otp|wordlist), `otp{secret,digits,period,algorithm,skew}`, `unlockAfter`(prereq NAME), `perPlayerIntervalHours`/`perPlayerMax`/`globalMax`, `scoreWindow{days,from,to,tz}`, `timeTiers[{from,to,ceiling}]`, `effect`(any), `maxAttempts`/`rateLimitWindow`, `enabled`, `solveCount`.
- **`src/lib/ctf-hash.ts`** — `hashAnswer(raw)` = salted SHA-256 of trim+lowercased answer; salt from `CTF_ANSWER_SALT` (default `dc34-ctf-answer-salt-v1`). **Seed run MUST use prod's salt or hashes won't verify.**
- **`scripts/reset-ctf-user.mts`** — the raw-SDK/DRY-RUN/SSO-cred pattern to mirror for `seed-ctf.mts`.
- **`~/working/meshtk/meshtk.bak.yaml`** — real DC33 persona data (codes + `OtpUrl` seeds). Goldstein's real seed == the mockup's.

## Landmines
- vitest needs Node ≥22.12 (`nvm use 23.6.0`).
- Prod `.env` points at localhost:8888 — for a prod seed run, use `AWS_PROFILE=dc34-application` and do NOT `--env-file` the localhost `.env` (or override the endpoint). Confirm `Ctf` pk/sk shape against a real row before a prod `--confirm`.
- Full-dark reveal over a light-theme device: verify contrast/legibility.
</code_context>

<specifics>
## Specific Ideas
- Slice C: `--remove` companion is convenience; UI Delete is the primary removal path.
- The broader DC33 persona pool (Gene Sharp, Ada Lovelace, Gibson, Darknet…) exists in `meshtk.bak.yaml` if more than six starters are wanted later.
- Progress ring drives width from existing `remaining/period` — no new timing logic.
</specifics>

<deferred>
## Deferred Ideas
- Admin unsolve/delete-a-solve UI (separate idea — `project_ctf_admin_unsolve_ui`), NOT this phase.
- Sourcing DC33 data from prod DynamoDB (rejected in favor of meshtk.bak.yaml + curated set).
</deferred>
