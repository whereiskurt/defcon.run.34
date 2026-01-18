# Proposal: Centralize Quota Service in run.auth

**Status:** Implemented
**Author:** Claude
**Created:** 2026-01-17

## Problem Statement

The quota system currently lives in run.human, creating issues:
- **Code duplication**: run.gpx needs quotas but would have to copy all quota code
- **Data silos**: Quota data isolated in run.human's DynamoDB table
- **No single source of truth**: Each service would have its own quota logic
- **Inconsistent enforcement**: Hard to ensure uniform quota policies across services

## Proposed Solution

Move the quota system into run.auth, exposing quota operations via HTTP APIs that all services call. run.auth becomes the centralized authority for:
- User authentication (existing)
- User quotas (new)
- User tier management (new)

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  run.human  │     │   run.gpx   │     │  run.cms    │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────── HTTP API ┼───────────────────┘
                           │
                    ┌──────▼──────┐
                    │  run.auth   │
                    │  quota +    │
                    │  auth       │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  DynamoDB   │
                    │  run-quota-electro  │
                    └─────────────┘
```

## Key Design Decisions

1. **Dedicated `run-quota-electro` DynamoDB table** - Separate from auth table for independent scaling
2. **Add `quotaTier` field to AuthProfile** - Explicit tier (zero/upload/admin) instead of deriving from services
3. **Internal service URLs** - Backends use `auth.app-{region}-defcon-run.local` to avoid CloudFront roundtrips
4. **X-Internal-Secret auth** - Server-to-server operations protected by shared secret

## API Surface

**User operations (session auth):**
- `GET /api/quota` - List user's quotas
- `POST /api/quota/{quotaId}/consume` - Consume quota
- `POST /api/quota/{quotaId}/restore` - Restore quota

**Service-to-service (X-Internal-Secret):**
- `POST /api/internal/quota/{userId}/{quotaId}/consume`
- `POST /api/internal/quota/{userId}/{quotaId}/restore`

**Admin operations:**
- `POST /api/admin/quota/{userId}/{quotaId}/reset`
- `POST /api/admin/quota/{userId}/{quotaId}/set`

## Impact

- **run.auth**: Add quota service code, API endpoints, DynamoDB table
- **run.human**: Replace local quota code with HTTP client calls
- **run.gpx**: Add quota client, integrate with upload flow
- **Infrastructure**: New DynamoDB table `run-quota-electro`

## Migration Strategy

1. Build quota service in run.auth (non-breaking)
2. Add quota client to run.human, run parallel (feature flag)
3. Migrate existing quota data
4. Remove local quota code from run.human
5. Integrate run.gpx

## Related Specs

- `quota-service` - New spec defining quota API requirements
