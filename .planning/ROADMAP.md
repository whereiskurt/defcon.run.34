# Roadmap: DEF CON Run 34

## Milestones

- [x] **v1.0 Meshtastic Flasher MVP** - Phases 1-4 (shipped 2026-03-02)
- [x] **v1.1 CMS Content Types** - Phases 5-9 (shipped 2026-03-05)
- [ ] **v1.2 User Checkins** - Phases 10-13 (in progress)

## Phases

<details>
<summary>v1.0 Meshtastic Flasher MVP (Phases 1-4) - SHIPPED 2026-03-02</summary>

See `.planning/milestones/v1.0-ROADMAP.md` for archived v1.0 roadmap.

</details>

<details>
<summary>v1.1 CMS Content Types (Phases 5-9) - SHIPPED 2026-03-05</summary>

See `.planning/milestones/v1.1-ROADMAP.md` for archived v1.1 roadmap.

</details>

### v1.2 User Checkins

**Milestone Goal:** Participants can GPS check-in from the browser with privacy controls, quota enforcement, and a map-based profile view of their check-in history.

- [x] **Phase 10: CheckIn Data Layer** - ElectroDB entity, indexes, and User entity side-effect fields (completed 2026-03-06)
- [ ] **Phase 11: Check-in API Routes** - Create, list, toggle, delete, and preference endpoints with quota enforcement
- [ ] **Phase 12: CheckInModal + Header Integration** - GPS sampling modal with progress bar, privacy toggle, and header dropdown entry
- [ ] **Phase 13: Profile Check-in Display** - Paginated check-in list with Leaflet map, numbered markers, and accuracy circles

## Phase Details

### Phase 10: CheckIn Data Layer
**Goal**: The CheckIn entity exists in DynamoDB with all fields, indexes, and User entity side-effect updates so that API routes can persist and query check-ins
**Depends on**: Nothing (first phase of v1.2)
**Requirements**: CHKN-01, CHKN-02, CHKN-03
**Success Criteria** (what must be TRUE):
  1. A CheckIn record can be created in DynamoDB with GPS samples, averaged coordinates, best accuracy, distance, duration, privacy flag, and timestamps
  2. Check-ins for a given user can be queried in reverse-chronological order with cursor-based pagination (by-user-recent index)
  3. All check-ins across users can be queried in reverse-chronological order with cursor-based pagination (by-global-recent index)
  4. Creating or deleting a CheckIn automatically updates the User entity's checkInCount and lastCheckInAt fields
**Plans**: 1 plan

Plans:
- [ ] 10-01-PLAN.md — CheckIn entity, indexes, helpers, and RunUser legacy cleanup

### Phase 11: Check-in API Routes
**Goal**: Authenticated users can create, list, toggle privacy, delete check-ins, and set their default privacy preference through API endpoints
**Depends on**: Phase 10
**Requirements**: API-01, API-02, API-03, API-04, UI-04
**Success Criteria** (what must be TRUE):
  1. User can POST GPS samples to create a check-in, receiving quota enforcement (rejected when quota exceeded) and the created check-in in the response
  2. User can GET their own check-ins with cursor-based pagination returning consistent pages
  3. User can PATCH a check-in they own to toggle its public/private visibility
  4. User can DELETE a check-in they own, and their checkInCount decrements accordingly
  5. User can GET and PUT their default check-in privacy preference (public or private)
**Plans**: 1 plan

Plans:
- [ ] 11-01-PLAN.md — Check-in CRUD route + user preference PATCH handler

### Phase 12: CheckInModal + Header Integration
**Goal**: Users can trigger a GPS check-in from anywhere in the app via the header dropdown, with real-time GPS sampling feedback and privacy controls
**Depends on**: Phase 11
**Requirements**: UI-01, UI-02
**Success Criteria** (what must be TRUE):
  1. Clicking "GPS Check-in" in the header user dropdown opens the CheckInModal
  2. The modal collects 3 GPS samples over 2 seconds, showing a progress bar during collection
  3. The modal displays the user's current quota usage (e.g., "3 of 10 check-ins today")
  4. The modal includes a privacy toggle pre-set to the user's default preference, and the user can override it per check-in
**Plans**: TBD

Plans:
- [ ] 12-01: TBD

### Phase 13: Profile Check-in Display
**Goal**: Users can view their check-in history on their profile page as both a paginated list and a Leaflet map with visual indicators
**Depends on**: Phase 11 (needs API list endpoint; can develop in parallel with Phase 12)
**Requirements**: UI-03
**Success Criteria** (what must be TRUE):
  1. Profile page shows a paginated list of the user's check-ins with timestamps, coordinates, and privacy status
  2. Profile page shows a Leaflet map with numbered markers corresponding to check-in locations
  3. Each marker on the map displays an accuracy circle showing GPS precision
  4. Pagination controls allow browsing through check-in history, and the map updates to show markers for the current page
**Plans**: TBD

Plans:
- [ ] 13-01: TBD

## Progress

**Execution Order:**
Phase 10 -> 11 -> 12 and 13 (12 and 13 can run in parallel after 11).

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 10. CheckIn Data Layer | 1/1 | Complete    | 2026-03-06 | - |
| 11. Check-in API Routes | v1.2 | 0/1 | Not started | - |
| 12. CheckInModal + Header | v1.2 | 0/? | Not started | - |
| 13. Profile Check-in Display | v1.2 | 0/? | Not started | - |
