# Phase 1: App Scaffold + Device Picker - Research

**Researched:** 2026-02-28
**Domain:** Next.js 16 app scaffold, OIDC authentication, ESP32 device picker, wizard flow UI
**Confidence:** HIGH

## Summary

Phase 1 builds the `apps/run.flash/webapp/` Next.js application from scratch, following the established monorepo patterns from run.human and run.gpx. The core technical challenges are: (1) bootstrapping a new Next.js 16 app with the existing HeroUI + Tailwind 4 dark theme stack, (2) integrating OIDC authentication via auth.defcon.run using the proven Auth.js v5 pattern, (3) building a Web Serial API browser gate, (4) implementing a device picker from vendored Meshtastic hardware-list.json, and (5) creating a custom wizard stepper component since HeroUI does not provide one.

The monorepo has strong patterns to copy from. The run.gpx app provides the most direct template: same Auth.js v5 OIDC client config, middleware-based route protection, and SessionProvider setup. The run.human app provides the HeroUI dark theme configuration, glass-card styling, font setup, and header patterns. The Meshtastic hardware-list.json is a flat JSON array of device objects with well-defined fields (`hwModel`, `platformioTarget`, `architecture`, `displayName`, `tags`, `images`, `supportLevel`, `activelySupported`).

**Primary recommendation:** Copy run.gpx's auth config as the skeleton, apply run.human's theme and HeroUI setup, build a custom stepper component using Tailwind (HeroUI has no stepper), and vendor hardware-list.json + device SVGs as static assets.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Card grid layout, 3-4 cards per row on desktop
- Device SVGs displayed prominently for visual hardware identification
- Each card shows: device image, display name, manufacturer tag, and chip architecture badge (ESP32, ESP32-S3, etc.)
- Selecting a card highlights it and a "Select this device" confirm button advances to the Connect step
- Show ALL ESP32 devices from hardware-list.json, with tested/recommended devices badged
- Search bar + clickable manufacturer tabs (RAK, Heltec, LilyGo, etc.) to filter the grid
- Recommended/tested devices pinned at top of the grid with a "Recommended" badge, rest below
- Default sort: recommended first, then alphabetical by name
- When device not found: show help text with link to Meshtastic's full flasher
- Horizontal stepper bar across the top showing all 5 steps: Pick Device -> Connect -> Flash -> Configure -> Done
- Future steps visible but disabled/grayed-out
- Back navigation: click any previous completed step in the stepper to return
- Step validation: each step must complete before advancement
- Same dark theme and DCR34 branding as run.human, but simplified wizard-focused layout
- Minimal header: logo + "flash.defcon.run" + user avatar/logout. No nav links
- Hacker/cyberpunk visual feel: terminal-esque, green-on-dark, matrix vibes
- HeroUI components + Tailwind 4 for consistency with monorepo

