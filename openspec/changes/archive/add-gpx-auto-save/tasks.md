# Tasks: Add GPX Auto-Save to Cloud

## 1. Core Auto-Save Service

- [ ] 1.1 Create `auto-save.ts` service module with AutoSaveManager class
- [ ] 1.2 Implement content hash calculation (GPX XML → hash)
- [ ] 1.3 Track cloud-linked files (fileId → { lastHash, lastSaveTime, needsSync })
- [ ] 1.4 Implement 10-minute interval timer with start/stop/reset
- [ ] 1.5 Implement save check logic (compare current hash to lastHash)
- [ ] 1.6 Call `saveOrUpdateToCloud()` when hash differs
- [ ] 1.7 Update lastHash after successful save

## 2. Cloud-Linked File Detection

- [ ] 2.1 Hook into cloud file open flow to register file as cloud-linked
- [ ] 2.2 Hook into cloud save flow to register file as cloud-linked
- [ ] 2.3 Hook into file close to unregister from auto-save tracking
- [ ] 2.4 Compute initial hash when file becomes cloud-linked

## 3. Settings & Persistence

- [ ] 3.1 Add `autoSaveEnabled` setting to IndexedDB settings (default: true)
- [ ] 3.2 Create Svelte store for auto-save enabled state
- [ ] 3.3 Start/stop auto-save timer based on setting changes

## 4. File Menu Integration

- [ ] 4.1 Add "Auto-Save" checkbox item to File menu
- [ ] 4.2 Bind checkbox to autoSaveEnabled setting
- [ ] 4.3 Add separator before/after for visual grouping

## 5. Status Indicator

- [ ] 5.1 Create `AutoSaveIndicator.svelte` component
- [ ] 5.2 Implement states: idle, saving, saved, offline, error
- [ ] 5.3 Design subtle UI (small icon + text, e.g., cloud icon with status)
- [ ] 5.4 Position indicator in appropriate location (toolbar or status area)
- [ ] 5.5 Show "Saved" briefly after successful save, then fade to idle

## 6. Offline Handling

- [ ] 6.1 Monitor `navigator.onLine` and online/offline events
- [ ] 6.2 Create offline-aware Svelte store (`isOnline`)
- [ ] 6.3 Skip auto-save attempts when offline (mark as needsSync)
- [ ] 6.4 Trigger immediate sync check when coming back online
- [ ] 6.5 Update indicator to show "Offline" state

## 7. Tab Close Save

- [ ] 7.1 Register `beforeunload` event handler
- [ ] 7.2 Check for pending changes (any file with hash diff)
- [ ] 7.3 Attempt save using `navigator.sendBeacon()` or sync fetch
- [ ] 7.4 Handle graceful degradation if save fails

## 8. Testing

- [ ] 8.1 Test auto-save triggers after 10 minutes with changes
- [ ] 8.2 Test no save occurs when content unchanged
- [ ] 8.3 Test toggle enables/disables auto-save
- [ ] 8.4 Test offline → online sync behavior
- [ ] 8.5 Test tab close save attempt
- [ ] 8.6 Test multiple cloud-linked files tracked independently
- [ ] 8.7 Test file close removes from tracking

## 9. Documentation

- [ ] 9.1 Update user-facing help/docs if applicable
