# CTF Form/QR Polish + DC33 Seed Data — Design

**Date:** 2026-07-15
**Status:** Draft (awaiting Kurt review)
**Scope:** Frontend visual polish of the shipped v2.3 CTF admin form + player OTP reward reveal, plus a DC33 starter-data seed script. **No** data-model, judge, API, or scoring changes.
**Author:** Kurt + Claude
**Branch / worktree:** `gsd/ctf-admin-form-clarity` (this `ctf-form-clarity` worktree)
**Related:** `project_ctf_flag_types_milestone` (v2.3 shipped), `project_ctf_polish_dc33_seed` (this NEXT-UP), `project_runner_qr_card` + `project_qr_sheet_designer` (styled-QR landmines), the two mockup artifacts:
- Form: `claude.ai/code/artifact/6c9b79cb-91ba-4062-8288-0ce8b134d740`
- Flag-types / OTP reveal: `claude.ai/code/artifact/b8d84bac-422d-488f-ba3a-2fd0570aacc3`

---

## Problem

v2.3 shipped LIVE (run.human v0.0.65). It matches the mockups' **structure** but not their **polished look** — Phase 54's UI-SPEC deliberately reused existing HeroUI admin tokens rather than pixel-matching the demo artifacts. Kurt: *"not exactly like the mockups — get the QRs and other elements looking nicer, and have last year's DC33 data for starts, which I could delete from the UI."* Two gaps:

1. **Visual polish** — the admin form and the player OTP reward reveal work but look plain vs. the bespoke dark "terminal" mockups.
2. **No starter data** — an admin opening `/admin/qr/ctf` sees an empty list; there is no DC33 CTF data in the repo to demonstrate the flag types.

Both are additive polish/data; neither touches the judge, scoring, entities, or the covert channel.

## Goals / Non-Goals

**Goals**
- Admin form *looks* like the mockup while staying inside HeroUI tokens (consistent with the rest of `/admin`).
- Player OTP reward reveal adopts the mockup's full bespoke-dark treatment (a standalone dramatic moment).
- The reward QR stays **scannable in a real authenticator app** (Google Authenticator / Authy).
- A `seed-ctf.mts` script loads real DC33 flags as deletable starters covering every flag type.

**Non-Goals**
- No judge / scoring / entity / API / covert-channel changes. The `ctf_upsert` payload, `computePoints`, and all judge gates are untouched.
- No new npm dependencies.
- No new admin delete UI — challenge delete already exists (`ctf_delete` action + Delete button in `CtfForm`).
- Not re-adding form *structure* — the segmented type picker, presets, live preview, and Advanced drawer already shipped. This is restyle only.

## Fidelity decision (Kurt, 2026-07-15)

