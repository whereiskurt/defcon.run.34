---
phase: 34-bib-admin-orderform
plan: 03
subsystem: run.bib orderform UX
tags: [orderform, responsive, cash-rain, unsaved-state, implicit-save, altcha-flush]
requires:
  - pending-bib-save bridge (registerBibFlusher / flushPendingBibName)
  - CashRain overlay + globals.css cash-rain keyframes
provides:
  - lib/rain-store.ts singleton (setRaining / subscribe / getRaining)
  - BibPreview dirty prop (UNSAVED rubber stamp, outranks PAID)
  - performSponsorCheckout(args, deps) testable checkout flow (flush-before-checkout)
affects:
  - apps/run.bib/webapp/src/app/orderform/page.tsx
  - apps/run.bib/webapp/src/components/{BibForm,BibPreview,SponsorForm,GetYourBib,WillPayInPersonCheckbox}.tsx
tech-stack:
  added: []
  patterns:
    - Module-singleton event store mirroring pending-bib-save (rain-store)
    - Dependency-injected pure async flow so DOM-coupled logic is node-testable without jsdom
    - Tailwind order utilities for a responsive between/below reflow
key-files:
  created:
    - apps/run.bib/webapp/src/lib/rain-store.ts
  modified:
    - apps/run.bib/webapp/src/app/orderform/page.tsx
    - apps/run.bib/webapp/src/components/GetYourBib.tsx
    - apps/run.bib/webapp/src/components/WillPayInPersonCheckbox.tsx
    - apps/run.bib/webapp/src/components/BibForm.tsx
    - apps/run.bib/webapp/src/components/BibPreview.tsx
    - apps/run.bib/webapp/src/components/SponsorForm.tsx
    - apps/run.bib/webapp/src/styles/globals.css
    - apps/run.bib/webapp/src/__tests__/bib-preview.test.tsx
    - apps/run.bib/webapp/src/__tests__/sponsor-form.test.ts
key-decisions:
  - "Renamed BibForm's reactive `raining` prop to a one-shot `initialRaining` seed; live rain state now flows from the rain-store subscription. Preserves load-time cash-rain for an already-pledged bib without re-lifting state."
  - "Extracted performSponsorCheckout (dependency-injected) to make the flush-before-checkout ordering unit-testable in the node vitest env (project has no jsdom). Endpoints + provider routing unchanged."
requirements-completed: [BIB-ADM-04, BIB-ADM-05, BIB-ADM-06, BIB-ADM-09]
coverage:
  - deliverable: "Responsive checkbox placement (between on mobile, full-width below on desktop) + cash-rain bridge across the new component boundary (SC34.4)"
    verification:
      - kind: build
        ref: "cd apps/run.bib/webapp && npx next build"
        status: pass
      - kind: grep
        ref: "order-2 sm:order-3 sm:col-span-2 + grid gap-5 sm:grid-cols-2 in orderform/page.tsx; setRaining wiring"
        status: pass
    human_judgment: true
    rationale: "The responsive reflow (checkbox visually BETWEEN tiles on mobile vs FULL-WIDTH BELOW on desktop) and the cash-rain firing over the preview are visual/interaction behaviors no unit test asserts — needs a resize + toggle in the running app."
  - deliverable: "Loud unsaved state — UNSAVED stamp outranks PAID while dirty (SC34.5)"
    verification:
      - kind: tests
        ref: "src/__tests__/bib-preview.test.tsx#renders the UNSAVED stamp and suppresses PAID while dirty"
        status: pass
    human_judgment: false
  - deliverable: "Save button glow + enlarge when the name is dirty (SC34.5)"
    verification:
      - kind: build
        ref: "next build green; .bib-save-dirty ring + gated pulse in globals.css; dirty-driven padding/font in BibForm"
        status: pass
    human_judgment: true
    rationale: "The glow ring, enlarge, and reduced-motion-gated pulse are visual affordances best confirmed by eye in the running app."
  - deliverable: "Hardened implicit save-on-checkout — flush awaited before checkout for both bib + general variants (SC34.6)"
    verification:
      - kind: tests
        ref: "src/__tests__/sponsor-form.test.ts#performSponsorCheckout — implicit save before checkout"
        status: pass
    human_judgment: false
duration: ~35 min
completed: 2026-07-04
---

# Phase 34 Plan 03: Orderform UX (responsive checkbox, loud unsaved state, hardened implicit save) Summary

Moved the "$20 in person" checkbox into a responsive Tailwind tile grid (between the
Sponsor/Donate tiles on mobile, full-width below on desktop), bridged its cash-rain across
the new component boundary via a `rain-store` singleton, made the unsaved-name state loud
(mint Save glow/enlarge + a red-orange UNSAVED rubber stamp that outranks PAID), and
hardened the implicit save-on-checkout into a single dependency-injected flow that unit-tests
the flush-before-checkout ordering for both the bib and general variants.

## Accomplishments

