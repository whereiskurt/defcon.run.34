---
phase: 01-app-scaffold-device-picker
verified: 2026-02-28T15:30:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 1: App Scaffold + Device Picker Verification Report

**Phase Goal:** Users can browse and select their ESP32 device in a guided wizard, with unsupported browsers blocked and unauthenticated users redirected
**Verified:** 2026-02-28T15:30:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A user visiting flash.defcon.run in Firefox sees a clear "use Chrome or Edge" message and cannot proceed | VERIFIED | `browser-gate.tsx` checks `"serial" in navigator` via `useEffect` (SSR-safe). When false, renders `UnsupportedBrowserMessage` with "Web Serial API Required" heading, "Flash your Meshtastic device using Chrome or Edge" text, Chrome and Edge download buttons, and "Firefox and Safari do not support Web Serial" note. Children are never rendered. |
| 2 | A user visiting in Chrome without being logged in is redirected to auth.defcon.run and returned after login | VERIFIED | `middleware.ts` imports `auth` from `@/config/auth` and redirects unauthenticated users to `/signin`. `signin/page.tsx` auto-calls `signIn("run.defcon.run", { callbackUrl })`. `auth.ts` configures OIDC with `oidcIssuer` pointing to `auth.defcon.run`, service-specific cookies (`sess_flash`, `csrf_flash`, `callback_flash`, `state_flash`), JWT callbacks with claims refresh, and `redirectProxyUrl` for callback routing. Flash tool is registered in `run.auth/config/oidc.ts` with production and dev redirect URIs. |
| 3 | An authenticated user can browse ESP32 devices with images and manufacturer tags, and filter by name or manufacturer | VERIFIED | `device-grid.tsx` loads vendored `hardware-list.json` (1352 lines), filters via `isEsp32Device()`, deduplicates by `hwModel`, renders a 4-column grid of `DeviceCard` components. Each card shows device SVG image (38 vendored SVGs + unknown.svg fallback), display name, manufacturer `Chip`, and architecture `Chip` with color coding. `DeviceSearch` provides text search against `displayName` and `tags`. Manufacturer `Chip` row filters by manufacturer with toggle behavior. |
| 4 | Selecting a device advances the wizard to the "Connect" step, and the correct firmware filename is determined from the selection | VERIFIED | `DeviceCard` is `isPressable` and calls `onSelect()` which propagates to `useWizard().selectDevice()`. `WizardContainer` renders a "Continue with {device.displayName}" button that calls `advance()` when `canAdvance("pick-device")` is true (requires `selectedDevice !== null`). `advance()` adds `"pick-device"` to `completedSteps` and moves to `"connect"`. `getFirmwareFilename(device, version)` in `types/device.ts` computes `firmware-${device.platformioTarget}-${version}.bin` from the selected device's `platformioTarget`. |
| 5 | A progress breadcrumb shows the user's current position across all wizard steps (Pick Device / Connect / Flash / Configure / Done) | VERIFIED | `WizardStepper` renders all 5 steps (`STEPS` array) in a horizontal flex row with connecting lines. Current step: teal border/text with glow shadow (`shadow-[0_0_12px_#00d4aa30]`). Completed steps: filled primary background with `Check` icon, clickable with `hover:bg-content2`. Future steps: `text-default-400`, `cursor-not-allowed`, `opacity-50`. Labels hidden on mobile (`hidden sm:inline`). Back navigation via `goToStep()` only allows completed steps. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/run.flash/webapp/package.json` | Next.js 16 project with all dependencies | VERIFIED | Contains next@^16.1.6, react@^19.2.3, heroui, next-auth, framer-motion, lucide-react, clsx, tailwindcss@^4, typescript |
| `apps/run.flash/webapp/src/config/auth.ts` | OIDC client config for auth.defcon.run | VERIFIED | 309 lines. Exports `{ handlers, auth, signIn, signOut }`. Full JWT callbacks with `fetchFreshClaims`, `validateAndUpdateClaims`, lockout detection, session versioning. Service-specific cookies: `sess_flash`, `csrf_flash`, `callback_flash`, `state_flash`. |
| `apps/run.flash/webapp/src/middleware.ts` | Auth middleware protecting all routes | VERIFIED | 30 lines. Imports `auth` from `@/config/auth`, redirects unauthenticated users to `/signin`. Matcher excludes api, _next, favicon, signin, img, data. |
| `apps/run.flash/webapp/src/app/layout.tsx` | Root layout with HeroUI providers and dark theme | VERIFIED | 61 lines. Imports Providers, SessionProvider, Header, fonts, globals.css. Dark theme via `defaultTheme: "dark"`. Noise-overlay wrapper. |
| `apps/run.auth/webapp/src/config/oidc.ts` | Flash tool OIDC client registration | VERIFIED | Flash client at lines 118-146 with `flashTool` client credentials, production + dev redirect URIs, `LOCAL_FLASH_PORT` declared at line 10. |
| `apps/run.flash/webapp/src/types/device.ts` | DeviceHardware interface and ESP32 filter helpers | VERIFIED | 33 lines. Exports `DeviceHardware`, `isEsp32Device`, `ESP32_ARCHITECTURES`, `getFirmwareFilename`. |
| `apps/run.flash/webapp/src/hooks/use-wizard.ts` | Wizard state management hook | VERIFIED | 97 lines. Exports `useWizard`, `WizardStep`, `STEPS`, `STEP_LABELS`. Full state management with `canAdvance`, `advance`, `goToStep`, `selectDevice`, `clearDevice`. |
| `apps/run.flash/webapp/src/components/browser-gate.tsx` | Web Serial API browser detection gate | VERIFIED | 83 lines. SSR-safe check via `useEffect`. Three states: loading skeleton, unsupported message with Chrome/Edge links, children pass-through. |
| `apps/run.flash/webapp/src/components/wizard/wizard-stepper.tsx` | Custom horizontal stepper bar | VERIFIED | 86 lines. Renders all 5 steps with current/completed/future visual states, connecting lines, back navigation via click on completed steps. |
| `apps/run.flash/webapp/src/components/wizard/wizard-container.tsx` | Wizard step container with state management | VERIFIED | 115 lines. Uses `useWizard()` hook, renders `WizardStepper` + step content with `AnimatePresence` transitions. Device picker in pick-device step, placeholder cards for Connect/Flash/Configure/Done. |
| `apps/run.flash/webapp/src/components/device-picker/device-grid.tsx` | Device card grid with filtering | VERIFIED | 125 lines. Loads vendored hardware-list.json, filters ESP32, deduplicates, search + manufacturer filter, renders grid with `DeviceCard` components. Continue button with device name. |
| `apps/run.flash/webapp/src/components/device-picker/device-card.tsx` | Individual device card component | VERIFIED | 86 lines. SVG image, display name, manufacturer Chip, architecture Chip with color coding, Recommended badge, reduced opacity for unsupported. Selected state with ring-2 ring-primary and !important overrides. |
| `apps/run.flash/webapp/public/data/hardware-list.json` | Vendored Meshtastic device list | VERIFIED | 1352 lines of JSON device data. |
| `apps/run.flash/webapp/public/img/devices/` | Vendored device SVG images | VERIFIED | 38 SVG files including unknown.svg fallback. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `middleware.ts` | `config/auth.ts` | `import { auth }` | WIRED | Line 1: `import { auth } from "@/config/auth"` |
| `config/auth.ts` | `run.auth/config/oidc.ts` | OIDC client registration | WIRED | `flashTool` client registered in oidc.ts lines 118-146, credentials in index.ts line 73 |
| `layout.tsx` | `providers.tsx` | Providers component | WIRED | Line 4: `import { Providers } from "@/app/providers"`, rendered at line 48 |
| `page.tsx` | `browser-gate.tsx` | BrowserGate wraps wizard | WIRED | Line 1: `import { BrowserGate }`, line 6: `<BrowserGate><WizardContainer /></BrowserGate>` |
| `wizard-container.tsx` | `use-wizard.ts` | useWizard hook | WIRED | Line 6: `import { useWizard }`, line 38: destructured state/actions |
| `device-grid.tsx` | `types/device.ts` | isEsp32Device filter | WIRED | Line 6: `import { isEsp32Device }`, line 30: `allDevices.filter(isEsp32Device)` |
| `device-grid.tsx` | `hardware-list.json` | Static import | WIRED | Line 15: `import deviceData from "@/../public/data/hardware-list.json"` |
| `wizard-container.tsx` | `device-grid.tsx` | DeviceGrid in pick-device step | WIRED | Line 8: `import { DeviceGrid }`, line 69: rendered with `onSelect`, `selectedDevice`, `onContinue` props |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| BRWS-01 | 01-02 | App gates unsupported browsers with "use Chrome or Edge" message | SATISFIED | `browser-gate.tsx` checks Web Serial API, renders `UnsupportedBrowserMessage` with download links |
| BRWS-02 | 01-01 | App enforces OIDC authentication, unauthenticated users redirect to auth.defcon.run | SATISFIED | `middleware.ts` protects all routes, `signin/page.tsx` auto-redirects to OIDC, `auth.ts` configures provider |
| DEVC-01 | 01-02 | User can browse ESP32 devices from vendored hardware-list.json filtered to ESP32 architectures | SATISFIED | `device-grid.tsx` imports hardware-list.json, filters via `isEsp32Device`, deduplicates |
| DEVC-02 | 01-02 | Device picker displays device images (SVGs), display names, and manufacturer tags | SATISFIED | `device-card.tsx` renders SVG image, `displayName`, manufacturer Chip, architecture Chip |
| DEVC-03 | 01-02 | User can filter/search devices by name or manufacturer | SATISFIED | `device-search.tsx` for text search, manufacturer Chip row in `device-grid.tsx` for filtering |
| DEVC-04 | 01-02 | Device picker shows support tier and actively-supported status for sorting | SATISFIED | `sortDevices()` sorts by recommended, then actively supported, then alpha. Unsupported devices rendered at `opacity-60`. Recommended devices get "Recommended" badge. |
| DEVC-05 | 01-02 | Selecting a device determines the correct firmware binary filename via platformioTarget | SATISFIED | `getFirmwareFilename(device, version)` in `types/device.ts` computes filename from `platformioTarget`. Device selection stores full `DeviceHardware` object including `platformioTarget`. |
| WZRD-01 | 01-02 | Step-by-step wizard: Pick Device, Connect, Flash, Configure, Done | SATISFIED | `STEPS` array and `WizardContainer` implement all 5 steps with content per step |
| WZRD-02 | 01-02 | Each step validates completion before allowing progression | SATISFIED | `canAdvance()` checks `selectedDevice !== null` for pick-device, checks previous step completion for all others. `goToStep()` only allows completed steps. |
| WZRD-03 | 01-02 | Progress breadcrumb shows current position in the flow | SATISFIED | `WizardStepper` renders 5-step horizontal bar with current/completed/future visual states |

