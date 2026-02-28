# Phase 1: App Scaffold + Device Picker - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Next.js app scaffold for flash.defcon.run with browser compatibility gate (Web Serial detection), OIDC authentication via auth.defcon.run, ESP32 device picker from vendored hardware-list.json, and wizard flow skeleton (5 steps: Pick Device / Connect / Flash / Configure / Done). No serial port interaction in this phase — Connect/Flash/Configure steps are placeholder shells.

</domain>

<decisions>
## Implementation Decisions

### Device Picker Layout
- Card grid layout, 3-4 cards per row on desktop
- Device SVGs displayed prominently for visual hardware identification
- Each card shows: device image, display name, manufacturer tag, and chip architecture badge (ESP32, ESP32-S3, etc.)
- Selecting a card highlights it and a "Select this device" confirm button advances to the Connect step
- Show ALL ESP32 devices from hardware-list.json, with tested/recommended devices badged

### Device Filtering
- Search bar + clickable manufacturer tabs (RAK, Heltec, LilyGo, etc.) to filter the grid
- Recommended/tested devices pinned at top of the grid with a "Recommended" badge, rest below
- Default sort: recommended first, then alphabetical by name
- When device not found: show help text ("Can't find your device? It may not be ESP32-based or supported by Meshtastic.") with link to Meshtastic's full flasher

### Wizard Flow Design
- Horizontal stepper bar across the top showing all 5 steps: Pick Device → Connect → Flash → Configure → Done
- Future steps visible but disabled/grayed-out — users see the full journey ahead
- Back navigation: click any previous completed step in the stepper to return
- In-progress steps (later phases): Claude decides per step whether full-width progress panel or inline
- Step validation: each step must complete before advancement

### Visual Identity
- Same dark theme and DCR34 branding as run.human, but simplified wizard-focused layout
- Minimal header: logo + "flash.defcon.run" + user avatar/logout. No nav links — the wizard IS the app
- Hacker/cyberpunk visual feel — terminal-esque, green-on-dark, matrix vibes. Fits DEF CON aesthetic
- HeroUI components + Tailwind 4 for consistency with monorepo

### Claude's Discretion
- Exact card dimensions and responsive breakpoints
- Stepper component implementation (custom or HeroUI-based)
- Animation and transition patterns between wizard steps
- Loading/skeleton states during data hydration
- Mobile responsive behavior for card grid

</decisions>

<specifics>
## Specific Ideas

- "Hacker/cyberpunk feel" — terminal-esque, green-on-dark, matrix vibes. The flasher should feel like a DEF CON tool, not a generic web app.
- Device cards should help non-technical users visually identify their physical hardware — SVG images are critical.
- The wizard should build confidence — users know exactly where they are and what's coming next.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/run.gpx/webapp/src/config/auth.ts`: Complete OIDC client config pattern with session validation, cookie naming, and region-aware URL construction. Copy and adapt for run.flash.
- `apps/run.human/webapp/src/components/header/`: Header component patterns with dropdown menus, icons, login/logout
- HeroUI Card, Button, Input, Chip, Badge components available across the monorepo
- Tailwind 4 dark theme setup already established

### Established Patterns
- **Auth pattern**: OIDC client → auth.defcon.run with `run.defcon.run` provider, JWT session, cookie naming convention (`sess_flash`, `csrf_flash`, etc.)
- **App structure**: `apps/run.{name}/webapp/` with `src/app/` (Next.js App Router), `src/config/`, `src/components/`
- **Path aliases**: `@/*` mapping to `./src/*`, `@components/*` to `./src/components/*`
- **Region-aware URLs**: `isDev` toggle between localhost and `https://{subdomain}.defcon.run/{region}`
- **TypeScript strict mode**: All Next.js apps use `strict: true`

### Integration Points
- OIDC client registration needed in `apps/run.auth/webapp/src/config/oidc.ts` (add flash.defcon.run as OIDC client)
- `hardware-list.json` vendored as static data in `apps/run.flash/webapp/public/data/` or imported directly
- Next.js basePath will need region prefix in production (`/{REGION_LABEL}`)
- Dockerfile.webapp + Dockerfile.nginx following existing dual-container pattern

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-app-scaffold-device-picker*
*Context gathered: 2026-02-28*
