# Virtual Folders and Tags for GPX Cloud Storage

> **Status**: Proposal
> **Author**: Claude
> **Date**: 2026-01-11

## Overview

Add virtual folder support and file tagging to the GPX Studio cloud storage interface. Folders are metadata-only constructs stored in DynamoDB - S3 file keys remain flat. Tags provide flexible categorization independent of folder structure.

## Design Principles

1. **Virtual folders** - Folders exist only in DynamoDB metadata, not S3
2. **No S3 changes** - Files keep their existing S3 keys (`uploads/{userId}/gpx/{fileId}.gpx`)
3. **Backward compatible** - Existing files appear in root folder
4. **Simple hierarchy** - Standard parent-child folder relationship
5. **Max depth limit** - 5 levels maximum to prevent abuse
6. **Flexible tagging** - Arbitrary user-defined tags on files
7. **Global folders** - Shared folders accessible by all gpxstudio users

## Data Model

### Limits and Constraints

| Limit | Value | Rationale |
|-------|-------|-----------|
| Max folder depth | 5 | Prevent abuse, keep UI manageable |
| Max folder name length | 50 chars | Reasonable display length |
| Max folders per user | 100 | Prevent abuse |
| Max tags per file | 10 | Keep manageable |
| Max tag length | 20 chars | Chip display size |
| Max tags per user | 50 | Prevent tag sprawl |
| Max global folders | 10 | Prevent abuse, admin-managed |

### New Entity: GpxFolder

```typescript
export const GpxFolder = new Entity({
  model: {
    entity: "GpxFolder",
    version: "1",
    service: "gpx",
  },
  attributes: {
    userId: {
      type: "string",
      required: true,
    },
    folderId: {
      type: "string",
      required: true,
    },
    folderName: {
      type: "string",
      required: true,
      validate: (val) => val.length <= 50,
    },
    parentFolderId: {
      type: "string",
      required: false,
      default: null,  // null = root level
    },
    depth: {
      type: "number",
      required: true,
      default: 0,  // 0 = root level, max 4 (5 levels: 0,1,2,3,4)
      validate: (val) => val >= 0 && val <= 4,
    },
    isGlobal: {
      type: "boolean",
      required: true,
      default: false,  // true = shared folder accessible by all gpxstudio users
    },
    createdBy: {
      type: "string",
      required: false,  // userId of creator (for global folders)
    },
    createdAt: {
      type: "number",
      required: true,
      default: () => Date.now(),
      readOnly: true,
    },
    updatedAt: {
      type: "number",
      required: true,
      default: () => Date.now(),
      watch: "*",
      set: () => Date.now(),
    },
  },
  indexes: {
    primary: {
      pk: { field: "pk", composite: ["userId"] },
      sk: { field: "sk", composite: ["folderId"] },
    },
    byParent: {
      index: "gsi1",
      pk: { field: "gsi1pk", composite: ["userId"] },
      sk: { field: "gsi1sk", composite: ["parentFolderId", "folderName"] },
    },
    // Global folders index - query all global folders across users
    global: {
      index: "gsi3",
      pk: { field: "gsi3pk", composite: [] },  // Static "GLOBAL_FOLDERS" partition
      sk: { field: "gsi3sk", composite: ["parentFolderId", "folderName"] },
      condition: (attr) => attr.isGlobal === true,  // Sparse index
    },
  },
});
```

**Depth Calculation:**
- Root level folders: `depth = 0`
- When creating folder with parent: `depth = parent.depth + 1`
- Reject if `depth > 4` (would create 6th level)

### Modified Entity: GpxFile

Add `folderId` and `tags` attributes:

```typescript
// Add to GpxFile attributes
folderId: {
  type: "string",
  required: false,
  default: null,  // null = root level
},
tags: {
  type: "set",      // DynamoDB String Set
  items: "string",
  required: false,
  default: [],
  validate: (tags) => {
    if (tags.length > 10) return false;  // Max 10 tags
    return tags.every(t => t.length <= 20);  // Max 20 chars each
  },
},

// Add new index for querying files by folder
byFolder: {
  index: "gsi2",
  pk: { field: "gsi2pk", composite: ["userId"] },
  sk: { field: "gsi2sk", composite: ["folderId", "createdAt"] },
},
```

### New Entity: GpxTag (User's Tag Library)

Track user's tags for autocomplete and management:

