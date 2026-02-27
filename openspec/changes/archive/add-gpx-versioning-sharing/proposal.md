# Add GPX File Versioning and Sharing

**Status:** Draft
**Created:** 2026-01-15

## Summary

Extend GPX cloud storage with file versioning, shareable URLs, and menu restructuring to improve the user experience for collaborative map editing.

## Problem Statement

Currently, GPX files in cloud storage:
- Have no version history - saves overwrite the previous content
- Cannot be shared via URL - only the file owner can access
- Require opening the Cloud Storage dialog for every save operation
- Don't remember the user's last folder location

Users need:
1. Version history to track changes and reference specific states
2. Shareable links for collaboration (public or private access)
3. Quick save without dialog interaction
4. Persistent folder context across saves

## Proposed Solution

### 1. File Versioning
- Every save increments a version number (starting at v1)
- Each version stored as a separate S3 object with version suffix
- Current version always accessible; previous versions retrievable
- Metadata tracks version count and current version pointer

### 2. Shareable URLs
- Generate public URLs pointing to specific file versions
- Two access modes:
  - **Public**: Anyone with the link (requires defcon.run account)
  - **Private**: Specific email addresses only
- Opening a shared link creates a copy (v1) in the recipient's storage
- Server-side rendering of shared map state

### 3. Menu Restructuring
- Move "Cloud Storage" from File menu to View menu
- Rename current "Open" to "Local Open"
- Add "Save to Cloud" (Ctrl+Shift+K) - saves without dialog
- Remember last folder for subsequent saves

## Capabilities

| Capability | Description |
|------------|-------------|
| gpx-file-versioning | Version tracking for GPX files |
| gpx-sharing | Shareable URLs with access control |
| gpx-menu-restructure | Menu reorganization for improved UX |

## Dependencies

- Existing cloud storage infrastructure (S3 + DynamoDB)
- Authentication service (run.auth) for access control
- Existing folder system for organization

## Out of Scope

- Real-time collaborative editing (live sync)
- Version diff visualization
- Merge conflict resolution
- Bulk sharing operations

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| S3 storage growth from versions | Implement max version limit (e.g., 50) with oldest auto-pruning |
| Unauthorized access to shared links | Require authenticated session + share token validation |
| Orphaned share records | Cascade delete shares when file deleted |

## Related Work

- `gpx-cloud-save-ux` spec: Layer selection and save/copy behavior (foundation for this work)
- `add-gpxstudio-service` change: Original GPX service implementation
