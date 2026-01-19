# Tasks: Add GPX Upload Security Controls

## Phase 1: Infrastructure Setup

### 1.1 Create constants file
- [x] Create `apps/run.gpx/webapp/src/lib/constants.ts`
- [x] Add `MAX_GPX_FILE_SIZE = 10 * 1024 * 1024` (10 MB)
- [x] Add `PRESIGN_EXPIRY_SECONDS = 3600`

### 1.2 Copy quota system from run.human
- [x] Quota client already exists at `lib/quota-client.ts`
- [x] Uses centralized quota service in run.auth
- [x] **Verify:** Quota definitions match: zero=0, upload=50, admin=500

### 1.3 Create GPX validator
- [x] Create `apps/run.gpx/webapp/src/lib/gpx-validator.ts`
- [x] Implement `validateGpxFile(key)` function
- [x] Fetch first 1KB from S3 to check header
- [x] Verify `<gpx>` root element exists
- [x] Return `{ valid: boolean, error?: string }`

## Phase 2: API Changes

### 2.1 Add file size validation to presign
- [x] Update `POST /api/gpx/files` route
- [x] Check `fileSize` parameter against MAX_GPX_FILE_SIZE
- [x] Return 413 if exceeded with clear error message
- [x] Add ContentLength to PutObjectCommand
- [ ] **Verify:** 15 MB upload attempt returns 413

### 2.2 Add quota consumption to presign
- [x] Import quota service in files route
- [x] Determine user tier from session
- [x] Call `consumeQuota()` before generating presign
- [x] Return 429 if quota exceeded with remaining/limit info
- [x] Add `status: 'pending'` to file record
- [x] Include `quotaRemaining` in response
- [ ] **Verify:** 51st upload returns 429 for regular user

### 2.3 Create confirmation endpoint
- [x] Create `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/confirm/route.ts`
- [x] Add auth checks (session, service, ownership)
- [x] Verify file status is 'pending'
- [x] Call `validateGpxFile()` with S3 key
- [x] If valid: update status to 'active'
- [x] If invalid: delete S3 object, mark as failed, restore quota
- [x] Return appropriate success/error response
- [ ] **Verify:** .txt file uploaded as .gpx fails validation

### 2.4 Update file record entity
- [x] Add `status` field to GpxFile entity (pending/active/failed)
- [x] Add GSI for querying by status (for cleanup)
- [x] Filter file listing to only show active files
- [ ] **Verify:** Entity changes don't break existing queries

## Phase 3: Client Updates

### 3.1 Update cloud-sync.ts upload flow
- [x] Handle 413 (file too large) response with FileTooLargeError
- [x] Handle 429 (quota exceeded) response with QuotaExceededError
- [x] Add confirm API call after S3 upload
- [x] Handle confirm failures (invalid GPX)
- [x] Client-side file size check for better UX

### 3.2 Add quota display (optional)
- [ ] Show remaining uploads in UI somewhere
- [ ] Update after successful upload

## Phase 4: Cleanup & Maintenance

### 4.1 Implement stale upload cleanup
- [ ] Add `cleanupStaleUploads()` function
- [ ] Query pending files older than 2 hours
- [ ] Delete S3 objects and DynamoDB records
- [ ] Restore quotas for each cleaned upload
- [ ] Add to admin API or scheduled task

### 4.2 Update version upload flow
- [ ] Apply same checks to `PUT /api/gpx/files/[id]` with updateContent
- [ ] Ensure quota is consumed for versioned uploads
- [ ] **Verify:** Version updates respect size limits

## Phase 5: Testing & Verification

### 5.1 Manual testing
- [ ] Test 15 MB file upload → 413 error
- [ ] Test 51 files as regular user → 429 on 51st
- [ ] Test .txt renamed to .gpx → validation failure
- [ ] Test quota restoration on failed validation
- [ ] Test normal GPX upload flow works end-to-end
- [ ] Test version updates with new content

### 5.2 Edge cases
- [ ] Test presign then don't upload → cleanup restores quota
- [ ] Test concurrent uploads near quota limit
- [ ] Test admin tier has 500 limit
- [ ] Test file size at exactly 10 MB boundary

## Dependencies

```
Phase 1 (Infrastructure) → Phase 2 (API) → Phase 3 (Client)
                                        ↓
                                 Phase 4 (Cleanup)
                                        ↓
                                 Phase 5 (Testing)
```
