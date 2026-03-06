# Roadmap: DEF CON Run 34

## Milestones

- [x] **v1.0 Meshtastic Flasher MVP** - Phases 1-4 (shipped 2026-03-02)
- [ ] **v1.1 CMS Content Types** - Phases 5-9 (in progress)

## Phases

<details>
<summary>v1.0 Meshtastic Flasher MVP (Phases 1-4) - SHIPPED 2026-03-02</summary>

See `.planning/milestones/v1.0-ROADMAP.md` for archived v1.0 roadmap.

</details>

### v1.1 CMS Content Types

**Milestone Goal:** Event organizers can manage DCR34 events, routes, and points of interest through cms.defcon.run with a branded OIDC login experience and working REST API for run.human consumption.

- [x] **Phase 5: Infrastructure Hardening + Content Type Schemas** - Fix worker sync, upgrade S3 provider, define all content type schemas (completed 2026-03-02)
- [x] **Phase 6: Relations + API Verification** - Wire many-to-many relations, configure public permissions, verify REST API end-to-end (completed 2026-03-02)
- [x] **Phase 7: Branded Login** - DCR34-branded OIDC login experience on cms.defcon.run (completed 2026-03-02)
- [x] **Phase 8: run.human CMS Client** - Verified manually: CMS sync working across regions (skipped — manually verified 2026-03-05)
- [x] **Phase 9: Seed Data + End-to-End Verification** - Verified manually: seed data created and confirmed (skipped — manually verified 2026-03-05)

## Phase Details

### Phase 5: Infrastructure Hardening + Content Type Schemas
**Goal**: CMS has a safe worker sync mechanism and all three content types (Event, Route, POI) defined with their schemas committed to git
**Depends on**: Nothing (first phase of v1.1)
**Requirements**: INFR-01, INFR-02, SCHM-01, SCHM-02, SCHM-03, SCHM-04, SCHM-07
**Success Criteria** (what must be TRUE):
  1. Worker litestream sync completes without corrupting SQLite WAL/SHM files while Strapi is serving read traffic
  2. Media uploads from Strapi admin reach S3 and serve via CloudFront URLs across both regions
  3. Organizer can create, edit, and delete an Event with all specified fields (title, slug, description, datetimes, location, cover image, gallery, attachments, sort order) via the Strapi admin panel
  4. Organizer can create, edit, and delete a Route with all specified fields (name, slug, description, route type, distance, elevation, difficulty, duration, GPX files, coordinates, cover image, map styling, sort order) via the Strapi admin panel
  5. Organizer can create, edit, and delete a Point of Interest with all specified fields (name, slug, description, coordinates, POI type, marker image, photo, sort order) via the Strapi admin panel
**Plans**: 2 plans (1 wave)

Plans:
- [x] 05-01-PLAN.md — Fix worker Litestream sync safety + upgrade S3 upload provider to Strapi 5
- [x] 05-02-PLAN.md — Define shared coordinates component + Event, Route, and POI content type schemas

### Phase 6: Relations + API Verification
**Goal**: Content types are linked with bidirectional many-to-many relations and the public REST API returns fully populated data
**Depends on**: Phase 5
**Requirements**: SCHM-05, SCHM-06, API-01, API-02, API-03
**Success Criteria** (what must be TRUE):
  1. Events and Routes are linked bidirectionally -- populating an Event returns its Routes and populating a Route returns its Events
  2. Routes and POIs are linked bidirectionally -- populating a Route returns its POIs and populating a POI returns its Routes
  3. Unauthenticated GET requests to /api/events, /api/routes, and /api/pois return published content (Public role permissions working)
  4. REST API supports explicit population of nested relations and media (events with routes, routes with POIs and GPX URLs)
  5. REST API supports field selection and filtering by date, type, and slug
**Plans**: 2 plans (2 waves)

Plans:
- [x] 06-01-PLAN.md — Add eventType enum + bidirectional many-to-many relations to schemas + public permission bootstrap
- [x] 06-02-PLAN.md — Create API verification script (population, filtering, field selection, write protection)

### Phase 7: Branded Login
**Goal**: Organizers see a DCR34-branded login experience when accessing cms.defcon.run instead of the raw Strapi admin form
**Depends on**: Nothing (independent of Phases 5-6, can run in parallel)
**Requirements**: AUTH-01, AUTH-02
**Success Criteria** (what must be TRUE):
  1. Visiting cms.defcon.run root shows a DCR34-branded page with DCR34 logo and visual identity, not the default Strapi login form
  2. Clicking the sign-in button triggers the OIDC flow to auth.defcon.run and returns the organizer to the Strapi admin panel upon successful authentication
**Plans**: 1 plan (1 wave)

Plans:
- [x] 07-01-PLAN.md — Branded login page (static HTML + nginx) and branded SSO error pages

### Phase 8: run.human CMS Client (Manually Verified)
**Goal**: run.human can fetch and render CMS content from regional workers via service discovery with type-safe code
**Status**: Skipped — CMS sync verified manually across regions (2026-03-05)

### Phase 9: Seed Data + End-to-End Verification (Manually Verified)
**Goal**: CMS contains representative DCR34 sample content and the full organizer-to-participant pipeline is verified across both regions
**Status**: Skipped — seed data created and confirmed manually (2026-03-05)

## Progress

**Execution Order:**
Phases 5 and 7 can execute in parallel (no dependency). Phase 6 follows 5. Phase 8 follows 6. Phase 9 follows 6 and 8.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 5. Infrastructure + Schemas | v1.1 | 2/2 | Complete | 2026-03-02 |
| 6. Relations + API | v1.1 | 2/2 | Complete | 2026-03-02 |
| 7. Branded Login | v1.1 | 1/1 | Complete | 2026-03-02 |
| 8. CMS Client | v1.1 | — | Manually verified | 2026-03-05 |
| 9. Seed Data + E2E | v1.1 | — | Manually verified | 2026-03-05 |