### Claude's Discretion
- Exact card dimensions and responsive breakpoints
- Stepper component implementation (custom or HeroUI-based)
- Animation and transition patterns between wizard steps
- Loading/skeleton states during data hydration
- Mobile responsive behavior for card grid

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BRWS-01 | App detects Web Serial API support and gates unsupported browsers with "use Chrome or Edge" message | Web Serial detection via `"serial" in navigator` check; Chromium-only (Chrome 89+, Edge 89+); Firefox/Safari have no support |
| BRWS-02 | App enforces OIDC authentication -- unauthenticated users redirect to auth.defcon.run | Auth.js v5 OIDC pattern from run.gpx: middleware-based protection + signin auto-redirect to `run.defcon.run` provider |
| DEVC-01 | User can browse ESP32 devices from vendored hardware-list.json filtered to ESP32 architectures | hardware-list.json is flat JSON array; filter by `architecture` field matching esp32/esp32-s3/esp32-c3/esp32-c6 |
| DEVC-02 | Device picker displays device images (SVGs), display names, and manufacturer tags | SVGs available from Meshtastic repo (78 files); vendor to `public/img/devices/`; `displayName`, `tags` fields available |
| DEVC-03 | User can filter/search devices by name or manufacturer | Search against `displayName`; manufacturer from `tags` array; HeroUI Input + Chip components for filter UI |
| DEVC-04 | Device picker shows support tier and actively-supported status for sorting | `supportLevel` (1-3) and `activelySupported` (boolean) fields in hardware-list.json; use for sort/badge |
| DEVC-05 | Selecting a device determines correct firmware binary filename via platformioTarget | `platformioTarget` field maps to firmware zip: `firmware-{architecture}-{version}.zip` contains `firmware-{platformioTarget}-{version}.bin` |
| WZRD-01 | Step-by-step wizard: Pick Device -> Connect -> Flash -> Configure -> Done | Custom stepper component (HeroUI has no stepper); 5 steps, horizontal bar |
| WZRD-02 | Each step validates completion before allowing progression | Wizard state machine: step completion tracked in React state; device selection = step 1 complete |
| WZRD-03 | Progress breadcrumb shows current position in the flow | Stepper component shows all 5 steps with current/completed/future states |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | ^16.1.6 | App framework | Monorepo standard, all DCR34 apps use Next.js 16 |
| react / react-dom | 19.2.x | UI framework | Monorepo standard, React 19 |
| next-auth | ^5.0.0-beta.30 | OIDC authentication | Monorepo standard, Auth.js v5 beta |
| @heroui/react | ^2.8.8 | UI component library | Monorepo standard (Card, Button, Input, Chip, Badge, Avatar, Navbar) |
| tailwindcss | ^4 | Styling | Monorepo standard, Tailwind 4 |
| @tailwindcss/postcss | ^4 | PostCSS integration | Monorepo standard |
| next-themes | ^0.4.6 | Dark/light theme | Monorepo standard |
| framer-motion | ^12.23.26 | Animations | Required by HeroUI, used for wizard transitions |
| clsx | 2.1.1 | Class name utility | Monorepo standard |
| lucide-react | ^0.561.0 | Icons | Monorepo standard |
| typescript | ^5 | Type safety | Monorepo standard, strict mode |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @react-aria/ssr | 3.9.10 | SSR support for HeroUI | Required by HeroUI |
| @react-aria/visually-hidden | 3.8.28 | Accessibility | Required by HeroUI |
| @react-types/shared | ^3.32.1 | Router type augmentation | Required for HeroUI + Next.js router integration |
| eslint | ^9 | Linting | Dev dependency, monorepo standard |
| eslint-config-next | 16.1.6 | Next.js lint rules | Dev dependency |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom stepper | HeroUI Tabs with `disabledKeys` | HeroUI Tabs can be styled but lack step-number indicators, completion states, and disabled-future-step semantics -- custom component is more appropriate for wizard UX |
| lucide-react icons | react-icons | run.human uses react-icons for FaRadio etc., but lucide-react is cleaner for general icons; both are in the monorepo |

**Installation:**
```bash
cd apps/run.flash/webapp
npm init -y
npm install next@^16.1.6 react@19.2.3 react-dom@19.2.3 next-auth@5.0.0-beta.30 \
  @heroui/react@^2.8.8 next-themes@^0.4.6 framer-motion@^12.23.26 \
  clsx@2.1.1 lucide-react@^0.561.0 \
  @react-aria/ssr@3.9.10 @react-aria/visually-hidden@3.8.28 @react-types/shared@^3.32.1
npm install -D tailwindcss@^4 @tailwindcss/postcss@^4 typescript@^5 \
  @types/node@^25 @types/react@^19 @types/react-dom@^19 \
  eslint@^9 eslint-config-next@16.1.6
```

## Architecture Patterns

