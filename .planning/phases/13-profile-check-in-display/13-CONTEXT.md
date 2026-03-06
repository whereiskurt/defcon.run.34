# Phase 13: Profile Check-in Display - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can view their check-in history on their profile page as both a paginated list and a Leaflet map with numbered markers and accuracy circles. This is a display-only feature on the existing whoami profile page -- no new routes, no CRUD actions (toggle privacy, delete are future work).

</domain>

<decisions>
## Implementation Decisions

### Map + list layout
- Collapsible card section on the whoami profile page, matching the existing QR/Quotas/Radios pattern (ChevronRight/Down toggle)
- Positioned after Quotas, before Meshtastic Radios
- Expanded by default (unlike QR/Quotas which are collapsed) -- check-ins are the main new feature
- Section header: "Check-ins ({count})" showing total check-in count
- Map at top of the section (350px height), check-in list below, pagination at bottom

### Check-in list content
- Each row shows: sequential number + relative time + accuracy + privacy badge
- Example: "#3 · 2 hours ago · +/-4m · Private"
- Sequential numbering from total checkInCount -- latest = highest number, counting down as you paginate
- Clicking a list row pans the map to that marker and opens its popup (two-way list-map linking)

### Map marker design
- Numbered circle markers using Leaflet divIcon -- number matches the check-in's sequential number in the list
- Always-visible semi-transparent accuracy circles around each marker showing GPS precision radius
- Color-coded by privacy: primary/blue for public, gray/muted for private
- Clicking a marker shows a Leaflet popup with time, accuracy, privacy status AND highlights/scrolls to the corresponding list row

### Pagination + map sync
- 5 check-ins per page (compact for mobile, clean marker count on map)
- HeroUI Pagination component with numbered page buttons
- Map shows only current page's markers (not all check-ins)
- Map auto-fits bounds to current page markers on every page change
- Initial view also auto-fits to first page markers

### Empty state
- When user has zero check-ins: show the Leaflet map centered on Las Vegas area with a message overlay ("No check-ins yet -- use GPS Check-in from the menu to get started")
- No list or pagination rendered in empty state

### Claude's Discretion
- Map tile provider (OpenStreetMap, dark theme tiles, etc.)
- Exact marker circle size and opacity for accuracy visualization
- Popup content layout and styling
- How to compute page numbers from cursor-based pagination (may need to fetch total count or use checkInCount)
- Whether to extract check-in section into its own component file or keep inline in whoami/page.tsx
- Transition animation when expanding/collapsing the section

</decisions>

<specifics>
## Specific Ideas

- DCR33 had check-ins on a map -- this is the DCR34 equivalent, now integrated into the profile page rather than a separate view
- Two-way linking between list and map: click a row to highlight on map, click a marker to highlight in list
- The map is the first interactive Leaflet map in run.human (map-background.tsx uses static tile images, not react-leaflet)
- Leaflet + react-leaflet are already in package.json -- no new dependencies needed

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `leaflet` + `react-leaflet` v5: Already in package.json with types, leaflet-defaulticon-compatibility for marker fixes
- `whoami/page.tsx`: Profile page with collapsible section pattern (ChevronRight/Down, useState toggle, glass-card)
- `QuotaBar` component: Reference for compact data display within profile sections
- `apiUrl()` helper: Base path-aware API calls
- `GET /api/checkins`: Returns `{data: CheckInItem[], cursor: string | null}` with cursor pagination
- `GET /api/user`: Returns `userData.checkInCount` for total count

### Established Patterns
- Collapsible sections: `useState` boolean + button with ChevronRight/Down + conditional render
- Card styling: `glass-card overflow-hidden` with `CardBody className="px-5 py-3"`
- Data fetching: `useEffect` + `fetch(apiUrl(...))` in whoami/page.tsx
- HeroUI components: Card, CardBody, Chip, Button, Pagination all available

### Integration Points
- `whoami/page.tsx`: Add new collapsible section between Quotas card and MeshtasticRadios component
- `GET /api/checkins` with `?limit=5` for page size -- cursor pagination for subsequent pages
- `userData.checkInCount` from existing `/api/user` fetch for sequential numbering and total display
- react-leaflet `MapContainer`, `TileLayer`, `Marker`, `Popup`, `Circle` for map components

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 13-profile-check-in-display*
*Context gathered: 2026-03-06*
