# run.bib Admin Changes — Design Spec

**Date:** 2026-07-11
**Author:** Kurt (+ Claude)
**Status:** Approved for planning
**Worktree:** `bibreport` (branch `gsd/phase-43-run-human-admin-reporting-dashboard`)

## Context

The run.bib admin dashboard (`apps/run.bib/webapp/src/app/admin/page.tsx`) lets
organizers reconcile payments and export CSVs for the bib printer. Four gaps:

1. Organizers can **approve** a pending Venmo/CashApp payment intent but cannot
   **deny** a fake one in the same place — fake Venmo submissions pile up in the
   Outstanding table with no way to dismiss them.
2. The donation click-limit should be confirmed to exist (it does).
3. The **printed-name-list CSV** — the one uploaded to the bib-number vendor —
   lacks payment type, runner email, and the runner's profile QR URL.
4. Admin access is a single flat `admin` group. We want a granular `bibadmin`
   group gating the bib admin section, plus a new `runadmin` group, with `admin`
   remaining a superuser.

## Authorization model (background)

Groups are free-form strings in a user's `services: string[]` list on their
**AuthProfile** DynamoDB record (`run-auth-electro`, keyed by OIDC sub, email in
GSI1 `$oidc#email_<EMAIL>`). The list flows via OIDC (`services` scope) into
`session.user.services`. Each app gates by `services.includes("admin")`. There is
**no central registry** of group names — adding a group = granting the string to
users + adding a gate check that reads it. Membership changes propagate to a live
session within ~5 min (no redeploy).

## Scope

### 1. Deny a pending Venmo/CashApp intent

The fakes are `PendingContribution` rows (unreconciled Venmo/CashApp intents),
shown in the Outstanding table beside the Approve control (`ReconcileAction`).

**Chosen behavior:** soft-delete (mark rejected, keep the row for audit); the
runner's donation quota stays **consumed** (denying does not refund).

- **Data model** — `apps/run.bib/webapp/src/entities/pending-contribution.ts`:
  add two optional attributes to the `PendingContribution` entity:
  - `deniedAt: string` (ISO8601) — presence marks the intent denied.
  - `deniedBy: string` — admin email that denied it (audit).
- **Helper** — same file: `denyPendingById(pendingId, deniedBy)` using
  `PendingContribution.patch({ pendingId }).set({ deniedAt, deniedBy }).go()`.
  (Patch, not delete — the row survives for audit.)
- **API** — new `apps/run.bib/webapp/src/app/api/admin/bib/deny-pending/route.ts`:
  `POST { pendingId }`, admin-gated via `requireBibAdmin` (see §4), Zod-validated,
  `runtime="nodejs"`, `force-dynamic`. Calls `denyPendingById`. Does **not** touch
  quota. Returns `{ ok: true }`.
- **Reports** — `apps/run.bib/webapp/src/lib/admin-reports.ts`, `buildReports()`:
  exclude rows with `deniedAt` from the **Outstanding** list. Surface a
  `deniedCount` so denied fakes are counted, not silently vanished.
- **UI** — new `DenyPendingAction` component (red button + `window.confirm()`),
  rendered beside `<ReconcileAction>` in the Outstanding table
  (`admin/page.tsx` pending-intent rows). On success → `router.refresh()`.
- The existing `RejectAction` (hard-deletes a whole registration in the
  *registrations* table, `api/admin/bib/reject/route.ts`) is unchanged — different
  purpose (nuke a registration vs dismiss a payment intent).

**Accepted risk (documented, not fixed):** `PendingContribution` uses a
deterministic PK, so a denied spammer who *re-lands on the Venmo handoff page*
would upsert the same `pendingId` via `recordPending`, clearing `deniedAt` and
resurrecting the row. Unlikely for fakes; left as the simple version. If it
becomes a problem, `recordPending` can be made to preserve an existing
`deniedAt`.

### 2. Donation quota — verify only

No code change. The click-limit already exists: `donation` quota = **5** for a
regular runner (`upload` tier), 50 for admins, enforced server-side in
`apps/run.bib/webapp/src/app/api/checkout/general/route.ts` (returns
`429 donation_limit_reached` on the donate click when spent). Limits defined in
`apps/run.auth/webapp/src/lib/quota-definitions.ts`. Deliverable: confirm it's
wired and note the number in the CSV/verification. (Bib purchase is a separate
quota = 2.)

### 3. CSV "printed name list" — 3 new columns

