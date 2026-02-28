# Coding Conventions

**Analysis Date:** 2026-02-28

## Naming Patterns

**Files:**
- Components: PascalCase with `.tsx` extension (e.g., `ConfirmDialog.tsx`, `theme-switch.tsx`)
- Services/Utilities: camelCase with `.ts` extension (e.g., `quota-client.ts`, `api.ts`)
- Routes/Pages: lowercase with hyphens (e.g., `(protected)/`, `(public)/`)
- API routes: lowercase, match semantic paths (e.g., `/api/admin/quota/route.ts`)

**Functions:**
- camelCase for regular functions (e.g., `fullLogout`, `cleanupStaleUploads`, `quotaRequest`)
- camelCase for React hooks with `use` prefix (e.g., `useLogout`, `useLogout()`)
- Arrow functions preferred for utility/helper functions
- JSDoc comments required for public functions

**Variables:**
- camelCase for all variables and constants (e.g., `isDev`, `REGION_SHORT`, `maxAgeMs`)
- ALL_CAPS only for truly immutable config constants exported from modules
- Environment variables: SCREAMING_SNAKE_CASE (e.g., `NEXT_PUBLIC_REGION_SHORT`, `AWS_REGION`)

**Types:**
- PascalCase for interfaces and types (e.g., `ConfirmDialogProps`, `SessionValidateResponse`, `QuotaId`)
- Use `I` prefix only when necessary for disambiguation
- Union types descriptive: `QuotaId = "file_upload" | "gpx_upload" | ...` (specific string literals)
- Generic response types: `{FieldName}Response` or `{FieldName}Request`

**Path Aliases:**
All configured in `tsconfig.json` with `@` prefix:
- `@/*` → `./src/*` (general imports)
- `@auth` → `./src/config/auth`
- `@components/*` → `./src/components/*`
- `@header` → `./src/components/header/header`
- `@fonts` → `./src/config/fonts`
- `@site` → `./src/config/site`
- `@public/*` → `./public/*`
- `@svgtypes` → `./src/types`

## Code Style

**Formatting:**
- No `.prettierrc` file - uses default formatting
- ESLint configuration in `eslint.config.mjs` per app
- TypeScript strict mode enabled across all apps

**Linting:**
- Framework: ESLint v9 + Next.js config
- Config: `eslint.config.mjs` (flat config format)
- Extends:
  - `eslint-config-next/core-web-vitals`
  - `eslint-config-next/typescript`
- Global ignores: `.next/`, `out/`, `build/`, `next-env.d.ts`
- No automated formatter enforcement (rely on IDE)

**Build Config:**
- TypeScript v5: `tsconfig.json` with `strict: true`
- Tailwind CSS v4: `@tailwindcss/postcss` plugin
- Next.js v16: `next.config.ts` with app router

## Import Organization

**Order:**
1. React and React libraries (`import { FC, useState } from "react"`)
2. Next.js and Next.js libraries (`import { useTheme } from "next-themes"`)
3. Installed packages (`import clsx from "clsx"`)
4. Local absolute imports using `@` paths (`import { apiUrl } from "@/lib/api"`)
5. Local relative imports (rarely used due to `@` aliases)
6. Type imports when needed (`import type { UserRole } from "@/lib/cookie-jar"`)

**Path Aliases:**
Always use `@/` prefix for imports within the same app. Never use relative paths like `../../../`.

Example from `theme-switch.tsx`:
```typescript
import { FC, useState, useEffect } from "react";
import { VisuallyHidden } from "@react-aria/visually-hidden";
import { SwitchProps, useSwitch } from "@heroui/switch";
import { useTheme } from "next-themes";
import clsx from "clsx";
import { IconSvgProps } from "@svgtypes";
```

## Error Handling

**Patterns:**
- Custom error classes for domain-specific errors (e.g., `QuotaExceededError`)
- Throw `Error` or custom error class when operation cannot proceed
- Return error objects in API responses: `{ success: false, message: "...", error?: "..." }`
- Try-catch blocks in async functions; log errors with context
- Error messages must be descriptive for debugging

Example from `quota-client.ts`:
```typescript
if (!response.ok) {
  const error = await response.json().catch(() => ({ error: "Unknown error" }));
  const err = new Error(error.error || `HTTP ${response.status}`) as Error & {
    status: number;
  };
  err.status = response.status;
  throw err;
}
```

