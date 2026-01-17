# Tasks: Refactor GPX Cloud Dialog

## Phase 1: State Management

### 1.1 Add CloudStorageMode enum to utils.svelte.ts
- [x] Add `CloudStorageMode` enum (CLOSED, SAVE, OPEN, BROWSE)
- [x] Replace `cloudStorageOpen` writable with `cloudStorageMode` writable
- [x] Add derived `cloudStorageOpen` store for backwards compatibility
- [x] Add mode-specific open functions: `openCloudStorageSave()`, `openCloudStorageOpen()`, `openCloudStorageBrowse()`
- [x] Update `closeCloudStorage()` to set mode to CLOSED
- [x] **Verify:** Import and use mode functions

## Phase 2: CloudStorage.svelte UI Changes

### 2.1 Add remote file selection state
- [x] Add `selectedRemoteFiles: Set<string>` state
- [x] Add `toggleRemoteFileSelection(fileId)` function
- [x] Add `selectAllRemoteFiles()` function
- [x] Add `selectNoneRemoteFiles()` function
- [x] Clear selection when navigating folders

### 2.2 Implement mode-reactive section expansion
- [x] Import `cloudStorageMode` and `CloudStorageMode` from utils
- [x] Add reactive statement to set `layersExpanded` and `filesExpanded` based on mode
- [ ] **Verify:** Each mode expands correct sections

### 2.3 Update dialog title
- [x] Make title reactive based on mode
- [x] "Save to Cloud" for save mode
- [x] "Open from Cloud" for open mode
- [x] "Cloud Storage" for browse mode

### 2.4 Add checkboxes to Remote Files section
- [x] Add checkbox column (visible in open/browse modes only)
- [x] Wire checkboxes to `toggleRemoteFileSelection`
- [x] Add "Select All" / "Select None" toolbar buttons
- [x] Style consistently with Layers section

### 2.5 Remove individual open button
- [x] Remove green plus "Add to map" button from file rows
- [x] Keep other actions: rename, delete, share, versions

### 2.6 Add handleOpenSelectedFiles function
- [x] Iterate through selected files
- [x] Load each file from cloud
- [x] Parse and add to map
- [x] Show success toast with count
- [x] Close dialog

### 2.7 Update footer buttons
- [x] Show "Save" only in save/browse modes
- [x] Show "Open Selected (N)" only in open/browse modes
- [x] Include selection count in Open Selected button
- [x] Disable buttons appropriately

### 2.8 Remove Make Copy functionality
- [x] Remove `handleCopySelectedLayers` function
- [x] Remove "Make Copy" button from UI
- [ ] **Verify:** Make Copy button no longer appears

## Phase 3: Menu.svelte Changes

### 3.1 Add Save As menu item
- [x] Add "Save As..." to File menu after Local Open
- [x] Wire to `openCloudStorageSave()`
- [x] Disable when no layers loaded
- [ ] **Verify:** Opens dialog in save mode

### 3.2 Add Open Remote menu item
- [x] Add "Open Remote..." to File menu after Save As
- [x] Wire to `openCloudStorageOpen()`
- [ ] **Verify:** Opens dialog in open mode

### 3.3 Update Cloud Storage in View menu
- [x] Wire to `openCloudStorageBrowse()` instead of `openCloudStorage()`
- [ ] **Verify:** Opens dialog in browse mode

### 3.4 Update keyboard shortcuts
- [x] Ctrl+Shift+K calls `openCloudStorageSave()`
- [x] Add Ctrl+Shift+O for `openCloudStorageOpen()`
- [ ] **Verify:** Shortcuts open correct modes

### 3.5 Update imports
- [x] Import new functions from utils.svelte.ts
- [x] Remove old `openCloudStorage` import if unused

## Phase 4: Testing

### 4.1 Manual verification
- [ ] Test Save As menu → dialog in save mode, layers expanded
- [ ] Test Open Remote menu → dialog in open mode, files expanded
- [ ] Test Cloud Storage (View) → dialog in browse mode, both expanded
- [ ] Test keyboard shortcuts (Ctrl+Shift+K, Ctrl+Shift+O)
- [ ] Test batch file selection and Open Selected
- [ ] Test folder navigation clears selection
- [ ] Test existing save functionality still works
- [ ] Test existing individual file actions (rename, delete, share, versions)

### 4.2 Edge cases
- [ ] Test opening with no cloud files (empty state)
- [ ] Test opening with no local layers (empty layers section)
- [ ] Test mode switching mid-dialog (if applicable)

## Dependencies

```
Phase 1 (State) → Phase 2 (Dialog UI) → Phase 3 (Menu)
                                     ↓
                              Phase 4 (Testing)
```
