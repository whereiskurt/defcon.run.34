---
phase: 34-bib-admin-orderform
reviewed: 2026-07-04T00:00:00Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - apps/run.bib/webapp/src/app/api/admin/bib/reconcile/route.ts
  - apps/run.bib/webapp/src/app/api/admin/bib/reject/route.ts
  - apps/run.bib/webapp/src/app/admin/page.tsx
  - apps/run.bib/webapp/src/app/orderform/page.tsx
  - apps/run.bib/webapp/src/app/providers.tsx
  - apps/run.bib/webapp/src/components/AdminActions.tsx
  - apps/run.bib/webapp/src/components/AltchaOverlay.tsx
  - apps/run.bib/webapp/src/components/BibForm.tsx
  - apps/run.bib/webapp/src/components/BibPreview.tsx
  - apps/run.bib/webapp/src/components/GetYourBib.tsx
  - apps/run.bib/webapp/src/components/SponsorForm.tsx
  - apps/run.bib/webapp/src/components/WillPayInPersonCheckbox.tsx
  - apps/run.bib/webapp/src/components/header.tsx
  - apps/run.bib/webapp/src/components/menu-dropdown.tsx
  - apps/run.bib/webapp/src/components/user-dropdown.tsx
  - apps/run.bib/webapp/src/lib/admin-reports.ts
  - apps/run.bib/webapp/src/lib/altcha-client.ts
  - apps/run.bib/webapp/src/lib/altcha-overlay.ts
  - apps/run.bib/webapp/src/lib/rain-store.ts
  - apps/run.bib/webapp/src/lib/run-human-url.ts
  - apps/run.bib/webapp/src/lib/social-qr.ts
  - apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts
findings:
  critical: 0
  warning: 2
  info: 4
  total: 6
status: clean
---

# Phase 34: Code Review Report

**Reviewed:** 2026-07-04
**Depth:** standard
**Files Reviewed:** 22
**Status:** resolved — all 6 findings fixed (see 34-fix commits)

## Summary

Reviewed the three Phase 34 slices: the two new admin routes (reconcile / reject),
the admin UI actions, the admin-reports filter, the cross-app social-QR fetch (run.bib
→ run.human internal endpoint), the client-store singletons (rain-store, altcha-overlay),
and the orderform React components + dropdowns. I traced call contracts into
`entities/bib.ts`, `entities/general-donation.ts`, `entities/pending-contribution.ts`,
`lib/quota-client.ts`, and the run.auth `restoreQuota` service to verify the money and
quota paths.

The security-critical surfaces hold up well:

- **Auth gating** — both admin routes call `requireAdmin(await auth())` at the very top
  before any body parse or mutation; 401/403 split is correct. No bypass path.
- **Reject preserves donations** — `Bib.delete` + `clearPendingForOwner` (pending
  intents only) + isolated quota restore. The `GeneralDonation` ledger is never touched.
  Confirmed the quota restore is idempotent and safe against repeated reject: run.auth's
  `restoreQuota` caps `remaining` at `initialAmount` and decrements `totalConsumed`
  (`Math.max(0, totalConsumed - amount)`), so a double-reject can neither over-credit nor
  overflow the cap.
- **Cross-app fetch** — `getSocialQrHash` catches all errors → null → runner-code
  fallback (never 500s the orderform, never blanks a stub). The run.human endpoint adds
  only `hash` (a public `/r?h=` value) and does not serialize `seed`/`rsaprivSHA`. Secret
  is header-only, host is fixed (no SSRF).
- **Client stores** — the altcha in-flight counter floors at 0 (no underflow/wedge);
  `useAltchaBusy` seeds from the live count on mount; subscriptions return unsubscribers
  used in effect cleanup. No leaks.

No blockers found. Two warnings concern money-handling UX correctness and a stale-flag
cosmetic bug; four info items are defensive hardening.

## Warnings

### WR-01: Reconcile amount is editable but idempotency ignores it — corrections silently no-op

**Status:** fixed (fd447a28)

**File:** `apps/run.bib/webapp/src/app/api/admin/bib/reconcile/route.ts:60-86`, `apps/run.bib/webapp/src/components/AdminActions.tsx:44-78`

**Issue:** The admin UI prefills and lets the organizer *edit* the amount
(`ReconcileAction` holds an editable cents field — locked decision 3, "admin-editable").
But the write is idempotent on the pending intent id only:
- `kind==="bib"` → `applyPayment(..., reconciled_via = admin_manual_<pendingId>)` short-circuits
  when the marker already exists in `paidStatusHistory` (`entities/bib.ts:283-288`).
- `kind==="donation"` → `recordDonation({ donationId: admin_manual_<pendingId> })` collides on
  the PK and reads back the *existing* row (`entities/general-donation.ts:162-191`).

`pendingId` is deterministic and embeds the *original* `amountCents`, so it never changes
when the admin edits the field. Consequence: only the **first** Approve's amount is
recorded. If an organizer approves the wrong amount (e.g. fat-fingers $2000), then re-edits
to $20 and re-approves, the route returns `{ ok: true }` 200 while silently keeping the
original $2000 — the admin has no signal the correction was dropped. Additionally,
`clearPendingForOwner(ownerSub, kind, provider)` (line 86) wipes the entire
`(owner, kind, provider)` pending bucket, so a second same-provider intent for a different
amount disappears from the dashboard without ever being reconciled.

