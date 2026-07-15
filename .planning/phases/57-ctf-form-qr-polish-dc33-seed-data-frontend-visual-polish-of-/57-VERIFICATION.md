---
phase: 57-ctf-form-qr-polish-dc33-seed-data
verified: 2026-07-15T18:50:46Z
status: human_needed
score: 4/5 must-haves verified (code + automated tests); 1 human-only (real-authenticator QR scan)
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Open the admin CtfForm (auth-gated /admin/qr → create/edit a challenge) in BOTH light and dark app themes."
    expected: "Active challenge-type segment shows an accent selection glow; challenge-type descriptors read on a second line; the Live scoring preview renders as bordered stat tiles; the timed-drop/window note is amber; NO raw near-black mockup panels leak (colors track the rest of /admin); text is AA-legible in both themes."
    why_human: "Cross-theme visual legibility/aesthetics and 'no raw darks leaked' are subjective visual judgments behind an auth-gated admin route; grep only proves the underlying preset/preview logic is untouched and the correct HeroUI tokens are applied."
  - test: "Trigger a credited otp-enroll solve so the reward reveal renders (goldstein → goldstein-otp path, or the admin reveal preview in CtfForm); scan the rendered enrollment QR with a REAL Google Authenticator / Authy install; also view the dark reveal card while the app is in LIGHT theme."
    expected: "The QR enrolls and produces a working rolling 6-digit code that matches the on-screen cyan hero code; the bespoke-dark card renders full-dark and legible over a light-theme device; the countdown bar shrinks smoothly as the period ticks."
    why_human: "A real-authenticator scan (CTFP-03 HARD ship gate) cannot be automated — only a live scan proves the restyle did not invert/degrade the QR modules. qr.toDataURL params are confirmed byte-identical (strong static evidence), but the scan itself is human-only."
---

# Phase 57: CTF Form/QR Polish + DC33 Seed Data — Verification Report