- **Cash-rain bridge (`lib/rain-store.ts`).** New client singleton mirroring
  `pending-bib-save.ts`: `setRaining(v)` / `subscribe(cb)` / `getRaining()`. The checkbox
  pushes its checked state; `BibForm` subscribes and threads the value into `<CashRain>`.
- **Responsive tile grid (`orderform/page.tsx`).** Replaced the old `hideBuyBib` ternary
  with a single `grid gap-5 sm:grid-cols-2` wrapper. DOM order Sponsor → checkbox → Donate;
  explicit `order` utilities (`order-1 sm:order-1`, checkbox `order-2 sm:order-3 sm:col-span-2`,
  Donate `order-3 sm:order-2`) yield the between-on-mobile / below-on-desktop reflow. Tiles
  keep their inline styles; only the wrapper is Tailwind. `hideBuyBib` still hides the Sponsor
  tile when checked (decision 5); the "paying in person — reserved" note and big THANK YOU are
  preserved.
- **Thin `GetYourBib`.** Dropped the local `raining` useState and the `showCheckbox` prop; it
  is now just a client boundary around `BibForm`.
- **Loud unsaved state.** `BibForm` glows (mint `#6CCDB8` ring) and enlarges the Save button
  while dirty (pulse gated by `prefers-reduced-motion` in `globals.css`); passes `dirty` to
  `BibPreview`. `BibPreview` renders a red-orange (`#C2410C`) UNSAVED rubber stamp in the same
  `rotate(-11 806 208)` slot as PAID and suppresses the PAID group while dirty — an unsaved
  name can never read as a paid bib.
- **Hardened implicit save.** Extracted `performSponsorCheckout(args, deps)` — awaits
  `flushPendingBibName()` before any checkout side-effect (Stripe fetch or Venmo/Cash App
  handoff), variant-agnostic. `onSubmit` routes through it; `clampRange` now delegates to a
  shared `clampForVariant`. Endpoints and provider routing are unchanged.

## Verification results

- `npx vitest run src/__tests__/bib-preview.test.tsx src/__tests__/sponsor-form.test.ts` → 26 passed.
- Full suite `npx vitest run` → 16 files / 165 tests passed (no regressions).
- `npx next build` in `apps/run.bib/webapp` → green.
- All node commands under node v23.6.0.

## Deviations from Plan

Two within-scope design decisions (both explicitly sanctioned by the plan); no bug fixes and
no scope changes.

**1. [Rule 3 - Blocking] `initialRaining` seed prop on `BibForm`**
- **Found during:** Task 1.
- **Issue:** Dropping `GetYourBib`'s lifted `raining` state loses the load-time cash-rain for
  a bib whose `willPayInPerson` pledge is already `true` on server render.
- **Fix:** Renamed the reactive `raining` prop to a one-shot `initialRaining` seed; `BibForm`
  seeds local state from it and then tracks the rain-store subscription. Preserves the original
  on-load behavior without re-lifting state.
- **Files:** `BibForm.tsx`, `GetYourBib.tsx`, `orderform/page.tsx`.
- **Commit:** d62a137f.

**2. [Rule 3 - Blocking] Extracted `performSponsorCheckout` for node-testable ordering**
- **Found during:** Task 3.
- **Issue:** The plan requires a unit test asserting the flush is awaited before checkout for
  both variants, but the project's vitest env is node-only (no jsdom) so the client component
  cannot be rendered to exercise `onSubmit`.
- **Fix:** Extracted the flow into a pure, dependency-injected `performSponsorCheckout(args, deps)`
  (flush → clamp → provider/Stripe dispatch). `onSubmit` calls it with the real `fetch` /
  `router.push` / `window.location` deps. Behavior, endpoints (`checkoutEndpointFor`), and
  provider routes (`providerRouteFor`) are byte-for-byte unchanged; the test injects mocks and
  asserts call order.
- **Files:** `SponsorForm.tsx`, `sponsor-form.test.ts`.
- **Commit:** 62a356f2.

**Total deviations:** 2 (both blocking-issue design choices to satisfy plan intent). **Impact:**
none negative — original runtime behavior preserved, testability improved.

## Commits

- `d62a137f` feat(34-03): responsive in-person checkbox + cash-rain bridge
- `38c33c14` feat(34-03): loud unsaved state — Save glow + UNSAVED stamp
- `62a356f2` feat(34-03): harden implicit save-on-checkout + unit-test flush ordering

## Known Stubs

None.

## Next

Wave 2 / Plan 04 (ALTCHA blur overlay + social-QR render) also touches these shared orderform
files — this plan intentionally landed first to avoid concurrent edits. Ready for 34-04.

## Self-Check: PASSED
- `apps/run.bib/webapp/src/lib/rain-store.ts` exists on disk.
- Commits d62a137f, 38c33c14, 62a356f2 present in `git log`.
- All task acceptance-criteria greps re-run PASS; both plan test suites + `next build` green.
