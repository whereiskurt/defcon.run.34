# Coding Conventions

**Analysis Date:** 2026-02-28

## Naming Patterns

**Files:**
- TypeScript components: PascalCase for React components (`ConfirmDialog.tsx`, `PathnameBinder.tsx`), kebab-case for non-component files (`map-background.tsx`, `theme-switch.tsx`, `dropdown-user.tsx`)
- Entity files: kebab-case (`run-user.ts`, `auth-profile.ts`, `gpx-file.ts`, `user-quota.ts`)
- Config files: camelCase or simple names (`auth.ts`, `site.ts`, `fonts.ts`, `index.ts`)
- API routes: Next.js App Router convention (`route.ts` inside path-based directories)
- Go files: lowercase with underscores for tests (`import_test.go`), lowercase single-word for source (`handlers.go`, `discovery.go`, `config.go`)
- Terraform files: descriptive lowercase (`variables.tf`, `main.tf`, `outputs.tf`, `ssm.tf`, `iam.tf`)

**Functions:**
- TypeScript: camelCase for all functions (`upsertRunUser`, `getAuthProfile`, `validateGpxFile`, `consumeQuota`)
- React components: PascalCase function names (`Header`, `Providers`, `Footer`)
- Go: PascalCase for exported (`App.reload`, `DefaultConfig`), camelCase for unexported (`findRepoRoot`, `openBrowser`)
- Async functions: Use `async/await` consistently, no `.then()` chains

**Variables:**
- TypeScript: camelCase for variables (`isDev`, `siteDomain`, `csrfToken`)
- Constants: SCREAMING_SNAKE_CASE for true constants (`ELECTRO_TABLE`, `DYNAMODB_TABLE`, `CHALLENGE_TTL_MS`, `BUCKET_SSM_PARAM`, `PRESIGN_EXPIRY_SECONDS`)
- Environment variables: SCREAMING_SNAKE_CASE with prefixes (`RUN_DYNAMODB_ENDPOINT`, `AUTH_INTERNAL_SECRET`, `OIDC_RUNHUMAN_CLIENT_ID`)
- Go: camelCase for local vars, PascalCase for exported struct fields

**Types:**
- TypeScript interfaces/types: PascalCase (`SessionValidateResponse`, `QuotaCheckResult`, `GpxValidationResult`, `MeshtasticRadio`)
- Type exports at bottom of entity files, after functions
- Module augmentation pattern for extending library types (e.g., `declare module "next-auth"` in auth config)

## Code Style

**Formatting:**
- No project-level Prettier config. Rely on ESLint and editor defaults.
- 2-space indentation in TypeScript/JavaScript files
- Go: standard `gofmt` formatting (tabs)
- Terraform: standard HCL formatting (2-space indentation)
- Semicolons: Not enforced via config; mixed usage observed (mostly present)
- Trailing commas: Used consistently in multi-line objects and arrays

**Linting:**
- ESLint 9 with flat config (`eslint.config.mjs`) in each Next.js app
- `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript` for run.human and run.auth
- run.gpx uses older FlatCompat approach with `"next/core-web-vitals"` and `"next/typescript"`
- Lint command: `npm run lint` (runs `eslint`)
- No shared ESLint config across apps

**TypeScript:**
- `strict: true` in all Next.js apps (`apps/run.human/webapp/tsconfig.json`, `apps/run.auth/webapp/tsconfig.json`)
- Target: ES2017
- Module: esnext with bundler resolution
- Path aliases defined per app (see Import Organization below)
- `noEmit: true` (Next.js handles compilation)
- `skipLibCheck: true` for faster builds

## Import Organization

**Order (observed pattern):**
1. External library imports (`next/server`, `next-auth`, `electrodb`, AWS SDK)
2. Path alias imports (`@/config/auth`, `@/entities/run-user`, `@/lib/quota-client`)
3. Relative imports (`./client`, `../lib/cookie-jar.js`)

**Path Aliases (run.human):**
```json
{
  "@auth": ["./src/config/auth"],
  "@fonts": ["./src/config/fonts"],
  "@site": ["./src/config/site"],
  "@public/*": ["./public/*"],
  "@svgtypes": ["./src/types"],
  "@components/*": ["./src/components/*"],
  "@header": ["./src/components/header/header"],
  "@/*": ["./src/*"]
}
```

**Path Aliases (run.auth):**
- Same as run.human except no `@header` alias

**Path Aliases (run.gpx):**
- Uses `@/*` only (minimal alias set, defined in `apps/run.gpx/webapp/tsconfig.json`)

**E2E imports:**
- Use `.js` extension for local imports (`from '../lib/cookie-jar.js'`) since e2e projects use `"type": "module"`
- Use `@playwright/test` for test framework imports

## Error Handling

