# Phase 5: Infrastructure Hardening + Content Type Schemas - Research

**Researched:** 2026-03-02
**Domain:** Strapi 5 CMS infrastructure (Litestream sync, S3 upload provider) + content type schema design
**Confidence:** HIGH

## Summary

Phase 5 has two independent workstreams: (1) fixing the worker Litestream sync script to safely handle SQLite WAL/SHM files while Strapi serves read traffic, and upgrading the S3 upload provider from v4 to v5 config format; (2) defining three content type schemas (Event, Route, POI) plus a shared coordinates component, all committed to git as schema.json files.

The worker sync bug is well-understood: the current `mv` swap replaces the .db file but leaves behind stale .db-wal and .db-shm files, which SQLite then applies to the new database, causing corruption. The fix requires atomically swapping all three files (.db, .db-wal, .db-shm) and checkpointing the restored database before Strapi opens it. The S3 provider upgrade is a config restructuring from flat `providerOptions` (v4) to nested `providerOptions.s3Options.credentials` (v5). Content type schemas follow a well-documented Strapi 5 pattern with schema.json files under `src/api/{type}/content-types/{type}/`.

**Primary recommendation:** Fix the sync script first (INFR-01/02 are prerequisites for any content traffic), then create the shared coordinates component, then define Event/Route/POI schemas in parallel.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- POI type taxonomy: DEF CON-flavored POI types: water station, rest stop, start/finish, aid station, photo opportunity, scenic viewpoint, lockpick village, badge station, swag drop, RF check-in (Meshtastic), vendor, social gathering spot. Implemented as Strapi enumeration field.
- Distance units: Kilometres stored in CMS (canonical unit). UI in run.human handles conversion to miles and steps for display. Single decimal field for distance in km.
- Rich text fields: Use Strapi 5's built-in blocks editor (rich text) for event and route descriptions. Matches existing `@strapi/blocks-react-renderer` already in run.human dependencies. Capabilities: headings, bold, italic, lists, links, inline images.
- Photo gallery (Events): Simple multi-upload using Strapi's built-in media (multiple files) field. No per-image captions or structured gallery components. Organizer uploads photos, they display in upload order.
- GPX files (Routes): Multiple GPX files per route (multi-media field). Allows variants (full route + shortcut, etc.). Requirements say "GPX files" (plural) -- confirmed.
- Upload limits: Rely on Strapi's global upload size limits in server config. No per-field size restrictions needed for small organizer team (3-5 people).
- Difficulty: NOT a stored field -- difficulty is derived from distance, elevation, GPX data, etc. Computed at display time in run.human, not entered by organizers in CMS. Remove difficulty from the Route schema.
- Route types: As specified in requirements: point-to-point, loop, out-and-back. Implemented as Strapi enumeration field.

### Claude's Discretion
- Map styling field implementation (color/weight/opacity inputs)
- Admin sidebar organization and content type grouping
- Coordinate precision for lat/lng fields
- Sort order field implementation
- Worker sync fix approach (technical -- safe WAL/SHM handling)
- S3 provider upgrade approach (v4 to v5 config format)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFR-01 | Worker litestream sync script safely handles WAL/SHM files under active read load | Sync script analysis, SQLite WAL docs, Litestream restore reference -- see Architecture Patterns and Common Pitfalls sections |
| INFR-02 | S3 upload provider uses Strapi 5 config format (v5 `s3Options.credentials` nesting) | Strapi 5 S3 provider docs, v4-to-v5 config migration -- see Standard Stack and Code Examples sections |
| SCHM-01 | Shared coordinates component (lat/lng with -90/90 and -180/180 validation) | Strapi 5 component model format, decimal type with min/max -- see Architecture Patterns section |
| SCHM-02 | Organizer can CRUD Events with all specified fields | Strapi 5 content type schema format, blocks/media/datetime/enumeration types -- see Code Examples section |
| SCHM-03 | Organizer can CRUD Routes with all specified fields (minus difficulty per user decision) | Same as SCHM-02 plus uid, decimal, component types -- see Code Examples section |
| SCHM-04 | Organizer can CRUD Points of Interest with all specified fields | Same as SCHM-02 plus enumeration for POI types -- see Code Examples section |
| SCHM-07 | All content types support draft/publish lifecycle | Strapi 5 draftAndPublish option (enabled by default) -- see Architecture Patterns section |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @strapi/strapi | ^5.6.0 | CMS framework | Already installed; defines content type API, admin panel, schema format |
| @strapi/provider-upload-aws-s3 | ^5.6.0 | S3 media uploads | Official Strapi 5 provider; upgrade from currently installed 4.15.0 |
| litestream | 0.5.5 | SQLite replication | Already installed in Docker image; master->S3->worker sync |
| better-sqlite3 | ^11.6.0 | SQLite driver | Already installed; Strapi 5 default for SQLite |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @strapi/blocks-react-renderer | ^1.0.2 | Render blocks rich text | Already in run.human; used for Event/Route description display (Phase 8+) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `blocks` rich text type | `richtext` (Markdown) | Blocks is newer, JSON-based, better admin UX; matches existing renderer in run.human |
| `float` for coordinates | `decimal` with `column.args` | Decimal allows precision control; float is IEEE 754 -- decimal is more predictable for coordinates |
| Per-field media restrictions | Global upload limits | Small organizer team (3-5) makes per-field restrictions unnecessary overhead |