### Recommended Project Structure
```
apps/run.flash/
  webapp/
    public/
      data/
        hardware-list.json          # Vendored Meshtastic device list
      img/
        devices/                    # Vendored device SVGs (78 files)
          tbeam.svg
          heltec-v3.svg
          t-deck.svg
          unknown.svg
          ...
      favicon.ico
    src/
      app/
        layout.tsx                  # Root layout: fonts, HeroUI providers, SessionProvider
        page.tsx                    # Main page: browser gate + wizard
        providers.tsx               # Client providers: HeroUIProvider + ThemeProvider
        signin/
          page.tsx                  # OIDC auto-redirect (copy from run.gpx)
        api/
          auth/
            [...nextauth]/
              route.ts              # Auth.js route handler
      components/
        wizard/
          wizard-stepper.tsx        # Custom horizontal stepper bar
          wizard-container.tsx      # Step content container with state management
        device-picker/
          device-grid.tsx           # Card grid with filtering
          device-card.tsx           # Individual device card
          device-search.tsx         # Search bar + manufacturer tabs
          device-not-found.tsx      # Help text for missing devices
        header/
          header.tsx                # Minimal header: logo + avatar/logout
        browser-gate.tsx            # Web Serial detection gate
      config/
        auth.ts                     # OIDC client config (adapted from run.gpx)
        fonts.ts                    # Font declarations (same as run.human)
        site.ts                     # Site metadata
        devices.ts                  # Device type definitions + helpers
      hooks/
        use-wizard.ts               # Wizard state management hook
      styles/
        globals.css                 # Tailwind imports + DCR34 theme overrides
      types/
        device.ts                   # DeviceHardware TypeScript interface
      middleware.ts                 # Auth protection middleware
    tailwind.config.js              # HeroUI dark theme (copy from run.human)
    tsconfig.json                   # TypeScript config with path aliases
    next.config.ts                  # Next.js config with region basePath
    package.json
```

### Pattern 1: OIDC Authentication (from run.gpx)
**What:** Auth.js v5 OIDC client connecting to auth.defcon.run
**When to use:** All authenticated routes
**Example:**
```typescript
// src/config/auth.ts - adapted from run.gpx pattern
// Source: apps/run.gpx/webapp/src/config/auth.ts

const isDev = process.env.NODE_ENV !== "production";
const region = process.env.REGION_SHORT || "use1";
const siteDomain = process.env.SITE_DOMAIN || "defcon.run";
const LOCAL_AUTH_PORT = process.env.LOCAL_AUTH_PORT || "3002";
const LOCAL_FLASH_PORT = process.env.LOCAL_FLASH_PORT || "3004";

// Cookie names MUST be service-specific to avoid conflicts
cookies: {
  sessionToken: { name: "sess_flash", /* ... */ },
  csrfToken: { name: "csrf_flash", /* ... */ },
  callbackUrl: { name: "callback_flash", /* ... */ },
  state: { name: "state_flash", /* ... */ },
},

// Provider config uses run.defcon.run OIDC provider
providers: [{
  id: "run.defcon.run",
  name: "DEF CON",
  type: "oidc",
  issuer: oidcIssuer,
  clientId: process.env.OIDC_CLIENT_ID!,
  clientSecret: process.env.OIDC_CLIENT_SECRET!,
  redirectProxyUrl,
  // ... same pattern as run.gpx
}],
```

### Pattern 2: Middleware Route Protection (from run.gpx)
**What:** Auth.js middleware wrapper pattern for edge-level auth
**When to use:** Protecting the main wizard route
**Example:**
```typescript
// src/middleware.ts - adapted from run.gpx
import { auth } from "@/config/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  // req.auth contains the session (null if not authenticated)
  if (!req.auth?.user) {
    const signinUrl = req.nextUrl.clone();
    signinUrl.pathname = "/signin";
    signinUrl.searchParams.set("callbackUrl", req.url);
    return NextResponse.redirect(signinUrl);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|signin|img|data).*)"],
};
```

### Pattern 3: Web Serial Browser Gate
**What:** Client-side check for Web Serial API support, blocking unsupported browsers
**When to use:** Page load, before any wizard interaction
**Example:**
```typescript
// src/components/browser-gate.tsx
"use client";

export function BrowserGate({ children }: { children: React.ReactNode }) {
  const [isSupported, setIsSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setIsSupported("serial" in navigator);
  }, []);

  if (isSupported === null) return <LoadingSkeleton />;
  if (!isSupported) return <UnsupportedBrowserMessage />;
  return <>{children}</>;
}

// UnsupportedBrowserMessage shows:
// - "Web Serial API is required" heading
// - "Use Chrome or Edge to flash your device"
// - Download links for Chrome and Edge
// - DEF CON themed styling
```