Example from API routes (`admin/quota/route.ts`):
```typescript
try {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 }
    );
  }
  // ... operation logic ...
} catch (error) {
  console.error("[admin/quota] Error:", error);
  return NextResponse.json(
    {
      success: false,
      message: error instanceof Error ? error.message : "Internal server error",
    },
    { status: 500 }
  );
}
```

## Logging

**Framework:** `console` (standard Node.js logging)

**Patterns:**
- Use `console.error()` for errors with context prefix: `[module-name] Error: description`
- Use `console.log()` for test output and progress: `[TEST] Step description`
- Avoid logging in production rendering paths
- Include request/response context in API logs

Example from test file:
```typescript
test.beforeEach(async ({ context }) => {
  const hasJar = hasCookieJarForUser(USER_ROLE);
  if (!hasJar) {
    console.log(`\n[ERROR] No cookie jar found for ${USER_ROLE}`);
    console.log(`Run: TEST_USER_ROLE=${USER_ROLE} npx playwright test setup/acquire-credentials.spec.ts`);
  }
});
```

## Comments

**When to Comment:**
- Explain WHY, not WHAT (code shows what)
- Complex business logic or non-obvious implementations
- Workarounds, temporary solutions, or known limitations
- Integration points with external services
- Multi-step processes that aren't immediately clear

**JSDoc/TSDoc:**
- Required on exported functions and types
- Include `@param`, `@returns`, `@throws` for public APIs
- Include usage examples for complex functions

Example from `api.ts`:
```typescript
/**
 * Get the API base path for client-side requests
 * Returns empty string in dev, /{region} in production
 */
export function getApiBasePath(): string {
  return IS_PRODUCTION ? `/${REGION_SHORT}` : "";
}

/**
 * Build a full API URL with the correct basePath
 * @param path - API path starting with /api/... (e.g., "/api/user")
 * @returns Full URL with basePath in production (e.g., "/use1/api/user")
 */
export function apiUrl(path: string): string {
  const basePath = getApiBasePath();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${basePath}${normalizedPath}`;
}
```

## Function Design

**Size:** Keep functions focused and under 50 lines when possible; max 100 lines is a warning sign

**Parameters:**
- Use object parameters for functions with 3+ parameters
- Include JSDoc `@param` tags
- Destructure props in React components
- Type all parameters explicitly

**Return Values:**
- Type all return values explicitly (TypeScript `strict: true` enforces this)
- Use unions for conditional returns: `Promise<T | null>`, `{ success: true } | { success: false, error: string }`
- Never return plain `null` without typing; prefer `undefined` or explicit union

Example from `quota-client.ts`:
```typescript
async function quotaRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  // implementation
}
```

## Module Design

**Exports:**
- Use named exports for utilities and helpers
- Use default export only for React components (optional but preferred)
- Group related exports in barrel files (`index.ts`)

**Barrel Files:**
- Use when re-exporting from multiple files
- Keep exports organized and documented
- Avoid circular imports

Example from `quota-client.ts` exports:
```typescript
export type QuotaTier = "zero" | "upload" | "admin";
export type QuotaId = "file_upload" | "gpx_upload" | ...;
export interface QuotaCheckResult { ... }
export async function checkQuota(...): Promise<QuotaCheckResult> { ... }
```

## Region-Aware Patterns

**Multi-region routing:**
- Apps run in `us-east-1` (use1) and `ca-central-1` (cac1)
- Routes prefixed with region: `/use1/...` and `/cac1/...`
- Extract region from URL path: `const region = getRegionFromPath()` or use `REGION_PREFIX`
- Environment variable: `NEXT_PUBLIC_REGION_SHORT` (e.g., "use1")

Example from `useLogout.ts`:
```typescript
function getRegionFromPath(): string {
  if (typeof window === 'undefined') return 'use1';
  const match = window.location.pathname.match(/^\/(use1|cac1)/);
  return match ? match[1] : 'use1';
}
```

## Interface/Type Patterns

**Request/Response types:**
- Interfaces for API contracts: `interface {Action}Request`, `interface {Action}Response`
- Include optional fields with `?` when not always required
- Use strict union types for discriminated unions

Example:
```typescript
interface AdminQuotaRequest {
  action: "get" | "reset" | "reset_to_tier" | "set_limit" | "upgrade_tier" | "cleanup_stale";
  targetUserId?: string;
  quotaId?: string;
  tier?: QuotaTier;
}

interface AdminQuotaResponse {
  success: boolean;
  message?: string;
  data?: unknown;
}
```

---

*Convention analysis: 2026-02-28*
