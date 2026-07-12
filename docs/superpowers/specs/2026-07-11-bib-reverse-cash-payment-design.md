# run.bib — Reverse a Cash Payment — Design Spec

**Date:** 2026-07-11
**Author:** Kurt (+ Claude)
**Status:** Approved for planning (design confirmed by user 2026-07-11)
**Branch:** `gsd/bib-reverse-cash-payment` (cut from main)

## Context

The bib admin **Payments / revenue** table lists every reconciled payment
(`Bib.paidStatusHistory` rows). Cash payments are booked one-way by the
in-person **PAID** button (`MarkPaidAction` → `/api/admin/bib/mark-paid` →
`applyPayment(provider:"cash")`). There is **no way to undo a mistaken cash
booking**. Concrete case: runner OGRE (`bib-wbbb`) has BOTH a $20 stripe payment
and a mistaken $20 **cash** payment (`2026-07-11T22:01:06`), inflating revenue.

## Decisions (locked)

- **Scope:** reverse **cash only**. Stripe/Venmo/CashApp are NOT reversible from
  this UI — those reflect real external money movement, and reversing only the
  ledger would make the books lie. Enforced in the **data layer**, not just the UI.
- **UX:** a red **Remove** button (behind `confirm()`) on **cash** rows in the
  Payments/revenue table. Removing un-books the cash: subtract its amount from
  `paidAmount` and delete that one `paidStatusHistory` entry.
- **Natural side effect (matches the user's mental model):** if the removed cash
  was the runner's only payment and they still pledged in-person
  (`willPayInPerson`), `paidAmount` drops to 0 and they reappear in **Outstanding
  + in-person** with the PAID button — "back in the approval area". OGRE keeps
  their separate stripe $20, so OGRE stays paid; only the bad cash leaves.
- **Audit tradeoff (accepted):** Remove **deletes** the ledger entry (it vanishes
  from Payments and the cash total drops). No lingering trail that the mistake
  existed — which is what "remove" implies. Soft-hide-with-trail was considered
  and declined for simplicity.

## Design

### Data layer — `reverseCashPayment` (in `entities/bib.ts`)

`reverseCashPayment(ownerSub, { timestamp, reconciledVia }): Promise<{ reversed: boolean; amountCents: number }>`

- Read the bib (`getBib`). If missing → `{ reversed: false, amountCents: 0 }`.
- Find the `paidStatusHistory` entry where `provider === "cash"` **and**
  `timestamp === input.timestamp` **and** `reconciled_via === input.reconciledVia`.
  The `provider === "cash"` clause is the **cash-only guarantee** — a stripe/venmo
  row can never match, regardless of client input.
- No match → `{ reversed: false, amountCents: 0 }` (idempotent — already reversed).
- Match → remove that one entry, `paidAmount = max(0, paidAmount − entry.amount)`,
  write both via a single `Bib.patch({ownerSub}).set({ paidStatusHistory, paidAmount }).go()`.
  Return `{ reversed: true, amountCents: entry.amount }`.

Read-modify-write (not atomic add/remove) is acceptable: this is a rare,
admin-only manual correction with no concurrent writers.

### API — `POST /api/admin/bib/reverse-payment`

Admin-gated (`requireBibAdmin`), `runtime="nodejs"`, `force-dynamic`. Body (Zod):
`{ ownerSub: string, timestamp: string, reconciledVia: string }`. Calls
`reverseCashPayment`, returns `{ ok: true, reversed, amountCents }`; 400 invalid
body, 401/403 gate, 500 on failure. Mirrors the `deny-pending` route.

### Reports — `PaymentRow` (in `lib/admin-reports.ts`)

`PaymentRow` gains optional `ownerSub?: string` and `reconciledVia?: string`,
populated for **bib** rows (from `b.ownerSub` and the history row's
`reconciled_via`). Donation rows leave them undefined. The payments **CSV is
unchanged** — `reportToCsv` uses an explicit column allowlist.

### UI — Payments table (`app/admin/page.tsx`) + `RemoveCashAction` (`components/AdminActions.tsx`)

- New `RemoveCashAction({ apiBase, ownerSub, timestamp, reconciledVia })` — red
  "Remove" button + `window.confirm()`, POSTs `/api/admin/bib/reverse-payment`,
  `router.refresh()` on success. Copy hardcoded (no CMS key). Mirrors
  `DenyPendingAction`/`RejectAction`.
- The Payments/revenue table gains an **"Action"** first column (like Outstanding).
  Only rows with `kind === "bib" && provider === "cash"` (and the ids present)
  render `RemoveCashAction`; every other row's action cell is `""`.

## Testing

- `reverseCashPayment` (mirror `apply-payment.test.ts` electrodb mock):
  removes only the matching cash entry + decrements `paidAmount`, leaving a
  co-existing stripe entry intact; no-op (`reversed:false`, no patch) when the
  timestamp/reconciledVia don't match; a stripe entry with a matching
  timestamp/reconciledVia is NOT reversed (provider guard).
- `buildReports`: bib payment rows carry `ownerSub` + `reconciledVia`; donation
  rows don't.
- Route gate + validation follow the established pattern (no new test harness).

## Out of scope

- Reversing stripe/venmo/cashapp payments.
- Any refund / external money movement (this only edits the internal ledger).
- Payments CSV changes.
- Soft-delete/audit trail for reversed entries.
