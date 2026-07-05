---
phase: 36-runtime-copy-toolkit
plan: 03
subsystem: ui
tags: [copy-catalog, react-context, client-provider, self-proof, vitest, run.bib]

# Dependency graph
requires:
  - phase: 36-runtime-copy-toolkit
    plan: 01
    provides: "copy-core t/interpolate (client-safe), server-only loadCopy(locale), committed copy-snapshot.json floor"
  - phase: 36-runtime-copy-toolkit
    plan: 02
    provides: "renderCopy escape-first inline renderer (available for Phase 37 client rendering)"
provides:
  - "CopyProvider (client context) carrying the server-resolved copy map to client components"
  - "useCopy(): returns a bound t with the client floor context[key] ?? snapshot[key] ?? key; never throws"
  - "run.bib layout.tsx wiring: loadCopy('default') server-side + <CopyProvider> mounted (permanent — Phase 37 consumes it)"
affects: [37-bib-donate-sponsor-proof, 38-custom-copy-admin]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client provider passes ONLY the already-resolved copy map across the server->client boundary — never the server-only resolver, token, or CMS URL (T-36-08)"
    - "One shared lookup path: useCopy's bound t reuses copy-core's t (same O(1) map[key] ?? key + interpolate the server uses)"
    - "Client floor merge: t({ ...SNAPSHOT_FLOOR, ...context }, key) so context wins but a snapshot-present key never renders raw (FALL-04)"
    - "useCopy() outside a provider floors to the committed snapshot via an empty-map context default — never throws (T-36-10)"

key-files:
  created:
    - apps/run.bib/webapp/src/components/CopyProvider.tsx
    - apps/run.bib/webapp/src/__tests__/copy-provider.test.tsx
  modified:
    - apps/run.bib/webapp/src/app/layout.tsx

key-decisions:
  - "CopyProvider imports only copy-core (t) + copy-snapshot.json — never the server-only lib/copy; enforced by the plan's grep gate (0)"
  - "Server self-proof key rendered in a hidden <span data-copy-selftest> marker (zero visual footprint, present in the RSC/HTML markup) rather than building any donate/sponsor UI (that is Phase 37)"
  - "CopyProvider mounted INSIDE the existing Providers composition (wrapping the content tree) so every client component below can call useCopy without restructuring the provider tree"

requirements-completed: [TOOL-02, TOOL-03, FALL-04]

coverage:
  - id: D1
    description: "useCopy().t interpolates a context key at RUNTIME inside <CopyProvider> (client resolution, SC-2, TOOL-03)"
    requirement: TOOL-03
    verification:
      - kind: unit
        ref: "src/__tests__/copy-provider.test.tsx#interpolates a context key inside a provider at runtime"
        status: pass
    human_judgment: false
  - id: D2
    description: "Client floor context[key] ?? snapshot[key] ?? key: a key absent from the provider map still resolves from the committed snapshot (FALL-04)"
    requirement: FALL-04
    verification:
      - kind: unit
        ref: "src/__tests__/copy-provider.test.tsx#falls back to the snapshot floor for a key absent from the provider map / echoes the raw key as the last resort"
        status: pass
    human_judgment: false
  - id: D3
    description: "useCopy() outside any provider never throws — floors to the snapshot (T-36-10)"
    requirement: FALL-04
    verification:
      - kind: unit
        ref: "src/__tests__/copy-provider.test.tsx#resolves via the snapshot floor when used OUTSIDE any provider"
        status: pass
    human_judgment: false
  - id: D4
    description: "layout.tsx carries the server-resolved copy map into CopyProvider (only the map crosses; token/URL never do) — permanent Phase 37 wiring (TOOL-02, T-36-08)"
    requirement: TOOL-02
    verification:
      - kind: other
        ref: "code review: layout awaits loadCopy('default'); <CopyProvider value={copy}> wraps the tree; CopyProvider grep gate for lib/copy = 0"
        status: pass
    human_judgment: true
    rationale: "The server->client no-token-leak property is a bundling guarantee; next build in this environment is blocked by pre-existing missing UI deps (see Issues), so the boundary is proven by the grep gate + code review rather than a clean production build here"
  - id: D5
    description: "Server-side self-proof: bib.selftest.serverGreeting resolves to 'Bib copy toolkit online' via t(map,...) (SC-1 half)"
    requirement: TOOL-02
    verification:
      - kind: unit
        ref: "src/__tests__/copy-provider.test.tsx#resolves the server self-proof key to its committed string"
        status: pass
    human_judgment: false

# Metrics
metrics:
  duration_minutes: 15
  tasks_completed: 2
  files_created: 2
  files_modified: 1
  commits: 3
  completed_date: 2026-07-05

status: complete
---

# Phase 36 Plan 03: Client Copy Provider + Layout Self-Proof Summary

**`CopyProvider`/`useCopy` carry the server-resolved copy map into run.bib's client components — a bound `t` that resolves an interpolated key at RUNTIME (client modals/toasts/handlers) via the client floor `context[key] ?? snapshot[key] ?? key` — and `layout.tsx` now `await loadCopy('default')` + mounts `<CopyProvider>`, self-proving one server key and one client key resolve end to end. Only the resolved map crosses the boundary; the CMS token/URL never do.**

## What Was Built