### Pattern 4: Device Data Types (from Meshtastic hardware-list.json)
**What:** TypeScript interface matching the vendored hardware-list.json schema
**When to use:** Device picker, firmware filename resolution
**Example:**
```typescript
// src/types/device.ts
// Source: meshtastic/web-flasher types/api.ts DeviceHardware interface

export interface DeviceHardware {
  hwModel: number;              // Unique device ID (e.g., 4 for T-Beam)
  hwModelSlug: string;          // URL-safe name (e.g., "TBEAM")
  platformioTarget: string;     // Build target (e.g., "tbeam") -- used for firmware filename
  architecture: string;         // Chip family: "esp32", "esp32-s3", "esp32-c3", "esp32-c6"
  activelySupported: boolean;   // Current maintenance status
  displayName: string;          // Human-readable name (e.g., "LILYGO T-Beam")
  supportLevel?: number;        // 1-3 support tier (1=highest)
  tags?: string[];              // Manufacturer tags (e.g., ["LilyGo"])
  images?: string[];            // SVG filenames (e.g., ["tbeam.svg"])
  partitionScheme?: string;     // Flash layout (e.g., "8MB", "16MB")
  requiresDfu?: boolean;        // Needs DFU mode for flashing
  hasMui?: boolean;             // Has Material UI interface
  hasInkHud?: boolean;          // Has e-ink display
}

// ESP32 architecture filter
export const ESP32_ARCHITECTURES = ["esp32", "esp32-s3", "esp32-c3", "esp32-c6"];

export function isEsp32Device(device: DeviceHardware): boolean {
  return ESP32_ARCHITECTURES.includes(device.architecture);
}

// Firmware filename from device selection
// Pattern: firmware-{platformioTarget}-{version}.bin inside firmware-{architecture}-{version}.zip
export function getFirmwareFilename(device: DeviceHardware, version: string): string {
  return `firmware-${device.platformioTarget}-${version}.bin`;
}
```

### Pattern 5: Wizard State Management
**What:** React hook managing wizard step progression
**When to use:** Wizard container component
**Example:**
```typescript
// src/hooks/use-wizard.ts
"use client";

export type WizardStep = "pick-device" | "connect" | "flash" | "configure" | "done";

const STEPS: WizardStep[] = ["pick-device", "connect", "flash", "configure", "done"];
const STEP_LABELS: Record<WizardStep, string> = {
  "pick-device": "Pick Device",
  "connect": "Connect",
  "flash": "Flash",
  "configure": "Configure",
  "done": "Done",
};

interface WizardState {
  currentStep: WizardStep;
  completedSteps: Set<WizardStep>;
  selectedDevice: DeviceHardware | null;
}

export function useWizard() {
  const [state, setState] = useState<WizardState>({
    currentStep: "pick-device",
    completedSteps: new Set(),
    selectedDevice: null,
  });

  const canAdvance = (step: WizardStep): boolean => {
    // Step validation: each step must complete before next
    const currentIndex = STEPS.indexOf(step);
    if (currentIndex === 0) return state.selectedDevice !== null;
    return state.completedSteps.has(STEPS[currentIndex - 1]);
  };

  // ... advance, goBack, goToStep methods
}
```

