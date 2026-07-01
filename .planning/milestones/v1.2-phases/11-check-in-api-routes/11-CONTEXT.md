# Phase 11: Check-in API Routes - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Authenticated users can create, list, toggle privacy, delete check-ins, and set their default privacy preference through API endpoints. All CRUD operations use the CheckIn entity helpers from Phase 10. Quota enforcement via existing quota-middleware. No UI work (Phase 12-13).

</domain>

<decisions>
## Implementation Decisions

### Route structure
- Single file: `src/app/api/checkins/route.ts` with GET, POST, PATCH, DELETE handlers
- Matches existing meshtastic-radios pattern (single route file for CRUD)
- DELETE identifies check-in via `?checkinId=X` query param
- PATCH identifies check-in via `{checkinId}` in request body
- Client sends only `checkinId` -- server resolves full composite key (userId + timestamp + checkInId) by querying the by-user-recent index. No need for client to track timestamps.

### Response format
- POST returns the full created check-in object (all computed fields: averageCoordinates, bestAccuracy, duration, etc.) plus `{quota: {remaining}}`
- GET returns paginated list with `{data: CheckInItem[], cursor: string | null}`
- PATCH returns the updated check-in
- DELETE returns `{success: true}`

### Quota behavior
- Quota consumed on create via `requireAndConsumeQuota(userId, "checkin", 1, tier)` + `handleQuotaError()` pattern
- No quota restore on delete (same policy as meshtastic radios -- prevents gaming)
- Quota remaining included only in POST response, not GET/PATCH/DELETE

### Privacy preference (UI-04)
- Add PATCH handler to existing `/api/user/route.ts` for updating `checkinPreference`
- Accepts `{checkinPreference: "public" | "private"}` -- checkin-only, not a generic preferences endpoint
- When creating a check-in: if POST body omits `isPrivate`, server looks up user's `checkinPreference` and applies it as the default

### Input validation
- GPS samples: validate non-empty array, each sample has lat/lng/accuracy/timestamp as numbers, lat in [-90,90], lng in [-180,180]
- Source field: accept any string (informational, not restricted)
- Pagination: default page size 20 (matches entity helper), max cap at 100

### Claude's Discretion
- Error message wording and HTTP status code choices beyond the obvious (401, 404, 429)
- How to resolve checkinId to full composite key (query approach, error handling for not-found)
- Auth pattern details (follows existing `auth()` + `session.user.id` pattern)

</decisions>

<specifics>
## Specific Ideas

- Follow meshtastic-radios/route.ts as the primary pattern reference -- it demonstrates the auth + quota + CRUD pattern this phase needs
- The CheckIn entity helpers (`createCheckIn`, `getCheckInsByUser`, `updateCheckInPrivacy`, `deleteCheckIn`) handle all DynamoDB operations and RunUser side effects -- routes just wire auth, validation, quota, and call helpers
- `getUserTier(session.user.services)` for quota tier determination

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `requireAndConsumeQuota()` + `handleQuotaError()` from `src/lib/quota-middleware.ts` -- battle-tested quota pattern
- `auth()` from `@auth` -- session/user extraction
- `getUserTier()` from quota-middleware -- tier from services array
- `getRunUser()` from `src/entities/run-user.ts` -- for looking up checkinPreference default
- All CheckIn entity helpers from `src/entities/checkin.ts` -- createCheckIn, getCheckInsByUser, getCheckIn, deleteCheckIn, updateCheckInPrivacy

### Established Patterns
- API route pattern: auth check -> input validation -> quota check -> entity operation -> response (see meshtastic-radios/route.ts)
- Quota error response: HTTP 429 with structured `{error, code, details}` via `quotaExceededResponse()`
- User preferences stored in RunUser entity `preferences` map (e.g., `preferences.checkinPreference`)

### Integration Points
- New file: `src/app/api/checkins/route.ts`
- Modified file: `src/app/api/user/route.ts` (add PATCH handler)
- RunUser entity: read `preferences.checkinPreference` for default privacy on create
- Quota service: "checkin" quota ID already registered in PROFILE_QUOTA_IDS

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 11-check-in-api-routes*
*Context gathered: 2026-03-05*