**Phase Goal:** Close the visual gap between the shipped v2.3 CTF surfaces and Kurt's mockups, and give admins deletable DC33 starter flags — all additive polish/data with NO judge, scoring, entity, API, or covert-channel changes.
**Verified:** 2026-07-15T18:50:46Z
**Status:** human_needed
**Re-verification:** No — initial verification (after the CR-01 blocker fix landed)

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Admin `CtfForm` matches the mockup polish (segment glow + two-line labels, stat-tile scoring preview, framed QR); presets/live preview/`ctf_upsert` payload/validation/edit-mode inference behave exactly as before (unit tests green) | ✓ VERIFIED (code) + human visual | `qr-ui.ts`: `segmentActive` = `bg-primary/10 border-primary ring-1 ring-inset ring-primary/40` (glow), new `segmentStacked` two-line token, `cls.label` mono/uppercase. `CtfForm.tsx`: `PRESET_DESC`/`ANSWER_DESC` descriptor maps, stat tiles (`font-mono tabular-nums text-[20px] text-primary`), amber note (`text-secondary`). `ctf-form-model.test.ts` 40/40 green → preset/preview/payload logic untouched. Light+dark visual is a human gate (see human_verification #1). |
| SC2 | Player OTP reveal renders full bespoke-dark (rolling-code hero + prev/next, gradient progress-ring countdown, "Add to Authenticator"/copy, chain line) with all prior behavior intact (rolling codes advance, algo-unsupported note, unparseable no-op, a11y announcement) | ✓ VERIFIED | `CtfOtpEnroll.tsx`: `✓ Correct — {flagName} solved` header (fallback `✓ Correct`), cyan `fontSize:40` hero + 12px prev/next flanks, `role="progressbar"` fill `linear-gradient(90deg,#38bdf8,#4ade80)` width=remaining/period (no new timer), full-width mint `＋ Add to Authenticator`, conditional `🔗 This unlocks: {nextFlag}`. Preserved verbatim: `parseOtpauth`, `adjacentCodesAsync`, `isSupportedAlgorithm` fallback, `if(!parsed) return null` no-op, `aria-live`/`aria-hidden`. `ctf-otp-enroll.test.ts` (9) + `ctf-otp-client.test.ts` (44) green. |
| SC3 | The enrollment QR scans successfully in a real authenticator (Google Authenticator / Authy) and enrolls a working rolling code — proving the restyle did not invert/degrade the QR | ? UNCERTAIN (human-only gate) | `qr.toDataURL(otpauth,{width:220,margin:2,errorCorrectionLevel:"M",color:{light:"#ffffff",dark:"#000000"}})` confirmed byte-identical to the D2 contract; polish is an OUTER glow + border on the white quiet-zone wrapper only, modules/pupils untouched. Strong static evidence the QR is unchanged, but the actual real-authenticator scan is an un-automatable HARD ship gate → human_verification #2. |
| SC4 | `seed-ctf.mts --confirm` loads six real DC33 starters (`enabled:false`), the goldstein→goldstein-otp chain + each flag type present, answers verify against the judge under prod salt, idempotent, each deletable via the existing admin Delete button; DRY-RUN writes nothing | ✓ VERIFIED | Live DRY-RUN composed all 6 rows (`$run#challenge_<name>`/`$ctf_1` + `__edb_e__=Ctf`/`__edb_v__=1`), every row `enabled:false`, chain present (goldstein `effect.nextFlag=goldstein-otp`; goldstein-otp `answerType:otp` + `unlockAfter:goldstein`), grace-hopper `timeTiers[ceiling:500]`, wrote nothing offline. **CR-01 FIX CONFIRMED:** no `points` field; every row sets `pointMax`/`pointFloor`/`maxSolves`/`firstBloodBonus`; `ctf-seed-rows.test.ts` 17/17 green including first-solver `computePoints` parity (goldstein 100, mudge 1250, turing 10, grace-hopper 100 outside/500 inside). Seeded rows are ordinary `Ctf` rows → deletable via unchanged `ctf_delete`. Prod `--confirm` run is a deferred operator step, not code verification. |
| SC5 | No judge, scoring, `Ctf`/ledger entity, `/api/admin/qr`, or covert-CSS (`covert-egg.ts`) code changed — diff confined to form/reveal styling, the seed script, and its tests | ✓ VERIFIED | `git diff --name-only 110270ea..HEAD` (non-planning) returns exactly 7 files: `seed-ctf.mts`, `ClaimClient.tsx`, `CtfForm.tsx`, `qr-ui.ts`, `CtfOtpEnroll.tsx`, `ctf-seed-rows.ts`, `ctf-seed-rows.test.ts`. No `ctf-judge.ts`, `ctf-scoring.ts`, `qr.ts` entity, `/api/admin/qr`, or `covert-egg.ts` touched. |

**Score:** 4/5 truths verified in code + automated tests (SC1, SC2, SC4, SC5); SC3 is a human-only real-authenticator scan gate.

### CR-01 Blocker — Fix Verification

The code review found a Critical defect (CR-01): 5 of 6 seed rows populated the legacy `points` field the judge ignores and omitted `maxSolves`, so `computePoints` returned 0 for the first solver. **The fix landed and is verified:**

- `ctf-seed-rows.ts` no longer carries any `points` field (the `CtfSeedRow` type comment explicitly documents why). Every scoring row sets `pointMax`/`pointFloor`/`maxSolves`/`firstBloodBonus` (commit `826a393d`).
- `ctf-seed-rows.test.ts` adds a "first-solver award parity through the judge's scorer" block that runs each row through the SAME `computePoints` the judge uses and asserts non-zero intended awards (goldstein 100, goldstein-otp 100, condor 100, mudge 1250, turing 10, grace-hopper 100 outside / 500 inside window) — closing the masking gap where the old test asserted the ignored `points` field.
- Full run green: `ctf-seed-rows.test.ts` 17/17, `ctf-scoring.test.ts` 14/14.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/components/admin/qr-ui.ts` | Restyled cls tokens (glow, two-line, mono label) | ✓ VERIFIED | `segmentActive`/`segmentStacked`/`segmentIdle` + mono `label` present; consumed by CtfForm. |
| `src/components/admin/CtfForm.tsx` | Two-line segments, stat tiles, amber note | ✓ VERIFIED | `PRESET_DESC`/`ANSWER_DESC`, stat-tile row, amber `text-secondary` note; `previewPoints` calls unchanged. |
| `src/components/ctf/CtfOtpEnroll.tsx` | Bespoke-dark reveal, framed unchanged QR | ✓ VERIFIED | Cyan hero, gradient progressbar, mint CTA, chain callout; `qr.toDataURL` params byte-identical. |
| `src/app/(ctf)/ctf/claim/ClaimClient.tsx` | Tightened solved-branch card | ✓ VERIFIED | Solved-branch framing tightened; `asOtpEnrollEffect`, capped/not-solved/signin branches + nonce effects unchanged. |
| `src/lib/ctf-seed-rows.ts` | Pure `buildSeedRows()` 6 starters | ✓ VERIFIED | Import-pure (hashAnswer only), 6 rows, real scoring knobs, all `enabled:false`, no plaintext answers. |
| `src/lib/__tests__/ctf-seed-rows.test.ts` | Unit test incl. scoring parity | ✓ VERIFIED | 17/17 green; asserts scoring knobs + `computePoints` first-solver awards. |
| `scripts/seed-ctf.mts` | Raw-SDK DRY-RUN/--confirm/--remove | ✓ VERIFIED | Raw `DynamoDBDocument`, DRY-RUN default, region-guard, WR-01 live-counter preserve, WR-02 `--remove` gated behind `--confirm`. |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| `qr-ui.ts` cls tokens | `CtfForm.tsx` segments/tiles/labels | `segmentActive`/`segmentStacked` consumed | ✓ WIRED |
| `hashAnswer` (ctf-hash.ts) | seed row `answerHash` | salted SHA-256 on each static/flat/race/timed/easter row | ✓ WIRED |
| `buildSeedRows()` | `seed-ctf.mts` | relative import, no logic duplicated, key-composition added in script | ✓ WIRED |
| `Ctf` entity key shape | composed raw pk/sk in seed-ctf.mts | `$run#challenge_<name>`/`$ctf_1` + `__edb_e__`/`__edb_v__` (parity via `qr-key-parity.test.ts`) | ✓ WIRED |
| `adjacentCodesAsync` | rolling-code hero + prev/next flanks | `codes.previous/current/next` (unchanged call) | ✓ WIRED |
| `remaining/period` state | progress-bar width | `role=progressbar` fill, no new timer | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase test suites green | `vitest run` (5 CTF suites) | 124/124 passed | ✓ PASS |
| Seed builder awards >0 (CR-01) | `computePoints(1, …)` parity tests | goldstein 100, mudge 1250, turing 10, grace-hopper 100/500 | ✓ PASS |
| Seed DRY-RUN writes nothing offline | `RUN_DYNAMODB_REGION=us-east-1 tsx scripts/seed-ctf.mts` | 6 rows composed, all enabled:false, "wrote nothing" | ✓ PASS |
| Diff scope confined (SC5) | `git diff --name-only 110270ea..HEAD` | exactly 7 expected files | ✓ PASS |
| Real-authenticator QR scan | (manual) | — | ? SKIP (human gate) |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| CTFP-01 (CtfForm restyle within HeroUI tokens, zero preset/payload/validation change) | 57-01 | ✓ SATISFIED (code) / human visual | Tokens present, `ctf-form-model` 40/40 green; light/dark visual → human_verification #1 |
| CTFP-02 (OTP reveal + ClaimClient bespoke-dark, all logic preserved) | 57-02 | ✓ SATISFIED | Restyle tokens + preserved logic; otp tests 53/53 green |
| CTFP-03 (QR-scannability guard — params unchanged, verified scannable) | 57-02 | ? NEEDS HUMAN | `toDataURL` params byte-identical (static PASS); real scan → human_verification #2 |
| CTFP-04 (seed-ctf.mts six DC33 rows, hashed, idempotent, enabled:false, unit-tested) | 57-03 | ✓ SATISFIED | DRY-RUN + 17 tests green; CR-01 scoring fix landed; WR-01/WR-02 hardening landed |

### Anti-Patterns Found

None blocking. Deferred-but-tracked items (see 57-FOLLOWUPS.md): WR-03 (CtfForm create-path can save a blank-secret OTP flag — pre-existing form/judge-validation gap, not introduced by this restyle), IN-01 (`ctf_pending` cookie lacks SameSite/Secure — pre-existing ported behavior), IN-03 (seed script hardcodes ElectroDB key format — mitigated by DRY-RUN parity print + `qr-key-parity.test.ts`). All are explicitly logged as out-of-restyle-scope follow-ups and none block the phase goal.

### Human Verification Required

See the two `human_verification` items in frontmatter:
1. **Surface A light + dark visual sign-off** (57-01 checkpoint) — auth-gated admin route, subjective cross-theme legibility.
2. **Real-authenticator QR scan** (57-02 / CTFP-03 HARD ship gate) — un-automatable; qr.toDataURL params confirmed unchanged so static evidence is strong, but a live scan is required before ship.

### Gaps Summary

No gaps. The one Critical blocker (CR-01) surfaced by code review was fixed in-phase and is verified: seed rows now emit the real scoring knobs (`pointMax`/`pointFloor`/`maxSolves`) so `computePoints` awards the intended points to the first solver, proven by a parity test that exercises the judge's scorer. All 124 CTF unit tests pass, the seed DRY-RUN writes nothing offline while composing all six `enabled:false` rows with correct keys and the goldstein→goldstein-otp chain, and the git diff is confined to exactly the seven expected restyle/seed/test files (SC5). The phase goal is achieved in code; the only outstanding items are two legitimate human ship-gates (cross-theme visual polish + real-authenticator QR scan) that cannot be verified programmatically — hence `human_needed`, not `gaps_found`.

---

_Verified: 2026-07-15T18:50:46Z_
_Verifier: Claude (gsd-verifier)_