### Anti-Patterns to Avoid
- **Do NOT put auth secrets in client bundles:** OIDC_CLIENT_SECRET, AUTH_INTERNAL_SECRET must only be in server-side code. Next.js automatically tree-shakes server-only code, but never prefix these with NEXT_PUBLIC_.
- **Do NOT use `navigator.serial` without feature detection:** Accessing `navigator.serial` directly in Firefox/Safari throws. Always use `"serial" in navigator` check first.
- **Do NOT fetch hardware-list.json from Meshtastic CDN at runtime:** Vendor it as a static file. Runtime fetch introduces an external dependency and latency.
- **Do NOT use HeroUI Tabs as stepper:** Tabs component lacks step numbers, completion checkmarks, and disabled-future-step semantics. Build a custom stepper that fits the wizard UX.
- **Do NOT use generic cookie names:** Cookie names MUST be `sess_flash`, `csrf_flash`, `callback_flash`, `state_flash` to avoid conflicts with other DCR34 apps on `.defcon.run` domain.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OIDC authentication flow | Custom OAuth2 flow | Auth.js v5 + run.gpx pattern | Token refresh, session management, CSRF protection, redirect URI handling all battle-tested |
| Dark theme system | Custom CSS variables | HeroUI theme plugin + next-themes | Color system, component dark mode, system preference detection already solved |
| Device image rendering | Custom SVG loader | `<img>` tags pointing to vendored SVGs | SVGs are static assets; Next.js Image optimization not needed for SVGs |
| Search/filter state | Complex Redux store | React useState + useMemo | Device list is small (< 200 items), client-side filtering is trivial |
| Icon library | Custom SVG components | lucide-react | Consistent icons with tree-shaking |

**Key insight:** This phase is 90% scaffolding established patterns. The only novel component is the wizard stepper -- everything else has a direct template in the monorepo.

## Common Pitfalls

### Pitfall 1: OIDC Redirect URI Mismatch
**What goes wrong:** Authentication flow fails with "redirect_uri_mismatch" error
**Why it happens:** The redirect URI constructed by Auth.js doesn't match any URI registered in the OIDC provider (run.auth's oidc.ts)
**How to avoid:** Register flash.defcon.run as a new OIDC client in `apps/run.auth/webapp/src/config/oidc.ts` with ALL required redirect URIs: production (both with and without region prefix), and localhost for dev. Follow the exact pattern of the gpxStudio client registration.
**Warning signs:** 401 or "invalid_redirect_uri" errors during login flow

### Pitfall 2: Cookie Name Conflicts
**What goes wrong:** Users logged into run.human get logged out when visiting flash.defcon.run, or vice versa
**Why it happens:** All DCR34 apps share the `.defcon.run` cookie domain. If cookie names collide, apps overwrite each other's session tokens.
**How to avoid:** Use `sess_flash`, `csrf_flash`, `callback_flash`, `state_flash` cookie names. Never use generic names like `session` or `token`.
**Warning signs:** Mysterious logouts on other DCR34 services after visiting flash.defcon.run

### Pitfall 3: Web Serial Detection in SSR
**What goes wrong:** `navigator is not defined` error during server-side rendering
**Why it happens:** `navigator.serial` is a browser API, not available in Node.js
**How to avoid:** Browser gate component must use `"use client"` directive and check inside `useEffect` (runs only in browser). Never check `navigator.serial` at module scope or in server components.
**Warning signs:** Hydration errors, build failures

### Pitfall 4: Region BasePath in Production
**What goes wrong:** Auth callbacks fail, assets 404, API routes unreachable in production
**Why it happens:** Production deploys use `basePath: "/${REGION_SHORT}"` (e.g., `/use1`). Auth.js callback URLs, signin redirect paths, and asset references must account for this.
**How to avoid:** Follow the exact `next.config.ts` pattern from run.gpx: conditionally apply `basePath` and `assetPrefix` in production only. In the auth config, use `isDev ? "/signin" : "/${region}/signin"` for pages config.
**Warning signs:** Working locally but broken in production

### Pitfall 5: Missing OIDC Client Registration
**What goes wrong:** Users cannot log in at all -- OIDC provider rejects the client
**Why it happens:** New service needs to be registered as an OIDC client in run.auth, with client ID, secret, and redirect URIs
**How to avoid:** Add a `flasher` client entry to `apps/run.auth/webapp/src/config/oidc.ts` clients array AND add corresponding `OIDC_FLASH_CLIENT_ID` / `OIDC_FLASH_SECRET` to run.auth's config/index.ts
**Warning signs:** "client_not_found" errors during authentication