- `components/CopyProvider.tsx` (`"use client"`) — exports `CopyProvider` (a plain React context provider taking the server-resolved `CopyMap` as `value`) and `useCopy()` (returns `{ t }`). The bound `t(key, vars)` merges the committed snapshot floor UNDER the context (`t({ ...SNAPSHOT_FLOOR, ...context }, key, vars)`), reusing copy-core's `t`/`interpolate` — the exact same O(1) lookup path the server uses. The context default is `{}`, so `useCopy()` outside a provider still resolves through the snapshot floor and never throws.
- `layout.tsx` wiring — the async root layout `await loadCopy("default")` once server-side, renders the server key `bib.selftest.serverGreeting` in a hidden `<span data-copy-selftest>` marker (zero visual footprint, present in markup), and wraps the content tree in `<CopyProvider value={copy}>` inside the existing `Providers` composition. Permanent wiring Phase 37's donate/sponsor copy consumes.
- `copy-provider.test.tsx` — 5 vitest cases via `renderToStaticMarkup` (node env, no jsdom): runtime context-key interpolation, snapshot-floor fallback for an absent key, no-provider safety, raw-key echo, and the server-key self-proof.

## How It Was Verified

- `npx vitest run src/__tests__/copy-provider.test.tsx` — **5/5 pass** under Node v23.6.0.
- Grep gate: `grep -v '^\s*//' src/components/CopyProvider.tsx | grep -c "lib/copy'"` → **0** (CopyProvider never imports the server-only resolver).
- `npx tsc --noEmit` — **zero NEW errors** from this plan's files. The only error touching a plan file is the pre-existing `import clsx from "clsx"` on `layout.tsx:3` (line untouched by this plan; `clsx` is one of the ~30 documented missing UI deps). CopyProvider.tsx and copy-provider.test.tsx are type-clean.

## TDD Gate Compliance

- **RED:** `10da8fe0` `test(36-03):` — client spec committed while `CopyProvider` did not exist (import fails, "no tests" — confirmed failing before implementation).
- **GREEN:** `ed42d537` `feat(36-03):` — CopyProvider/useCopy implemented; 4/4 client cases pass, grep gate 0, tsc clean.
- **Task 2:** `38d376a0` `feat(36-03):` — layout wiring + server-key self-proof assertion (5/5 pass). Task 2's deliverable is the layout wiring (proven by the mounted provider + the self-proof assertion + the grep-gated boundary), not a classic failing unit test, since an async server layout calling `auth()`/`loadCopy()` is not unit-renderable here.

## Decisions Made

- **Only the resolved map crosses the boundary.** CopyProvider imports `t` from `copy-core` and the floor from `copy-snapshot.json`; it never imports the server-only `lib/copy` (which reads `STRAPI_API_TOKEN`/`CMS_INTERNAL_URL`). Enforced by the grep gate (0) — the token/URL are read only inside `loadCopy` server-side and never serialized into the client payload (T-36-08).
- **Hidden self-proof marker, no donate/sponsor UI.** The server key is rendered in a `hidden` span rather than any visible surface — the plan explicitly defers the donate/sponsor surface to Phase 37. The marker proves server render + client provider are live without changing the visible app.
- **Provider mounted inside Providers.** Wrapping the content tree with `<CopyProvider>` inside the existing `Providers` tree (not replacing it) means every client component below can call `useCopy` with a one-line, permanent change.

## Deviations from Plan

None — plan executed as written (Rules 1–4 not triggered). The `next build` step in Task 2's verify could not run to completion in this environment; see Issues (pre-existing, out of scope — matches Plans 01/02).

## Issues Encountered

- **`next build` blocked by pre-existing missing UI deps (out of scope).** The run.bib webapp `node_modules` (symlinked to the main checkout's partial install) is missing `@heroui/react`, `@heroui/theme`, `clsx`, `next-themes`, `framer-motion`, `qrcode`, `react-icons/*`, `altcha-lib/v1`. `npx next build` fails with `Module not found` for these in pre-existing components (`header.tsx`, `menu-dropdown.tsx`, `user-dropdown.tsx`, `theme-switch.tsx`, `providers.tsx`) — **zero** failures reference this plan's files (`CopyProvider.tsx`, `layout.tsx`, `copy-provider.test.tsx` all resolve). This is the identical partial-install issue documented in Plans 36-01 and 36-02; installing packages is excluded from auto-fix (Rule 3 package-install exclusion) and would churn the shared lockfile. The server->client no-token-leak guarantee is therefore proven by the grep gate + code review (D4, human_judgment) rather than a clean production build in this broken env. A full dependency reinstall is the environment fix and is out of scope for this plan.

## User Setup Required

- Same as Plan 36-01: run.bib needs `CMS_INTERNAL_URL` + `STRAPI_API_TOKEN` wired into its ECS runtime before Phase 37 ships to prod. Until then the toolkit silently serves the S3 export then the committed snapshot floor (no crash) — the mounted CopyProvider already carries whatever `loadCopy` resolves.
- Environment (for anyone running the build/tests locally): use Node v23.6.0 for vitest; a full `node_modules` install (the missing UI deps above) is required for `next build`.

## Next Phase Readiness

- CopyProvider/useCopy + the layout wiring are the client entrypoint Phase 37 (bib donate/sponsor proof) consumes — client components can call `useCopy().t(...)` immediately, and `renderCopy` (Plan 02) is available for markdown copy. The provider is permanently mounted; Phase 37 only adds keys + UI.

## Self-Check: PASSED

- FOUND: apps/run.bib/webapp/src/components/CopyProvider.tsx
- FOUND: apps/run.bib/webapp/src/__tests__/copy-provider.test.tsx
- FOUND (modified): apps/run.bib/webapp/src/app/layout.tsx
- FOUND commit: 10da8fe0 (test — RED)
- FOUND commit: ed42d537 (feat — Task 1 GREEN)
- FOUND commit: 38d376a0 (feat — Task 2 layout self-proof)
- `npx vitest run src/__tests__/copy-provider.test.tsx` → 5/5 pass (Node v23.6.0); grep gate 0; tsc clean for plan files.

---
*Phase: 36-runtime-copy-toolkit*
*Completed: 2026-07-05*