```typescript
export const GpxTag = new Entity({
  model: {
    entity: "GpxTag",
    version: "1",
    service: "gpx",
  },
  attributes: {
    userId: {
      type: "string",
      required: true,
    },
    tag: {
      type: "string",
      required: true,
      validate: (val) => val.length <= 20,
    },
    useCount: {
      type: "number",
      required: true,
      default: 1,
    },
    createdAt: {
      type: "number",
      required: true,
      default: () => Date.now(),
    },
    lastUsedAt: {
      type: "number",
      required: true,
      default: () => Date.now(),
    },
  },
  indexes: {
    primary: {
      pk: { field: "pk", composite: ["userId"] },
      sk: { field: "sk", composite: ["tag"] },
    },
    byUseCount: {
      index: "gsi1",
      pk: { field: "gsi1pk", composite: ["userId"] },
      sk: { field: "gsi1sk", composite: ["useCount"] },
    },
  },
});
```

**Tag Library Benefits:**
- Autocomplete suggestions when adding tags
- Show most-used tags first
- Prevent typo variants (suggest existing tags)
- Track tag usage for cleanup

## Global Folders

### Concept

Global folders are shared folders that all users with the `gpxstudio` service claim can access. They provide a way to share official routes, curated content, or collaborative workspaces.

**Use Cases:**
- **Official DEF CON Routes** - Event organizers share official event routes
- **Challenges** - Shared challenge routes everyone can access
- **Community Curated** - Popular routes shared by the community
- **Collaborative Planning** - Group route planning for events

### Authorization Model

| Action | User Folder | Global Folder |
|--------|-------------|---------------|
| View/List | Owner only | All gpxstudio users |
| Download files | Owner only | All gpxstudio users |
| Upload files | Owner only | All gpxstudio users |
| Rename files | Owner only | All gpxstudio users |
| Delete files | Owner only | All gpxstudio users |
| Create subfolder | Owner only | All gpxstudio users |
| Delete folder | Owner only | Creator or admin only |
| Rename folder | Owner only | Creator or admin only |

**Key Points:**
- Any gpxstudio user can read/write/delete files in a global folder
- Only the folder creator (or admin) can delete or rename the global folder itself
- Subfolders within a global folder inherit the global flag
- Files in global folders use a special `userId: "GLOBAL"` for S3 storage

### Data Model Notes

**Global Folder Record:**
```typescript
{
  userId: "GLOBAL",           // Special constant for global folders
  folderId: "uuid",
  folderName: "DEF CON 34 Official Routes",
  parentFolderId: null,
  isGlobal: true,
  createdBy: "user-123",      // Track who created it
  depth: 0,
  createdAt: 1704931200000,
  updatedAt: 1704931200000,
}
```

**Files in Global Folders:**
```typescript
{
  userId: "GLOBAL",           // Files also use GLOBAL userId
  fileId: "uuid",
  fileName: "keynote-walk.gpx",
  folderId: "folder-uuid",
  bucket: "dc34-run-gpx-uploads-use1",
  key: "uploads/GLOBAL/gpx/uuid.gpx",  // GLOBAL prefix in S3
  uploadedBy: "user-456",     // Track who uploaded
  // ... other fields
}
```

### S3 Storage for Global Files

Global files are stored under a special `GLOBAL` prefix:
- **Path**: `uploads/GLOBAL/gpx/{fileId}.gpx`
- **Access**: IAM policy allows any authenticated gpxstudio user to read/write this prefix
- **Isolation**: Clearly separated from user-specific uploads

### UI Presentation

Global folders appear in a special section at the top of the file list:

```
┌─────────────────────────────────────────────────────────────┐
│  Cloud Storage                                          [X] │
├─────────────────────────────────────────────────────────────┤
│              [ Save All Layers ]                            │
├─────────────────────────────────────────────────────────────┤
│  🌐 Shared Folders                                     [v]  │
├─────────────────────────────────────────────────────────────┤
│  🌐 DEF CON 34 Official         8 items                     │
│  🌐 Community Routes           12 items                     │
├─────────────────────────────────────────────────────────────┤
│  📁 My Files (12)              [+ Folder] [Refresh]    [v]  │
├─────────────────────────────────────────────────────────────┤
│  📁 Day 1 Routes                 3 items          ✏️ 🗑️     │
│  [+] village-loop.gpx   45kb   Today @ 2pm        ✏️ 🗑️     │
└─────────────────────────────────────────────────────────────┘
```

