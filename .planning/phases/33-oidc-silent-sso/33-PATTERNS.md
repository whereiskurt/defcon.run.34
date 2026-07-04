# Phase 33: OIDC Silent SSO - Pattern Map

**Mapped:** 2026-07-03
**Files analyzed:** 3 modified (run.auth IdP) + 5 created x3 apps (silent-SSO unit) + tests
**Analogs found:** 8 / 8 (all created files have strong in-repo analogs)

Silent SSO makes the OIDC redirect invisible. Two workstreams:
1. **IdP (run.auth)** — 3 edits to existing files (repoint `interactions.url`, add `loadExistingGrant`, flip `remember`).
2. **RP unit** — a self-contained `prompt=none` iframe unit authored once and dropped identically into `run.gpx`, `run.flash`, `run.bib` `src/`, guarded by a parity test.

---

## File Classification

### MODIFIED (run.auth IdP)

| File | Role | Data Flow | Change | Match Quality |
|------|------|-----------|--------|---------------|
| `apps/run.auth/webapp/src/config/oidc.ts` | config | request-response | Repoint `interactions.url` + add `loadExistingGrant` | self (edit in place) |
| `apps/run.auth/webapp/src/pages/api/oidc/interaction/[uid].ts` | route (Pages API) | request-response | `remember: false` → `true` (2 branches) | self (edit in place) |
| `apps/run.auth/webapp/src/config/index.ts` | config | n/a | Read-only reference (`urls.loginPage`, `routePrefix`) — likely no edit | self |

### CREATED (RP silent-SSO unit — placed identically in gpx / flash / bib)

| File (per app, path at discretion) | Role | Data Flow | Closest Analog | Match Quality |
|-----------------------------------|------|-----------|----------------|---------------|
| Initiator route `…/api/auth/silent-signin/route.ts` | route (App Router) | request-response | `apps/run.human/webapp/src/app/api/auth/auto-signin/route.ts` | exact |
| Fallback route `…/api/auth/auto-signin/route.ts` | route (App Router) | request-response | `apps/run.human/webapp/src/app/api/auth/auto-signin/route.ts` | exact |
| `/silent-callback` bridge page `…/silent-callback/page.tsx` | page (client) | event-driven (postMessage) | `apps/run.gpx/webapp/src/app/signin/page.tsx` (`"use client"` + effect) | role-match |
| Iframe client component/hook `…/components/SilentSSO.tsx` | component/hook (client) | event-driven (iframe + message listener + timeout) | `apps/run.gpx/webapp/src/app/providers.tsx` + `signin/page.tsx` | role-match |
| Parity test | test | transform (byte-compare) | `apps/run.bib/webapp/src/__tests__/*.test.ts` + `vitest.config.ts` | role-match |
| NextAuth config (reference, not created) | config | — | `apps/run.gpx/webapp/src/config/auth.ts` (flash/bib identical stack) | exact |

---

## Pattern Assignments — IdP (MODIFIED)

### `apps/run.auth/webapp/src/config/oidc.ts` (config, request-response)

**Change 1 — repoint `interactions.url`.** Current block (lines 309-315), the exact shape to edit:

```typescript
  interactions: {
    url(ctx, interaction) {
      // Redirect to the existing Auth.js login page with OIDC interaction ID
      // After login, /login will redirect to /api/oidc/interaction/{uid}
      return `${config.urls.loginPage}?oidc=${interaction.uid}`;
    },
  },
```

