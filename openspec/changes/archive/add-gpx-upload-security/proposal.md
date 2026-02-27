# Proposal: Add GPX Upload Security Controls

**Status:** Draft
**Author:** Claude
**Created:** 2026-01-17

## Problem Statement

The GPX file upload presign process currently lacks security controls:
- No file size limits - users can upload arbitrarily large files
- No quota tracking - unlimited uploads per user
- No content validation - files are not verified as valid GPX XML

This creates potential for abuse (storage costs, non-GPX content hosting).

## Proposed Solution

Add three layers of security to the GPX upload flow:

1. **10 MB file size limit** - Enforced at presign time via API validation and S3 ContentLength
2. **Quota system** - Copy quota service from run.human, limit uploads to 50/user (500 for admins)
3. **Basic GPX validation** - Two-phase upload with confirmation endpoint that validates `<gpx>` root element

## Architecture

```
Current flow:
POST /api/gpx/files → presign URL → PUT to S3 → done

New flow:
POST /api/gpx/files → size check → quota consume → presign URL
                    → PUT to S3
                    → POST /api/gpx/files/[id]/confirm → validate GPX → active
                                                      → invalid → delete + restore quota
```

## Impact

- **Breaking changes:** None - existing API remains compatible
- **New endpoints:** `POST /api/gpx/files/[id]/confirm`
- **New errors:** 413 (file too large), 429 (quota exceeded), 400 (invalid GPX)
- **Client changes:** Must call confirm endpoint after S3 upload

## Alternatives Considered

1. **S3 Lambda trigger for validation** - More complex, async validation
2. **Client-only validation** - Can be bypassed, less secure
3. **Shared quota package** - Cleaner but more infrastructure work (future enhancement)

## Dependencies

- Quota system from run.human (will be copied, not shared)
- DynamoDB table access for quota tracking

## Related Specs

- `gpx-upload-security` - New spec defining security requirements
