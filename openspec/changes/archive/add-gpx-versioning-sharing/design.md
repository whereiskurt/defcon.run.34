# Design: GPX Versioning and Sharing

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           GPX Studio Frontend                            │
├─────────────────────────────────────────────────────────────────────────┤
│  Menu.svelte          │  CloudStorage.svelte  │  ShareDialog.svelte     │
│  - Local Open         │  - File browser       │  - Generate share link  │
│  - Save to Cloud      │  - Version history    │  - Set access mode      │
│  - View > Cloud       │  - Share button       │  - Copy URL             │
└───────────────────────┴───────────────────────┴─────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Next.js API Routes                             │
├─────────────────────────────────────────────────────────────────────────┤
│  /api/gpx/files/[id]          │  /api/gpx/shares                        │
│  - GET: fetch file + versions │  - POST: create share                   │
│  - PUT: save new version      │  - GET: list shares for file            │
│  - DELETE: remove file        │  - DELETE: revoke share                 │
├───────────────────────────────┼─────────────────────────────────────────┤
│  /api/gpx/shares/[token]      │  /api/gpx/shares/[token]/accept         │
│  - GET: validate share token  │  - POST: copy file to user's storage    │
└───────────────────────────────┴─────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
┌───────────────────────────────┐   ┌───────────────────────────────────┐
│         DynamoDB              │   │              S3                    │
├───────────────────────────────┤   ├───────────────────────────────────┤
│  GpxFile entity               │   │  uploads/{userId}/gpx/             │
│  - version: number            │   │    {fileId}.gpx        (current)   │
│  - versionCount: number       │   │    {fileId}.v1.gpx     (version 1) │
│                               │   │    {fileId}.v2.gpx     (version 2) │
│  GpxShare entity (new)        │   │    ...                             │
│  - shareId (token)            │   │                                    │
│  - fileId + version           │   │                                    │
│  - accessMode + allowedEmails │   │                                    │
└───────────────────────────────┘   └───────────────────────────────────┘
```

## Data Model Changes

### GpxFile Entity (Modified)

```typescript
// New attributes added to existing entity
{
  version: {
    type: "number",
    required: true,
    default: 1,
  },
  versionCount: {
    type: "number",
    required: true,
    default: 1,
  },
  // Existing: fileId, fileName, bucket, key, etc.
}
```

**S3 Key Pattern:**
- Current version: `uploads/{userId}/gpx/{fileId}.gpx`
- Versioned: `uploads/{userId}/gpx/{fileId}.v{N}.gpx`

### GpxShare Entity (New)

```typescript
export const GpxShare = new Entity({
  model: {
    entity: "GpxShare",
    version: "1",
    service: "gpx",
  },
  attributes: {
    shareId: {
      type: "string",  // URL-safe token (nanoid)
      required: true,
    },
    ownerId: {
      type: "string",  // User who created the share
      required: true,
    },
    fileId: {
      type: "string",
      required: true,
    },
    version: {
      type: "number",  // Specific version shared
      required: true,
    },
    accessMode: {
      type: "string",
      enum: ["public", "private"],
      required: true,
    },
    allowedEmails: {
      type: "list",
      items: { type: "string" },
      required: false,  // Only for private mode
    },
    createdAt: {
      type: "number",
      required: true,
      default: () => Date.now(),
    },
    expiresAt: {
      type: "number",
      required: false,  // Optional expiration
    },
  },
  indexes: {
    primary: {
      pk: { field: "pk", composite: ["shareId"] },
      sk: { field: "sk", composite: [] },
    },
    byFile: {
      index: "gsi1pk-gsi1sk-index",
      pk: { field: "gsi1pk", composite: ["ownerId", "fileId"] },
      sk: { field: "gsi1sk", composite: ["createdAt"] },
    },
  },
});
```

## API Design

### Save New Version

```
PUT /api/gpx/files/{fileId}
Body: { updateContent: true }
Response: {
  uploadUrl: "presigned S3 URL",
  version: 3,  // New version number
  key: "uploads/{userId}/gpx/{fileId}.v3.gpx"
}
```

**Flow:**
1. Increment file.versionCount
2. Generate presigned URL for new versioned key
3. Client uploads to versioned key
4. On success, update file.version to new number
5. Copy to current key (non-versioned) for default access

### Create Share

```
POST /api/gpx/shares
Body: {
  fileId: "abc123",
  version: 3,
  accessMode: "public" | "private",
  allowedEmails?: ["user@example.com"]
}
Response: {
  shareId: "xYz789AbC",
  shareUrl: "https://gpx.defcon.run/share/xYz789AbC"
}
```

### Accept Share (Copy to User's Storage)

```
POST /api/gpx/shares/{token}/accept
Headers: { Authorization: "Bearer ..." }
Response: {
  fileId: "newFileId",
  fileName: "SharedMap.gpx",
  version: 1  // Fresh copy starts at v1
}
```

**Flow:**
1. Validate share token and access permissions
2. Copy S3 object from owner's versioned key to recipient's storage
3. Create new GpxFile record with version=1
4. Return new file info for immediate loading

## Frontend Changes

### Menu Restructuring

**File Menu (After):**
```
+ New              Ctrl++
─────────────────────────
  Local Open       Ctrl+O
  Save to Cloud    Ctrl+Shift+K
─────────────────────────
  Duplicate        Ctrl+D
─────────────────────────
  Delete File      Ctrl+⌫
  Delete All       Ctrl+Shift+⌫
─────────────────────────
  Export           Ctrl+S
  Export All       Ctrl+Shift+S
```

**View Menu (After):**
```
  Elevation Profile    Ctrl+P
  Tree File View       Ctrl+L
─────────────────────────────
  Cloud Storage
─────────────────────────────
  Switch Basemap       F1
  ...
```

### CloudStorage.svelte Additions

1. **Version indicator** on files: "v3" badge
2. **Share button** on file hover/selection
3. **Version history dropdown** for accessing old versions

### New ShareDialog.svelte

- Access mode selector (Public/Private)
- Email input for private shares
- Generated URL display with copy button
- QR code for mobile sharing (optional)

## State Management

### Settings Persistence

```typescript
// In settings.ts
lastSaveFolder: new Setting<string>({
  key: 'lastSaveFolder',
  defaultValue: 'ROOT',
  persist: true,
}),
```

### Quick Save Logic

```typescript
async function quickSaveToCloud() {
  const selectedLayers = getSelectedLayers();
  const folderId = settings.lastSaveFolder.get();

  for (const layer of selectedLayers) {
    await saveOrUpdateToCloud(layer, folderId);
  }
}
```

## Security Considerations

1. **Share Token Generation**: Use `nanoid(21)` for URL-safe, collision-resistant tokens
2. **Access Validation**: Always verify session before share operations
3. **Private Share Emails**: Validate against authenticated user's email
4. **Rate Limiting**: Limit share creation to prevent abuse (e.g., 100/day)
5. **Cascade Deletion**: Remove all shares when file is deleted

## Migration Strategy

1. **Existing Files**: Set `version=1, versionCount=1` for all existing files
2. **No S3 Migration**: Existing files remain at non-versioned keys
3. **Forward Compatible**: New saves create versioned keys alongside current

## Trade-offs

| Decision | Alternative | Rationale |
|----------|-------------|-----------|
| Copy-on-accept (not reference) | Viewer-only mode | Simpler permissions, user owns their copy |
| Version per save | Manual version creation | Automatic history without user friction |
| Email-based private sharing | User lookup/search | Simpler UX, no user directory needed |
| Max 50 versions | Unlimited | Storage cost control, sufficient history |
