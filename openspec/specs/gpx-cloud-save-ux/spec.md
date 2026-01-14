# GPX Cloud Storage Save UX Improvements

**Status:** Implemented (pending testing)
**Beads:** dcr34-3k1
**Created:** 2026-01-13

## Summary

Improve the cloud storage save experience by:
1. Adding layer selection checkboxes
2. Changing "Save" to overwrite existing files (by name match)
3. Adding "Copy" for creating new files (current behavior)
4. Moving save controls below the file listing

## Current Behavior

- "Save All Layers" button saves every open layer to cloud storage
- Each save creates a **new file**, even if a file with the same name exists
- Save button is prominently placed at the top, file listing is in a collapsible below

## Proposed Behavior

### Layout Change

**Before:**
```
[Save All Layers button]
[Remote Files (collapsible)]
  - folders/files table
```

**After:**
```
[Remote Files (expanded by default)]
  - folders/files table
[Layer Selection + Save/Copy controls]
```

### Layer Selection

Add a dropdown/checkbox section showing all loaded layers:

```
Layers to save:
[x] MyRoute.gpx
[x] WaypointCollection.gpx
[ ] TempTrack.gpx
[Select All] [Select None]
```

- Default: all layers selected
- Each layer shows its name from `file.metadata?.name`
- Unchecked layers are skipped during save/copy

### Save vs Copy Behavior

| Action | Button | Behavior |
|--------|--------|----------|
| **Save** | Primary green | Overwrites existing file if name matches in current folder |
| **Copy** | Secondary outline | Always creates new file (current behavior) |

**Save logic:**
1. For each selected layer, check if a file with matching `fileName` exists in current folder
2. If match found: update that file's content (overwrite S3 object)
3. If no match: create new file (same as copy)

### API Changes Required

The current `PUT /api/gpx/files/[id]` only updates metadata. Need to add content update support:

**Option A: Extend PUT endpoint**
```typescript
// PUT /api/gpx/files/[id] with body { updateContent: true }
// Returns { uploadUrl } for presigned S3 PUT to existing key
```

**Option B: New endpoint**
```typescript
// POST /api/gpx/files/[id]/upload
// Returns { uploadUrl } for presigned S3 PUT to existing key
```

**Recommendation:** Option A (extend PUT) - simpler, single endpoint

### Cloud-sync.ts Changes

Add new function:
```typescript
export async function updateCloudFileContent(
  fileId: string,
  gpxContent: string,
  metadata?: { trackCount?: number; ... }
): Promise<void>
```

Modify `saveToCloud` or add wrapper that:
1. Searches `cloudFiles` store for matching `fileName`
2. If found in current folder: call `updateCloudFileContent`
3. If not found: call existing `saveToCloud` (create new)

## UI Component Changes

### CloudStorage.svelte

1. **Remove** prominent save button from top
2. **Expand** Remote Files by default (`filesExpanded = true` initially)
3. **Add** layer selection section below file table
4. **Add** two buttons: "Save Selected" (primary) and "Copy Selected" (outline)

### New Component: LayerSelector.svelte (optional)

Could extract layer selection to reusable component, but keeping inline is acceptable for simplicity.

## File Changes

| File | Change Type |
|------|-------------|
| `CloudStorage.svelte` | Major UI restructure |
| `cloud-sync.ts` | Add `updateCloudFileContent`, modify save logic |
| `webapp/.../files/[id]/route.ts` | Extend PUT for content update |

## Edge Cases

1. **Name collision across folders**: Only match within current folder
2. **Global folder files**: Follow existing permission model (uploader or admin)
3. **No layers loaded**: Disable save/copy buttons, show message
4. **All layers unchecked**: Disable save/copy buttons

## Testing

- [ ] Save overwrites existing file with same name
- [ ] Save creates new file when no name match
- [ ] Copy always creates new file
- [ ] Layer checkboxes correctly filter which files are saved
- [ ] Select All / Select None work
- [ ] File listing appears above save controls
- [ ] Works in subfolders and global folders