Design (spec lines 67-73): return the **server** interaction route instead —
`/{region}/api/oidc/interaction/{uid}`. Note `config.oidc.routePrefix` already yields
`/${region}/api/oidc` (config/index.ts line 56), but the interaction completion route lives at
`/{region}/api/oidc/interaction/{uid}` (Pages API, NOT under the provider `routePrefix`'s `/auth`,`/token` set in lines 197-210). Build it from `config.region` + a literal `/api/oidc/interaction/` path, matching the `loginPath` derivation in `[uid].ts` line 9 (`isDev ? "/api/oidc/interaction" : \`/${REGION_SHORT}/api/oidc/interaction\``). The `interaction.uid` accessor stays.

**Change 2 — add custom `loadExistingGrant(ctx)`.** No existing implementation (library default is used today). Add it as a new top-level key in the `configuration` object (alongside `findAccount` at lines 321-384). The first-party client allowlist to check against is the `config.oidc.clients` map — its keys are the allowlist (config/index.ts lines 60-81):

```typescript
    clients: {
      runHuman:  { clientId: process.env.OIDC_RUNHUMAN_CLIENT_ID!, ... },
      cmsStrapi: { clientId: process.env.OIDC_CMS_CLIENT_ID!,       ... },
      gpxStudio: { clientId: process.env.OIDC_GPXSTUDIO_CLIENT_ID!, ... },
      flashTool: { clientId: process.env.OIDC_FLASH_CLIENT_ID!,     ... },
      bib:       { clientId: process.env.OIDC_BIB_CLIENT_ID!,       ... },
    },
```

Build the allowlist as `Object.values(config.oidc.clients).map(c => c.clientId)` (spec: "reuse it rather than a second list", CONTEXT.md line 143-145). The clients array (oidc.ts lines 24-181) declares each `client_id: config.oidc.clients.<name>.clientId` — same source.

**Grant-minting pattern to reuse** — `[uid].ts` already contains the canonical grant creation
(`interaction/[uid].ts` lines 72-86), copy its shape into `loadExistingGrant`:

```typescript
    const grant = new oidc.Grant({
      accountId,
      clientId: interactionDetails.params.client_id as string,
    });
    if (interactionDetails.params.scope) {
      grant.addOIDCScope(interactionDetails.params.scope as string);
    }
    const grantId = await grant.save();
```

Inside `loadExistingGrant(ctx)` the equivalents are `ctx.oidc.account.accountId`,
`ctx.oidc.client.clientId`, `ctx.oidc.params.scope`; record via `ctx.oidc.session.grantIdFor(clientId)` / `session.ensureGrantId(...)` (spec line 93 `session.grantIdFor`). Return `undefined` for any clientId not in the allowlist (default behavior — no auto-consent).

`Provider` instance available in-file as `oidc` (line 460); `oidc.Grant` is the constructor used in `[uid].ts`. `Configuration` type imported at line 1 — add `loadExistingGrant` to it (it is a supported v9 hook per CONTEXT.md line 133-134).

**Cookie context (why the iframe works)** — session cookies (lines 275-291) use
`sameSite: "lax"` + `domain: .${siteDomain}`; TTL `Session: config.oidc.ttl.session` = 15 days
(config/index.ts line 89). Do not change these.

---

### `apps/run.auth/webapp/src/pages/api/oidc/interaction/[uid].ts` (route, request-response)

**Change 3 — flip `remember: false` → `true`** in BOTH branches that set a `login` result.

Branch A — `prompt.name === "login"` (lines 88-105):

```typescript
    if (prompt.name === "login") {
      const grantId = await createGrant();
      result = {
        login: {
          accountId,
          remember: false,   // <-- change to true
        },
        consent: {
          grantId,
        },
      };
    }
```

Branch B — unknown-prompt fallback (lines 116-129):

```typescript
    } else {
      // Unknown prompt - create grant and complete login
      const grantId = await createGrant();
      result = {
        login: {
          accountId,
          remember: false,   // <-- change to true
        },
        consent: {
          grantId,
        },
      };
    }
```

The `consent` branch (lines 106-115) sets no `login` and is unchanged. Preserve `interactionDetails` / expired / `isSessionNotFound` handling (lines 54-60, 141-156) unchanged (spec line 199). The unauth fallback that already redirects to `/login?oidc={uid}` (lines 46-50) is what change #1 relies on — leave it.

---

## Pattern Assignments — RP unit (CREATED, x3 apps)

### Initiator route + fallback route (App Router, request-response)

**Analog (exact):** `apps/run.human/webapp/src/app/api/auth/auto-signin/route.ts` — full file:

```typescript
import { signIn } from "@/config/auth";

const isDev = process.env.NODE_ENV !== "production";
const REGION_SHORT = process.env.REGION_SHORT || "use1";

/**
 * Auto-signin route for silent SSO.
 * This route handler triggers the OIDC flow server-side.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const defaultCallback = isDev ? "/whoami" : `/${REGION_SHORT}/whoami`;
  const callbackUrl = url.searchParams.get("callbackUrl") || defaultCallback;

  await signIn("run.defcon.run", { redirectTo: callbackUrl });
}
```

**Initiator route** — same shape, but (a) `redirectTo` points at the app's own
`/{region}/silent-callback` bridge, and (b) pass the **third** `signIn` arg for `prompt=none`
(CONTEXT.md line 55, spec line 114):

```typescript
await signIn("run.defcon.run", { redirectTo: silentCallbackPath }, { prompt: "none" });
```

The `signIn` import resolves to each app's own `@/config/auth` — confirmed present and identical-signature in all three: `gpx/config/auth.ts:313`, `flash/config/auth.ts:304`, `bib/config/auth.ts:316` all `export const { handlers, auth, signIn, signOut } = NextAuth({...})`. Provider id `"run.defcon.run"` is identical across all three (gpx `auth.ts:128`, flash `:126`, bib `:128`).

**Fallback route** — copy `auto-signin/route.ts` almost verbatim (no `prompt=none`; relies on IdP change #1 to be invisible). Place at `…/api/auth/auto-signin/route.ts` in each RP (mirrors run.human's path exactly). CONTEXT.md line 65-66 & spec line 132.

`isDev` / `REGION_SHORT` env derivation pattern is used identically in every route/config in the repo (`[uid].ts:5-9`, `auto-signin/route.ts:3-4`, `auth.ts:4-5`) — reuse it for region/path parameterization.

---

### `/silent-callback` bridge page (page, client, event-driven)

**Analog (role-match):** `apps/run.gpx/webapp/src/app/signin/page.tsx` — the canonical
`"use client"` page-with-effect + region-from-path pattern to model on:

```typescript
"use client";

import { signIn } from "next-auth/react";
import { useEffect } from "react";

export default function SignInPage() {
  useEffect(() => {
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const firstSegment = pathParts[0] || '';
    const isRegion = /^(use1|cac1|usw2|euw1)$/.test(firstSegment);
    const region = isRegion ? firstSegment : '';
    const callbackUrl = region ? `/${region}/studio/app` : "/studio/app";
    signIn("run.defcon.run", { callbackUrl });
  }, []);
  return ( /* minimal redirecting UI */ );
}
```

**Bridge behavior** (spec lines 118-124, CONTEXT.md lines 58-70): instead of `signIn`, the effect
reads the OIDC outcome from URL params (`error` / `code`) and calls
`window.parent.postMessage({ type: "silent-sso", status }, <app-origin>)` where `status` is
`"success"` or `"login_required"`. Normalize every `prompt=none` negative
(`login_required`, `interaction_required`, `consent_required`, `access_denied`) to
`login_required`. Target the **explicit app origin, never `*`** (security, spec line 221). Reuse
the region-from-path regex above to derive the app origin / region rather than hardcoding.

The app origin can be derived the same way `auth.ts` builds public URLs, e.g. gpx uses
`process.env.GPX_PUBLIC_URL` / `https://gpx.${siteDomain}/${region}` (`gpx/config/auth.ts:38-42`) — parameterize per app (flash/bib have the equivalent `*_PUBLIC_URL`).

---

### Iframe client component/hook (component, client, event-driven + timeout)

**Analog (role-match):** compose two existing gpx patterns —
`apps/run.gpx/webapp/src/app/providers.tsx` (the `"use client"` wrapper that mounts under
`<body>` via layout) and the `useEffect` lifecycle from `signin/page.tsx`.

`providers.tsx` (full — shows the client-wrapper + optional-param convention):

```typescript
"use client";

import { SessionProvider } from "next-auth/react";

interface ProvidersProps {
  children: React.ReactNode;
  authBasePath?: string;
}

export function Providers({ children, authBasePath }: ProvidersProps) {
  return <SessionProvider basePath={authBasePath}>{children}</SessionProvider>;
}
```

**Mount point:** `apps/run.gpx/webapp/src/app/layout.tsx` renders `<Providers authBasePath={authBasePath}>{children}</Providers>` under `<body>`, deriving `authBasePath = isDev ? "/api/auth" : \`/${REGION_SHORT}/api/auth\``. This is where the `<SilentSSO />` component should be mounted (inside `Providers`, on public routes) so it runs app-wide. The same layout.tsx shape exists in flash and bib.

**Component behavior** (spec lines 107-139, CONTEXT.md lines 53-72): inject a hidden `0×0`,
`aria-hidden` `<iframe>` pointing at the initiator route; add a `window` message listener that
verifies `event.origin === <app-origin>` before acting (`success` → refresh to authed view;
`login_required` → stay logged-out); arm a ~4-5s timeout that tears down the iframe and navigates
to the redirect fallback route. All app-specifics (region, client id, callback path, app origin)
are **props/config**, no app-specific logic inside (CONTEXT.md line 72, spec line 158). Use the
region-from-path regex from `signin/page.tsx` for parameterization.

---

## Shared Patterns

### Region / env parameterization
**Source:** `apps/run.auth/webapp/src/pages/api/oidc/interaction/[uid].ts` lines 5-9; `apps/run.gpx/webapp/src/config/auth.ts` lines 4-5; `apps/run.human/.../auto-signin/route.ts` lines 3-4
**Apply to:** every created route/page/component in the RP unit.
```typescript
const isDev = process.env.NODE_ENV !== "production";
const REGION_SHORT = process.env.REGION_SHORT || "use1";
const somePath = isDev ? "/x" : `/${REGION_SHORT}/x`;
```
Client components instead derive region from `window.location.pathname` (regex `/^(use1|cac1|usw2|euw1)$/`, from `signin/page.tsx`).

### NextAuth `signIn` provider id + third-arg passthrough
**Source:** `apps/run.human/.../auto-signin/route.ts:17`; provider decl `apps/run.gpx/webapp/src/config/auth.ts:126-150`
**Apply to:** initiator + fallback routes.
Provider id is the literal `"run.defcon.run"` in all three RPs. The third `signIn` argument
(`authorizationParams`) is how `prompt=none` reaches the authorize URL. Provider `checks: ["state", "pkce", "nonce"]` and `token_endpoint_auth_method: "client_secret_post"` (auth.ts:145-148) are unchanged — `prompt=none` is additive.

### Per-app cookie naming (parameterization target)
**Source:** `auth.ts` cookie blocks — gpx `sess_gpx`/`csrf_gpx` (`gpx/auth.ts:271-289`), flash `sess_flash`/`csrf_flash` (`flash/auth.ts:263-273`), bib `sess_bib`/`csrf_bib` (`bib/auth.ts:275-285`). All `sameSite: "lax"`, `domain: .${siteDomain}` in prod. SESSION_MAX_AGE = 1 day in all three (`auth.ts:33`).
**Apply to:** understanding which app-session cookie the bridge's `success` implies is set; the unit itself does not read cookie names (NextAuth handles it).

### App-Router route handler barrel
**Source:** `apps/run.gpx/.../api/auth/[...nextauth]/route.ts` (identical in flash/bib):
```typescript
import { handlers } from "@/config/auth";
export const { GET, POST } = handlers;
```
**Apply to:** confirms new routes go under `src/app/api/auth/…/route.ts` with named `GET` exports and `@/config/auth` imports.

---

## Test Conventions (per app)

| App | Unit runner | Location | Config |
|-----|-------------|----------|--------|
| `run.bib` | **vitest** (`"test": "vitest run"`) | `src/__tests__/*.test.{ts,tsx}` | `run.bib/webapp/vitest.config.ts` (node env; `@` alias → `./src`) |
| `run.human` | (test dir) | `src/entities/__tests__/*.test.ts` | — |
| `run.gpx` | no webapp unit config yet | — | e2e only |
| `run.flash` | no webapp unit config yet | — | — |

**vitest config to copy** (`run.bib/webapp/vitest.config.ts`) — the canonical shape for adding unit tests to gpx/flash (they lack one today):
```typescript
export default defineConfig({
  test: { environment: "node", include: ["src/__tests__/**/*.test.{ts,tsx}"] },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
```
Note: DOM-touching tests (bridge/component) need `environment: "jsdom"` + a dom dep — the bib config comment (lines calling out "add environment: jsdom … at that time") flags this explicitly. Bridge `postMessage` / listener tests and the parent-timeout test require jsdom.

**Parity test** (CONTEXT.md discretion, lines 84): the three copies of the unit must stay in sync. Model: a vitest test that byte-compares (or hashes) the three per-app copies, OR asserts they all import from a single checked-in source of truth. Place under each app's `src/__tests__/` (bib pattern) — or a single repo-level test.

**e2e (Playwright):** existing layout at `apps/run.gpx/e2e/` (`playwright.config.ts`, `*.spec.ts`, `lib/cookie-jar.ts`) and `apps/run.auth/e2e/` (`tests/*.spec.ts`, `setup/`, `lib/`). Full silent-SSO e2e goes in `run.gpx/e2e/`; smoke specs on flash/bib follow the same `e2e/` package pattern (each `e2e/` is its own npm package with its own `package.json`/`playwright.config.ts`).

---

## No Analog Found

None. Every created file maps to an in-repo analog:
- Routes → `run.human/.../auto-signin/route.ts`
- Client page/component → `run.gpx` `signin/page.tsx` + `providers.tsx`
- Tests → `run.bib` vitest + `run.gpx`/`run.auth` e2e

The only genuinely new construct is `loadExistingGrant` in oidc.ts (no prior custom impl), but its grant-minting body is copied directly from `interaction/[uid].ts` lines 72-86.

---

## Metadata

**Analog search scope:** `apps/run.auth/webapp/src`, `apps/run.gpx/webapp/src`, `apps/run.flash/webapp/src`, `apps/run.bib/webapp/src`, `apps/run.human/webapp/src`, plus `e2e/` dirs.
**Files scanned:** ~15 read + directory/grep sweeps across 5 apps.
**Pattern extraction date:** 2026-07-03
