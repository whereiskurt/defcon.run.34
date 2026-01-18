# Change: Add Auto-Save to Cloud for GPX Files

## Why

Users working on maps often forget to save, leading to lost work. When a file is opened from or saved to cloud storage, users expect their changes to persist automatically — similar to Google Docs or modern productivity apps. Currently, every save requires manual action via the dialog or Ctrl+Shift+S.

## What Changes

- **ADDED** Auto-save background process (10-minute interval) for cloud-linked files
- **ADDED** Content hash change detection to avoid unnecessary version increments
- **ADDED** "Auto-Save" toggle in File menu (default: ON)
- **ADDED** Subtle auto-save status indicator (Saving.../Saved/Offline)
- **ADDED** Online/offline awareness with sync-on-reconnect
- **ADDED** Save attempt on tab close (`beforeunload`)
- **ADDED** Global auto-save preference stored in IndexedDB settings

## Impact

- **Affected specs**: None (new capability)
- **New spec**: `gpx-auto-save` — Auto-save behavior and settings
- **Affected code**:
  - `apps/run.gpx/gpx-studio/website/src/lib/components/cloud/` (new auto-save service)
  - `apps/run.gpx/gpx-studio/website/src/lib/components/Menu.svelte` (toggle)
  - `apps/run.gpx/gpx-studio/website/src/lib/logic/settings.ts` (preference)
  - `apps/run.gpx/gpx-studio/website/src/lib/cloud-sync.ts` (hash tracking)

## Dependencies

- `add-gpx-versioning-sharing` — Provides versioning infrastructure (every save increments version)
- `refactor-gpx-cloud-dialog` — Provides dialog modes and cloud file tracking
- Existing `saveOrUpdateToCloud()` function in `cloud-sync.ts`

## Design Decisions

### Change Detection: Content Hash
- Hash the GPX XML string using a fast algorithm (e.g., xxHash or SHA-256 substring)
- Compare current hash to last-saved hash
- Only trigger save if hash differs
- Store last-saved hash per file in memory (not persisted)

### Cloud-Linked File Tracking
A file is "cloud-linked" when:
1. Opened from cloud storage (has `cloudFileId`)
2. First saved to cloud storage (acquires `cloudFileId`)

### Conflict Resolution
- **Last-write-wins** — No merge, no lock, simple overwrite
- Acceptable for single-user expected workflow

### Offline Handling
- Detect offline via `navigator.onLine` + fetch failures
- Queue pending saves (just mark as "needs sync")
- Sync immediately when `online` event fires
- Show "Offline" indicator during disconnection

### Tab Close Behavior
- Register `beforeunload` handler
- Attempt synchronous save if changes pending
- Use `navigator.sendBeacon()` as fallback for reliability

## Out of Scope

- Real-time collaborative editing
- Conflict detection/resolution between devices
- Version pruning/cleanup
- Per-file auto-save toggle (global only)
