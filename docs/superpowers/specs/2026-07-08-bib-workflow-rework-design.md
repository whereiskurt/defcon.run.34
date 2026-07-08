# Bib Ordering Workflow Rework — Design

**Date:** 2026-07-08
**Branch:** `gsd/bib-ui-fixes` (rolls into PR #461)
**Apps:** run.bib (primary); run.human + run.flash (change ② only)

## Goal

Refocus the bib order page on a single action — **sponsor a bib** — and move
donations entirely into the header modal. Add a friction gate for cash payers,
celebrate donations with a cash rain, and reset all bogus test payment data
before launch.

## Context (what already exists)

- **Order page** (`app/orderform/page.tsx`) renders a bib preview, the
  `ContributionChoice` checkboxes (pay-in-person / burn), and `ContributionTiles`
  (a 2-up Sponsor + Donate grid).
- **Donations** already redirect to `/orderform?status=success`, where
  `StripeStatusBanner` shows a thank-you. `RunnerCodeBadge` already renders a
  BIB-XXXX code with a copy button. `CashRain` + the `rain-store` singleton
  already drive the falling-dollar animation.
- **`DonateModal.tsx`** is a custom `createPortal` overlay (not HeroUI — the repo
  uses no HeroUI modal). It is **duplicated across 3 apps**; run.human and
  run.flash are byte-identical, **run.bib has already diverged**.
- **Copy** is CMS-driven: `t()` / `loadCopy` / `useCopy` resolve
  Strapi → S3 `copy.json` → committed `src/lib/copy-snapshot.json` (floor).
- **Payment data** lives on the shared `run-human-electro` DynamoDB table across
  four ElectroDB entities: `Bib` (`paidAmount`, `paidStatusHistory`),
  `GeneralDonation`, `PendingContribution`, `BibReconcile`. `BudgetCounter` on
  the same table is the Haiku Lambda's LLM-cost cap — **not** revenue.

## Changes

### ① Drop the Donate tile; Sponsor goes full-width
`ContributionTiles` renders a single full-width Sponsor tile (no 2-up grid, no
Donate tile). The bib preview and the pay-in-person/burn checkboxes stay on the
page. Donations now happen only via the header modal (②).

### ② Header modal = the Donate panel — ported to all 3 apps
Restyle `DonateModal`'s body to match the on-page Donate tile: inline the
`DonateArt` coin SVG + a centered kicker/title/body copy block above the existing
amount-slider / provider-pills / CTA form, adopting the tile's surface + border.
Keep the existing donation submit logic (POST `/api/checkout/general`). Apply the
same change to run.bib, run.human, and run.flash — diff run.bib's divergence
first, then re-sync all three. `DonateArt` is inlined per file (self-contained;
not a shared import).

### ③ Donate → back to bib, thank-you + one-shot rain
Change the **general** checkout `success_url` to `/orderform?status=donated`
(bib checkout keeps `?status=success`). The page maps a third status value;
`StripeStatusBanner` gains a `donated` variant showing "thank you for your
donation". On mount with `status=donated`, fire a **one-shot** cash rain via the
rain-store — CashRain's ~60s cap ends it; it does **not** set the persistent
`willPayInPerson` pledge. Bib-buy stays available if the bib is unpurchased.

### ④ Bib purchase → hide controls + bib thank-you
Once `hasSponsored`, the Sponsor tile and the checkboxes hide (already wired via
`hasSponsored` / `showCheckbox = !hasTransacted`). With ① removing the Donate
tile, a sponsored bib cleanly shows: bib preview + "thank you for your bib
purchase". `status=success` keeps the bib thank-you (copy reworded from the
generic success string).

### ⑤ Cash-pay → Signal-confirm modal before the rain (net-new)
Toggling **pay-in-person ON** opens a new `CashConfirmModal` (custom portal,
matching `DonateModal`'s pattern) containing `RunnerCodeBadge` (BIB code + copy)
and a plain-text instruction ("send this code to agent x on Signal to confirm").

- **OK** → persist the pledge (PATCH `/api/bib`) **and** start the rain.
- **Cancel / dismiss** → revert the toggle to its prior choice, no PATCH, no
  rain. (OK is required to commit the pledge.)

`ContributionChoice` is restructured so the `inperson` path gates through the
modal: it no longer applies the store/PATCH optimistically for pay-in-person.
Burn and "nothing" keep their current instant behavior (no modal).

### ⑥ Release reset — nuke all test payment data (destructive, prod)
A one-off script deletes **all** rows of `Bib`, `GeneralDonation`,
`PendingContribution`, and `BibReconcile` (entity-scoped scan + batch delete).
`BudgetCounter` and all non-bib data on the shared table are untouched. Bibs
regenerate fresh (new runner code) on the owner's next visit.

- **Dry-run by default**: prints per-entity counts of what it would delete.
- Deletes only with `--confirm`.
- Reads creds from env (`RUN_ELECTRO_*` / `RUN_DYNAMODB_*`). No creds exist in
  the dev/agent session, so **the operator runs it** against prod (or pastes it
  as a `!` command in-session so output is captured).

## CMS copy keys

New/changed `ui-string` keys. Strategy: add to committed `copy-snapshot.json`
(source-controlled floor — works in the build immediately), then import to the
live catalog via the master write endpoint (`cms.defcon.run/use1`) when
available.

| Key | Purpose | Note |
|-----|---------|------|
| `bib.status.donationSuccess` | ③ donation thank-you banner | new |
| `bib.status.paymentSuccess` | ④ reword → "thank you for your bib purchase" | exists, reword |
| `bib.cashConfirm.title` | ⑤ modal title | new |
| `bib.cashConfirm.instruction` | ⑤ Signal instruction; `{handle}` placeholder | new, plain-text |
| `bib.cashConfirm.confirm` | ⑤ OK button label | new |
| `bib.cashConfirm.cancel` | ⑤ Cancel button label | new |

**Landmine:** Strapi 5 rejects `filters[locale][$eq]` on the `ui-string`
catalog ("Invalid key locale" 400). Any live import/verify must avoid the
reserved `locale` query. Verify a live import via the S3 origin, not CloudFront.

## Out of scope
- `BudgetCounter` reset (LLM cost, not revenue).
- HeroUI modal migration (repo has none; keep the portal pattern).
- Venmo/CashApp reconciliation flow changes.

## Verification
- `tsc --noEmit` clean across run.bib (and run.human/run.flash for ②).
- Manual: order page shows only Sponsor (full-width); header Donate opens the
  restyled panel; donate → returns with thank-you + rain; cash toggle → modal →
  OK rains / Cancel reverts; sponsored bib hides controls.
- ⑥: dry-run counts reviewed before `--confirm`.
