---
phase: 34-bib-admin-orderform
plan: 05
subsystem: run.bib webapp — header + user menu
tags: [frontend, heroui, cross-app-links, region-routing, flash-parity]
requires:
  - run.flash user dropdown pattern (739836f5, on-branch post-rebase)
  - run.human ?open=checkin|qr modal auto-open (origin/main)
provides:
  - runHumanUrl region-prefix helper (src/lib/run-human-url.ts)
  - flash-style bib user dropdown (Profile/My Bib/CMS/Admin/Check-in/QR/Sign out)
  - unified cross-app run.human link construction across dropdown + header + mobile menu
affects:
  - apps/run.bib/webapp header and navigation surfaces
tech-stack:
  added: []
  patterns:
    - "Single shared region-prefix helper (runHumanUrl) for all cross-app run.human links"
    - "Call-time NEXT_PUBLIC_REGION_SHORT read (mirrors social-qr.ts) so vi.stubEnv works"
    - "Source-content vitest test for a client HeroUI component (node env, no jsdom)"
key-files:
  created:
    - apps/run.bib/webapp/src/lib/run-human-url.ts
    - apps/run.bib/webapp/src/__tests__/run-human-url.test.ts
    - apps/run.bib/webapp/src/__tests__/user-dropdown.test.ts
  modified:
    - apps/run.bib/webapp/src/components/user-dropdown.tsx
    - apps/run.bib/webapp/src/components/header.tsx
    - apps/run.bib/webapp/src/components/menu-dropdown.tsx
decisions:
  - "Kept bib's direct signOut (no logout-confirm Modal) — flash's Modal is optional chrome, out of scope (simplicity first)"
  - "Admin item preserved as bib-specific (flash has none); gated on services.includes('admin')"
  - "user-dropdown tested as a source-content contract, not a render — vitest env is node (no jsdom) and the component uses HeroUI + useSession"
metrics:
  duration: ~10m
  completed: 2026-07-04
  tasks: 2
  files_created: 3
  files_modified: 3
requirements: [BIB-ADM-10]
status: complete
---

# Phase 34 Plan 05: Bib header + flash-style user menu Summary

Reworked run.bib's user dropdown to mirror flash/run.human (Profile, My Bib, CMS,
Admin, GPS Check-in, Show My QR, Sign out) and unified every cross-app run.human
link — dropdown Profile/Check-in/QR plus header + mobile-menu Meshtastic —
through a single region-prefixing `runHumanUrl` helper. Implements BIB-ADM-10.

## What Was Built

- **`src/lib/run-human-url.ts`** — a react-free pure helper `runHumanUrl(path)`
  returning `https://run.defcon.run/${region}${path}`, region read at call time
  from `NEXT_PUBLIC_REGION_SHORT` (default `use1`). Mirrors flash's `RUN_BASE`
  and social-qr.ts's call-time env read so it is env-stubbable in node-env vitest.
- **`user-dropdown.tsx`** — reworked to HeroUI `DropdownSection` groups with the
  seven menu keys in flash order: `profile` → `bib` → `cms` → `admin` →
  `checkin` → `showqr` → `signout`. Profile (`runHumanUrl("/whoami")`),
  GPS Check-in (`runHumanUrl("/?open=checkin")`), and Show My QR
  (`runHumanUrl("/?open=qr")`) open in a new tab (`target="_blank"`) and deep-link
  run.human's auto-opening modals. My Bib (`/orderform`) and Admin (`/admin`)
  stay in-app; signout keeps `signOut({ callbackUrl: "/orderform" })`. CMS gated
  on `services.includes("cms")`, Admin (bib-specific) on `services.includes("admin")`.
- **`header.tsx` / `menu-dropdown.tsx`** — Meshtastic links now use
  `runHumanUrl("/meshtastic")`; the duplicate module-level `runRegion` consts are
  removed. Header's `basePath` still reads the region for in-app active-state.
- **Two test files** — `run-human-url.test.ts` (default use1, call-time cac1
  override, deep-link paths) and `user-dropdown.test.ts` (source contract: seven
  keys in order, runHumanUrl deep links with `target="_blank"`, cms/admin gating,
  in-app My Bib/Admin/signout).

## Task Commits

| Task | Description | Commit |
|------|-------------|--------|
| 1 (RED) | Failing runHumanUrl + user-dropdown contract tests | 93859c50 |
| 1 (GREEN) | runHumanUrl helper + flash-style user dropdown | faa03874 |
| 2 | Route header + mobile-menu Meshtastic through runHumanUrl | 531915f7 |

## Verification

- `npm test` (node v23.6.0) — full vitest suite green: **19 files, 179 tests
  passing** (incl. new run-human-url + user-dropdown tests).
- `npx next build` (node v23.6.0) — **Compiled successfully in 6.4s**; all routes
  built. Only a pre-existing workspace-root lockfile inference warning (unrelated).
- Source review: exactly one region-prefix helper (`runHumanUrl`) is used for all
  run.human cross-app links across `user-dropdown.tsx`, `header.tsx`,
  `menu-dropdown.tsx`.

## Deviations from Plan

None — plan executed exactly as written. Task 1 followed the TDD RED→GREEN cycle
(test commit 93859c50 fails before implementation, GREEN commit faa03874 passes).

## Threat Mitigations

- **T-34-05-02 (EoP, CMS/Admin items)** — mitigated as specified: both items
  render only when `session.services` includes the matching group (client-side
  UX gating). cms.defcon.run and the bib `/admin` route remain the server-enforced
  authorization boundary.
- **T-34-05-01 / T-34-05-03 (accept)** — run.human deep links carry only a path +
  `?open=checkin|qr`; no tokens/PII; fixed first-party host. No new surface.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: apps/run.bib/webapp/src/lib/run-human-url.ts
- FOUND: apps/run.bib/webapp/src/__tests__/run-human-url.test.ts
- FOUND: apps/run.bib/webapp/src/__tests__/user-dropdown.test.ts
- FOUND commit 93859c50 (test RED)
- FOUND commit faa03874 (feat GREEN)
- FOUND commit 531915f7 (refactor Task 2)
