# Tasks: Centralize Quota Service in run.auth

## Phase 1: Infrastructure & Core Service

### 1.1 Create DynamoDB table
- [ ] Add Terraform module for `run-quota` DynamoDB table
- [ ] Configure GSI for quota queries (byQuotaRemaining)
- [ ] Set up table in both us-east-1 and ca-central-1
- [ ] **Verify:** Table accessible from run.auth

### 1.2 Add quotaTier to AuthProfile
- [ ] Add `quotaTier` field to AuthProfile entity (`zero | upload | admin`)
- [ ] Default to `upload` for new users
- [ ] Update session validation to include quotaTier in response
- [ ] **Verify:** quotaTier returned in `/api/session/validate`

### 1.3 Copy quota core to run.auth
- [ ] Copy `lib/quota-definitions.ts` from run.human
- [ ] Copy `services/quota.ts` from run.human
- [ ] Create `entities/user-quota.ts` (point to run-quota table)
- [ ] Update imports and table references
- [ ] **Verify:** Quota service initializes without errors

## Phase 2: User Quota API Endpoints

### 2.1 GET /api/quota
- [ ] Create `apps/run.auth/webapp/src/app/api/quota/route.ts`
- [ ] Require session authentication
- [ ] Return all initialized quotas for authenticated user
- [ ] Include remaining, initialAmount, quotaId for each
- [ ] **Verify:** Returns quota list for logged-in user

### 2.2 GET /api/quota/{quotaId}
- [ ] Create `apps/run.auth/webapp/src/app/api/quota/[quotaId]/route.ts`
- [ ] Require session authentication
- [ ] Return specific quota details
- [ ] Auto-initialize if quota doesn't exist
- [ ] **Verify:** Returns single quota record

### 2.3 POST /api/quota/{quotaId}/check
- [ ] Add POST handler to quota/[quotaId] route
- [ ] Accept `amount` in body (default 1)
- [ ] Read-only check, no consumption
- [ ] Return `{ allowed: boolean, remaining, requested }`
- [ ] **Verify:** Check doesn't decrement quota

### 2.4 POST /api/quota/{quotaId}/consume
- [ ] Create `apps/run.auth/webapp/src/app/api/quota/[quotaId]/consume/route.ts`
- [ ] Require session authentication
- [ ] Accept `amount` in body (default 1)
- [ ] Use atomic DynamoDB conditional update
- [ ] Return 429 if quota exceeded
- [ ] **Verify:** Consume decrements remaining

### 2.5 POST /api/quota/{quotaId}/restore
- [ ] Create `apps/run.auth/webapp/src/app/api/quota/[quotaId]/restore/route.ts`
- [ ] Require session authentication
- [ ] Accept `amount` in body (default 1)
- [ ] Cap at initialAmount
- [ ] **Verify:** Restore increments remaining

### 2.6 GET /api/quota/definitions
- [ ] Create `apps/run.auth/webapp/src/app/api/quota/definitions/route.ts`
- [ ] Return QUOTA_DEFINITIONS (public, no auth required)
- [ ] Include name, limits by tier, resetPolicy
- [ ] **Verify:** Returns all quota type definitions

## Phase 3: Internal Service-to-Service API

### 3.1 GET /api/internal/quota/{userId}
- [ ] Create `apps/run.auth/webapp/src/app/api/internal/quota/[userId]/route.ts`
- [ ] Require `X-Internal-Secret` header
- [ ] Return all quotas for specified user
- [ ] **Verify:** Works with valid secret, rejects invalid

### 3.2 POST /api/internal/quota/{userId}/{quotaId}/consume
- [ ] Create `apps/run.auth/webapp/src/app/api/internal/quota/[userId]/[quotaId]/consume/route.ts`
- [ ] Require `X-Internal-Secret` header
- [ ] Accept `amount` and `tier` in body
- [ ] Auto-initialize quota if needed (using provided tier)
- [ ] **Verify:** Backend can consume quota for any user

### 3.3 POST /api/internal/quota/{userId}/{quotaId}/restore
- [ ] Create `apps/run.auth/webapp/src/app/api/internal/quota/[userId]/[quotaId]/restore/route.ts`
- [ ] Require `X-Internal-Secret` header
- [ ] Accept `amount` in body
- [ ] **Verify:** Backend can restore quota for any user

## Phase 4: Admin API