**API Route Pattern (consistent across all apps):**
```typescript
// 1. Check session (401)
const session = await auth();
if (!session?.user?.id) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// 2. Check service claim (403)
const services = (session.user as { services?: string[] }).services ?? [];
if (!services.includes("gpxstudio")) {
  return NextResponse.json({ error: "Access denied" }, { status: 403 });
}

// 3. Business logic in try/catch
try {
  // ... logic ...
  return NextResponse.json({ data }, { status: 200 });
} catch (error) {
  console.error("Error description:", error);
  return NextResponse.json({ error: "Failed to ..." }, { status: 500 });
}
```

**Admin Route Pattern (additional auth check):**
```typescript
// Internal secret OR admin session
const providedSecret = request.headers.get("X-Internal-Secret");
if (providedSecret === INTERNAL_SECRET && INTERNAL_SECRET) {
  return true; // Authorized via internal secret
}

// Fall back to session-based admin check
const token = await getToken({ req: request, secret: ..., cookieName: "sess_auth" });
const profile = await getAuthProfile(token.sub);
return profile?.services?.includes("admin") ?? false;
```

**Error Response Format:**
- Always include `error` field with human-readable message
- Optionally include `code` field for programmatic handling (e.g., `"NOT_ADMIN"`, `"INVALID_TIER"`)
- Optionally include `message` for longer explanations and contextual data
- HTTP status codes: 400 (bad input), 401 (no session), 403 (forbidden), 404 (not found), 413 (file too large), 429 (quota exceeded), 500 (server error)

**Quota Fail-Fast Pattern:**
```typescript
// Consume quota BEFORE the operation
const quotaResult = await consumeQuota(session.user.id, "gpx_upload", 1, quotaTier);
if (!quotaResult.success) {
  return NextResponse.json({ error: "Quota exceeded", ... }, { status: 429 });
}

// If later steps fail, RESTORE the quota
try {
  await doExpensiveOperation();
} catch (error) {
  await restoreQuota(session.user.id, "gpx_upload", 1);
  throw error;
}
```

**Go Error Handling:**
```go
cfg, err := importSiteHCL(a.siteHCLPath)
if err == nil {
    a.config = imported
} else if os.IsNotExist(err) {
    log.Printf("No site.hcl found, using defaults")
} else {
    log.Printf("Warning: could not import site.hcl: %v", err)
}
```

## Logging

**Framework:** `console` (no structured logging library)

**Patterns:**
- Prefix log messages with service/context name: `[run.human]`, `[Silent SSO]`, `[validateGpxFile]`
- Use `console.error()` for errors: `console.error("[run.human] Failed to fetch claims:", response.status, ...)`
- Use `console.log()` for informational messages: `console.log("[Silent SSO] Valid auth session found, redirecting to OIDC flow")`
- Go uses `log.Printf()` with similar prefixing convention
- E2E tests use descriptive step logging: `console.log('\n[1/8] Navigating to login page...')`

**When to Log:**
- Always log errors before returning error responses
- Log significant state transitions (SSO flow, session validation, claims refresh)
- Log warnings for non-fatal issues (`"Warning: could not import site.hcl"`)
- Do NOT log sensitive data (tokens, secrets, passwords)

## Comments

**When to Comment:**
- JSDoc-style comments on exported functions with description, param types, and usage examples
- Inline comments for non-obvious business logic (e.g., `// Consume quota before generating presign URL`)
- Module-level documentation blocks explaining entity purpose and data flow
- TODO comments for known issues: `//TODO: Remember why I did this...`

**JSDoc/TSDoc Pattern:**
```typescript
/**
 * Session Validation Endpoint (App Router)
 *
 * This endpoint allows other *.defcon.run services to validate the shared
 * session cookie and retrieve user claims including authorized services.
 *
 * Usage:
 *   GET https://auth.defcon.run/api/session/validate
 *   Cookie: sess=<session-token>
 *
 * Response (authenticated):
 *   { "valid": true, "user": { ... }, "expires": "..." }
 */
```

**Entity Comments:**
```typescript
/**
 * RunUser Entity
 *
 * Stores user data for the run.human application.
 * This entity is created after successful OIDC authentication from auth.defcon.run.
 */
```

## Function Design

**Size:** Target < 100 lines per function. Most API route handlers are 30-60 lines. Entity operations are 10-30 lines.

**Parameters:** Use destructured objects for multiple parameters. Single primitives for simple lookups (`userId: string`).

**Return Values:**
- API routes: Always return `NextResponse.json(...)` with explicit status code
- Entity functions: Return data directly or null for not-found (`return result.data`)
- Async operations: Always return promises (never fire-and-forget)

## Module Design

**Exports:** Use named exports exclusively. No default exports except for Next.js page components and eslint config.

**Barrel Files:** Minimal usage. `src/config/index.ts` re-exports config. `src/types/index.ts` defines shared types. Entities are imported directly from their files.

## Component Patterns

**Client Components:**
```typescript
"use client";

import { HeroUIProvider } from "@heroui/system";
// ... component code
export function Providers({ children, themeProps }: ProvidersProps) { ... }
```

