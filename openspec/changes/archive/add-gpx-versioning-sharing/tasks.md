# Tasks: GPX Versioning and Sharing

**Epic:** dcr34-r2l

## Phase 1: Data Model Foundation

### 1.1 Add version attributes to GpxFile entity (dcr34-58l)
- [x] Add `version` attribute (number, default 1) to `gpx-file.ts`
- [x] Add `versionCount` attribute (number, default 1)
- [x] **Verify:** Query existing file, confirm defaults applied

### 1.2 Create GpxShare entity (dcr34-1wp)
- [x] Create `apps/run.gpx/webapp/src/entities/gpx-share.ts`
- [x] Define attributes: shareId, ownerId, fileId, version, accessMode, allowedEmails, createdAt
- [x] Add indexes: primary (shareId), byFile (ownerId+fileId)
- [x] **Verify:** Entity can be imported and instantiated

## Phase 2: Backend API - Versioning

### 2.1 Modify file save to create versions (dcr34-zyz)
- [x] Update `PUT /api/gpx/files/[id]` to increment version on updateContent
- [x] Generate versioned S3 key: `{fileId}.v{N}.gpx`
- [x] Copy versioned object to current key after upload confirmed
- [x] Return new version number in response
- [ ] **Verify:** Save file twice, confirm two versioned objects in S3

### 2.2 Add version history endpoint (dcr34-d44)
- [x] Add `GET /api/gpx/files/[id]/versions` to list available versions
- [x] Return version numbers with createdAt timestamps
- [ ] **Verify:** Query history for multi-version file

### 2.3 Add version-specific download (dcr34-8ug)
- [x] Modify presign endpoint to accept optional `version` parameter
- [x] Generate presigned URL for versioned key when specified
- [ ] **Verify:** Download specific version content

### 2.4 Implement version pruning (dcr34-5nk)
- [x] Add MAX_VERSIONS constant (50)
- [x] On save, delete oldest version if exceeding limit
- [ ] **Verify:** Save 51st version, confirm v1 deleted

## Phase 3: Backend API - Sharing

### 3.1 Create share endpoints (dcr34-hha)
- [x] Add `POST /api/gpx/shares` - create share record
- [x] Add `GET /api/gpx/shares?fileId=X` - list shares for file
- [x] Add `DELETE /api/gpx/shares/[id]` - revoke share
- [ ] **Verify:** Create, list, delete share records

### 3.2 Add share validation endpoint (dcr34-5gt)
- [x] Add `GET /api/gpx/shares/[token]` - validate and return share metadata
- [x] Validate accessMode and allowedEmails against session user
- [x] Return 403 for unauthorized access
- [ ] **Verify:** Public access works, private access validates email

### 3.3 Add share acceptance endpoint (dcr34-jsb)
- [x] Add `POST /api/gpx/shares/[token]/accept` - copy file to user's storage
- [x] Copy S3 object from owner's versioned key to recipient's storage
- [x] Create new GpxFile record with version=1
- [x] Return new fileId for immediate loading
- [ ] **Verify:** Accept share, confirm file copied with v1

### 3.4 Add cascade delete for shares (dcr34-swj)
- [x] Modify file DELETE to also delete associated shares
- [x] Query byFile index and batch delete
- [ ] **Verify:** Delete file with shares, confirm shares removed

## Phase 4: Frontend - Menu Restructure

### 4.1 Rename Open to Local Open (dcr34-f5w)
- [x] Update Menu.svelte: change "Open" label to "Local Open"
- [x] Update i18n key if applicable
- [x] **Verify:** Menu shows "Local Open" with Ctrl+O ✓ (tested in browser)

### 4.2 Add Save to Cloud menu item (dcr34-dpn)
- [x] Add "Save to Cloud" item after "Local Open" in File menu
- [x] Assign keyboard shortcut Ctrl+Shift+K
- [x] Wire to new `quickSaveToCloud()` function
- [x] **Verify:** Menu item visible, shortcut works ✓ (tested in browser)

### 4.3 Move Cloud Storage to View menu (dcr34-t02)
- [x] Remove Cloud Storage from File menu content
- [x] Add Cloud Storage to View menu after Tree File View
- [x] **Verify:** Cloud Storage only in View menu ✓ (tested in browser)

### 4.4 Implement lastSaveFolder persistence (dcr34-37r)
- [x] Add `lastSaveFolder` setting to settings.ts (string, default "ROOT")
- [x] Update CloudStorage save to set lastSaveFolder
- [ ] **Verify:** Save to folder, close/reopen, folder remembered

### 4.5 Implement quick save logic (dcr34-361)
- [x] Create `quickSaveToCloud()` in cloud-sync.ts or file-actions.ts
- [x] Use lastSaveFolder for target folder
- [x] Save all layers if none selected, else selected only
- [x] Handle folder validation (fallback to ROOT if deleted)
- [ ] **Verify:** Quick save works without dialog

## Phase 5: Frontend - Version UI

### 5.1 Add version indicator to file list (dcr34-b9k)
- [x] Display "v{N}" badge on files in CloudStorage.svelte
- [x] Style badge (small, muted color)
- [ ] **Verify:** Files show version number

### 5.2 Add version history dropdown (dcr34-hpv)
- [x] Add dropdown/menu on file for version selection
- [x] Fetch versions from API on expand
- [x] Load selected version content
- [ ] **Verify:** Can browse and load old versions

## Phase 6: Frontend - Sharing UI

### 6.1 Create ShareDialog.svelte component (dcr34-d9a)
- [x] Create dialog with access mode selector (Public/Private)
- [x] Add email input for private mode (comma-separated)
- [x] Display generated share URL with copy button
- [ ] **Verify:** Dialog opens and generates URL

### 6.2 Add share button to file list (dcr34-esj)
- [x] Add share icon/button on file hover in CloudStorage
- [x] Open ShareDialog on click
- [ ] **Verify:** Share button visible and functional

### 6.3 Add share list view (dcr34-efc)
- [x] Add "Shared Links" section in ShareDialog
- [x] List existing shares with revoke button
- [ ] **Verify:** Can view and revoke shares

### 6.4 Create share landing page (dcr34-u71)
- [x] Create route `/share/[token]` page
- [x] Display file info and "Add to My Files" button
- [x] Handle authentication redirect
- [x] Load file into session after accept
- [ ] **Verify:** Full share flow works end-to-end (requires SPA fallback on deployment)

## Phase 7: Testing and Polish

### 7.1 Integration testing (dcr34-05u)
- [ ] Test version save/load cycle
- [ ] Test share create/accept/revoke cycle
- [ ] Test menu shortcuts and behaviors
- [ ] Test folder persistence across sessions

### 7.2 Edge case handling (dcr34-1ei1)
- [ ] Test sharing deleted file (graceful error)
- [ ] Test accepting own share (should work)
- [ ] Test version limit pruning
- [ ] Test invalid lastSaveFolder fallback

### 7.3 Documentation (dcr34-7q0j)
- [ ] Update run.gpx README with new features
- [ ] Add inline comments for complex logic

## Dependencies

```
Phase 1 (Data Model)
    ↓
Phase 2 (Versioning API) ──→ Phase 5 (Version UI)
    ↓
Phase 3 (Sharing API) ────→ Phase 6 (Sharing UI)
    ↓
Phase 4 (Menu) ← can parallel with Phase 2/3
    ↓
Phase 7 (Testing)
```

**Parallelizable:**
- Phase 4 (Menu) can start immediately
- Phase 5 (Version UI) can start after 2.1-2.3
- Phase 6 (Sharing UI) can start after 3.1-3.3