This is a genuine money-handling trap on an explicitly-editable field. The idempotency
correctly prevents accidental double-crediting (good), but it also makes deliberate
corrections impossible and gives false success feedback.

**Fix:** Either (a) make the marker/donationId incorporate the edited amount so a changed
amount is a distinct, applicable write — e.g.
`admin_manual_${pendingId}_${amountCents}` — accepting that this weakens the
double-click guard (mitigate with the existing client `busy` disable); or (b) detect the
no-op path and return a distinct response the UI surfaces (e.g.
`{ ok: true, applied: false, reason: "already_reconciled" }`) so the admin knows the edit
did not land. Prefer (b) if double-credit protection must stay strict.

### WR-02: Cash-rain seeded from raw `willPayInPerson` after a transaction — perpetual rain with no way to dismiss

**Status:** fixed (56135fdf)

**File:** `apps/run.bib/webapp/src/app/orderform/page.tsx:160-165,231`, `apps/run.bib/webapp/src/components/BibForm.tsx:83-87`

**Issue:** The page computes `hasTransacted = hasSponsored || donationTotal > 0` and hides
the checkbox with `showCheckbox = !hasTransacted`, but it still seeds the bib preview's
cash-rain from the *raw* pledge flag: `willPayInitial = bib.willPayInPerson === true` →
passed as `initialRaining`. `willPayInPerson` is never cleared in the DB when money moves
(the A4 note "drop the pledge" is only realized by hiding the checkbox, not by mutating the
flag). So a runner who pledged in-person *and* later paid online loads the orderform with
`initialRaining=true`, the checkbox unmounted (`showCheckbox=false`), and BibForm's
`raining` state stuck true — cash rains over a paid bib permanently with no control to turn
it off. `BibForm` only ever sets `raining` false when the (now-absent) checkbox pushes
`setRaining(false)`.

**Fix:** Gate the seed on the same condition used to show the checkbox:
```ts
const willPayInitial = bib.willPayInPerson === true;
const showCheckbox = !hasTransacted;
// seed rain only while the pledge is still actionable
const initialRaining = showCheckbox && willPayInitial;
```
and pass `initialRaining` (not `willPayInitial`) into `GetYourBib`.

## Info

### IN-01: `window.open(href, "_blank")` without `"noopener"` — reverse tab-nabbing

**Status:** fixed (bd6fec05)

**File:** `apps/run.bib/webapp/src/components/menu-dropdown.tsx:33-36`

**Issue:** `ext(href)` opens external links (`gpx.defcon.run`, `runHumanUrl("/meshtastic")`)
via `window.open(href, "_blank")`. Unlike an anchor `target="_blank"`, `window.open` does
**not** default to `noopener` in browsers, so the opened tab receives a live `window.opener`
reference. Destinations are first-party/trusted, so risk is low, but it is a gratuitous gap.

**Fix:** `window.open(href, "_blank", "noopener,noreferrer")`.

### IN-02: Dropdown `target="_blank"` items missing `rel="noopener noreferrer"`

**Status:** fixed (18f1caa7)

**File:** `apps/run.bib/webapp/src/components/user-dropdown.tsx:95-98,115-118,140-143,148-153`

**Issue:** The Profile / CMS / GPS Check-in / Show My QR `DropdownItem`s set
`target="_blank"` with no `rel`. Modern browsers default anchors to `noopener` for
`target="_blank"`, so this is largely defensive, but the header's own external nav links
(`header.tsx:84`) already set `rel="noreferrer"` — inconsistent hardening.

**Fix:** Add `rel="noopener noreferrer"` to each `target="_blank"` DropdownItem for
consistency with `header.tsx`.

### IN-03: Reconcile `amountCents` has no upper bound

**Status:** fixed (a5f5b85c)

**File:** `apps/run.bib/webapp/src/app/api/admin/bib/reconcile/route.ts:35`

**Issue:** `amountCents: z.number().int().positive()` accepts arbitrarily large values. The
route is admin-gated so this is not a vulnerability, but an accidental extra digit writes a
huge amount straight into the money ledger (`paidAmount` / donation row) with no guardrail.

**Fix:** Add a sane ceiling matching the SponsorForm cap, e.g.
`.max(200_000)` (or a higher admin-specific bound), so a typo is rejected 400 rather than
booked.

### IN-04: `buildSocialQrUrl` interpolates `hash` without encoding

**Status:** fixed (b749c5c7)

**File:** `apps/run.bib/webapp/src/lib/social-qr.ts:88-92`

**Issue:** `` `https://run.${domain}/${regionShort}/r?h=${hash}` `` interpolates the hash
directly. `getSocialQrHash` only validates it is a non-empty string; the value is a trusted
SHA256 from run.human's internal endpoint (hex, URL-safe), so there is no live injection
path, but `getSocialQrHash` (`social-qr.ts:65-67`) already correctly `encodeURIComponent`s
`ownerSub` — the query param is the one spot that skips it.

**Fix:** `` `...?h=${encodeURIComponent(hash)}` `` for defense-in-depth against any future
change to the hash format.

---

_Reviewed: 2026-07-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
