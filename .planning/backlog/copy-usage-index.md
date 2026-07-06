---
title: Copy usage index — "used in" file map for the CMS copy catalog
captured: 2026-07-06
source: Phase 38 close-out conversation with Kurt
status: backlog — promote as a follow-up phase immediately AFTER Phase 39
milestone: v1.9 CMS-Driven UI Copy Catalog (follow-up)
depends_on: Phase 39 (copy must be migrated to t() call sites before a scan finds anything)
fast_follow: yes — small, static-scan based; no runtime cost
number: TBD — sweep worktrees before minting (Phase 40 is already "Admin Activity Reports" elsewhere; see project_phase_number_collisions)
---

# Copy usage index — "used in" file map for the copy catalog

## Why we want it

The Copy Catalog admin page (Phase 38) shows every `ui-string` as `key · locale · value`,
but an editor has no idea **where** a given key is rendered. When there are hundreds of
keys across bib/human/auth/gpx/flash + shared `common.*` chrome, "which screen does
`common.header.nav.maps` show up on?" becomes a real question. Surfacing the source
file(s) each key appears in — as a "Used in" column/tooltip in the grid — makes the
catalog self-documenting and safe to edit.

## Why it MUST come after Phase 39

The map is built by scanning `t("...")` / `useCopy()` call sites across the apps.
Before Phase 39 wires the keys in, that scan finds almost nothing — only the Phase-37
bib donate/sponsor surface. Running it post-39, once every migrated surface renders
through `t()`, is when it has real data.

## Approach (two options — decide in the phase)

A **build/CI scan** greps every literal `t("<key>")` across `apps/*/webapp/src`, builds a
`key → [relative file paths]` map, then EITHER:

- **(a) push into the catalog** — write the paths into a new `usedIn` field (or reuse
  `notes`) via the bulk-upsert endpoint, and render a "Used in" column/tooltip in the
  admin grid. Pro: lives with the data. Con: needs a schema field + a write job.
- **(b) committed sidecar** — emit a committed `copy-usage.json` the admin page fetches
  and joins by key at render time. Pro: zero schema change, zero runtime write, trivially
  regenerated in CI. Con: one more static file to keep fresh. **Leaning (b).**

## Caveats (state them in the phase, don't over-promise)

1. **Static-only** — catches literal `t("bib.hero.title")`, NOT dynamic `t(someVar)` or
   computed keys. Convention is literal keys, so coverage is high but the "Used in" list
   is **best-effort**, not guaranteed-complete. Label it as such in the UI.
2. **Cross-app** — the scan must cover all apps that adopt the toolkit in Phase 39
   (bib + human/auth/gpx/flash for `common.*`), not just bib.
3. **Freshness** — regenerate on CI (or a `copy:usage` npm script) so it doesn't drift;
   it's advisory metadata, so slight staleness is acceptable.

## Scope sketch (~1 small phase, 2 plans)

- Plan 1: the `copy:usage` scan script (grep → `key → files` JSON) + CI/npm wiring.
- Plan 2: surface it in the Copy Catalog admin grid (a "Used in" column/tooltip that
  joins the sidecar by key; "best-effort (static)" affordance).

Not a blocker for anything; pure editor-QoL. Promote right after Phase 39 lands, before
the full-site migration fans out further.