### Pitfall 6: Device Variant Deduplication
**What goes wrong:** Same physical device appears multiple times in the picker
**Why it happens:** Meshtastic's hardware-list.json can have multiple entries with the same `hwModel` but different `platformioTarget` (representing hardware variants)
**How to avoid:** Deduplicate by `hwModel` for display purposes. If variants exist, either show the primary entry or add a variant selector within the device card.
**Warning signs:** Users confused by duplicate-looking cards

## Code Examples

### Device Grid with Filtering
```typescript
// src/components/device-picker/device-grid.tsx
"use client";

import { Card, CardBody, Chip, Input, Badge } from "@heroui/react";
import { Search } from "lucide-react";
import { useState, useMemo } from "react";
import type { DeviceHardware } from "@/types/device";
import { isEsp32Device } from "@/types/device";

// Known manufacturers from Meshtastic hardware-list.json tags
const MANUFACTURERS = ["RAK", "Heltec", "LilyGo", "Seeed", "Elecrow", "M5Stack", "DIY"];

interface DeviceGridProps {
  devices: DeviceHardware[];
  onSelect: (device: DeviceHardware) => void;
  selectedDevice: DeviceHardware | null;
}

export function DeviceGrid({ devices, onSelect, selectedDevice }: DeviceGridProps) {
  const [search, setSearch] = useState("");
  const [manufacturer, setManufacturer] = useState<string | null>(null);

  const esp32Devices = useMemo(() =>
    devices.filter(isEsp32Device),
    [devices]
  );

  const filtered = useMemo(() => {
    let result = esp32Devices;

    if (manufacturer) {
      result = result.filter(d => d.tags?.includes(manufacturer));
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(d =>
        d.displayName.toLowerCase().includes(q) ||
        d.tags?.some(t => t.toLowerCase().includes(q))
      );
    }

    // Sort: recommended (supportLevel 1) first, then alphabetical
    return result.sort((a, b) => {
      const aRecommended = a.activelySupported && (a.supportLevel === 1);
      const bRecommended = b.activelySupported && (b.supportLevel === 1);
      if (aRecommended && !bRecommended) return -1;
      if (!aRecommended && bRecommended) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [esp32Devices, search, manufacturer]);

  return (
    <div className="space-y-4">
      {/* Search + manufacturer tabs */}
      <Input
        placeholder="Search devices..."
        startContent={<Search className="w-4 h-4 text-default-400" />}
        value={search}
        onValueChange={setSearch}
        classNames={{ inputWrapper: "glass-card" }}
      />
      <div className="flex gap-2 flex-wrap">
        <Chip
          variant={manufacturer === null ? "solid" : "bordered"}
          color="primary"
          className="cursor-pointer"
          onClick={() => setManufacturer(null)}
        >All</Chip>
        {MANUFACTURERS.map(m => (
          <Chip
            key={m}
            variant={manufacturer === m ? "solid" : "bordered"}
            color="primary"
            className="cursor-pointer"
            onClick={() => setManufacturer(m === manufacturer ? null : m)}
          >{m}</Chip>
        ))}
      </div>
      {/* Device card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map(device => (
          <DeviceCard
            key={`${device.hwModel}-${device.platformioTarget}`}
            device={device}
            isSelected={selectedDevice?.hwModel === device.hwModel}
            onSelect={() => onSelect(device)}
          />
        ))}
      </div>
      {filtered.length === 0 && <DeviceNotFound />}
    </div>
  );
}
```

