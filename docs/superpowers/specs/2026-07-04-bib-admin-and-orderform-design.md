# run.bib — Admin Reporting + Orderform UX + Social QR

**Date:** 2026-07-04
**Author:** Kurt (whereiskurt) with Claude
**Branch:** `gsd/bib-admin-orderform-refresh`
**Status:** Design — pending approval

## Overview

Three independent slices of work on `apps/run.bib`:

- **A. Admin reporting** (`/admin`) — stop counting empty visit-created bibs as
  registrations; add inline reconcile of pending Venmo/Cash App payments; add a
  "reject bib" admin action that clears a runner's bib + resets their quota.
- **B. Orderform UX** — responsive placement of the in-person checkbox; a loud
  "unsaved" state; reliable implicit-save on Sponsor/Donate; a blur-overlay
  spinner during the ALTCHA proof-of-work.
- **C. Social QR** — render the runner's real per-user social QR (the run.human
  profile "Show My QR" value) on the bib, bigger, instead of the runner-code QR.

Each slice lands and is reviewed independently. Suggested order: A → B → C.

---

## A. Admin reporting

### A1. Filter empty (unregistered) bibs

**Problem.** A `Bib` row is created the instant *anyone visits* `/orderform`
(`orderform/page.tsx` bootstrap `createBib`). An empty bib — no name, `$0`, no
pledge — therefore counts as a "registration." This is the phantom
"1 registration with name `—`" in the admin dashboard, and toggling
pay-in-person on/off leaves such an empty row behind.

**Fix.** In `src/lib/admin-reports.ts`, add a predicate:

```ts
// A bib is a real registration once the runner has done SOMETHING with it.
export function isRegistered(b: BibItem): boolean {
  const hasName = (b.nameOnBib ?? "").trim().length > 0;
  const hasPaid = (b.paidAmount ?? 0) > 0;
  const pledged = b.willPayInPerson === true;
  return hasName || hasPaid || pledged;
}
```

Apply `isRegistered` when shaping reports in `buildReports()`:
- `totals.bibs` counts only registered bibs (phantom empty bibs excluded).
- `totals.inPersonPledges` / `registrations` roster already imply a name or a
  pledge, but filter the roster to `isRegistered` so a bare empty bib never
  shows as a `—` row.
- `printNames` and `outstanding` already filter (named / pledged / pending), so
  no change needed there.

**Name attribution.** With the filter, a pay-in-person pledge *is* a real
registration and shows in the roster with whatever name is saved. If a runner
pledged without ever saving a name, the roster correctly shows the pledge with a
blank name — the deeper "name didn't save" fragility is addressed at the source
by **B2** (loud unsaved state) and **B3** (implicit save).

**Tests.** Unit-test `isRegistered` + the filtered totals/roster in the existing
`admin-reports` vitest suite (pure function, no AWS).

### A2. Reconcile pending intents inline

**Goal.** From the *Outstanding + in-person* table, an admin approves a pending
Venmo/Cash App intent and it credits the runner immediately.

**Scope (locked):** pending intents only — the `PendingContribution` rows that
already carry an `ownerSub`. Matching un-owned inbound receipt emails
(`BibReconcile`) is explicitly out of scope for this slice.

**New route:** `POST /api/admin/bib/reconcile` (admin-gated via `requireAdmin`).

Request body:
```ts
{
  pendingId: string;     // the PendingContribution PK (idempotency anchor)
  ownerSub: string;      // owner to credit
  kind: "bib" | "donation";
  provider: "venmo" | "cashapp";
  amountCents: number;   // admin-editable; prefilled from the intent
}
```

Handler:
1. `requireAdmin(session)` → 401/403 on failure.
2. Validate body (zod). Clamp `amountCents` to a sane floor (> 0).
3. `kind === "bib"` → `applyPayment(ownerSub, { provider, amount_cents,
   reconciled_via: `admin_manual_${pendingId}` })`. Idempotent by
   `reconciled_via`, so a double-click never double-credits.
   `kind === "donation"` → `recordDonation({ ownerSub, provider, amountCents,
   reconciled_via: `admin_manual_${pendingId}` })` (verify `recordDonation`
   signature during implementation; it exists in `general-donation.ts`).
4. `clearPendingForOwner(ownerSub, kind, provider)` (best-effort — `applyPayment`
   already does this for venmo/cashapp, but call defensively for donation-kind).