**Hybrid.** Admin form → mockup structure in HeroUI tokens (no theme clash with `/admin`). Player claim reveal → full bespoke-dark, self-contained (commits to dark regardless of the viewer's app theme).

---

## Slice A — Admin form visual polish (within HeroUI)

**Files:** `apps/run.human/webapp/src/components/admin/CtfForm.tsx`, `apps/run.human/webapp/src/components/admin/qr-ui.ts` (the `cls` token layer).

The shipped form already has: segmented "Challenge type" control (`cls.segment` / `cls.segmentActive` / `cls.segmentIdle`), preset pre-fill (`presetToAdvanced`), the answer-type segments, a collapsible Advanced drawer, and a "Live scoring preview" section (`previewPoints`). **This slice changes only presentation** — no field, payload, or logic change.

Restyle work, all via `cls` tokens / Tailwind in-theme (no raw `#0b0d10` darks — use theme/accent tokens so light + dark both read well):
- **Segmented type picker** → mockup's selected state: accent border + soft inner glow; two-line label (name + one-line descriptor, e.g. *"Everyone earns the same"*, *"Early solvers earn more"*).
- **Live scoring preview** → mockup's stat-tile row: mono `tabular-nums` values, tiny uppercase keys ("1st solver" / "50th" / "100th"), a subtly tinted/gradient container; the timed-drop window note styled as the amber callout.
- **Framed QR** on the answer-type/OTP surface (if the form renders one) → rounded border + quiet-zone card.
- Card rhythm, mono uppercase labels, and `code`-chip help text to match the mockup's density.

**No** change to: presets, `previewPoints`, the `ctf_upsert` payload, validation, or edit-mode inference.

## Slice B — Player OTP reward reveal (full bespoke-dark)

**Files:** `apps/run.human/webapp/src/components/ctf/CtfOtpEnroll.tsx`, `apps/run.human/webapp/src/app/(ctf)/ctf/claim/ClaimClient.tsx` (the solved-branch success card that mounts `CtfOtpEnroll` on the credited-solve path).

Restyle `CtfOtpEnroll` (and tighten the surrounding success card) to the flag-types mockup's reveal — a **self-contained dark card** (its own scoped palette; renders dark over either app theme):
- **Rolling-code hero** — big mono `tabular-nums` current code (~40px, cyan), prev/next flanking it (keep the existing `codes.previous/current/next`).
- **Progress ring** — a gradient countdown bar replacing today's plain *"New code in Ns"* line (drive width from the existing `remaining`/`period`).
- Header *"✓ Correct — {name} solved"*; primary **"＋ Add to Authenticator"** accent button; existing "Copy setup link"; cyan *"🔗 This unlocks: {nextFlag}"* chain callout (keep the `nextFlag` prop).
- Keep every existing behavior: `parseOtpauth`, `adjacentCodesAsync`, the algorithm-unsupported fallback note (WR-02), silent no-op on unparseable seed, and the `aria-live` code-roll announcement.

### ⚠️ QR scannability guard (the landmine)

The mockup's QR is a **fake, dark-inverted illustrative canvas** (hash-seeded random dots on `#0b1219` with cyan modules). A real authenticator QR **must be dark modules on a light quiet-zone** — inverted / low-contrast / restyled-pupil QRs fail to scan (the exact trap `project_runner_qr_card` and `project_qr_sheet_designer` hit). Therefore:
- Keep `qr.toDataURL(...)` rendering the **real** `otpauth://` with **dark-on-white** (unchanged colors, `errorCorrectionLevel:"M"`, white quiet-zone).
- Polish is **framing only**: keep the white quiet-zone card, add a rounded border and (optionally) a soft *outer* glow around the frame — never touch module colors or pupils.
- **Ship gate:** scan the rendered QR with a real Google Authenticator / Authy install and confirm enrollment + a rolling code before merge.

## Slice C — DC33 seed loader

**New file:** `apps/run.human/webapp/scripts/seed-ctf.mts`, mirroring `scripts/reset-ctf-user.mts`:
- Raw `DynamoDBDocument` client (not the ESM entities); rows written by their composed `Ctf` pk/sk (`pk = "$run#challenge_<name>"`-style — read the exact key shape from an existing `Ctf` row or compose via the same key rule the app uses; **verify against a real row before writing prod**).
- **DRY-RUN by default**; `--confirm` to write; `--remove` to bulk-delete the seeded set (convenience — the admin UI Delete button also works).
- SSO-cred fallback (default AWS provider chain when `RUN_ELECTRO_ID/SECRET` absent), same env contract as `reset-ctf-user.mts`.
- Answers hashed via **`import { hashAnswer } from "@/lib/ctf-hash"`** (dependency-free `crypto` module — safe under `tsx`). **CRITICAL:** the run must use the **same `CTF_ANSWER_SALT` as prod** or the seeded `answerHash` won't verify (default `dc34-ctf-answer-salt-v1`; source prod's value from `.env`/SSM if overridden).
- Idempotent: keyed by challenge name; a re-run upserts (put) the same rows.
- All rows seeded **`enabled: false`** — inert until an admin flips them on; each is deletable via the existing Delete button.

**Starter set — real DC33 flags** (sourced from `~/working/meshtk/meshtk.bak.yaml`: each persona has a static flag code embedded in its system prompt and a real `OtpUrl` TOTP seed). Six flags, one per type:

