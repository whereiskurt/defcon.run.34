---
phase: 34-bib-admin-orderform
plan: 04
subsystem: run.bib orderform (ALTCHA overlay + social-QR render)
tags: [altcha, blur-overlay, in-flight-store, social-qr, bib-preview, tear-off-stub]
requires:
  - lib/social-qr.ts (getSocialQrHash + buildSocialQrUrl — Plan 34-02)
  - solveAltcha(level) client PoW entry (lib/altcha-client.ts)
  - HeroUI Spinner + framer-motion (already installed)
provides:
  - lib/altcha-overlay.ts in-flight counter store (begin/end/subscribe + useAltchaBusy)
  - components/AltchaOverlay.tsx once-mounted blur overlay (mounted in providers.tsx)
  - BibPreview socialQrUrl prop (enlarged tear-off QR, runner-code fallback)
affects:
  - apps/run.bib/webapp/src/lib/{altcha-overlay,altcha-client}.ts
  - apps/run.bib/webapp/src/components/{AltchaOverlay,BibForm,BibPreview,WillPayInPersonCheckbox}.tsx
  - apps/run.bib/webapp/src/app/{providers,orderform/page}.tsx
tech-stack:
  added: []
  patterns:
    - "Module-singleton in-flight COUNT store (mirrors pending-bib-save / rain-store); end() floored at 0"
    - "solveAltcha begin()/end() wrapped in a finally so every PoW caller drives one shared overlay"
    - "Best-effort server-side social-QR resolution → prop-threaded to a print-safe vector QR with a never-blank fallback"
key-files:
  created:
    - apps/run.bib/webapp/src/lib/altcha-overlay.ts
    - apps/run.bib/webapp/src/__tests__/altcha-overlay.test.ts
    - apps/run.bib/webapp/src/components/AltchaOverlay.tsx
  modified:
    - apps/run.bib/webapp/src/lib/altcha-client.ts
    - apps/run.bib/webapp/src/app/providers.tsx
    - apps/run.bib/webapp/src/components/BibForm.tsx
    - apps/run.bib/webapp/src/components/WillPayInPersonCheckbox.tsx
    - apps/run.bib/webapp/src/app/orderform/page.tsx
    - apps/run.bib/webapp/src/components/BibPreview.tsx
decisions:
  - "Overlay uses a COUNT not a boolean so overlapping PoW solves (a checkout flush firing a name-save while a toggle is still resolving) keep the overlay up until the LAST solve returns; end() is floored at 0 so an unbalanced call can never wedge the overlay off."
  - "Kept BibForm's 'Saving…' (PATCH) hint — the overlay only covers the ALTCHA PoW, not the subsequent network write. Only the 'Checking you're human… (~5s)' verifying branch was removed (per SC34.7 remove-list). The checkbox's PoW 'Saving…' hint WAS blanked (explicitly on the remove-list)."
  - "socialQrUrl typed as `string | undefined` (not null) to match React optional-prop threading; orderform maps a null hash to undefined."
  - "GetYourBib needs no code change — it forwards `{...bibForm}` to BibForm, so adding socialQrUrl to BibFormProps threads it automatically (pure pass-through, as the plan intended)."
requirements-completed: [BIB-ADM-07, BIB-ADM-08, BIB-ADM-09]
metrics:
  duration: ~5m
  completed: 2026-07-05
  tasks: 2
  files: 9
status: complete
---

# Phase 34 Plan 04: ALTCHA Blur Overlay + Enlarged Social-QR Render Summary

Replaced every inline "verifying" hint with a single once-mounted HeroUI blur-overlay
Spinner ("Checking you're human…") driven by an in-flight counter inside `solveAltcha`,
and rendered the runner's REAL per-user social-QR (`/r?h=<hash>`) enlarged (76 → 112 SVG
units) on both bib tear-off stubs — with a runner-code fallback so a missing hash never
blanks a stub.

## What Was Built

### Task 1 — ALTCHA in-flight store + blur overlay, inline hints removed (TDD)
- **`lib/altcha-overlay.ts`** (new, module singleton mirroring `pending-bib-save.ts`):
  `begin()` (count++, notify), `end()` (`count = Math.max(0, count-1)`, notify),
  `subscribe(cb)` (returns unsubscribe), and the `useAltchaBusy()` React hook (seeds from
  the live count on mount, then tracks the store). Subscribers are notified with
  `count > 0`.
- **`altcha-client.ts`**: `solveAltcha` now calls `begin()` at entry and `end()` in a
  `finally`, so every caller (BibForm save, pay-in-person toggle, checkout flush) raises
  and dismisses the same shared overlay — even when the solve throws. The returned
  base64 solution contract + `AltchaLevel` are unchanged.
