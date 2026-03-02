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

- [ ] **Phase 5: Infrastructure Hardening + Content Type Schemas** - Fix worker sync, upgrade S3 provider, define all content type schemas
- [ ] **Phase 6: Relations + API Verification** - Wire many-to-many relations, configure public permissions, verify REST API end-to-end
- [ ] **Phase 7: Branded Login** - DCR34-branded OIDC login experience on cms.defcon.run
- [ ] **Phase 8: run.human CMS Client** - Service-discovery-based CMS fetch client with TypeScript types and rich text rendering
- [ ] **Phase 9: Seed Data + End-to-End Verification** - Sample DCR34 content and full pipeline verification

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
- [ ] 05-01-PLAN.md — Fix worker Litestream sync safety + upgrade S3 upload provider to Strapi 5
- [ ] 05-02-PLAN.md — Define shared coordinates component + Event, Route, and POI content type schemas

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
**Plans**: TBD

Plans:
- [ ] 06-01: TBD

### Phase 7: Branded Login
**Goal**: Organizers see a DCR34-branded login experience when accessing cms.defcon.run instead of the raw Strapi admin form
**Depends on**: Nothing (independent of Phases 5-6, can run in parallel)
**Requirements**: AUTH-01, AUTH-02
**Success Criteria** (what must be TRUE):
  1. Visiting cms.defcon.run root shows a DCR34-branded page with DCR34 logo and visual identity, not the default Strapi login form
  2. Clicking the sign-in button triggers the OIDC flow to auth.defcon.run and returns the organizer to the Strapi admin panel upon successful authentication
**Plans**: TBD

Plans:
- [ ] 07-01: TBD

### Phase 8: run.human CMS Client
**Goal**: run.human can fetch and render CMS content from regional workers via service discovery with type-safe code
**Depends on**: Phase 6
**Requirements**: CLNT-01, CLNT-02, CLNT-03
**Success Criteria** (what must be TRUE):
  1. run.human fetches CMS content from the regional worker via service discovery (not the master, not CloudFront) using a reusable client module
  2. TypeScript types for Event, Route, and POI API responses are defined and used by the CMS client (no untyped API responses)
  3. Rich text blocks from CMS content render correctly in run.human pages following the DCR33 blocks-renderer pattern
**Plans**: TBD

Plans:
- [ ] 08-01: TBD

### Phase 9: Seed Data + End-to-End Verification
**Goal**: CMS contains representative DCR34 sample content and the full organizer-to-participant pipeline is verified across both regions
**Depends on**: Phase 6, Phase 8
**Requirements**: SEED-01, SEED-02
**Success Criteria** (what must be TRUE):
  1. CMS contains sample DCR34 events (Day 1 Run, Day 1 Social, Day 2 Swag Swap, etc.) with realistic field values, cover images, and attachments
  2. Sample routes with uploaded GPX files and linked POIs are associated with events via many-to-many relations
  3. Content created on the master in us-east-1 is readable from workers in both us-east-1 and ca-central-1 within the Litestream sync window
**Plans**: TBD

Plans:
- [ ] 09-01: TBD

## Progress

**Execution Order:**
Phases 5 and 7 can execute in parallel (no dependency). Phase 6 follows 5. Phase 8 follows 6. Phase 9 follows 6 and 8.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 5. Infrastructure + Schemas | v1.1 | 0/2 | Planned | - |
| 6. Relations + API | v1.1 | 0/0 | Not started | - |
| 7. Branded Login | v1.1 | 0/0 | Not started | - |
| 8. CMS Client | v1.1 | 0/0 | Not started | - |
| 9. Seed Data + E2E | v1.1 | 0/0 | Not started | - |
