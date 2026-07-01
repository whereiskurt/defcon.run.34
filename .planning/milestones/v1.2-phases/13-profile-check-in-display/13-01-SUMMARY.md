---
phase: 13-profile-check-in-display
plan: 01
status: complete
---

## Accomplishments

- Created CheckInHistory component with Leaflet map, numbered markers, accuracy circles, and paginated list
- Two-way map-list linking: click list item zooms to marker, click marker highlights list row
- Relative age coloring: newest check-in is bright blue, oldest fades to dark navy
- Delete check-in with confirmation modal
- Quick check-in button (+ icon) integrated into section header
- Auto-refresh and auto-select newest after successful check-in
- Dark/light theme support for map tiles, zoom controls, and popups
- Condensed popup layout with source type, coordinates, copy button, and external map links (gpx.studio, OSM, Google Maps)
- CheckInModal enhanced: mini map preview with accuracy circle, Select dropdown for visibility, theme-aware tiles, primary (teal) color scheme
- Infrastructure: Added gsi3pk-gsi3sk-index to both Terraform module and local DynamoDB init script

## Files Modified

- `apps/run.human/webapp/src/components/profile/CheckInHistory.tsx` (NEW) - Main deliverable
- `apps/run.human/webapp/src/components/CheckInModal.tsx` - Mini map, Select dropdown, theme tiles, primary colors
- `apps/run.human/webapp/src/app/(protected)/whoami/page.tsx` - Integrated CheckInHistory, widened to 900px, Strava linking chip
- `apps/run.human/webapp/src/styles/globals.css` - Dark theme Leaflet overrides
- `apps/run.human/webapp/src/components/header/header.tsx` - Nav: Routes->Maps, removed HeatMap/Contributors
- `apps/run.human/webapp/src/components/header/dropdown-menu.tsx` - Mobile dropdown matching nav changes
- `apps/local/dynamodb/init-local-db.sh` - Added gsi3 to run-human-electro table
- `infra/terraform/modules/dynamodb/v1.0.0/main.tf` - Added gsi3 to electro schema
- `apps/run.auth/webapp/src/app/(authlogin)/strava/page.tsx` - autoLink param for seamless OAuth flow

## Beyond Original Plan

- Strava linking chip on profile (clickable with autoLink OAuth flow)
- Nav simplification (Routes->Maps, removed HeatMap/Contributors)
- Page width matched to header (900px)
- Coordinate copy-to-clipboard button
- External map links (gpx.studio, OSM, Google Maps)
- Source type label in popup ("Web" — future: Meshtastic)
