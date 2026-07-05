# Roadmap: v1.8 Bib Admin, Orderform UX & Social QR

**Workstream:** v1-8-bib-admin
**Scope:** `apps/run.bib/` + one additive change to `apps/run.human/` (internal user endpoint returns `hash`)
**Created:** 2026-07-04
**Base branch:** origin/main (each phase branches off fresh per `phase_branch_template`)
**Design contract:** `DESIGN.md` (this dir) → spec `docs/superpowers/specs/2026-07-04-bib-admin-and-orderform-design.md`

## Milestone Goal

Tighten the run.bib organizer + runner experience: make the admin dashboard truthful
and actionable (no phantom registrations; approve pending Venmo/Cash App payments and
reject/reset a runner's bib inline), make the orderform's save/pledge UX unmistakable,
and print the runner's real social QR on the bib.

## Phases

- [x] **Phase 34: Bib admin, orderform UX & social QR** — single combined phase (completed 2026-07-05)
  (Kurt's choice, 2026-07-04) delivering slices A (admin), B (orderform UX), and
  C (social QR) below. Reqs: BIB-ADM-01…10. **Plans:** 5 plans.

### Phase 34: Bib admin, orderform UX & social QR

**Goal:** Make the run.bib admin dashboard truthful and actionable (filter phantom
registrations; inline reconcile of pending Venmo/Cash App intents; inline reject/reset
of a runner's bib), make the orderform's save/pledge UX unmistakable (responsive
checkbox placement, loud unsaved state, hardened implicit save, ALTCHA blur overlay),
and print the runner's real social QR on the bib tear-offs with a runner-code fallback.

**Depends on:** None (branches off origin/main)

**Requirements:** BIB-ADM-01, BIB-ADM-02, BIB-ADM-03, BIB-ADM-04, BIB-ADM-05, BIB-ADM-06, BIB-ADM-07, BIB-ADM-08, BIB-ADM-09, BIB-ADM-10

**Success Criteria:** SC34.1–SC34.9 (see "Success Criteria (Phase 34)" below)

**Plans:** 5/5 plans complete

Plans:
**Wave 1**

- [x] 34-01-PLAN.md — Slice A: filter phantom bibs + reconcile/reject routes + admin inline actions (wave 1)
- [x] 34-02-PLAN.md — Slice C backend: run.human endpoint returns hash + run.bib social-qr lib (wave 1)
- [x] 34-03-PLAN.md — Slice B core: responsive checkbox + rain bridge, loud unsaved state, implicit-save hardening (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 34-04-PLAN.md — Slice B/C: ALTCHA blur overlay + threaded/enlarged social QR render (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 34-05-PLAN.md — Header/menu alignment with run.human (flash-style menu, ?open deep-links) (wave 3)

**UI hint:** yes (orderform + bib preview are frontend; `/admin` stays plain dark-theme)

## Success Criteria (Phase 34)

**Slice A — Admin reporting (`apps/run.bib/webapp/src/app/admin` + `src/lib/admin-reports.ts` + new `src/app/api/admin/bib/{reconcile,reject}/route.ts`)**

- **SC34.1** `admin-reports.ts` gains `isRegistered(bib)` = has name OR paidAmount>0 OR
  willPayInPerson; `totals.bibs` and the "All registrations" roster count/show only
  registered bibs. Empty visit-created bibs no longer appear. Unit-tested in the
  existing admin-reports vitest suite.

- **SC34.2** `POST /api/admin/bib/reconcile` (admin-gated via `requireAdmin`) reconciles
  a pending intent: bib-kind → `applyPayment`, donation-kind → `recordDonation`,
  idempotent by `reconciled_via: admin_manual_<pendingId>`, then clears the pending row.
  The Outstanding table's pending-intent rows expose an inline Approve action with an
  editable (prefilled) amount; on success the dashboard refreshes.

- **SC34.3** `POST /api/admin/bib/reject` (admin-gated) deletes the bib + that owner's
  pending intents and resets the `bibname_change` quota to full (via quota `restore`
  of `totalConsumed`); donations are untouched. The roster exposes a Reject action with
  a confirm step; on success the dashboard refreshes.

**Slice B — Orderform UX (`apps/run.bib/webapp/src/app/orderform/page.tsx`, `BibForm`, `BibPreview`, `WillPayInPersonCheckbox`, `GetYourBib`, `providers.tsx`, `altcha-client.ts`)**

- **SC34.4** The "$20 in person" checkbox renders **between** Sponsor and Donate on
  mobile and **full-width below both** on desktop (Tailwind responsive utilities).
  Checking it still hides the Sponsor tile; the cash-rain over the bib preview still
  fires (bridged via a small shared client store).

- **SC34.5** An unsaved name change makes the Save button glow + enlarge, and renders an
  "UNSAVED" stamp on the bib preview in the same slot as `PAID! THANK YOU!`
  (new `dirty` prop to `BibPreview`); UNSAVED outranks PAID while dirty.

- **SC34.6** Clicking Sponsor or Donate reliably commits the current bib name before
  checkout (harden the existing `flushPendingBibName`), for both `bib` and `general`
  variants.

- **SC34.7** ALTCHA proof-of-work shows a once-mounted HeroUI blur-overlay Spinner
  ("Checking you're human…") driven by an in-flight counter in `solveAltcha`, auto-
  dismissing on resolve; the inline "verifying" text is removed from `BibForm` and the
  checkbox. Overlay store is unit-tested (increment/decrement).

**Slice C — Social QR (`apps/run.bib` orderform → `BibPreview`; `apps/run.human` internal endpoint)**

- **SC34.8** `apps/run.human` internal user endpoint
  (`src/app/api/internal/user/[oidcSub]/route.ts`) additively returns `hash`. run.bib's
  orderform server component fetches it (service-discovery pattern like `quota-client`),
  builds `https://run.<SITE_DOMAIN>/<REGION_SHORT>/r?h=<hash>`, threads it to
  `BibPreview`, which renders it as an **enlarged** crisp vector QR on both tear-off
  stubs. When the runner has no `hash`, fall back to the current runner-code QR.

**Gate — quality**

- **SC34.9** `next build` + vitest pass in `apps/run.bib/webapp`; `apps/run.human`
  still builds after the endpoint change. Each slice verified in the running app before
  the phase closes.

## Requirements (BIB-ADM-01 … 09)

Enumerated in `DESIGN.md`; each maps 1:1 to the success criteria above.

## Non-goals

- Un-owned receipt-email (`BibReconcile`) matching UI.
- A hard quota "reset" endpoint in run.auth (reuse `restore`).
- Re-skinning the `/admin` dashboard to HeroUI/Vegas.