**Visual Indicators:**
- 🌐 Globe icon for global folders (vs 📁 for personal)
- "Shared Folders" section header
- No delete button on global folders (unless creator)
- Files show "Uploaded by: username" in global folders

### Creating Global Folders

**Who Can Create:**
- Initially: Only admins (users with `admin` in services claim)
- Future: Could allow any gpxstudio user with rate limiting

**Creation Flow:**
1. Admin clicks "+ Global Folder" button
2. Enters folder name
3. Folder created with `isGlobal: true`, `userId: "GLOBAL"`
4. Appears immediately in all users' Shared Folders section

### API Changes for Global Folders

#### `GET /api/gpx/folders`

Add `includeGlobal` query param:

**Query params:**
- `parentId` (optional) - Parent folder ID
- `includeGlobal` (optional) - If `true`, also return global folders

**Response (with global folders):**
```json
{
  "folders": [...],
  "globalFolders": [
    {
      "folderId": "uuid",
      "folderName": "DEF CON 34 Official",
      "isGlobal": true,
      "createdBy": "user-123",
      "itemCount": 8
    }
  ]
}
```

#### `POST /api/gpx/folders`

Add `isGlobal` flag (admin only):

**Request:**
```json
{
  "folderName": "DEF CON 34 Official",
  "parentFolderId": null,
  "isGlobal": true
}
```

**Validation:**
- `isGlobal: true` requires admin privilege
- Max 10 global folders total
- Global folders can only be created at root level (for now)

#### `GET /api/gpx/files`

Add support for global folder context:

**Query params:**
- `folderId` - Folder ID (can be a global folder ID)
- `global` - If `true`, list files from global context

#### `POST /api/gpx/files`

When saving to a global folder:
- `userId` is set to `"GLOBAL"` automatically
- `uploadedBy` tracks the actual uploader
- S3 key uses `uploads/GLOBAL/gpx/{fileId}.gpx`

### Permissions Enforcement

**Folder Operations:**
```typescript
function canDeleteFolder(folder: GpxFolder, userId: string): boolean {
  if (!folder.isGlobal) {
    return folder.userId === userId;
  }
  // Global folders: only creator or admin can delete
  return folder.createdBy === userId || isAdmin(userId);
}

function canAccessFolder(folder: GpxFolder, user: User): boolean {
  if (!folder.isGlobal) {
    return folder.userId === user.id;
  }
  // Global folders: any gpxstudio user
  return user.services?.includes('gpxstudio');
}
```

**File Operations:**
```typescript
function canModifyFile(file: GpxFile, userId: string): boolean {
  if (file.userId === "GLOBAL") {
    // Any gpxstudio user can modify files in global folders
    return true;  // Caller already verified gpxstudio claim
  }
  return file.userId === userId;
}
```

### Security Considerations

1. **Rate Limiting** - Limit file uploads to global folders (e.g., 10/hour/user)
2. **Audit Trail** - Track `uploadedBy` and `modifiedBy` for all global file operations
3. **Content Moderation** - Consider review queue for global uploads (future)
4. **Size Limits** - Stricter file size limits for global folders
5. **Admin Override** - Admins can delete any file in global folders

### Migration

No migration needed for existing data. Global folders are a new feature:
1. Add `isGlobal` and `createdBy` attributes to GpxFolder entity
2. Add `uploadedBy` attribute to GpxFile entity
3. Create GSI for querying global folders
4. Update IAM policy to allow access to `uploads/GLOBAL/` prefix

## API Endpoints

### Folder Endpoints

#### `GET /api/gpx/folders`

List folders in a parent folder.

**Query params:**
- `parentId` (optional) - Parent folder ID. Omit for root level.

**Response:**
```json
{
  "folders": [
    {
      "folderId": "uuid",
      "folderName": "My Trips",
      "parentFolderId": null,
      "createdAt": 1704931200000,
      "updatedAt": 1704931200000
    }
  ]
}
```

#### `POST /api/gpx/folders`

Create a new folder.

**Request:**
```json
{
  "folderName": "My Trips",
  "parentFolderId": null
}
```

**Response:**
```json
{
  "folderId": "uuid",
  "folderName": "My Trips",
  "parentFolderId": null
}
```

**Validation:**
- `folderName` required, max 50 chars
- No duplicate names within same parent (case-insensitive)
- `parentFolderId` must exist if provided
- **Depth check**: If parent exists, `parent.depth + 1 <= 4` (max 5 levels)
- **Folder count**: User must have < 100 folders total

