# v1.8 Design Contract — Bib Admin, Orderform UX & Social QR

**Full spec (authoritative):** `docs/superpowers/specs/2026-07-04-bib-admin-and-orderform-design.md`
(committed on this branch). This file is the GSD-facing summary: requirements,
the grounded file map, and the externally-gated notes. Read the spec for full
rationale and code sketches.

## Requirements

| ID | Requirement | SC |
|----|-------------|----|
| BIB-ADM-01 | Admin dashboard must not count empty (unregistered) visit-created bibs; a bib counts only with a name, payment, or in-person pledge. | SC34.1 |
| BIB-ADM-02 | Admin can reconcile a pending Venmo/Cash App intent inline → credits the runner (bib or donation), idempotently, and clears the pending row. | SC34.2 |
| BIB-ADM-03 | Admin can reject a bib inline → deletes bib + pending intents, resets the runner's `bibname_change` quota, keeps donations. | SC34.3 |
| BIB-ADM-04 | The "$20 in person" checkbox is placed responsively: between Sponsor & Donate (mobile), full-width below both (desktop); still hides Sponsor when checked; cash-rain preserved. | SC34.4 |
| BIB-ADM-05 | Unsaved name edits are unmistakable: glowing/enlarged Save button + "UNSAVED" stamp on the bib (same slot as PAID, outranks it while dirty). | SC34.5 |
| BIB-ADM-06 | Clicking Sponsor/Donate commits the current bib name first (both variants). | SC34.6 |
| BIB-ADM-07 | ALTCHA proof-of-work shows a HeroUI blur-overlay spinner that auto-dismisses; inline "verifying" text removed. | SC34.7 |
| BIB-ADM-08 | The bib tear-off QR encodes the runner's real social-QR value (run.human `hash`), enlarged, with a runner-code fallback. | SC34.8 |
| BIB-ADM-09 | Quality gate: run.bib `next build` + vitest green; run.human still builds. | SC34.9 |

## Grounded file map (from spec — verified 2026-07-04)

**Slice A**
- `apps/run.bib/webapp/src/lib/admin-reports.ts` — add `isRegistered`; filter `totals.bibs` + `registrations`.
- `apps/run.bib/webapp/src/app/admin/page.tsx` — server component; add client action components for reconcile/reject buttons.
- `apps/run.bib/webapp/src/app/api/admin/bib/reconcile/route.ts` (new), `.../reject/route.ts` (new) — admin-gated.
- Reuse: `applyPayment`, `clearPendingForOwner`, `listPendingForOwner` (`entities/bib.ts`, `entities/pending-contribution.ts`), `recordDonation` (`entities/general-donation.ts`), `getUserQuotas`/`restoreQuota` (`lib/quota-client.ts`), `requireAdmin` (`lib/admin-gate.ts`).

**Slice B**
- `apps/run.bib/webapp/src/app/orderform/page.tsx` — move checkbox out of `GetYourBib` to between/below tiles (Tailwind responsive).
- `src/components/BibForm.tsx` — glow/enlarge Save when dirty; pass `dirty` to preview.
- `src/components/BibPreview.tsx` — add "UNSAVED" stamp in the sponsor-charm slot (`~line 301`); enlarge QR (slice C).
- `src/components/WillPayInPersonCheckbox.tsx` + `GetYourBib.tsx` — bridge cash-rain via a small shared client store (pattern: `lib/pending-bib-save.ts`).
- `src/app/providers.tsx` — mount the ALTCHA blur overlay once.
- `src/lib/altcha-client.ts` — instrument `solveAltcha` with an in-flight counter store driving the overlay.

**Slice C**
- `apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts` — additively return `hash` (currently returns MQTT fields only; `getRunUser` already loads it).
- `apps/run.bib/webapp/src/app/orderform/page.tsx` — fetch `hash` via service discovery (mirror `quota-client.ts` internal URL + `X-Internal-Secret`), build the `/r?h=` URL from run.bib env (`SITE_DOMAIN`, `REGION_SHORT`), thread to `BibPreview`.
- `src/components/BibPreview.tsx` — render the social-QR URL via existing `QrBadge`, enlarged (~76→112px); fallback to runner-code QR when no `hash`.

## Social-QR value (confirmed)

run.human encodes `https://run.<SITE_DOMAIN>/<REGION_SHORT>/r?h=<hash>` where `hash`
is a random per-user SHA256 stored on the `RunUser` entity (`run-human-electro` table,
also read by run.bib) and NOT derivable from session claims. Access via the extended
internal endpoint (preferred) — do not recompute the hash (needs run.human-only `seed`).

## Externally-gated / environment notes

- Reconcile/reject hit the run.auth quota service (internal secret). Implement + unit
  test; server enforces on write. Local dev has the quota service on `LOCAL_AUTH_PORT`.
- Social-QR cross-app fetch depends on run.human's internal endpoint reachable via
  service discovery; unit-test the URL builder + fallback; full cross-app E2E may be
  environment-gated (record a blocker in STATE.md if unreachable, ship the fallback).

## Testing

- vitest: `isRegistered` + filtered totals/roster; reconcile/reject route logic (mock
  entities + quota client); ALTCHA overlay store; social-QR URL builder + fallback.
- Manual: run the app, verify each slice end-to-end (responsive checkbox, unsaved
  stamp/glow, blur overlay, admin reconcile/reject, QR resolves to the same `/r?h=`
  target as the run.human profile QR) before closing the phase.