5. Return the updated total / 200.

**UI.** `/admin` is a server component. Add a client component
`ReconcileRow` (or an inline `<ReconcileAction>`) rendered in the pending-intent
rows of the Outstanding table: an editable amount input (prefilled), an
**Approve** button that POSTs, then `router.refresh()`. Non-pending outstanding
rows (in-person pledges, un-owned receipts) render as they do today with no
action.

### A3. Reject bib

**Goal.** An admin rejects a runner's bib: delete the record and reset their
quota so the runner starts fresh (a later visit auto-creates a clean bib).

**New route:** `POST /api/admin/bib/reject` (admin-gated).

Request body: `{ ownerSub: string }`.

Handler:
1. `requireAdmin(session)` → 401/403.
2. `Bib.delete({ ownerSub }).go()` — removes the bib (and its
   `paidStatusHistory`).
3. Delete that owner's pending intents: `listPendingForOwner(ownerSub)` →
   delete each (or reuse `clearPendingForOwner` for both kind/provider buckets).
4. Reset the `bibname_change` quota to full. run.auth exposes only `restore`
   (adds an amount), not a hard reset, so: `getUserQuotas(ownerSub)` → find the
   `bibname_change` quota → `restoreQuota(ownerSub, "bibname_change",
   totalConsumed)` to bring `remaining` back to `initialAmount`. Best-effort —
   a quota-service blip must not fail the delete (log + continue).
5. **Keep donations** (locked decision) — real money that was collected; not
   touched by reject.
6. Return 200.

**UI.** Add a client **Reject** action to each row of the "All registrations"
roster with a confirm step (browser `confirm()` or a HeroUI confirm modal),
then `router.refresh()`.

**Idempotency / safety.** Deleting an already-deleted bib is a no-op success.
The confirm step guards against fat-finger rejects.

---

## B. Orderform UX

### B1. Responsive in-person checkbox placement

**Current.** The `WillPayInPersonCheckbox` lives inside `GetYourBib`, directly
under the bib form. Checking it sets `willPayInPerson=true` → `hideBuyBib` →
the Sponsor tile is hidden.

**Target.**
- **Mobile** (tiles stacked, single column): checkbox sits **between** the
  Sponsor and Donate tiles → *Sponsor → checkbox → Donate*.
- **Desktop** (tiles side-by-side): checkbox sits **full-width below both** →
  *Sponsor | Donate*, checkbox spanning underneath.
- **Hide-Sponsor behavior retained (locked):** once checked, the Sponsor tile
  disappears, leaving *checkbox → Donate* (mobile) or *Donate* with the checkbox
  below (desktop).

**Implementation.** Move the checkbox out of `GetYourBib` and render it in the
tiles region of `orderform/page.tsx`. Breakpoints can't be expressed with inline
styles, so this region uses **Tailwind responsive utilities** (Tailwind 4 is in
the stack). DOM order: `Sponsor → checkbox → Donate`. A responsive grid/flex
container flips the checkbox to a full-width bottom row at `sm+`
(e.g. checkbox `order-2 sm:order-3 sm:col-span-2` within an
`sm:grid-cols-2` grid). Exact classes finalized in the plan.

**Cash-rain bridge.** The checkbox drives `CashRain` over the bib preview (in
`GetYourBib`). Now that the two are no longer siblings, bridge them with a tiny
client store (same pattern as `pending-bib-save.ts`): the checkbox publishes its
checked state; the bib preview subscribes and rains cash accordingly.

### B2. Loud unsaved state

**Goal.** Make an unsaved name change unmissable.

- **Save button** (in `BibForm`): when `dirty`, add a glow (box-shadow ring in
  the mint accent `#6CCDB8`) and enlarge it. Reverts to the normal state when
  clean / after save.
- **Bib preview stamp:** pass a new `dirty` prop to `BibPreview`. When `dirty`,
  render an **"UNSAVED"** rotated rubber-stamp in the same slot as the existing
  `PAID! THANK YOU!` stamp (`BibPreview.tsx` sponsor-charm group), styled amber/
  red to read as "attention."
- **Priority:** if `dirty` *and* `hasSponsored`, **UNSAVED wins** while editing;
  the PAID stamp returns after the name is saved.

### B3. Implicit save on Sponsor / Donate