**Errors:**
- 400 - Invalid folder name (empty or too long)
- 400 - Duplicate folder name in parent
- 400 - Max folder depth exceeded (5 levels)
- 400 - Max folder count exceeded (100 folders)
- 404 - Parent folder not found

#### `PUT /api/gpx/folders/[id]`

Rename a folder.

**Request:**
```json
{
  "folderName": "New Name"
}
```

**Note:** Moving folders (changing parent) is a separate operation to keep it simple. Could add `parentFolderId` to request body in v2.

#### `DELETE /api/gpx/folders/[id]`

Delete an empty folder.

**Response:** 204 No Content

**Errors:**
- 404 - Folder not found
- 409 - Folder not empty (has files or subfolders)

### Modified File Endpoints

#### `GET /api/gpx/files`

Add optional `folderId` query param.

**Query params:**
- `folderId` (optional) - Filter by folder. Omit for root level files.

#### `POST /api/gpx/files`

Add optional `folderId` to request body.

**Request (updated):**
```json
{
  "fileName": "track.gpx",
  "fileSize": 12345,
  "folderId": "uuid-or-null"
}
```

#### `PUT /api/gpx/files/[id]`

Allow updating `folderId` to move file between folders.

**Request (move file):**
```json
{
  "folderId": "new-folder-uuid"
}
```

Set to `null` to move to root.

### Tag Endpoints

#### `GET /api/gpx/tags`

List user's tag library for autocomplete.

**Query params:**
- `limit` (optional) - Max tags to return. Default 50.

**Response:**
```json
{
  "tags": [
    { "tag": "day1", "useCount": 5, "lastUsedAt": 1704931200000 },
    { "tag": "challenge", "useCount": 3, "lastUsedAt": 1704844800000 }
  ]
}
```

Tags are sorted by `useCount` descending (most-used first).

#### `PUT /api/gpx/files/[id]/tags`

Update tags on a file.

**Request:**
```json
{
  "tags": ["day1", "challenge", "commute"]
}
```

**Response:**
```json
{
  "tags": ["day1", "challenge", "commute"]
}
```

**Validation:**
- Max 10 tags per file
- Each tag max 20 chars
- Tags are lowercase, trimmed, no special chars except hyphen/underscore

**Side effects:**
- Creates new `GpxTag` entries for tags not in user's library
- Increments `useCount` for existing tags
- Updates `lastUsedAt` timestamp

**Errors:**
- 400 - Too many tags (max 10)
- 400 - Tag too long (max 20 chars)
- 400 - Invalid tag format
- 404 - File not found

#### `DELETE /api/gpx/tags/[tag]`

Delete a tag from user's library. Does NOT remove tag from files.

**Response:** 204 No Content

**Note:** Orphaned tags on files remain until file is updated. This is intentional - deleting from library just removes autocomplete suggestion.

## Frontend Changes

### State Management

```typescript
// cloud-sync.ts additions
export interface CloudFolder {
  folderId: string;
  folderName: string;
  parentFolderId: string | null;
  createdAt: number;
  updatedAt: number;
}

export const cloudFolders = writable<CloudFolder[]>([]);

export async function listCloudFolders(parentId?: string): Promise<CloudFolder[]>;
export async function createFolder(name: string, parentId?: string): Promise<CloudFolder>;
export async function renameFolder(folderId: string, newName: string): Promise<void>;
export async function deleteFolder(folderId: string): Promise<void>;
export async function moveFile(fileId: string, folderId: string | null): Promise<void>;
```

### Component State

```typescript
// CloudStorage.svelte
let currentFolderId: string | null = null;
let breadcrumbs: Array<{id: string | null, name: string}> = [
  { id: null, name: 'Root' }
];
```

### UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Cloud Storage                                          [X] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│              [ Save All Layers ]  (green button)            │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Remote Files (12)  [+ Folder] [Refresh]              [v]   │
├─────────────────────────────────────────────────────────────┤
│  Root > Projects > DEF CON 34                          [^]  │  <- Breadcrumbs
├─────────────────────────────────────────────────────────────┤
│  📁 Day 1 Routes                    3 items         ✏️ 🗑️   │  <- Folders first
│  📁 Day 2 Routes                    5 items         ✏️ 🗑️   │
├─────────────────────────────────────────────────────────────┤
│  [+] village-loop.gpx     45kb   Today @ 2pm        ✏️ 🗑️   │  <- Then files
│  [+] keynote-walk.gpx     32kb   Yesterday          ✏️ 🗑️   │
└─────────────────────────────────────────────────────────────┘
```

### Breadcrumb Navigation

- Click any breadcrumb segment to navigate to that folder
- "Root" always first, represents `folderId: null`
- Build breadcrumbs by traversing parent chain on folder enter

```typescript
async function navigateToFolder(folderId: string | null) {
  currentFolderId = folderId;

  if (folderId === null) {
    breadcrumbs = [{ id: null, name: 'Root' }];
  } else {
    // Build breadcrumb trail by following parent chain
    breadcrumbs = await buildBreadcrumbTrail(folderId);
  }

  await refreshCurrentFolder();
}

async function refreshCurrentFolder() {
  await Promise.all([
    listCloudFolders(currentFolderId),
    listCloudFiles(currentFolderId)
  ]);
}
```

### Folder Row Component

```svelte
<tr class="border-t hover:bg-muted/30 cursor-pointer" onclick={() => navigateToFolder(folder.folderId)}>
  <td class="px-4 py-2">
    <div class="flex items-center gap-2">
      <Folder class="h-4 w-4 text-muted-foreground" />
      <span class="font-medium text-sm">{folder.folderName}</span>
      <span class="text-xs text-muted-foreground">{itemCount} items</span>
    </div>
  </td>
  <td></td>
  <td class="px-4 py-2 text-sm text-muted-foreground hidden sm:table-cell">
    {formatDate(folder.createdAt)}
  </td>
  <td class="px-4 py-2 text-center">
    <div class="flex gap-1 justify-center">
      <Button variant="ghost" size="icon" onclick={(e) => { e.stopPropagation(); startRenameFolder(folder); }}>
        <Pencil class="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" class="text-destructive" onclick={(e) => { e.stopPropagation(); deleteFolder(folder); }}>
        <Trash2 class="h-4 w-4" />
      </Button>
    </div>
  </td>
</tr>
```

### Create Folder UI

Add "New Folder" button to collapsible header:

```svelte
<Collapsible.Trigger class="...">
  <div class="flex items-center gap-2">
    <Cloud class="h-4 w-4" />
    <span>Remote Files</span>
    <span class="text-muted-foreground">({totalCount})</span>
  </div>
  <div class="flex items-center gap-2">
    <Button variant="ghost" size="icon" onclick={(e) => { e.stopPropagation(); showCreateFolder(); }}>
      <FolderPlus class="h-4 w-4" />
    </Button>
    <Button variant="ghost" size="icon" onclick={(e) => { e.stopPropagation(); refreshFiles(); }}>
      <RefreshCw class="h-4 w-4" />
    </Button>
    <ChevronDown class="..." />
  </div>
</Collapsible.Trigger>
```

Create folder inline (similar to rename):

```typescript
let creatingFolder = false;
let newFolderName = '';

function showCreateFolder() {
  creatingFolder = true;
  newFolderName = '';
  filesExpanded = true;  // Expand to show input
}

