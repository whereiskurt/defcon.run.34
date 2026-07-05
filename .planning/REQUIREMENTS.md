# Requirements: v1.9 CMS-Driven UI Copy Catalog

**Defined:** 2026-07-05
**Core Value:** Participants and organizers have a seamless digital experience for DCR34. This milestone lets organizers change static UI wording live from the CMS — no code change, no deploy — starting with the bib donate/sponsor copy.

**Design spec:** `docs/superpowers/specs/2026-07-05-cms-copy-catalog-design.md`

## v1 Requirements

Requirements for this milestone. Each maps to exactly one roadmap phase.

### COPY — Catalog data model

- [ ] **COPY-01**: Editor can create/edit a UI string as a `(key, locale, value)` row with a `namespace` and optional `notes`
- [ ] **COPY-02**: `(key, locale)` is enforced unique — no duplicate rows for the same string in the same locale
- [ ] **COPY-03**: The read-only API token exposes `ui-string` find/findOne so app consumers can read the catalog
- [ ] **COPY-04**: The `locale` column is multi-lingual-ready; only `default` is populated in v1

### TOOL — Runtime copy toolkit

- [ ] **TOOL-01**: `loadCopy(locale)` fetches the catalog from the Strapi API, cached server-side in the Next.js Data Cache (`revalidate:N`)
- [ ] **TOOL-02**: `t(key, vars)` resolves from a single in-memory merged map with `{placeholder}` interpolation — never a per-element network call
- [ ] **TOOL-03**: `CopyProvider` / `useCopy` make `t()` available in client components (modals, toasts, handlers), not just server render
- [ ] **TOOL-04**: A copy edit propagates to all regions within ~15 min with no deploy (eventual consistency via `revalidate:N` + Litestream)
- [ ] **TOOL-05**: Lightweight markdown in a value renders safely client-side

### FALL — Cached fallback & resilience

- [ ] **FALL-01**: A Strapi lifecycle hook regenerates an S3 `copy.json` export on any `ui-string` create/update/delete
- [ ] **FALL-02**: When Strapi is unreachable or a key is missing, the toolkit falls back to the S3 export as the default, and the resolved fallback map is itself cached (no slow/failed call per load)
- [ ] **FALL-03**: An optional committed snapshot provides an offline build-time floor for the CMS-and-S3-both-down case
- [ ] **FALL-04**: The UI never renders a raw dotted key to an end user (guaranteed by the fallback chain)

### ADMN — Custom admin editing

- [ ] **ADMN-01**: A custom Strapi admin page shows copy as a three-column table (`label · locale · value`) with inline edit and add-row
- [ ] **ADMN-02**: The admin page filters by `namespace`
- [ ] **ADMN-03**: Bulk save upserts rows, enforcing `(key, locale)` uniqueness

### MIGR — String migration (bib + shared chrome)

- [ ] **MIGR-01**: The bib donate/sponsor surface (forms, instructions, payment/Venmo/CashApp copy, sponsor/QR/logout modals) is fully catalog-driven — the proof surface
- [ ] **MIGR-02**: Remaining `run.bib` copy is migrated to catalog keys
- [ ] **MIGR-03**: Shared chrome copy (`common.header.*`, `common.profileMenu.*`) is migrated so every app reads the same keys (words unify without a shared React component)

## v2 Requirements

Deferred to a follow-up milestone. Tracked but not in this roadmap.

### MIGR — Remaining app migration

- **MIGR-04**: `run.flash`, `run.human`, `run.auth`, and `run.gpx` copy is migrated to catalog keys (each app adopts the toolkit and relocates its hardcoded strings)

### I18N — Localization

- **I18N-01**: Populate non-`default` locales and add a locale switcher so the UI renders in multiple languages (schema is ready; authoring + switching deferred)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Shared React header/profile-menu component library | Words-only scope — each app keeps its own React and reads labels by shared key; component unification is a separate effort |
| Redis / shared Next cache handler | Eventual consistency over the existing master/worker + Litestream topology is accepted; no need for instant global invalidation |
| `revalidateTag` change webhook + per-app revalidation route | Not needed given eventual consistency; time-based `revalidate:N` alone converges all regions |
| Strapi `rest-cache` plugin | Caching lives in the app-side Next.js Data Cache, not the CMS |
| GraphQL | REST + field/populate query params are sufficient |
| Native Strapi i18n plugin | We model our own `locale` column for the three-column admin grid; native i18n splits locales into document variants |
| Strapi blocks for copy | Rich needs use lightweight markdown in a string field; domain `Route.description` blocks are untouched |
| Draft/publish on `ui-string` | Save = live in v1; a Publish gate can be added later |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| COPY-01 | Phase TBD | Pending |
| COPY-02 | Phase TBD | Pending |
| COPY-03 | Phase TBD | Pending |
| COPY-04 | Phase TBD | Pending |
| TOOL-01 | Phase TBD | Pending |
| TOOL-02 | Phase TBD | Pending |
| TOOL-03 | Phase TBD | Pending |
| TOOL-04 | Phase TBD | Pending |
| TOOL-05 | Phase TBD | Pending |
| FALL-01 | Phase TBD | Pending |
| FALL-02 | Phase TBD | Pending |
| FALL-03 | Phase TBD | Pending |
| FALL-04 | Phase TBD | Pending |
| ADMN-01 | Phase TBD | Pending |
| ADMN-02 | Phase TBD | Pending |
| ADMN-03 | Phase TBD | Pending |
| MIGR-01 | Phase TBD | Pending |
| MIGR-02 | Phase TBD | Pending |
| MIGR-03 | Phase TBD | Pending |

**Coverage:**
- v1 requirements: 19 total
- Mapped to phases: 0 (roadmap pending)
- Unmapped: 19 ⚠️

---
*Requirements defined: 2026-07-05*
*Last updated: 2026-07-05 after initial definition*