**All 10 Phase 1 requirements covered. No orphaned requirements.**

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/config/devices.ts` | 21 | `TODO: Update this list once event hardware is finalized` | Info | Expected -- recommended devices are placeholder values until event hardware is decided. Does not block Phase 1 goal. |
| `src/components/wizard/wizard-container.tsx` | 10-35 | `PlaceholderStep` for Connect/Flash/Configure/Done | Info | Intentional -- these steps are Phase 2 and Phase 3 deliverables. The placeholder content is well-styled with phase attribution. |

No blocker or warning anti-patterns found.

### Human Verification Required

### 1. Dark theme visual appearance

**Test:** Open http://localhost:3004 in Chrome, verify dark theme with DCR34 teal primary (#00d4aa), noise-overlay texture, glass-card effects, and matrix-green accents
**Expected:** Cohesive dark hacker/cyberpunk aesthetic matching DCR34 brand
**Why human:** Visual appearance and aesthetic quality cannot be verified programmatically

### 2. Firefox browser gate

**Test:** Open http://localhost:3004 in Firefox
**Expected:** Full-screen "Web Serial API Required" card with Chrome and Edge download buttons, no wizard visible
**Why human:** Requires actual browser testing (Navigator.serial availability varies by browser)

### 3. Device picker interaction

**Test:** Search for a device, click manufacturer filter, select a device, click continue
**Expected:** Real-time search filtering, manufacturer chip toggle, card selection highlight with teal glow, "Continue with [name]" button enables, wizard advances to Connect step with stepper update
**Why human:** Interactive behavior, animation quality, and visual feedback require human observation

### 4. Wizard stepper back navigation

**Test:** After advancing to Connect step, click "Pick Device" in the stepper bar
**Expected:** Returns to device picker with previous selection preserved
**Why human:** State preservation and navigation behavior need human verification

### 5. OIDC authentication flow

**Test:** With auth server running, visit http://localhost:3004 without session
**Expected:** Redirects to auth.defcon.run login, returns to flash app after authentication with valid session
**Why human:** Requires running auth server and complete OIDC flow

### Gaps Summary

No gaps found. All 5 success criteria are verified through code inspection. All 10 requirement IDs (BRWS-01, BRWS-02, DEVC-01-05, WZRD-01-03) are satisfied with substantive implementations. All key links are wired. No blocker anti-patterns exist. The placeholder steps for Connect/Flash/Configure/Done are intentional Phase 2/3 deliverables and do not impact Phase 1 goals.

The single TODO in `devices.ts` regarding recommended hardware list is informational -- the sorting and badge logic works correctly with the current list.

---

_Verified: 2026-02-28T15:30:00Z_
_Verifier: Claude (gsd-verifier)_