- **`components/AltchaOverlay.tsx`** (new, `"use client"`): subscribes via `useAltchaBusy`;
  while busy it renders a `position:fixed` full-viewport layer — `rgba(10,10,15,0.55)` +
  `backdropFilter: blur(6px)`, `zIndex: 9999` (above CashRain's z-5) — non-dismissable
  (no close affordance, captures pointer events by covering the viewport), with a centered
  mint-tint HeroUI `<Spinner color="success" label="Checking you're human…" />`. A ~150ms
  framer-motion opacity fade is gated by `useReducedMotion()`. Auto-hides at count 0 via
  `AnimatePresence`.
- **`providers.tsx`**: `<AltchaOverlay />` mounted ONCE inside `<HeroUIProvider>` (so the
  Spinner inherits the HeroUI theme); the NextThemes/HeroUI/Session/SilentSSO nesting +
  basePath handling are intact.
- **Inline hint removal (SC34.7):** dropped BibForm `SaveStateHint`'s
  "Checking you're human… (~5s)" verifying branch (kept saved/error/quota/locked/
  rename-count + the "Saving…" PATCH hint); blanked WillPayInPersonCheckbox's PoW
  "Saving…" hint (overlay covers it).
- **Test (`__tests__/altcha-overlay.test.ts`, 4 cases):** 0→1 busy=true / 1→0 busy=false;
  nested begin/begin/end/end stays busy until the final end; `end()` never underflows
  below 0 (a spare `end()` stays not-busy, then 0→1 still flips busy); unsubscribe stops
  notifications. RED (module absent) → GREEN via separate commits.

### Task 2 — Thread social-QR URL + render enlarged stub QR
- **`orderform/page.tsx`** (server): `const socialQrHash = await getSocialQrHash(ownerSub);`
  then `const socialQrUrl = socialQrHash ? buildSocialQrUrl(socialQrHash) : undefined;`
  (`getSocialQrHash` is null-safe — a miss/timeout never 500s the page, T-34-07). Threaded
  down alongside `runnerCode` via the `GetYourBib` `bibForm` object.
- **`BibForm.tsx`**: added `socialQrUrl?: string` pass-through prop → `<BibPreview>`.
  `GetYourBib` forwards it automatically via `{...bibForm}` (no code change there).
- **`BibPreview.tsx`**: added `socialQrUrl?: string`. `stubQrValue = socialQrUrl ||
  runnerCode` — encodes the social-QR when present, else falls back to the runner code so a
  stub is NEVER blank (SC34.8). The two tear-off QRs enlarge `76 → 112` SVG user-units and
  reposition to `x=182 / 642`, `y=582`, sitting fully between each stub's corner smiley
  (left ends x=116 / right ends x=576) and number box (left starts x=360 / right starts
  x=820), clear of the card's bottom border (y=696). The crisp vector `QrBadge` renderer
  (print-safe) is untouched.

## Verification results

- `npx vitest run src/__tests__/altcha-overlay.test.ts` → **4 passed** (increment/decrement,
  nesting, no-negative floor, unsubscribe).
- Full suite `npx vitest run` → **17 files / 169 tests passed** (was 16/165 — +1 file, +4
  new tests, no regressions).
- `npx next build` in `apps/run.bib/webapp` → **green** (`/orderform` server-rendered on
  demand).
- All acceptance greps pass: store exports begin/end/subscribe; client begin()/finally/end();
  overlay `backdrop` + "Checking you're human"; providers mounts AltchaOverlay; BibForm no
  longer has the "Checking you're human… (~5s)" branch (grep count 0); orderform has
  buildSocialQrUrl + getSocialQrHash; BibPreview has socialQrUrl + `size={112}` + stubQrValue.
- All node commands under node v23.6.0.

## Deviations from Plan

None — plan executed as written. Two zero-code observations worth noting (not deviations):
- **GetYourBib** is listed in Task 2's files but needed no edit: it forwards `{...bibForm}`
  to BibForm, so adding `socialQrUrl` to `BibFormProps` + the page's `bibForm` object threads
  it through automatically (the plan explicitly described this as "pure pass-through").
- **BibForm's "Saving…" (PATCH) hint was kept.** SC34.7's remove-list names only the
  "Checking you're human… (~5s)" verifying branch for BibForm; the overlay covers the PoW,
  not the subsequent network PATCH, so the "Saving…" feedback stays honest. The checkbox's
  PoW "Saving…" hint WAS blanked (it is on the remove-list).

## Threat Model Coverage

- **T-34-07** (DoS, orderform SSR hash fetch) — mitigated: `getSocialQrHash` catches all
  errors → null; a null hash yields `socialQrUrl = undefined` and BibPreview renders the
  runner-code QR. A miss/timeout never 500s the page.
- **T-34-10** (Tampering, ALTCHA overlay) — mitigated: the overlay is cosmetic; server-side
  PoW verification is unchanged; the overlay is non-dismissable, so it can't be used to imply
  a client-side bypass.
- **T-34-11** (Info disclosure, printed social-QR) — accepted: the stub QR encodes the same
  public `/r?h=<hash>` value run.human already prints; no new secret surfaced.
- **T-34-SC** (npm installs) — accepted: no new packages (HeroUI Spinner + framer-motion
  already installed).

No new threat surface beyond the register.

## Known Stubs

None. The social-QR fallback (runner-code QR) is intentional resilience per SC34.8, not a
stub — every stub always renders a scannable QR.

## Commits

- `d00eccb5` test(34-04): failing altcha-overlay in-flight store test (RED)
- `ae6c9273` feat(34-04): ALTCHA blur overlay + in-flight store, drop inline verifying text (GREEN)
- `b63d09ac` feat(34-04): thread social-QR URL + render enlarged stub QR with runner-code fallback

## Self-Check: PASSED

- FOUND: apps/run.bib/webapp/src/lib/altcha-overlay.ts
- FOUND: apps/run.bib/webapp/src/__tests__/altcha-overlay.test.ts
- FOUND: apps/run.bib/webapp/src/components/AltchaOverlay.tsx
- FOUND commit: d00eccb5, ae6c9273, b63d09ac (all present in git log)
- vitest (overlay suite + full 169) + `next build` all green under node v23.6.0.
