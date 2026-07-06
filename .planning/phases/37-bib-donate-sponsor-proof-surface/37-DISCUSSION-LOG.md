# Phase 37: Bib Donate/Sponsor Proof Surface - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-05
**Phase:** 37-bib-donate-sponsor-proof-surface
**Areas discussed:** Seeding source of truth, Server-component copy access, Copy scope, 37↔39 boundary

---

## Seeding (SC-3 edit-proof + SC-4 fallback-proof)

| Option | Description | Selected |
|--------|-------------|----------|
| Author snapshot + import to CMS | Extract literals → copy-snapshot.json (source of truth), then import script POSTs the same rows into Strapi; copy:snapshot round-trips | ✓ |
| Snapshot only, CMS rows by hand | Author snapshot; create CMS rows manually to prove editing | |
| CMS-first, generate snapshot | Author rows in Strapi first, then copy:snapshot pulls them down (no floor until CMS populated) | |

**User's choice:** Author snapshot + import to CMS
**Notes:** Committed snapshot is the authored artifact; CMS is a derived import. Satisfies both fallback-proof and edit-proof in one authoring pass. Import needs a write-capable token (not the read-only run-human-internal token) — flagged for planner.

---

## Server-component copy access

| Option | Description | Selected |
|--------|-------------|----------|
| loadCopy() in each server component | Each server component/page calls cached loadCopy('default'), uses t(copy, key) locally; matches layout.tsx | ✓ |
| Thread copy map as a prop | Page loads once, passes map down as prop | |
| Add a server getCopy() helper | Thin React cache() server helper any component awaits | |

**User's choice:** loadCopy() in each server component
**Notes:** loadCopy is unstable_cache-wrapped so repeated calls are free; no prop-threading or new helper needed. Reuses the existing layout pattern.

---

## Copy scope (what migrates this phase)

| Option | Description | Selected |
|--------|-------------|----------|
| Visible labels + sentences + interpolated | All participant-facing text incl. interpolated CTAs/modals; leave aria-labels + error detail tokens | ✓ |
| Everything including aria + errors | Every string incl. aria-labels and error microcopy | |
| Sponsor/donate sentences only | Only sentence copy + CTAs; defer labels/modals/BibForm to 39 | |

**User's choice:** Visible labels + sentences + interpolated
**Notes:** User-facing error *sentence* migrates; interpolated `{detail}`/`HTTP nnn` tokens stay raw. aria-labels stay literal — not editor-facing.

---

## 37 ↔ 39 boundary (bib name-entry surface)

| Option | Description | Selected |
|--------|-------------|----------|
| BibForm in 37 (full donate/sponsor flow) | Include GetYourBib/BibForm — criterion 1 names GetYourBib; full vertical proof | ✓ |
| BibForm deferred to 39 | Keep 37 to payment/sponsor surfaces only | |

**User's choice:** BibForm in 37 (full donate/sponsor flow)
**Notes:** 37 proves the whole donate/sponsor page top-to-bottom. Phase 39 keeps shared common.* chrome, admin, and remaining non-flow bib copy.

---

## Claude's Discretion

- Exact key leaf names (`<element>`) per literal — authored during execution against the `<namespace>.<area>.<element>` convention; kept stable once seeded.
- Prop shape for passing copy into SponsorInstructions (whole map vs pre-resolved strings).
- "Payment method" / provider-pill labels under `bib.sponsor.*` vs a neutral `bib.checkout.*`.
- Import script transport + location (`scripts/import-copy.ts` next to copy:snapshot).

## Deferred Ideas

- Shared chrome `common.*` (header/profile-menu/footer) — Phase 39.
- Remaining non-flow bib copy + other apps — Phase 39 / v2.
- Custom three-column admin plugin — Phase 38.
- Manual `revalidateTag('copy')` instant propagation — out of scope (v1 time-based only).
- aria-label / a11y-string catalog coverage — intentionally out.

## Derived decision (not asked — captured from design doc + roadmap)

- Per-variant keys (`bib.sponsor.*` / `bib.donate.*`) rather than one interpolated key, since SponsorForm renders distinct words per variant and the roadmap names both namespaces.
