# Phase 5: Infrastructure Hardening + Content Type Schemas - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix worker litestream sync safety (WAL/SHM corruption) and upgrade S3 upload provider to Strapi 5 format. Define all three content type schemas (Event, Route, POI) with a shared coordinates component, committed to git. Relations between types are Phase 6.

</domain>

<decisions>
## Implementation Decisions

### POI type taxonomy
- DEF CON-flavored POI types: water station, rest stop, start/finish, aid station, photo opportunity, scenic viewpoint, lockpick village, badge station, swag drop, RF check-in (Meshtastic), vendor, social gathering spot
- Implemented as Strapi enumeration field

### Distance units
- Kilometres stored in CMS (canonical unit)
- UI in run.human handles conversion to miles and steps for display
- Single decimal field for distance in km

### Rich text fields
- Use Strapi 5's built-in blocks editor (rich text) for event and route descriptions
- Matches existing `@strapi/blocks-react-renderer` already in run.human dependencies
- Capabilities: headings, bold, italic, lists, links, inline images

### Photo gallery (Events)
- Simple multi-upload using Strapi's built-in media (multiple files) field
- No per-image captions or structured gallery components
- Organizer uploads photos, they display in upload order

### GPX files (Routes)
- Multiple GPX files per route (multi-media field)
- Allows variants (full route + shortcut, etc.)
- Requirements say "GPX files" (plural) — confirmed

### Upload limits
- Rely on Strapi's global upload size limits in server config
- No per-field size restrictions needed for small organizer team (3-5 people)

### Difficulty
- NOT a stored field — difficulty is derived from distance, elevation, GPX data, etc.
- Computed at display time in run.human, not entered by organizers in CMS
- Remove difficulty from the Route schema

### Route types
- Three types: street, indoor, trail
- Implemented as Strapi enumeration field

### Claude's Discretion
- Map styling field implementation (color/weight/opacity inputs)
- Admin sidebar organization and content type grouping
- Coordinate precision for lat/lng fields
- Sort order field implementation
- Worker sync fix approach (technical — safe WAL/SHM handling)
- S3 provider upgrade approach (v4 to v5 config format)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `@strapi/blocks-react-renderer@1.0.2`: Already in run.human for rendering Strapi rich text blocks
- `@strapi/provider-upload-aws-s3@4.15.0`: Currently installed but needs upgrade to v5 format
- `apps/run.cms/app/config/plugins.ts`: S3 upload config with CloudFront CDN URL construction and `rootPath` pattern
- `apps/run.cms/app/src/api/health/`: Only existing custom API — pattern for adding new content type APIs

### Established Patterns
- CMS uses SQLite + Litestream replication (master writes, workers read)
- S3 media path: `{regionShort}/cms/` with CloudFront base URL `https://cms.{siteDomain}`
- No custom content types exist yet — all schemas are Strapi defaults (admin, plugins)
- Plugin config in `apps/run.cms/app/config/plugins.ts` handles dev/prod branching

### Integration Points
- Worker sync script: `apps/run.cms/app/litestream-sync.sh` — uses `mv` swap (needs fix for WAL/SHM safety)
- Content type schemas will be created in `apps/run.cms/app/src/api/{type}/` (Strapi convention)
- Generated types land in `apps/run.cms/app/types/generated/contentTypes.d.ts`
- Strapi 5 auto-generates REST API routes for content types

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-infrastructure-hardening-content-type-schemas*
*Context gathered: 2026-03-02*