### 4.1 GET /api/admin/quota/{userId}
- [ ] Create `apps/run.auth/webapp/src/app/api/admin/quota/[userId]/route.ts`
- [ ] Require admin session OR X-Internal-Secret
- [ ] Return all quotas with full details
- [ ] Include consumption history if available
- [ ] **Verify:** Admin can view any user's quotas

### 4.2 POST /api/admin/quota/{userId}/{quotaId}/reset
- [ ] Add reset endpoint
- [ ] Reset remaining to initialAmount
- [ ] Log reset action
- [ ] **Verify:** Reset restores quota to tier limit

### 4.3 POST /api/admin/quota/{userId}/{quotaId}/set
- [ ] Add set-limit endpoint
- [ ] Accept `newLimit` and optional `resetToNewLimit`
- [ ] For VIP/sponsor overrides
- [ ] **Verify:** Custom limits take effect

### 4.4 POST /api/admin/quota/upgrade-tier
- [ ] Add bulk tier upgrade endpoint
- [ ] Accept `userId`, `newTier`, optional `quotaIds[]`
- [ ] Update AuthProfile.quotaTier
- [ ] Upgrade all or specified quotas
- [ ] **Verify:** Tier upgrade increases limits

### 4.5 POST /api/admin/quota/cleanup-stale
- [ ] Add cleanup endpoint
- [ ] Accept `maxAgeHours`, `limit`
- [ ] Find and restore stale pending quotas
- [ ] Return cleanup statistics
- [ ] **Verify:** Stale quotas cleaned up

## Phase 5: Client Libraries

### 5.1 Create quota client for run.human
- [ ] Create `apps/run.human/webapp/src/lib/quota-client.ts`
- [ ] Use `privateAuthServer` URL for backend calls
- [ ] Include `X-Internal-Secret` header
- [ ] Implement: checkQuota, consumeQuota, restoreQuota
- [ ] Handle errors, return typed results
- [ ] **Verify:** Client can make quota API calls

### 5.2 Update run.human middleware
- [ ] Modify `lib/quota-middleware.ts` to use quota-client
- [ ] Keep same interface (tryConsumeQuota, requireQuota, etc.)
- [ ] Add feature flag for gradual rollout
- [ ] **Verify:** Existing code works with new middleware

### 5.3 Create quota client for run.gpx
- [ ] Create `apps/run.gpx/webapp/src/lib/quota-client.ts`
- [ ] Same pattern as run.human client
- [ ] **Verify:** run.gpx can call quota APIs

## Phase 6: Migration & Integration

### 6.1 Migrate existing quota data
- [ ] Create migration script to copy run.human quota data
- [ ] Transform keys for new table format
- [ ] Validate data integrity post-migration
- [ ] **Verify:** All existing quotas migrated

### 6.2 Update run.human API routes
- [ ] Update `/api/upload/presign` to use quota-client
- [ ] Update `/api/meshtastic-radios` to use quota-client
- [ ] Update `/api/admin/quota` to proxy to auth
- [ ] Update `/api/user` to fetch quotas from auth
- [ ] **Verify:** All quota operations use central service

### 6.3 Remove local quota code from run.human
- [ ] Delete `lib/quota-definitions.ts`
- [ ] Delete `services/quota.ts`
- [ ] Delete `entities/user-quota.ts`
- [ ] Update imports across codebase
- [ ] **Verify:** No local quota code remains

### 6.4 Integrate run.gpx with quota service
- [ ] Add quota checks to GPX upload presign
- [ ] Handle quota exceeded responses
- [ ] Display quota info in UI (optional)
- [ ] **Verify:** GPX uploads respect quotas

## Phase 7: Testing & Verification

### 7.1 API testing
- [ ] Test all user quota endpoints with curl
- [ ] Test all internal endpoints with X-Internal-Secret
- [ ] Test all admin endpoints
- [ ] Test error responses (401, 403, 429, etc.)

### 7.2 Integration testing
- [ ] Test run.human upload flow end-to-end
- [ ] Test run.gpx upload flow end-to-end
- [ ] Test quota consumption and restoration
- [ ] Test concurrent consume operations (race conditions)

### 7.3 Load testing
- [ ] Simulate high-concurrency quota operations
- [ ] Verify atomic operations don't lose counts
- [ ] Check DynamoDB capacity under load

## Dependencies

```
Phase 1 (Infrastructure)
    ↓
Phase 2 (User API) + Phase 3 (Internal API) + Phase 4 (Admin API)
    ↓
Phase 5 (Client Libraries)
    ↓
Phase 6 (Migration)
    ↓
Phase 7 (Testing)
```
