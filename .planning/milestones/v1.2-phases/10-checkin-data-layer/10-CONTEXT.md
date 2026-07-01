# Phase 10: CheckIn Data Layer - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Create a separate CheckIn ElectroDB entity on the `run-human-electro` DynamoDB table with all fields, two GSI indexes, and helper functions for CRUD + User entity side-effect updates. This is a port from DCR33's `apps/nx/apps/webapp/src/db/checkin.ts`.

</domain>

<decisions>
## Implementation Decisions

### Legacy cleanup
- Remove the inline `checkIns` list attribute from RunUser entity (lines 93-114 of run-user.ts)
- Remove the `CheckIn` type export (lines 322-333) — will be replaced by the new entity's types
- Keep denormalized fields on RunUser: `lastCheckInAt`, `checkInCount`, `checkinPreference` — fast profile reads without querying CheckIn table

### Schema scope
- Port the full DCR33 CheckIn schema including future-use fields (checkInType enum, otpCode, flagText, geoHash, s3Key)
- These are nullable and cost nothing to include — avoids schema migration when future check-in types are added
- Default `checkInType` to 'Basic' for v1.2

### Entity configuration
- `service: 'run'` — match RunUser, same table namespace
- Table: `run-human-electro` (shared with RunUser)
- Use `electroClient` from existing `entities/client.ts`

### GSI mapping
- Use gsi2 + gsi3 (NOT gsi1, which RunUser uses for byHash)
- `byGlobalRecent`: gsi2pk-gsi2sk-index — PK: `TYPE#CHECKIN`, SK: timestamp
- `byUserRecent`: gsi3pk-gsi3sk-index — PK: userId, SK: timestamp
- Clean separation between entities, plenty of GSI headroom (20 max)

### Claude's Discretion
- Helper function signatures and error handling patterns
- GPSSample interface structure (port from DCR33)
- Distance calculation approach
- File organization within `src/entities/`

</decisions>

<specifics>
## Specific Ideas

- DCR33 reference file: `/Users/khundeck/working/defcon.run.33/apps/nx/apps/webapp/src/db/checkin.ts`
- Port the full entity definition, GPSSample interface, and helper functions (createCheckIn, getCheckInsByUser, getRecentCheckIns, getCheckIn, deleteCheckIn, updateCheckInPrivacy)
- DCR34 uses userId (not email) for auth — adapt helper functions accordingly (DCR33 used email-based lookups)
- DCR34 quota system is centralized in run.auth via quota-middleware.ts — don't duplicate quota logic in entity helpers (that belongs in API routes, Phase 11)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `electroClient` + `ELECTRO_TABLE` from `src/entities/client.ts` — DynamoDB document client ready to use
- `getRunUser()`, `updateRunUserProfile()` from `src/entities/run-user.ts` — for side-effect updates
- `requireAndConsumeQuota()` from `src/lib/quota-middleware.ts` — quota enforcement (used in Phase 11, not here)

### Established Patterns
- ElectroDB entity definition pattern: see RunUser entity in `src/entities/run-user.ts`
- Entity exports: entity instance + helper functions + type definitions
- RunUser uses `watch: "*"` on `updatedAt` for auto-timestamp
- RunUser uses `readOnly: true` on `createdAt`

### Integration Points
- New file: `src/entities/checkin.ts` (alongside `run-user.ts` and `client.ts`)
- RunUser entity: remove `checkIns` list, keep denormalized fields
- DynamoDB table: needs gsi2 and gsi3 provisioned (or confirm they exist)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 10-checkin-data-layer*
*Context gathered: 2026-03-05*
