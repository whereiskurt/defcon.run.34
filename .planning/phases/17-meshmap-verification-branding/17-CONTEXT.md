# Phase 17: Meshmap Verification + Branding - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Port the DC33 meshmap single-page HTML application to DC34. Replace the placeholder `apps/mqtt/nginx/index.html` with the full meshmap from `~/working/defcon.run.33/apps/mqtt/nginx/meshmap/meshmap.net/website/`. Update all DC33 references to DC34, verify all features work (live nodes, topology lines, search, clustering, dark mode, opacity fade, ghost mode). Copy supporting assets (logo, favicon, manifest).

</domain>

<decisions>
## Implementation Decisions

### DC34 Branding
- Page title: "run.defcon.run" (with carrot emoji, same as DC33)
- Header link text: "run.defcon.run" linking to https://run.defcon.run
- Create dc34-logo-transp.webp for header (replace dc33-logo-transp.webp)
- DC logo links to defcon.meshtastic.org (same pattern as DC33, update if DC34 page exists)
- Keep GitHub link to brianshea2/meshmap.net (credit upstream source)
- Update all dc33 string references to dc34 throughout the HTML
- Copy all favicon/manifest/logo assets, update for DC34

### Node Color Scheme
- Update longName prefix checks from `dc33.*` to `dc34.*` (dc34.east=purple, dc34.bigstar=darkblue, dc34.*=orange)
- Default non-fleet node color remains red
- Ghost mode Matrix green (#00ff00) unchanged
- Ghost node detection logic unchanged: checks for 'ghost', 'contest', 'operative' in longName or 'ghost' prefix in shortName

### CDN Dependencies
- Keep all external CDN loads from unpkg.com (Leaflet, font-awesome, leaflet-easybutton, leaflet-search, leaflet.markercluster)
- Keep Google Fonts for Inter font family
- No vendoring — meshmap is non-critical, if CDN is down MQTT broker still works

### nodes.json Fetch Path
- Update fetch URL from `/map/nodes.json` to `/nodes.json` to match DC34 nginx.conf (root serving, no /map/ prefix)
- Also update the preload link href in the HTML head

### Ghost Mode / Easter Egg
- Keep both triggers: Konami code (desktop) and 10x rapid theme toggle in 4s (mobile)
- Keep same accomplishment API identifiers: type=meshctf, name=mobilemode_on_meshmap
- Remove QR redirect behavior — API call only (no window.open to /qr/ URL)
- On ghost mode activation: just show the "GHOST MODE ACTIVATED" flash, accomplishment recording is silent
- Keep same visual effect: hue-rotate(90deg) saturate(1.5) CSS filter, ghost SVG icons, Matrix green markers
- Keep "GHOST MODE DEACTIVATED" flash on toggle off

### Claude's Discretion
- DC34 logo image creation approach (placeholder or sourced from existing assets)
- manifest.json icon updates
- Any minor HTML/CSS cleanup during the port (whitespace, formatting)
- Whether to update the site.webmanifest name/description fields

</decisions>

<specifics>
## Specific Ideas

- The DC33 meshmap source is at `~/working/defcon.run.33/apps/mqtt/nginx/meshmap/meshmap.net/website/`
- It's a single index.html (~570 lines) with inline CSS and JS — no build step needed
- Supporting assets: dc33-logo-transp.webp, dc33-logo.webp, favicon.ico, apple-touch-icon.png, android-chrome-*.png, site.webmanifest
- The accomplishment API URL pattern: `${location.protocol}//${location.hostname.replace('mqtt', 'run')}/api/user/accomplishments` — this dynamically resolves mqtt.defcon.run to run.defcon.run
- Ghost mode flash messages are base64 encoded in DC33 (atob calls) — keep this obfuscation

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/mqtt/nginx/index.html`: Current placeholder — will be replaced entirely
- `apps/mqtt/nginx/nginx.conf`: Already configured to serve root with no-cache on nodes.json
- `apps/mqtt/nginx/Dockerfile.nginx`: Copies website files from apps/mqtt/nginx/ into /var/www/html/
- DC33 source: `~/working/defcon.run.33/apps/mqtt/nginx/meshmap/meshmap.net/website/` — complete meshmap with all assets

### Established Patterns
- nginx serves static files from /var/www/html/ (Dockerfile.nginx COPY pattern)
- nodes.json written by meshobserv every 10s to /var/www/html/nodes.json
- ECS health check on GET / port 80

### Integration Points
- `apps/mqtt/nginx/index.html` — replaced with ported meshmap
- `apps/mqtt/nginx/*.webp`, `apps/mqtt/nginx/*.png`, `apps/mqtt/nginx/*.ico` — new asset files copied by Dockerfile
- `apps/mqtt/nginx/site.webmanifest` — new manifest file
- Accomplishment API on run.defcon.run — called from meshmap JS (must be deployed and accepting requests)

</code_context>

<deferred>
## Deferred Ideas

- Ghost fleet container and GPX movement — Phase 18 (FLEET-01, FLEET-02)
- Ghost mode easter egg trigger refinement — Phase 18 (FLEET-03, FLEET-04) handles the fleet side; Phase 17 ports the existing HTML hooks as-is

</deferred>

---

*Phase: 17-meshmap-verification-branding*
*Context gathered: 2026-03-07*
