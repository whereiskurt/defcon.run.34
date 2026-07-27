/**
 * Bib sales switch (Kurt 2026-07-26: "We're done selling bibs").
 *
 * Single flip point for closing (or re-opening) bib sales. When true:
 *   - SponsorForm variant='bib' never starts a checkout — the pay CTA plays a
 *     fake "redirecting…" beat, then drops the dumpster-fire "sales closed"
 *     modal steering the runner to /donate instead (BibSalesClosedModal).
 *   - POST /api/checkout/bib 403s, so a crafted request can't buy either.
 *
 * General donations (/donate, header DonateModal, /api/checkout/general) and
 * the Venmo/Cash App instruction pages (shared with general donations) are
 * deliberately NOT gated.
 */
export const BIB_SALES_CLOSED = true;