**Server Components (default):**
```typescript
// No "use client" directive
export default async function ProtectedRootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth(); // Server-side data fetching
  return ( ... );
}
```

**Dynamic Imports for Client Components:**
```typescript
const UserDropDown = dynamic(() => import('./dropdown-user'), {
  ssr: false,
  loading: () => <Avatar size="sm" className="opacity-50 animate-pulse" src="" />,
});
```

**UI Library:** HeroUI (React Aria-based) for all UI components (`Button`, `Avatar`, `Navbar`, `Link`, `Tooltip`).

**Styling:** Tailwind CSS 4 with utility classes. Use `clsx` for conditional class composition.

## Configuration Pattern

**Centralized Config Object:**
Each app has a `src/config/index.ts` that exports a frozen config object derived from environment variables with dev/prod branching:

```typescript
export const config = {
  isDev,
  region,
  siteDomain,
  auth: { basePath, jwtSecret, internalSecret, ... },
  urls: { publicAuthServer, privateAuthServer, redirectProxy, ... },
  session: { maxAge, updateAge, refreshInterval },
  oidc: { clientId, clientSecret },
  cookies: { session: { name }, csrf: { name }, ... },
} as const;
```

**Environment Variable Conventions:**
- Prefix with service context: `RUN_DYNAMODB_*`, `AUTH_*`, `OIDC_*`
- Use `!` non-null assertion for required env vars: `process.env.OIDC_RUNHUMAN_SECRET!`
- Use `||` fallback for optional env vars with defaults: `process.env.REGION_SHORT || "use1"`
- Dev/prod branching: `const isDev = process.env.NODE_ENV !== "production"`

## ElectroDB Entity Pattern

All DynamoDB entities follow this consistent structure:

```typescript
import { Entity } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

export const MyEntity = new Entity(
  {
    model: { entity: "MyEntity", version: "1", service: "myservice" },
    attributes: {
      userId: { type: "string", required: true },
      // ... attributes with types, defaults, and watch triggers
      createdAt: { type: "number", default: () => Date.now(), readOnly: true },
      updatedAt: { type: "number", default: () => Date.now(), watch: "*", set: () => Date.now() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["userId"] },
        sk: { field: "sk", composite: [] },
      },
      // GSI indexes follow gsi1pk/gsi1sk, gsi2pk/gsi2sk naming
      byEmail: {
        index: "gsi1pk-gsi1sk-index",
        pk: { field: "gsi1pk", composite: ["email"] },
        sk: { field: "gsi1sk", composite: [] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

// Type exports at bottom
export type MyEntityItem = EntityItem<typeof MyEntity>;

// CRUD functions below entity definition
export async function getMyEntity(userId: string) {
  const result = await MyEntity.get({ userId }).go();
  return result.data;
}
```

## Terraform/HCL Conventions

**Module Versioning:**
- All modules use semver directories: `modules/{name}/v1.0.0/`
- Standard file layout: `variables.tf`, `main.tf`, `outputs.tf`, plus domain-specific files (`iam.tf`, `ssm.tf`, etc.)

**Variable Structure:**
```hcl
variable "site" {
  type = object({
    label         = string
    random_suffix = string
  })
  description = "Site configuration"
}
```
- Use `optional()` with defaults for non-required fields
- Complex nested objects with explicit types
- Template variables: `{{REGION}}`, `{{REGION_LABEL}}`, `{{SITE_LABEL}}` substituted at runtime

**Resource Naming:**
- Pattern: `${resource_name}-${region_label}-${site_label}` (e.g., `run-auth-use1-dc34-execution-role`)
- Tags: Always include `Name`, `Region`, `Site`, and context-specific tags (`TaskName`, `Cluster`)

**Resource Organization:**
- Data sources at top (`data "aws_caller_identity"`, `data "aws_region"`)
- Locals block for computed values
- IAM resources (roles, policies)
- Primary resources (ECS tasks, S3 buckets, etc.)
- Outputs at bottom

## Go Conventions (configui)

**App Struct Pattern:**
```go
type App struct {
    repoRoot    string
    configPath  string
    mu          sync.RWMutex
    config      *SiteConfig
    // ... fields
}
```

**Handler Pattern:**
```go
func (a *App) handleIndex(w http.ResponseWriter, r *http.Request) {
    a.mu.RLock()
    defer a.mu.RUnlock()
    // ... handler logic
}
```

**Route Registration:** Go 1.22+ method-aware routes: `mux.HandleFunc("GET /api/thing", app.handleThing)`

**Embedded Files:** `//go:embed static templates` for serving static assets and templates

## Service Communication

**Server-to-Server Pattern:**
- `X-Internal-Secret` header for authentication
- Internal service discovery URLs (not public endpoints)
- URL pattern: `http://run-auth.app-{region}-{domain-dashed}.local:3000/{region}`

**Cross-Origin (CORS):**
- Validate origin against `*.defcon.run` in production
- Allow `localhost` origins in development
- Explicit `Access-Control-Allow-*` headers

---

*Convention analysis: 2026-02-28*
