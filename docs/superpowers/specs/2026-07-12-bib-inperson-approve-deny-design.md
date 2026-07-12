# run.bib — In-person Pledge: editable Approve + Deny — Design Spec

**Date:** 2026-07-12
**Author:** Kurt (+ Claude)
**Status:** Approved for planning (design confirmed by user 2026-07-12)
**Branch:** `gsd/bib-reverse-cash-payment` (continues the reverse-cash-payment work)

## Context

The bib admin **Outstanding + in-person** table (`app/admin/page.tsx`) lists two
kinds of rows needing action:

- **pending-intent** (Venmo/Cash App): editable `$amount` + **Approve**
  (`ReconcileAction`) + **Deny** (`DenyPendingAction`).
- **in-person pledge** (`source === "in-person"`, i.e. a bib with
  `willPayInPerson === true && paidAmount === 0`): only a fixed-$20 **PAID**
  button (`MarkPaidAction`).

The organizer wants the in-person pledge row to have the **same controls as the
Venmo rows** — an editable amount, an **Approve** that books the cash, and a
**Deny**. Today an in-person pledge can only be booked at exactly $20 and cannot
be dismissed from the list at all.

## Decisions (locked)

- **Approve = book cash for the entered amount.** Replace the fixed-$20 PAID
  button with an editable dollar field (prefilled `$20.00`) + an **Approve**
  button, booking the entered cents via the existing
  `POST /api/admin/bib/mark-paid` (provider `cash`, idempotent). The mark-paid
  route already validates `amountCents` (`int, positive, ≤ $10,000, default
  2000`) — **no route change**.
- **Deny = soft-clear the pledge** (`willPayInPerson = false`). The row drops off
  Outstanding; the runner keeps their bib, name, and quota, and can re-pledge
  later. This mirrors the "soft drop" feel of the Venmo Deny. It is **NOT** the
  destructive roster Reject (which deletes the bib) — that stays a separate action.
- **Button label:** the in-person primary button becomes **"Approve"**
  (`t("bib.admin.approve")`, already in the CMS catalog) to match the Venmo rows.
- **Scope:** only the in-person branch of the Outstanding table changes. The
  Venmo pending-intent rows, the Payments table, and the roster Reject are
  untouched.

## Design

### Data layer — no new entity function

Reuse the existing `updateBibWillPayInPerson(ownerSub, willPayInPerson)` in
`entities/bib.ts` (patches `willPayInPerson`, throws if the bib is missing).
Deny calls it with `false`. Approve reuses the existing `applyPayment(provider:
"cash")` path via the mark-paid route — no entity change.

### API — `POST /api/admin/bib/deny-pledge` (new)

Admin-gated (`requireBibAdmin`), `runtime="nodejs"`, `force-dynamic`. Body (Zod):
`{ ownerSub: string }`. Calls `updateBibWillPayInPerson(ownerSub, false)`,
returns `{ ok: true }`; 400 invalid body, 401/403 gate, 500 on failure. Must
**not** log the request body/PII (only the error). Structurally mirrors the
`deny-pending` route.

`mark-paid` is unchanged (already accepts an editable `amountCents`).

### UI — `components/AdminActions.tsx`

**`MarkPaidAction` (extend):**
- Add an editable dollar field, prefilled from `amountCents` (default `2000` →
  `"20.00"`), using the **same input markup** as `ReconcileAction` (`$` prefix
  chip, 60px monospace field, digits-and-one-dot filter). On submit, dollars →
  integer cents (`Math.round(Number(value) * 100)`); reject non-finite / `≤ 0`.
- POST the entered cents to `/api/admin/bib/mark-paid` (unchanged contract).
- Relabel the button **PAID → Approve** via `t("bib.admin.approve")`.
- Keep the existing `alreadyBooked` (deduped) and `failText` states.

**`DenyPledgeAction({ apiBase, ownerSub })` (new):**
- Red "Deny" pill behind `window.confirm()`, POSTs `/api/admin/bib/deny-pledge`,
  `router.refresh()` on success, quiet inline failure otherwise.
- Copy **hardcoded** (no CMS catalog key), a structural clone of
  `DenyPendingAction`.

### UI — `app/admin/page.tsx`

The `source === "in-person" && r.ownerSub` branch of the Outstanding table's
Action cell becomes the same inline-flex wrapper the pending-intent branch uses:

```tsx
<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
  <MarkPaidAction apiBase={base} ownerSub={r.ownerSub} amountCents={r.amountCents} />
  <DenyPledgeAction apiBase={base} ownerSub={r.ownerSub} />
</span>
```

Only the in-person branch changes; the pending-intent and fallback branches are
untouched.

## Behavior

- **Approve** → books cash for the entered amount → row leaves Outstanding,
  appears in Payments / revenue (and is reversible via the Remove button shipped
  in the reverse-cash-payment feature).
- **Deny** → `willPayInPerson = false` → row leaves Outstanding; bib, name, and
  quota untouched; runner can re-pledge on a later visit.

## Testing

- Reuse existing coverage for `updateBibWillPayInPerson`; add one focused unit
  test asserting a `false` call patches `willPayInPerson` if not already covered.
- The `deny-pledge` route follows the established no-new-test-harness pattern
  (gate + Zod validation, like `deny-pending`).
- UI components (`MarkPaidAction`, `DenyPledgeAction`) have no tests, consistent
  with the existing admin actions.
- Manual visual verify is auth-gated (needs a signed-in admin session).

## Out of scope

- Any change to the Venmo/Cash App pending-intent flow (`ReconcileAction` /
  `DenyPendingAction` / `reconcile` / `deny-pending`).
- The destructive roster Reject (delete-bib) — Deny here is soft-only.
- Payments table, CSV, and the reverse-cash-payment Remove button.
- Reversing an already-booked cash payment (that is the separate Remove feature).