async function confirmCreateFolder() {
  if (!newFolderName.trim()) return;
  await createFolder(newFolderName.trim(), currentFolderId);
  creatingFolder = false;
  newFolderName = '';
}
```

### Moving Files (Optional v2 Feature)

Could add a "Move to..." action on files:
- Click move icon opens folder picker dialog
- Select destination folder
- Call `moveFile(fileId, newFolderId)`

For v1, users can save to a folder by navigating there first.

### Tag UI

#### Tag Display on File Row

Tags appear as small chips after the file name:

```
┌─────────────────────────────────────────────────────────────┐
│  [+] village-loop.gpx  [day1] [challenge]  45kb   Today...  │
└─────────────────────────────────────────────────────────────┘
```

```svelte
<div class="flex items-center gap-1 flex-wrap">
  <Button variant="ghost" size="icon" class="h-6 w-6 text-green-600" onclick={() => handleLoadFile(file)}>
    <Plus class="h-4 w-4" />
  </Button>
  <span class="font-medium text-sm">{truncateName(file.fileName)}</span>
  {#each file.tags?.slice(0, 3) || [] as tag}
    <span class="text-xs bg-muted px-1.5 py-0.5 rounded-full">{tag}</span>
  {/each}
  {#if (file.tags?.length || 0) > 3}
    <span class="text-xs text-muted-foreground">+{file.tags.length - 3}</span>
  {/if}
</div>
```

**Design notes:**
- Show max 3 tags inline, "+N" for overflow
- Chips are small, muted background, rounded-full
- Click chip to filter by tag (optional v2 feature)

#### Tag Editor Dialog

Click a "Tags" button or edit icon to open tag editor:

```
┌──────────────────────────────────────┐
│  Edit Tags for "village-loop.gpx"    │
├──────────────────────────────────────┤
│                                      │
│  [day1 ×] [challenge ×] [commute ×]  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ Add tag...                     │  │
│  └────────────────────────────────┘  │
│                                      │
│  Suggestions:                        │
│  [race] [hike] [urban] [scenic]      │
│                                      │
│          [Cancel]  [Save]            │
└──────────────────────────────────────┘
```

```typescript
// Tag editor state
let editingTagsFileId: string | null = null;
let editingTags: string[] = [];
let tagInput: string = '';
let tagSuggestions: string[] = [];

async function openTagEditor(file: CloudFile) {
  editingTagsFileId = file.fileId;
  editingTags = [...(file.tags || [])];
  tagSuggestions = await fetchTagSuggestions();
}

function addTag(tag: string) {
  const normalized = tag.toLowerCase().trim().replace(/[^a-z0-9-_]/g, '');
  if (normalized && editingTags.length < 10 && !editingTags.includes(normalized)) {
    editingTags = [...editingTags, normalized];
  }
  tagInput = '';
}

function removeTag(tag: string) {
  editingTags = editingTags.filter(t => t !== tag);
}

async function saveTags() {
  await updateFileTags(editingTagsFileId!, editingTags);
  editingTagsFileId = null;
}
```

#### Tag Input Component

```svelte
<div class="relative">
  <input
    type="text"
    placeholder="Add tag..."
    class="border rounded px-3 py-1.5 text-sm w-full"
    bind:value={tagInput}
    onkeydown={(e) => {
      if (e.key === 'Enter' && tagInput.trim()) {
        addTag(tagInput);
      }
    }}
  />

  {#if tagInput && filteredSuggestions.length > 0}
    <div class="absolute top-full left-0 right-0 bg-popover border rounded-md shadow-md mt-1 z-10">
      {#each filteredSuggestions as suggestion}
        <button
          class="w-full text-left px-3 py-1.5 text-sm hover:bg-muted"
          onclick={() => addTag(suggestion)}
        >
          {suggestion}
          <span class="text-muted-foreground ml-2">({suggestion.useCount})</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
```

**Autocomplete behavior:**
- Show suggestions as user types
- Filter by prefix match
- Sort by useCount (most-used first)
- Click or Enter to select
- Create new tag if not in suggestions

#### Tag Chip Component

```svelte
<span class="inline-flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full">
  {tag}
  {#if removable}
    <button onclick={() => removeTag(tag)} class="hover:text-destructive">
      <X class="h-3 w-3" />
    </button>
  {/if}
</span>
```

## Edge Cases

### Deleting Non-Empty Folders

**Behavior:** Return 409 Conflict error.

**UI:** Show error message "Cannot delete folder - it contains files or subfolders. Please empty the folder first."

**Rationale:** Prevents accidental data loss. Users must explicitly move/delete contents first.

### Duplicate Folder Names

**Behavior:** Reject creation with 400 error if same name exists in same parent (case-insensitive comparison).

**UI:** Show error "A folder with this name already exists."

### Orphaned Files

If a folder is somehow deleted with files still referencing it (shouldn't happen with proper validation):
- Files with non-existent `folderId` appear in root
- Or: Add cleanup job to set `folderId: null` for orphaned files

### Maximum Folder Depth

**Recommendation:** No hard limit, but UI could show warning at 10+ levels.

### Root Level Representation

- Use `null` consistently for root level
- In API: omit `folderId` param or set to `null`
- In UI: breadcrumbs start with `{ id: null, name: 'Root' }`

### Tag Edge Cases

#### Empty Tags
- Reject empty strings or whitespace-only
- Trim whitespace before validation

#### Tag Normalization
- Convert to lowercase
- Replace spaces with hyphens
- Strip special characters except hyphen/underscore
- `"Day 1"` → `"day-1"`
- `"@challenge!"` → `"challenge"`

#### Duplicate Tags
- Silently ignore duplicates in request
- `["day1", "day1", "commute"]` → `["day1", "commute"]`

#### Tag Library Cleanup
- Tags with `useCount: 0` can be deleted
- Decrement `useCount` when tag removed from file
- Optional: background job to clean up unused tags

#### Max Tags Per User
- Track total unique tags in user's library
- Reject new tags if user has 50+ tags
- UI: Show warning when approaching limit

## Migration

**No migration needed:**
- Existing files have `folderId: undefined/null` - they appear in root
- New GSI (`gsi2`) needs to be created on DynamoDB table
- Backward compatible with existing data

## Implementation Order

### Phase 1: Backend - Folders
1. Create `GpxFolder` entity
2. Add `folderId` attribute and `byFolder` index to `GpxFile`
3. Implement folder API endpoints
4. Update file endpoints to support `folderId`

### Phase 2: Backend - Tags
1. Create `GpxTag` entity
2. Add `tags` attribute to `GpxFile`
3. Implement tag API endpoints (`GET /tags`, `PUT /files/[id]/tags`)
4. Add tag normalization and validation logic

### Phase 3: Frontend - Folders
1. Add folder state management to `cloud-sync.ts`
2. Add breadcrumb navigation component
3. Update file list to show folders first
4. Add create folder UI (inline input)
5. Add folder rename/delete actions
6. Update save flow to use current folder

### Phase 4: Frontend - Tags
1. Add tag state management to `cloud-sync.ts`
2. Add tag chips display on file rows
3. Add tag editor dialog
4. Add autocomplete tag input component
5. Fetch and cache tag suggestions

### Phase 5: Backend - Global Folders
1. Add `isGlobal`, `createdBy` to GpxFolder entity
2. Add `uploadedBy` to GpxFile entity
3. Create GSI for querying global folders
4. Update folder/file endpoints for global context
5. Add admin check for global folder creation
6. Update IAM policy for `uploads/GLOBAL/` prefix

### Phase 6: Frontend - Global Folders
1. Add "Shared Folders" section to UI
2. Add globe icon for global folders
3. Show "Uploaded by" for files in global folders
4. Admin-only "Create Global Folder" button
5. Conditional delete/rename buttons based on permissions

### Phase 7: Polish
1. Add "Move to folder" action for files
2. Show item counts on folder rows
3. Add empty folder state
4. Add loading states for folder/tag operations
5. Add tag filtering (click chip to filter)
6. Add rate limiting for global folder uploads

## Testing Checklist

### Folders
- [ ] Create folder in root
- [ ] Create nested folder (up to 5 levels)
- [ ] Reject 6th level folder (max depth)
- [ ] Reject 101st folder (max count)
- [ ] Rename folder
- [ ] Delete empty folder
- [ ] Delete non-empty folder (should fail with 409)
- [ ] Navigate into folder
- [ ] Navigate up via breadcrumb
- [ ] Save file to current folder
- [ ] Files without folder appear in root
- [ ] Duplicate folder name rejected (case-insensitive)
- [ ] Move file between folders (if implemented)

### Global Folders
- [ ] Admin can create global folder
- [ ] Non-admin cannot create global folder (403)
- [ ] Global folders appear in all users' Shared Folders section
- [ ] Any gpxstudio user can upload to global folder
- [ ] Any gpxstudio user can download from global folder
- [ ] Any gpxstudio user can delete files in global folder
- [ ] Only creator/admin can delete global folder itself
- [ ] Only creator/admin can rename global folder
- [ ] Max 10 global folders enforced
- [ ] Files in global folders stored with GLOBAL userId
- [ ] S3 key uses uploads/GLOBAL/ prefix
- [ ] uploadedBy tracks actual uploader
- [ ] Global folder subfolders inherit isGlobal flag
- [ ] Globe icon displayed for global folders in UI

### Tags
- [ ] Add tags to a file
- [ ] Remove tag from file
- [ ] Max 10 tags per file enforced
- [ ] Tag length max 20 chars enforced
- [ ] Tags normalized (lowercase, special chars stripped)
- [ ] Autocomplete shows suggestions sorted by useCount
- [ ] New tags added to user's tag library
- [ ] Tag useCount increments on use
- [ ] Delete tag from library
- [ ] Max 50 tags per user enforced
- [ ] Tag chips display on file row (max 3 visible)
- [ ] Tag editor dialog opens/saves correctly