Target: the `print-names` report only (the vendor upload). Other CSVs unchanged.
File: `apps/run.bib/webapp/src/lib/admin-reports.ts`
(`buildReports` print-names block + `reportToCsv` print-names columns), served by
`apps/run.bib/webapp/src/app/api/admin/bib/report/[type]/route.ts`.

New columns appended to the existing `name, runnerCode, paidUsd, printEligible,
nameLocked`:

- **`paymentTypes`** — deduped, joined providers from the bib's
  `paidStatusHistory[].provider`, e.g. `cash+stripe`. Empty if unpaid. Local,
  no network.
- **`email`** — the runner's login email (see enrichment below). Blank on
  lookup failure.
- **`qrUrl`** — `https://run.<SITE_DOMAIN>/<REGION_SHORT>/r?h=<hash>`, built via
  the existing `buildSocialQrUrl(hash)` in
  `apps/run.bib/webapp/src/lib/social-qr.ts`. Blank on lookup failure.

**Cross-app dependency — run.human internal endpoint:**
`email` and `hash` both live in run.human. Extend
`apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts` to **also
return `email`** (it already returns `hash` and already resolves the authjs
`adapterUserId`; read the authjs user record's email by that id). Additive,
`X-Internal-Secret`-gated. **Overlaps the other worktree's run.human work —
coordinate on merge.**

**Enrichment (run.bib side):** for each named bib in the print-names report,
call the internal endpoint (extend the `social-qr.ts` client, or a sibling
`resolveRunnerContact(ownerSub) -> { hash, email }`) to fetch `{ hash, email }`.
Batch with a **concurrency cap (~8)**; on any per-runner failure, emit **blank**
`email`/`qrUrl` cells rather than failing the whole download. Scoped to
print-names so the other three CSVs stay network-free.

### 4. Groups: `bibadmin` + `runadmin`, `admin` as superuser

File: `apps/run.bib/webapp/src/lib/admin-gate.ts`.

- Add `requireBibAdmin(session)` — passes if `services` includes `"bibadmin"`
  **or** `"admin"` (superuser). Same 401/403 shape as `requireAdmin`.
- Swap all bib admin consumers from `requireAdmin` to `requireBibAdmin`:
  `api/admin/bib/*` routes (reconcile, mark-paid, reject, report/[type],
  pledged-unpaid, and the new deny-pending) and the admin page's server-side
  gate.
- Add `requireRunAdmin(session)` — passes if `services` includes `"runadmin"`
  **or** `"admin"`. **Inert for now** (no consumer wired). Reserved for the
  run.human admin dashboard; wiring run.human is out of scope (other worktree).
- Keep generic `requireAdmin`/`isAdmin` for anything not bib-specific.

**Membership grants (operations, applied via AWS profile `dc34-application`,
prod table `run-auth-electro`, us-east-1):**

- Grant `admin`, `bibadmin`, `runadmin` to:
  - `whereiskurt@gmail.com`
  - `jessekrembs@gmail.com` (main account; `+test` excluded)
- **Additive**: read each user's current `services` first, then re-set the full
  existing list **plus** the three groups (the update overwrites the whole
  `services` list, so we must not drop existing services like `run`/`gpx`).
- No lockout risk: `admin` remains a superuser and both users keep `admin`, so
  the gate swap is safe even before `bibadmin` propagates.

## Testing

- Unit: `denyPendingById` sets `deniedAt`/`deniedBy`; `buildReports` excludes
  denied from Outstanding and reports `deniedCount`; `paymentTypes` join
  (dedupe, multi-provider, empty); `qrUrl` build from a hash.
- Enrichment: mocked internal-client test — success returns `{hash,email}` →
  populated cells; failure → blank cells, download still succeeds.
- Gate: `requireBibAdmin`/`requireRunAdmin` truth table (bibadmin-only,
  admin-only superuser, neither → 403, no session → 401).
- Manual: deny a pending intent in the dashboard → disappears from Outstanding,
  count increments; download print-names CSV → new columns present.

## Out of scope / accepted

- Changing the donation quota number (stays 5 unless requested).
- Wiring `runadmin` into run.human's admin gate (other worktree).
- Fixing the deny "resurrect on refresh" edge (documented above).
- Email/QR enrichment on the other three CSV reports.

## Rollout ordering

1. run.human internal endpoint returns `email` (deploy first so run.bib
   enrichment has data; blank-on-failure means run.bib is safe if it lags).
2. run.bib code (deny, CSV columns, gate swap).
3. Apply membership grants via `dc34-application` (can happen any time; superuser
   `admin` prevents lockout).
