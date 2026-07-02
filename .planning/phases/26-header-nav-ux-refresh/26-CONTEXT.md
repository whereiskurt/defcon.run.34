# Phase 26: Header/Nav UX Refresh - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning
**App:** `apps/run.human` (run.defcon.run) — single deploy

<domain>
## Phase Boundary

Fix the run.defcon.run header: remove Leaderboard entirely, replace the dead
`/meshtastic` link with a real "this or that" Meshtastic landing page (Flash vs.
MQTT network), keep Maps pointing at gpx.defcon.run, and surface an admin-only
CMS link. Pure `run.human` frontend work — one build, one deploy. The CMS
incognito auth bug is a separate concern (Phase 27, different app).

</domain>

<decisions>
## Implementation Decisions

### Wave 1 — Header cleanup (ship first, lowest risk)
- **`src/components/header/header.tsx`:** remove the Leaderboard entry from
  `navItems`; drop the now-unused `FaTrophy` import. Keep Maps →
  `https://gpx.defcon.run` (already correct — no change). Point Meshtastic at
  the new in-app `/meshtastic` route (built in Wave 2), keeping the `basePath`
  region prefix so `${basePath}/meshtastic` resolves per region.
- **`src/components/header/dropdown-menu.tsx`:** remove the Leaderboard
  `DropdownItem` and the `FaTrophy` import; keep Maps (external window.open to
  gpx.defcon.run), Meshtastic → `${basePath}/meshtastic`, Who Am I, FAQ.
- **Note:** there is currently NO `/leaderboard` or `/meshtastic` page route
  (`src/app/(public)` / `(protected)` only contain page, whoami, strapi/debug).
  Both existing nav links are dead — this is the "wrong URLs" bug. Removing
  Leaderboard and building Meshtastic (Wave 2) resolves both.

### Wave 2 — Meshtastic "this or that" landing page
- **New route:** `src/app/(public)/meshtastic/page.tsx` — PUBLIC (recommended
  default). flash.defcon.run and mqtt.defcon.run are public services and the nav
  is visible to logged-out users, so no login gate. (Flip to `(protected)/` if a
  members-only chooser is preferred.)
- **Two tiles**, "this or that" chooser:
  - **Flash & Join** → `https://flash.defcon.run` — flash firmware + join the
    Meshtastic network. Heltec / board graphic.
  - **Network** → `https://mqtt.defcon.run` — bots + realtime viz of MQTT
    network participants. Map / mesh graphic.
- **Design language** (reuse existing tokens, already used in the CMS branded
  pages and run.human globals): `glass-card` (bg `rgba(17,17,24,0.8)`,
  `backdrop-filter: blur(12px)`, border `#2a2a3a`, radius 12px), teal accent
  `#00d4aa` (`teal-dot`), MuseoModerno wordmark font, base bg `#0a0a0f`, HeroUI
  Card/Link primitives.
- **Layout:** two tiles side-by-side on desktop (`sm:flex`), stacked on mobile.
  Hover lift + teal glow to echo `.glass-card:hover`.

### Wave 3 — CMS-group-gated CMS link
- Gate on the existing session claim: `session.user.services.includes('cms')`
  — the SAME `cms` service that `run.cms` itself requires for admin access
  (`apps/run.cms/.../strapi-server.ts` + `services-validation.ts`,
  `REQUIRED_SERVICE = 'cms'`). So the link is shown to exactly the users who can
  actually sign in to the CMS. (Note: `isAdmin()` in
  `src/app/api/admin/quota/route.ts` checks `services.includes('admin')` — a
  DIFFERENT group; do NOT reuse it here. Use `cms`.) The `services` array is
  already populated on the session (`src/config/auth.ts`).
- Placement: inside the user dropdown (`src/components/header/dropdown-user.tsx`),
  gated on the `cms` service (recommended default — keeps the shared top nav
  clean). Label "CMS" → `https://cms.defcon.run` (external, new tab). (Flip to a
  conditional top-nav item if more prominence is wanted.)

</decisions>

<specifics>
## Specific Ideas
- Graphics: prefer existing DC34 assets (`apps/run.mqtt/nginx/dc34-logo*.webp`,
  run.human `public/`) or lightweight inline SVG for the Heltec-vs-map tiles to
  avoid new heavy image deps. A simple board silhouette + a node-mesh/map motif
  reads as "hardware vs. network."
- Keep the page < 100 lines where possible (AGENTS.md simplicity rule); a single
  page.tsx with two Card components and inline SVG is sufficient.
- Active-state highlight: the header's `isActive` check uses
  `pathname?.startsWith(href)` for internal links — the new `/meshtastic` route
  will light up correctly once it exists.

</specifics>

<code_context>
## Existing Code Insights
- `src/components/header/header.tsx` — desktop `navItems` array (Maps/Leaderboard/
  Meshtastic), `basePath` = `/${REGION_SHORT}` in prod, `''` in dev.
- `src/components/header/dropdown-menu.tsx` — mobile hamburger items.
- `src/components/header/dropdown-user.tsx` — avatar/user menu (target for CMS link).
- `src/config/auth.ts` — session `services: string[]` claim (scope "... services").
- `src/app/api/admin/quota/route.ts:10` — `isAdmin()` = `services.includes('admin')`.
- `src/app/(public)/` — layout.tsx + page.tsx only; new meshtastic route lands here.
- Design tokens mirrored in `apps/run.cms/.../strapi-server.ts` renderBrandedError
  (glass-card, teal-dot #00d4aa, MuseoModerno, #0a0a0f) — reuse for tile page.

</code_context>

<deferred>
## Deferred Ideas
- Realtime participant count / live MQTT node badge on the Network tile → after
  mqtt.defcon.run exposes a public count endpoint.
- FAQ content refresh (nav item exists but out of scope here).

</deferred>

---
*Phase: 26-header-nav-ux-refresh*
*Context gathered: 2026-07-02*