**Current.** Already wired: `BibForm` registers a flusher
(`registerBibFlusher`), `SponsorForm.onSubmit` calls `flushPendingBibName()`
before checkout. Verify it (a) reliably awaits the ALTCHA + PATCH before the
checkout redirect, (b) fires for both `variant="bib"` and `variant="general"`,
and (c) surfaces save state / the blur overlay (B4). No new mechanism — harden
the existing one. Together with the explicit Save button this is the "couple of
save options."

### B4. "Checking for human" blur overlay

**Goal.** Replace the inline "Checking you're human… (~5s)" text with a
HeroUI-style blur-overlay spinner popup that appears during ALTCHA proof-of-work
and auto-dismisses when it resolves.

- **Chokepoint:** every PoW call goes through `solveAltcha()`
  (`src/lib/altcha-client.ts`) — used by `BibForm` save, the pay-in-person
  toggle, and the Sponsor/Donate flush. Instrument it there so all three sites
  get the overlay for free.
- **Store:** a tiny in-flight counter store (same shape as `pending-bib-save`):
  `solveAltcha` increments on entry, decrements in a `finally`. Overlay visible
  while count > 0.
- **Overlay component:** mounted once in `Providers`. A fixed, full-viewport,
  dimmed + `backdrop-filter: blur(...)` layer with a centered HeroUI `Spinner`
  labelled **"Checking you're human…"**. Non-dismissable; it disappears when PoW
  completes. (HeroUI `@heroui/react` + `framer-motion` are available.)
- **Remove** the `verifying` inline text from `BibForm`'s `SaveStateHint` and the
  checkbox hint. Keep the other states (Saved / error / quota / rename count).

---

## C. Social QR on the bib

**Goal.** Render the runner's real per-user **social QR** — the same value as
run.human's profile "Show My QR" — on the bib tear-off stubs, bigger, instead of
the current `BIB-XXXX` runner-code QR.

**The value.** run.human encodes
`https://run.<SITE_DOMAIN>/<REGION_SHORT>/r?h=<hash>`, where `hash` is a random,
per-user SHA256 stored on the `RunUser` DynamoDB entity (`run-human-electro`
table) and pre-rendered into an `eqr` PNG data URL. It is **not** derivable from
session claims (it depends on a random `seed` held only by run.human).

**Access.** run.bib runs against the same `run-human-electro` table but should
not duplicate run.human's `RunUser` key schema. Instead:
- **Extend run.human's internal endpoint** `GET /api/internal/user/[oidcSub]`
  to also return `hash` (it currently returns only MQTT fields). Additive,
  low-risk change to run.human.
- In `orderform/page.tsx` (server component), fetch the `hash` for
  `session.user.id` via service discovery (mirror the internal-URL + secret
  pattern in `quota-client.ts`), build the `https://run.<domain>/<region>/r?h=`
  URL from run.bib's own env (`SITE_DOMAIN`, `REGION_SHORT`), and thread it down
  through `GetYourBib → BibForm → BibPreview`.

**Render.** In `BibPreview`, replace the two runner-code `QrBadge`s with the
social-QR URL, re-encoded as crisp vector QR via the existing `QrBadge` helper,
**enlarged** (~76 → ~112px) for a fully-renderable look. Reposition the stubs as
needed to fit the larger badge.

**Fallback.** If the runner has no `RunUser`/`hash` yet (never visited
run.human), fall back to the current runner-code QR so the bib never renders a
blank stub.

---

## Non-goals

- Matching un-owned inbound receipt emails (`BibReconcile`) to runners in the
  admin UI — a later slice.
- A hard quota "reset" endpoint in run.auth — reuse `restore` for now.
- Re-skinning the `/admin` dashboard to the HeroUI/Vegas design system — the
  admin dashboard stays plain dark-theme; only the runner-facing orderform gets
  UX work here.

## Testing strategy

- **A:** vitest for `isRegistered` + filtered report shaping (pure). Route-level
  tests for reconcile/reject with mocked entities + quota client.
- **B:** unit-test the ALTCHA overlay store (increment/decrement). Manual verify
  the responsive layout, unsaved stamp/glow, and overlay in the running app.
- **C:** manual verify the QR resolves to the same `/r?h=` target as run.human's
  profile QR; unit-test the URL builder + fallback selection.
- Run the app (`/run`) to confirm each slice end-to-end before committing.
