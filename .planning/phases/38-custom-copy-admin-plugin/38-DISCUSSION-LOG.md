# Phase 38: Custom Copy Admin Plugin - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-06
**Phase:** 38-custom-copy-admin-plugin
**Areas discussed:** Admin surface architecture, Bulk-save & conflict UX, Namespace filter + add-row, Grid data & value editing
**Mode:** `--chain` (interactive discuss → auto plan+execute)

---

## Admin surface architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Custom page via `src/admin` injection | Register a menu link + page component through the existing `src/admin/app.tsx` injection; bulk-upsert as a custom route/controller on existing `api::ui-string`. Fewest files, matches SSO-injection precedent + AGENTS.md "boring/single-file". | ✓ |
| Full Strapi plugin | Scaffold `src/plugins/copy-catalog/` (server+admin halves) registered in `config/plugins.ts`. Proper encapsulation, much more ceremony. | |

**User's choice:** Custom page via `src/admin` injection (recommended).
**Notes:** No plan to package/reuse externally; the existing `src/admin/app.tsx` already does admin injection, so this fits precedent.

---

## Bulk-save & conflict UX

| Option | Description | Selected |
|--------|-------------|----------|
| Atomic reject + per-row errors | Post dirty+new rows to one bulk-upsert endpoint; any collision rejects the whole save, writes nothing, surfaces inline per-row errors. | ✓ |
| Reject only bad rows, save the rest | Partial commit — valid rows upsert, conflicting rows stay flagged. | |
| Last-write-wins merge | Upsert everything; matching `(key,locale)` overwrites with no rejection. | |

**User's choice:** Atomic reject + per-row errors (recommended).
**Notes:** Mirrors the Phase 35 lifecycle hook that already rejects duplicate writes with a clean 4xx; no silent clobber, no mixed grid state.

---

## Namespace filter + add-row

| Option | Description | Selected |
|--------|-------------|----------|
| Client-side filter + inherit on add | Load full catalog once; namespace dropdown filters in-memory; add-row pre-fills active namespace + key prefix. | ✓ |
| Server-query per namespace | Refetch filtered rows per selection. Scales to huge catalogs, adds latency. | |
| Client filter, add-row blank | Client filter, but add-row always starts blank (type full key each time). | |

**User's choice:** Client-side filter + inherit namespace on add-row (recommended).
**Notes:** Instant filtering at v1 catalog size; add-row under an active namespace stubs the key (e.g. `bib.`).

---

## Grid data & value editing

| Option | Description | Selected |
|--------|-------------|----------|
| Load-all + inline markdown cell | Fetch entire catalog into one grid (no pagination); value edited inline as raw markdown source in a growable textarea. | ✓ |
| Paginate / virtualize now | Add pagination/virtualization from the start. Premature at v1 size. | |

**User's choice:** Load-all + inline raw-markdown textarea cell (recommended).
**Notes:** v1 catalog is tens–low-hundreds of `default` rows; markdown is rendered downstream by the toolkit, not previewed in the admin grid.

---

## Claude's Discretion

- Grid component composition (`@strapi/design-system` `<Table>`/`<Textarea>`/`<SingleSelect>` vs lighter hand-rolled).
- Dirty-row tracking + client-side keying of new rows before they have a DB id.
- Bulk-upsert transaction strategy (validate-all-then-write in one transaction vs pre-flight check) — observable requirement is all-or-nothing with per-row errors, reusing the Phase 35 uniqueness rule and still firing the S3 export.
- Admin authorization confirmation (default admin-route protection; no extra RBAC expected).

## Deferred Ideas

- Live markdown preview in the value cell.
- Pagination / row virtualization (only if catalog grows).
- Per-locale authoring columns/tabs (`fr`, `es`, …).
- Manual `revalidateTag('copy')` fan-out for instant propagation.
- Migrating remaining bib copy + shared chrome + other apps — Phase 39.