**Installation:**
```bash
# In apps/run.cms/app/
npm install @strapi/provider-upload-aws-s3@^5.6.0
# This replaces the v4.15.0 already in package.json
```

## Architecture Patterns

### Recommended Project Structure
```
apps/run.cms/app/src/
├── api/
│   ├── health/                          # Existing custom API (pattern reference)
│   ├── event/
│   │   └── content-types/
│   │       └── event/
│   │           └── schema.json          # SCHM-02
│   ├── route/
│   │   └── content-types/
│   │       └── route/
│   │           └── schema.json          # SCHM-03
│   └── point-of-interest/
│       └── content-types/
│           └── point-of-interest/
│               └── schema.json          # SCHM-04
├── components/
│   └── shared/
│       └── coordinates.json             # SCHM-01
└── ...
```

Note: Strapi 5 auto-generates REST API routes, controllers, and services for content types. No custom controller/route/service files are needed for standard CRUD. The `src/api/{type}/` directory only needs the `content-types/{type}/schema.json` file.

### Pattern 1: Content Type Schema (Collection Type)
**What:** JSON schema defining a collection type with attributes, options, and info metadata
**When to use:** For every content type (Event, Route, POI)
**Example:**
```json
{
  "kind": "collectionType",
  "collectionName": "events",
  "info": {
    "displayName": "Event",
    "singularName": "event",
    "pluralName": "events",
    "description": "DCR34 events (runs, socials, swag swaps)"
  },
  "options": {
    "draftAndPublish": true
  },
  "attributes": {
    "title": {
      "type": "string",
      "required": true,
      "maxLength": 255
    },
    "slug": {
      "type": "uid",
      "targetField": "title"
    },
    "description": {
      "type": "blocks"
    },
    "coverImage": {
      "type": "media",
      "multiple": false,
      "allowedTypes": ["images"]
    }
  }
}
```
Source: [Strapi 5 Models docs](https://docs.strapi.io/cms/backend-customization/models), [Strapi GitHub examples](https://github.com/strapi/strapi/blob/main/examples/getstarted/src/api/article/content-types/article/schema.json)

### Pattern 2: Shared Component
**What:** Reusable field group stored as a single JSON file under `src/components/{category}/`
**When to use:** For the coordinates component shared across Event, Route, and POI
**Example:**
```json
{
  "collectionName": "components_shared_coordinates",
  "info": {
    "displayName": "Coordinates",
    "description": "GPS coordinates (latitude/longitude)",
    "icon": "map-pin"
  },
  "attributes": {
    "latitude": {
      "type": "decimal",
      "required": true,
      "min": -90,
      "max": 90
    },
    "longitude": {
      "type": "decimal",
      "required": true,
      "min": -180,
      "max": 180
    }
  }
}
```
Source: [Strapi 5 Models docs](https://docs.strapi.io/cms/backend-customization/models), [Strapi 5 Project Structure](https://docs.strapi.io/cms/project-structure)

File path: `src/components/shared/coordinates.json`
Referenced as: `"component": "shared.coordinates"` in content type schemas.

### Pattern 3: Safe Worker Database Sync
**What:** Restore from Litestream to temp path, checkpoint WAL into main db, then swap all three files atomically
**When to use:** Worker periodic sync (replaces current unsafe `mv` approach)
**Approach:**

1. Restore to a temp directory (not alongside the live database)
2. Checkpoint the restored database to fold WAL into main file: `sqlite3 "$TEMP_DB" "PRAGMA wal_checkpoint(TRUNCATE);"`
3. Stop Strapi reads briefly (or use SIGSTOP/SIGCONT, or rename approach)
4. Move all three files atomically (.db, .db-wal, .db-shm) -- or since checkpoint was done, only .db matters and .wal/.shm can be removed
5. Restart Strapi reads

**Recommended approach (simplest, safest):**
```bash
# Restore to completely separate temp directory
TEMP_DIR=$(mktemp -d)
TEMP_DB="${TEMP_DIR}/strapi.db"
litestream restore -config "$CONFIG" -o "$TEMP_DB" "$DB_PATH"

# Checkpoint to fold WAL into main db file (clean state)
sqlite3 "$TEMP_DB" "PRAGMA wal_checkpoint(TRUNCATE);"

# Remove any WAL/SHM files from restored db (should be clean after checkpoint)
rm -f "${TEMP_DB}-wal" "${TEMP_DB}-shm"

# Atomic swap: replace all database files
# Stop Strapi temporarily to release file handles
supervisorctl stop strapi
mv "$TEMP_DB" "$DB_PATH"
rm -f "${DB_PATH}-wal" "${DB_PATH}-shm"
supervisorctl start strapi

# Cleanup temp directory
rm -rf "$TEMP_DIR"
```

Source: [Litestream restore reference](https://litestream.io/reference/restore/), [SQLite WAL documentation](https://sqlite.org/wal.html), [Litestream tips](https://litestream.io/tips/)

### Pattern 4: S3 Provider v5 Configuration
**What:** Strapi 5 nests S3 credentials inside `s3Options.credentials` instead of flat `providerOptions`
**When to use:** Upgrading from @strapi/provider-upload-aws-s3 v4 to v5
**Current (v4 format in plugins.ts):**
```typescript
providerOptions: {
  accessKeyId: s3AccessKey,           // FLAT
  secretAccessKey: env('...'),        // FLAT
  region: env('...'),
  params: { Bucket: s3Bucket, ACL: null },
  rootPath: s3RootPath,
  baseUrl: cdnBaseUrl,
}
```
**Required (v5 format):**
```typescript
providerOptions: {
  baseUrl: cdnBaseUrl,                // Stays at top level
  rootPath: s3RootPath,               // Stays at top level
  s3Options: {                        // NEW: nested object
    credentials: {                    // NEW: credentials wrapper
      accessKeyId: s3AccessKey,
      secretAccessKey: env('...'),
    },
    region: env('...'),
    params: {
      ACL: null,                      // Bucket policy handles access
      Bucket: s3Bucket,
    },
  },
}
```
Source: [Strapi 5 S3 provider docs](https://docs.strapi.io/cms/configurations/media-library-providers/amazon-s3), [Strapi GitHub provider source](https://github.com/strapi/strapi/tree/main/packages/providers/upload-aws-s3)

**Also update the `provider` value from `'@strapi/provider-upload-aws-s3'` to `'aws-s3'`** (Strapi 5 uses short names).

### Pattern 5: Draft/Publish Configuration
**What:** Strapi 5 supports draft/publish lifecycle via `draftAndPublish: true` in schema options
**When to use:** All three content types (Event, Route, POI) -- required by SCHM-07
**Key details:**
- Default value is `true` in Strapi 5 (but explicit is better for clarity)
- Creates two database rows per document: one draft, one published, linked by `document_id`
- Three statuses in admin: Draft, Modified (published with pending changes), Published
- REST API returns only published content by default (draft requires `status=draft` query param)
- Unique constraints are skipped for draft entries (only enforced at publish)
Source: [Strapi 5 Draft & Publish docs](https://docs.strapi.io/cms/features/draft-and-publish)

### Anti-Patterns to Avoid
- **Flat S3 credentials in v5:** Putting `accessKeyId` directly in `providerOptions` instead of nested in `s3Options.credentials` -- silently fails or uses default AWS chain
- **mv-swap without WAL/SHM cleanup:** The current bug. SQLite applies stale WAL pages to the new database, causing corruption
- **Custom controllers for CRUD:** Strapi 5 auto-generates REST endpoints for collection types. Don't write custom controllers unless you need custom business logic
- **Restoring to the live database path:** Litestream restore refuses to overwrite existing files. Always restore to `-o` temp path
- **Forgetting `allowedTypes` on media fields:** Without it, any file type can be uploaded to image-only fields

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| REST API for content types | Custom Express/Koa routes | Strapi auto-generated APIs | Strapi creates GET/POST/PUT/DELETE + populate/filter for free |
| Slug generation | Custom slugify middleware | Strapi `uid` field with `targetField` | Auto-generates from title, handles uniqueness |
| Draft/publish workflow | Custom status field + logic | Strapi `draftAndPublish: true` | Built-in admin UI, API filtering, document versioning |
| Rich text editor | Custom TipTap/ProseMirror integration | Strapi blocks editor (`type: "blocks"`) | Built into admin, renderer exists for React frontend |
| Database migrations | Manual ALTER TABLE scripts | Strapi schema auto-sync | Strapi reads schema.json and auto-creates/migrates tables on startup |
| File upload to S3 | Custom multer + AWS SDK | `@strapi/provider-upload-aws-s3` v5 | Handles streaming, thumbnails, deletion, CDN URL construction |

**Key insight:** Strapi 5's schema-driven approach means content types only need schema.json files. Controllers, services, routes, and database migrations are all auto-generated. The only custom code needed is for non-standard behavior (like the health check endpoint).

## Common Pitfalls

### Pitfall 1: WAL/SHM File Separation During Database Swap
**What goes wrong:** Moving the .db file with `mv` leaves behind .db-wal and .db-shm files. When Strapi opens the "new" .db file, SQLite finds the old WAL and applies stale transactions, corrupting data.
**Why it happens:** SQLite WAL mode maintains three tightly coupled files (.db, .db-wal, .db-shm). They are a unit -- separating them causes data loss or corruption.
**How to avoid:** Always checkpoint the restored database (`PRAGMA wal_checkpoint(TRUNCATE)`) to fold WAL into the main file, then remove all three old files before placing the new one.
**Warning signs:** "database disk image is malformed" errors in Strapi logs after a sync cycle.
Source: [SQLite WAL docs](https://sqlite.org/wal.html), [Litestream tips](https://litestream.io/tips/)

### Pitfall 2: S3 Provider Config Format Mismatch
**What goes wrong:** Using v4 flat config with v5 provider package causes uploads to silently fail or fall back to default AWS credential chain (IAM role), ignoring explicit keys.
**Why it happens:** Strapi 5 S3 provider expects `s3Options.credentials` nesting. Flat keys are ignored.
**How to avoid:** Match the exact v5 config structure. Also change provider name from `'@strapi/provider-upload-aws-s3'` to `'aws-s3'`.
**Warning signs:** Uploads work in production (IAM role fallback) but explicit credentials are ignored; local dev with explicit keys fails silently.
Source: [Strapi 5 S3 provider docs](https://docs.strapi.io/cms/configurations/media-library-providers/amazon-s3)

### Pitfall 3: Component File Naming Convention
**What goes wrong:** Putting component schema in wrong path structure causes Strapi to not discover it.
**Why it happens:** Strapi 5 components are single JSON files (not directories with schema.json inside). The file lives at `src/components/{category}/{name}.json`, not `src/components/{category}/{name}/schema.json`.
**How to avoid:** Use `src/components/shared/coordinates.json` (single file), referenced as `"shared.coordinates"` in content type schemas.
**Warning signs:** Strapi starts without errors but the component doesn't appear in admin Content-Type Builder.
Source: [Strapi 5 Project Structure](https://docs.strapi.io/cms/project-structure), [Strapi GitHub examples](https://github.com/strapi/strapi/tree/main/examples/getstarted/src/components)

### Pitfall 4: UID Field Auto-Generation Issues
**What goes wrong:** Slug field doesn't auto-populate from title in Strapi 5 admin.
**Why it happens:** Known Strapi 5 issue where UID fields sometimes don't auto-generate when not marked as required.
**How to avoid:** Always set the `uid` field as `required: true` and test slug generation in admin after schema creation.
**Warning signs:** Empty slug field when creating content via admin panel.
Source: [Strapi GitHub issue #21472](https://github.com/strapi/strapi/issues/21472)

### Pitfall 5: Draft/Publish Unique Constraint Behavior
**What goes wrong:** Duplicate slugs exist for draft entries, causing confusion.
**Why it happens:** Strapi 5 intentionally skips unique validations for draft entries. Two drafts can have the same slug; uniqueness is only enforced at publish time.
**How to avoid:** Understand this is by design. Validate uniqueness in testing only against published entries.
**Warning signs:** Multiple entries with same slug in database (one draft, one published -- this is normal).
Source: [Strapi 5 Draft & Publish docs](https://docs.strapi.io/cms/features/draft-and-publish)

### Pitfall 6: Missing Litestream File Cleanup on Database Recreation
**What goes wrong:** After restoring a fresh database, old WAL file pages get applied to the new database.
**Why it happens:** Litestream docs warn: "Leaving the WAL file causes SQLite to apply old pages to new databases." The `-litestream` directory can also cause issues.
**How to avoid:** When replacing the database, delete all three files (.db, .db-wal, .db-shm) AND the `-litestream` directory if it exists.
**Warning signs:** Replication issues after database recreation; stale data appearing.
Source: [Litestream tips](https://litestream.io/tips/)

## Code Examples

### Shared Coordinates Component (SCHM-01)
```json
// File: src/components/shared/coordinates.json
// Referenced as: "shared.coordinates" in content type schemas
{
  "collectionName": "components_shared_coordinates",
  "info": {
    "displayName": "Coordinates",
    "description": "GPS latitude/longitude pair",
    "icon": "map-pin"
  },
  "attributes": {
    "latitude": {
      "type": "decimal",
      "required": true,
      "min": -90,
      "max": 90
    },
    "longitude": {
      "type": "decimal",
      "required": true,
      "min": -180,
      "max": 180
    }
  }
}
```
Source: [Strapi 5 Models docs](https://docs.strapi.io/cms/backend-customization/models)

### Event Schema (SCHM-02)
```json
// File: src/api/event/content-types/event/schema.json
{
  "kind": "collectionType",
  "collectionName": "events",
  "info": {
    "displayName": "Event",
    "singularName": "event",
    "pluralName": "events",
    "description": "DCR34 events (runs, socials, swag swaps)"
  },
  "options": {
    "draftAndPublish": true
  },
  "attributes": {
    "title": {
      "type": "string",
      "required": true,
      "maxLength": 255
    },
    "slug": {
      "type": "uid",
      "targetField": "title",
      "required": true
    },
    "description": {
      "type": "blocks"
    },
    "shortDescription": {
      "type": "text",
      "maxLength": 500
    },
    "startDatetime": {
      "type": "datetime",
      "required": true
    },
    "endDatetime": {
      "type": "datetime"
    },
    "locationName": {
      "type": "string",
      "maxLength": 255
    },
    "locationCoordinates": {
      "type": "component",
      "component": "shared.coordinates",
      "repeatable": false
    },
    "coverImage": {
      "type": "media",
      "multiple": false,
      "allowedTypes": ["images"]
    },
    "gallery": {
      "type": "media",
      "multiple": true,
      "allowedTypes": ["images"]
    },
    "attachments": {
      "type": "media",
      "multiple": true,
      "allowedTypes": ["images", "files", "videos", "audios"]
    },
    "sortOrder": {
      "type": "integer",
      "default": 0
    }
  }
}
```

### Route Schema (SCHM-03)
```json
// File: src/api/route/content-types/route/schema.json
// Note: difficulty REMOVED per user decision (computed at display time in run.human)
{
  "kind": "collectionType",
  "collectionName": "routes",
  "info": {
    "displayName": "Route",
    "singularName": "route",
    "pluralName": "routes",
    "description": "DCR34 running/walking routes"
  },
  "options": {
    "draftAndPublish": true
  },
  "attributes": {
    "name": {
      "type": "string",
      "required": true,
      "maxLength": 255
    },
    "slug": {
      "type": "uid",
      "targetField": "name",
      "required": true
    },
    "description": {
      "type": "blocks"
    },
    "shortDescription": {
      "type": "text",
      "maxLength": 500
    },
    "routeType": {
      "type": "enumeration",
      "enum": ["point-to-point", "loop", "out-and-back"],
      "required": true
    },
    "distance": {
      "type": "decimal"
    },
    "elevationGain": {
      "type": "decimal"
    },
    "estimatedDuration": {
      "type": "integer"
    },
    "gpxFiles": {
      "type": "media",
      "multiple": true,
      "allowedTypes": ["files"]
    },
    "startCoordinates": {
      "type": "component",
      "component": "shared.coordinates",
      "repeatable": false
    },
    "endCoordinates": {
      "type": "component",
      "component": "shared.coordinates",
      "repeatable": false
    },
    "coverImage": {
      "type": "media",
      "multiple": false,
      "allowedTypes": ["images"]
    },
    "mapColor": {
      "type": "string",
      "default": "#FF5733",
      "maxLength": 7
    },
    "mapWeight": {
      "type": "integer",
      "default": 3,
      "min": 1,
      "max": 10
    },
    "mapOpacity": {
      "type": "decimal",
      "default": 0.8,
      "min": 0,
      "max": 1
    },
    "sortOrder": {
      "type": "integer",
      "default": 0
    }
  }
}
```

### Point of Interest Schema (SCHM-04)
```json
// File: src/api/point-of-interest/content-types/point-of-interest/schema.json
{
  "kind": "collectionType",
  "collectionName": "points_of_interest",
  "info": {
    "displayName": "Point of Interest",
    "singularName": "point-of-interest",
    "pluralName": "points-of-interest",
    "description": "DCR34 points of interest along routes"
  },
  "options": {
    "draftAndPublish": true
  },
  "attributes": {
    "name": {
      "type": "string",
      "required": true,
      "maxLength": 255
    },
    "slug": {
      "type": "uid",
      "targetField": "name",
      "required": true
    },
    "description": {
      "type": "text"
    },
    "coordinates": {
      "type": "component",
      "component": "shared.coordinates",
      "repeatable": false,
      "required": true
    },
    "poiType": {
      "type": "enumeration",
      "enum": [
        "water-station",
        "rest-stop",
        "start-finish",
        "aid-station",
        "photo-opportunity",
        "scenic-viewpoint",
        "lockpick-village",
        "badge-station",
        "swag-drop",
        "rf-check-in",
        "vendor",
        "social-gathering-spot"
      ],
      "required": true
    },
    "markerImage": {
      "type": "media",
      "multiple": false,
      "allowedTypes": ["images"]
    },
    "photo": {
      "type": "media",
      "multiple": false,
      "allowedTypes": ["images"]
    },
    "sortOrder": {
      "type": "integer",
      "default": 0
    }
  }
}
```

### S3 Provider v5 Config (INFR-02)
```typescript
// File: apps/run.cms/app/config/plugins.ts (upload section only)
// Changes from current v4 format:
//   1. provider: '@strapi/provider-upload-aws-s3' -> 'aws-s3'
//   2. accessKeyId/secretAccessKey move into s3Options.credentials
//   3. region and params move into s3Options
//   4. baseUrl and rootPath stay at providerOptions level

const uploadConfig = s3AccessKey && s3Bucket
  ? {
      config: {
        provider: 'aws-s3',
        providerOptions: {
          baseUrl: cdnBaseUrl,
          rootPath: s3RootPath,
          s3Options: {
            credentials: {
              accessKeyId: s3AccessKey,
              secretAccessKey: env('S3_MEDIA_SECRET_KEY'),
            },
            region: env('S3_MEDIA_REGION', 'us-east-1'),
            params: {
              Bucket: s3Bucket,
              ACL: null,
            },
          },
        },
        actionOptions: {
          upload: {},
          uploadStream: {},
          delete: {},
        },
      },
    }
  : {};
```
Source: [Strapi 5 S3 provider docs](https://docs.strapi.io/cms/configurations/media-library-providers/amazon-s3)

### Worker Sync Script Fix (INFR-01)
```bash
#!/bin/bash
# Fixed periodic sync loop (replaces mv-swap with checkpoint-then-swap)

# ... (existing header, env vars, initial restore) ...

while true; do
    sleep "$SYNC_INTERVAL"

    echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting periodic sync..."

    # 1. Restore to isolated temp directory
    TEMP_DIR=$(mktemp -d)
    TEMP_DB="${TEMP_DIR}/strapi.db"

    if $LITESTREAM restore -config "$CONFIG" -o "$TEMP_DB" "$DB_PATH" 2>/dev/null; then
        # 2. Checkpoint restored DB to fold WAL into main file
        sqlite3 "$TEMP_DB" "PRAGMA wal_checkpoint(TRUNCATE);"

        # 3. Clean up any WAL/SHM from restored DB
        rm -f "${TEMP_DB}-wal" "${TEMP_DB}-shm"

        # 4. Brief Strapi stop for atomic swap
        supervisorctl stop strapi 2>/dev/null

        # 5. Remove old database files (all three)
        rm -f "${DB_PATH}-wal" "${DB_PATH}-shm"

        # 6. Swap in the new database
        mv "$TEMP_DB" "$DB_PATH"

        # 7. Restart Strapi
        supervisorctl start strapi 2>/dev/null

        echo "$(date '+%Y-%m-%d %H:%M:%S') - Sync completed successfully"
    else
        echo "$(date '+%Y-%m-%d %H:%M:%S') - Sync failed or no new data"
    fi

    # Cleanup temp directory
    rm -rf "$TEMP_DIR"
done
```
Source: [Litestream restore reference](https://litestream.io/reference/restore/), [SQLite WAL docs](https://sqlite.org/wal.html)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| S3 provider v4 flat config | v5 nested `s3Options.credentials` | Strapi 5.0 (2024) | Must restructure plugins.ts upload config |
| Provider name `@strapi/provider-upload-aws-s3` | Short name `aws-s3` | Strapi 5.0 (2024) | Change provider string in config |
| `richtext` (Markdown) | `blocks` (JSON-based) | Strapi 4.14 (2023) | Use `blocks` type for rich text fields; render with `@strapi/blocks-react-renderer` |
| Manual REST routes | Auto-generated REST APIs | Strapi 4.x+ | No custom routes needed for content type CRUD |
| `draftAndPublish` default false | Default true in Strapi 5 | Strapi 5.0 (2024) | Explicit `true` for clarity; changes DB schema (document_id linking) |

**Deprecated/outdated:**
- `richtext` type (Markdown): Still supported but `blocks` is the recommended rich text field in Strapi 5
- Flat `providerOptions.accessKeyId`: v4 format, must migrate to nested `s3Options.credentials`

## Open Questions

1. **Coordinate precision for decimal fields**
   - What we know: Strapi `decimal` type maps to SQLite REAL (8-byte IEEE 754 float), giving ~15 significant digits. Can use `column.args` for explicit precision.
   - What's unclear: Whether `column.args` on decimal type affects SQLite behavior (SQLite doesn't enforce precision/scale like PostgreSQL)
   - Recommendation: Use `decimal` without `column.args` -- SQLite stores all decimals as 8-byte floats regardless. The 15 significant digits provide sub-meter precision at any location on Earth. This is Claude's discretion area.

2. **Map styling field structure (color/weight/opacity)**
   - What we know: Could be a shared component or individual fields on Route
   - What's unclear: Whether a component adds unnecessary complexity vs. inline fields
   - Recommendation: Use inline fields on Route (mapColor, mapWeight, mapOpacity) -- simpler, only used by Route, avoids component overhead. This is Claude's discretion area.

3. **Strapi restart during sync and health check behavior**
   - What we know: Worker supervisord manages both litestream-sync.sh and Strapi. Health check is `curl -f http://localhost:1337/_health`.
   - What's unclear: Whether ALB will deregister the task during the brief Strapi restart (5-15 seconds) or if HEALTHCHECK grace period covers it.
   - Recommendation: The Docker HEALTHCHECK has `--start-period=180s` and `--retries=3` with `--interval=30s`. A 5-15 second Strapi restart should survive within the retry window. Test in staging.

4. **estimatedDuration field unit**
   - What we know: Requirements say "estimated duration". Could be minutes (integer) or a text field ("2h 30m").
   - What's unclear: Whether integer minutes is sufficient or a more flexible format is needed.
   - Recommendation: Integer field storing minutes. Simple, sortable, and the UI can format it as "2h 30m" for display.

## Discretion Recommendations

These are areas where the user gave Claude discretion. Here are the recommended approaches:

| Area | Recommendation | Rationale |
|------|---------------|-----------|
| Map styling fields | Inline fields on Route: `mapColor` (string, hex), `mapWeight` (integer, 1-10), `mapOpacity` (decimal, 0-1) | Only Route uses map styling; a component adds unnecessary indirection |
| Coordinate precision | Plain `decimal` type with `min`/`max` validation, no `column.args` | SQLite stores all decimals as 8-byte floats; sub-meter precision at 6+ decimal places |
| Sort order field | `integer` type with `default: 0` on all three content types | Simple, universally understood; admin can reorder by changing the number |
| Admin sidebar grouping | No special grouping needed yet | Only 3 content types; Strapi alphabetizes them. Grouping becomes useful at 6+ types |
| Worker sync approach | supervisorctl stop/start Strapi around file swap (see code examples) | Simplest correct approach; 5-15 second downtime per sync is acceptable for read replicas |
| S3 provider upgrade | Restructure to v5 nested format, change provider name to `'aws-s3'` | Direct migration following official docs |

## Sources

### Primary (HIGH confidence)
- [Strapi 5 Models documentation](https://docs.strapi.io/cms/backend-customization/models) - Schema format, attribute types, component references, validation
- [Strapi 5 Project Structure](https://docs.strapi.io/cms/project-structure) - File paths for content types and components
- [Strapi 5 S3 Provider docs](https://docs.strapi.io/cms/configurations/media-library-providers/amazon-s3) - v5 config format with s3Options
- [Strapi 5 Draft & Publish docs](https://docs.strapi.io/cms/features/draft-and-publish) - draftAndPublish behavior, document_id
- [SQLite WAL documentation](https://sqlite.org/wal.html) - WAL/SHM file coupling, checkpoint behavior, corruption risks
- [Litestream restore reference](https://litestream.io/reference/restore/) - `-o` output flag, overwrite prevention
- [Litestream tips](https://litestream.io/tips/) - WAL/SHM cleanup requirements, database recreation guidance
- [Strapi GitHub examples](https://github.com/strapi/strapi/blob/main/examples/getstarted/src/api/article/content-types/article/schema.json) - Confirmed `blocks` type usage
- [Strapi blocks-react-renderer](https://github.com/strapi/blocks-react-renderer) - Confirmed `blocks` field type for rich text
- [Strapi GitHub provider source](https://github.com/strapi/strapi/tree/main/packages/providers/upload-aws-s3) - Provider name `aws-s3`, config structure

### Secondary (MEDIUM confidence)
- [Strapi 5 Content-Type Builder docs](https://docs.strapi.io/cms/features/content-type-builder) - Field types available in admin UI
- [Strapi GitHub issue #21472](https://github.com/strapi/strapi/issues/21472) - UID auto-generation issues

### Tertiary (LOW confidence)
- Component file naming as single `.json` vs directory with `schema.json` - verified via GitHub examples listing but exact format for Strapi 5 may vary. Strapi GitHub examples show single `.json` files (e.g., `test-como.json` in `components/blog/`). Content type schemas are always in `content-types/{name}/schema.json` directories. Flag for validation during implementation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using already-installed Strapi 5 with well-documented upgrade path for S3 provider
- Architecture: HIGH - Content type schema format confirmed via official docs and GitHub examples; sync fix based on SQLite/Litestream official documentation
- Pitfalls: HIGH - WAL corruption mechanism well-documented in SQLite docs; S3 v4->v5 migration documented in Strapi 5 provider docs

**Research date:** 2026-03-02
**Valid until:** 2026-04-01 (Strapi 5 is stable; SQLite WAL behavior is permanent)