### Custom Wizard Stepper
```typescript
// src/components/wizard/wizard-stepper.tsx
"use client";

import { Check } from "lucide-react";
import type { WizardStep } from "@/hooks/use-wizard";

const STEPS: { key: WizardStep; label: string }[] = [
  { key: "pick-device", label: "Pick Device" },
  { key: "connect", label: "Connect" },
  { key: "flash", label: "Flash" },
  { key: "configure", label: "Configure" },
  { key: "done", label: "Done" },
];

interface WizardStepperProps {
  currentStep: WizardStep;
  completedSteps: Set<WizardStep>;
  onStepClick: (step: WizardStep) => void;
}

export function WizardStepper({ currentStep, completedSteps, onStepClick }: WizardStepperProps) {
  return (
    <div className="flex items-center justify-between w-full">
      {STEPS.map((step, index) => {
        const isCurrent = step.key === currentStep;
        const isCompleted = completedSteps.has(step.key);
        const isClickable = isCompleted; // Can only go back to completed steps

        return (
          <div key={step.key} className="flex items-center flex-1">
            <button
              onClick={() => isClickable && onStepClick(step.key)}
              disabled={!isClickable && !isCurrent}
              className={clsx(
                "flex items-center gap-2 px-3 py-2 rounded-lg transition-all",
                isCurrent && "text-primary font-medium",
                isCompleted && "text-success cursor-pointer hover:bg-content2",
                !isCurrent && !isCompleted && "text-default-400 cursor-not-allowed opacity-50",
              )}
            >
              <div className={clsx(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-mono border",
                isCurrent && "border-primary text-primary bg-primary/10",
                isCompleted && "border-success bg-success text-success-foreground",
                !isCurrent && !isCompleted && "border-default-400",
              )}>
                {isCompleted ? <Check className="w-4 h-4" /> : index + 1}
              </div>
              <span className="hidden sm:inline text-sm">{step.label}</span>
            </button>
            {index < STEPS.length - 1 && (
              <div className={clsx(
                "flex-1 h-px mx-2",
                isCompleted ? "bg-success" : "bg-default-300",
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}
```

### OIDC Client Registration (run.auth side)
```typescript
// Addition to apps/run.auth/webapp/src/config/oidc.ts clients array
// Source: existing gpxStudio client pattern

const LOCAL_FLASH_PORT = process.env.LOCAL_FLASH_PORT || "3004";

// Flash tool client (flash.{siteDomain}/{region})
{
  client_id: config.oidc.clients.flashTool.clientId,
  client_secret: config.oidc.clients.flashTool.clientSecret,
  redirect_uris: [
    `https://flash.${siteDomain}/api/auth/callback/run.${siteDomain}`,
    `https://flash.${siteDomain}/use1/api/auth/callback/run.${siteDomain}`,
    `https://flash.${siteDomain}/cac1/api/auth/callback/run.${siteDomain}`,
    ...(config.isDev ? [
      `http://localhost:${LOCAL_FLASH_PORT}/api/auth/callback/run.${siteDomain}`,
    ] : []),
  ],
  post_logout_redirect_uris: [
    `https://flash.${siteDomain}/use1`,
    `https://flash.${siteDomain}/cac1`,
    ...(config.isDev ? [
      `http://localhost:${LOCAL_FLASH_PORT}`,
    ] : []),
  ],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  scope: "openid profile email services",
  token_endpoint_auth_method: "client_secret_post",
},
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| NextUI | HeroUI (rebranded) | 2025 | Same API, import from `@heroui/react` not `@nextui-org/react` |
| Auth.js v4 (NextAuth) | Auth.js v5 (beta.30) | 2024 | New `auth()` universal function, middleware wrapper pattern |
| Tailwind 3 | Tailwind 4 | 2025 | `@import "tailwindcss"` + `@config` instead of `@tailwind` directives |
| `middleware.ts` (Next.js 15) | Still `middleware.ts` (Next.js 16) | Current | Despite docs mentioning `proxy.ts` rename, the monorepo still uses `middleware.ts` pattern |
| pages/ router | app/ router | 2023 | All DCR34 apps use App Router exclusively |

**Deprecated/outdated:**
- `@nextui-org/react`: Replaced by `@heroui/react` -- same components, different package name
- `@tailwind base/components/utilities`: Replaced by `@import "tailwindcss"` in Tailwind 4
- `next.config.js`: Monorepo uses `next.config.ts` (TypeScript config)

## Open Questions