| name | type | fields |
|---|---|---|
| `goldstein` | static + **OTP reward** | `answer: hackers4evr`; `effect: { kind:"otp-enroll", otpauth:"otpauth://totp/Emmanuel%20Goldstein?secret=GZRGQNKGKN4DINQ&issuer=Defcon.run&algorithm=SHA1&digits=6&period=120", nextFlag:"goldstein-otp" }`; flat 100 |
| `goldstein-otp` | rotating OTP (chained) | `answerType:"otp"`, `otp:{ secret:"GZRGQNKGKN4DINQ", digits:6, period:120, algorithm:"SHA1", skew:1 }`, `unlockAfter:"goldstein"`, `perPlayerIntervalHours:24` (daily) |
| `mudge` | first-blood race | `answer: 0g3l33t`; `pointMax:1000, pointFloor:100, maxSolves:100, firstBloodBonus:250` |
| `condor` | flat points | `answer: fr33k3v1n`; `pointMax:100, pointFloor:100, maxSolves:100000` |
| `grace-hopper` | timed drop | `answer: d3bugth3sYstem`; base `pointMax:100, pointFloor:1`, `timeTiers:[{ from,to = DEF CON 34 window, ceiling:500 }]` |
| `turing` | easter egg | `answer: 3n1gim@`; flat 10 + `effect:{ kind:"confetti", intensity:11 }` |

Notes:
- The real Goldstein `OtpUrl` in `meshtk.bak.yaml` is byte-identical to the mockup's, so the chain seed is authentic.
- Answers normalize (trim + lowercase) before hashing — the judge normalizes identically on verify, so mixed-case source codes (`d3bugth3sYstem`) stay consistent.
- Anti-spam default on all: `maxAttempts:5, rateLimitWindow:60`.
- The full pool of DC33 personas (Gene Sharp, Ada Lovelace, Gibson, Darknet, …) exists in `meshtk.bak.yaml` if Kurt later wants more than six.

## Data flow (unchanged)

- Admin form → `postQrAction({ action:"ctf_upsert", ctf })` → `POST /api/admin/qr` → `upsertCtf` → `ctfAttributes` (hashes answer) → `Ctf`. Slice A only restyles the surface.
- Claim → judge → `result.effect` narrowed by `asOtpEnrollEffect` → `CtfOtpEnroll`. Slice B only restyles the reveal.
- Seed script writes `Ctf` rows directly (raw SDK), hashing answers with the shared `ctf-hash` salt. Read only for `--remove`.

## Testing

- **A:** existing preset / preview unit tests stay green (`ctf-scoring`, form preset tests); verify visually via `PORT=3001 npm run dev` + screenshot of each type.
- **B:** existing `ctf-otp-enroll` / `ctf-otp-client` tests stay green; optionally add a ring-width render assertion. **Manual authenticator scan is the ship gate.**
- **C:** factor the row-builder as a pure function and unit-test each starter → documented `Ctf` fields (incl. the goldstein→goldstein-otp chain and the timed-drop tier). Then: dry-run (prints rows) → `--confirm` against local DynamoDB (`:8888`) → verify in `/admin/qr/ctf` → prod.
- Node ≥ 22.12 for vitest (`nvm use 23.6.0`) per `reference_node_version_for_bib_tests`.

## Rollout

Branch `gsd/ctf-admin-form-clarity` (this worktree) → PR → review → run.human release (buildpub run.human use1 → bump → deploy.yml us-east-1, `pr_number=skip`). Seed script run manually post-deploy against prod (`AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/seed-ctf.mts` → dry-run → `--confirm`). No infra or data migration.

## Risks / landmines

1. **QR inversion breaks scanning** — mitigated by Slice B's guard (dark-on-white only; frame, never recolor; authenticator ship-gate).
2. **Salt mismatch** — seed `answerHash` won't verify unless the script uses prod's `CTF_ANSWER_SALT`. Documented in the script header + this spec.
3. **`Ctf` key composition** — the seed script writes raw rows; confirm the exact `pk/sk` shape against a real `Ctf` row (or the app's key rule) before a prod `--confirm`, to avoid entity-key drift.
4. **Full-dark reveal over light theme** — Slice B commits to dark; verify legibility/contrast on a light-theme device.