1. **OIDC Client Credentials for run.flash**
   - What we know: Need OIDC_FLASH_CLIENT_ID and OIDC_FLASH_SECRET environment variables
   - What's unclear: These don't exist yet -- need to be generated and added to both run.auth's config and run.flash's .env
   - Recommendation: Generate placeholder values for local dev (e.g., `flash-dev-client-id` / `flash-dev-client-secret`). Production values generated during Phase 4 deployment.

2. **Exact Firmware Version to Pin**
   - What we know: Firmware follows `firmware-{arch}-{version}.zip` pattern from GitHub releases. Current latest is 2.7.15.
   - What's unclear: Which version DCR34 will pin for the event (this is an event decision, per STATE.md)
   - Recommendation: Build the device picker to display `platformioTarget` and defer version pinning. The `getFirmwareFilename()` function takes version as parameter.

3. **Device SVG Vendoring Strategy**
   - What we know: 78 SVGs exist in Meshtastic's web-flasher repo at `/public/img/devices/`. ESP32-specific devices are a subset.
   - What's unclear: Whether to vendor ALL 78 SVGs or only ESP32-related ones
   - Recommendation: Vendor only SVGs referenced by ESP32-architecture devices in hardware-list.json. Include `unknown.svg` as fallback. Estimated ~30-40 SVGs.

4. **Dev Port Assignment**
   - What we know: run.human=3001, run.auth=3002, run.gpx=3003, run.cms=1337
   - What's unclear: Nothing -- 3004 is the next available port
   - Recommendation: Use PORT=3004 for run.flash, add `LOCAL_FLASH_PORT` env var

## Sources

### Primary (HIGH confidence)
- `apps/run.gpx/webapp/src/config/auth.ts` -- Complete OIDC client config pattern
- `apps/run.auth/webapp/src/config/oidc.ts` -- OIDC provider client registration pattern
- `apps/run.gpx/webapp/src/middleware.ts` -- Auth middleware route protection pattern
- `apps/run.human/webapp/tailwind.config.js` -- HeroUI dark theme configuration
- `apps/run.human/webapp/src/styles/globals.css` -- Glass-card, noise-overlay, terminal-block CSS
- `apps/run.human/webapp/src/app/providers.tsx` -- HeroUIProvider + ThemeProvider setup
- `apps/run.human/webapp/src/components/header/header.tsx` -- Navbar component pattern
- `apps/run.human/webapp/package.json` -- Monorepo dependency versions
- `apps/run.gpx/webapp/next.config.ts` -- Region basePath / assetPrefix pattern
- `apps/run.human/webapp/tsconfig.json` -- TypeScript path aliases pattern
- Meshtastic web-flasher `types/api.ts` -- DeviceHardware interface (https://github.com/meshtastic/web-flasher)
- Meshtastic web-flasher `public/data/hardware-list.json` -- Device data structure
- Meshtastic web-flasher `public/img/devices/` -- 78 device SVG files
- Meshtastic firmware releases -- `firmware-{arch}-{version}.zip` naming convention (https://github.com/meshtastic/firmware/releases)

### Secondary (MEDIUM confidence)
- HeroUI docs -- Card, Tabs, Progress, Input, Chip component APIs (https://www.heroui.com/docs/components/)
- Web Serial API browser support -- Chrome 89+, Edge 89+, no Firefox/Safari (https://caniuse.com/web-serial)
- Chrome developer docs -- Web Serial API detection via `"serial" in navigator` (https://developer.chrome.com/docs/capabilities/serial)

### Tertiary (LOW confidence)
- Meshtastic web-flasher-events repo -- Event mode concept exists but documentation unclear on specifics (https://github.com/meshtastic/web-flasher-events)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- directly copied from existing monorepo apps with same versions
- Architecture: HIGH -- follows established run.gpx and run.human patterns, only novel piece is custom stepper
- Pitfalls: HIGH -- derived from CASS playbook learnings and actual code analysis of existing OIDC integration
- Device data: HIGH -- verified DeviceHardware interface from Meshtastic source, confirmed hardware-list.json structure

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable -- monorepo patterns unlikely to change mid-event prep)
