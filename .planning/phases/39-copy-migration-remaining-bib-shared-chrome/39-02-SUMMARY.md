---
phase: 39-copy-migration-remaining-bib-shared-chrome
plan: 02
subsystem: run.human copy toolkit adoption (port + snapshot floor + provider mount)
tags: [copy-catalog, migration, toolkit-port, snapshot-floor, CopyProvider, MIGR-03]
requires:
  - 39-01 (canonical common.* union authored in run.bib; byte-identical floor required here)
  - Phase 36 copy toolkit (run.bib copy.ts/copy-core.ts/copy-markdown.tsx/CopyProvider.tsx — port sources)
  - run.human config.cms (CMS_INTERNAL_URL + STRAPI_API_TOKEN already present in src/config/index.ts)
provides:
  - run.human copy toolkit installed (loadCopy/t server-side, useCopy client-side)
  - CopyProvider mounted in BOTH run.human group layouts (protected + public)
  - run.human copy-snapshot.json offline floor = full common.* union (byte-identical to run.bib)
  - namespace-aware copy:import + copy-catalog-human guard test
affects:
  - 39-05 (wires run.human chrome header/dropdown-user/footer to these common.* keys — now resolvable)
  - 39-06 (verifies bib/human common.* subsets are byte-identical — asserted green here)
tech-stack:
  added: []
  patterns:
    - per-app copy-paste toolkit port (D-05 — no shared package, matches repo DonateModal convention)
    - snapshot `default` map as offline source-of-truth floor (D-07)
    - dual group-layout provider mount (run.human has no root layout)
key-files:
  created:
    - apps/run.human/webapp/src/lib/copy.ts
    - apps/run.human/webapp/src/lib/copy-core.ts
    - apps/run.human/webapp/src/lib/copy-markdown.tsx
    - apps/run.human/webapp/src/components/CopyProvider.tsx
    - apps/run.human/webapp/src/lib/copy-snapshot.json
    - apps/run.human/webapp/scripts/import-copy.mjs
    - apps/run.human/webapp/src/lib/__tests__/copy-catalog-human.test.ts
  modified:
    - apps/run.human/webapp/package.json
    - apps/run.human/webapp/src/app/(protected)/layout.tsx
    - apps/run.human/webapp/src/app/(public)/layout.tsx
decisions:
  - Authored ZERO human.* easy-win keys (D-06 bias-to-defer). All run.human chrome labels are already common.* (wired in 39-05); every remaining visible run.human string is deep-client-state coupled (CheckInModal / QR modal / logout modal) → MIGR-04. run.human snapshot = exactly the 17-key common.* union.
  - Toolkit ported verbatim (byte-identical to run.bib) via cp; @/* + resolveJsonModule in run.human tsconfig resolve the @/lib/copy-core + @/lib/copy-snapshot.json imports identically to bib — no import-path edits needed.
  - CopyProvider mounted INSIDE SessionProvider in each group layout, wrapping the MapBackground + Header/main/Footer flex column, mirroring bib's layout.tsx placement.
metrics:
  duration: ~15m
  completed: 2026-07-06
  tasks: 3
  files: 10
  commits: 4
status: complete
---

# Phase 39 Plan 02: Install Copy Toolkit into run.human + Shared Chrome Floor Summary

Installed the Phase 36 copy toolkit into **run.human** by verbatim copy-paste port (D-05 — per-app convention, not a shared package), authored run.human's offline snapshot floor carrying the **byte-identical `common.*` union** from 39-01 (D-07), ported the namespace-aware import script + `copy:import` package script, and mounted `<CopyProvider value={copy}>` in **both** run.human group layouts (run.human has no root layout). This is the gate that makes run.human's chrome wiring (39-05) resolvable and proves the de-dup win is reachable LIVE (SC-3). No run.human component words were changed — chrome wiring is 39-05.

## What Was Built

### Task 1 — port the 4 toolkit files verbatim (commit c2fc4100)
`cp`-ported from run.bib into run.human at matching paths, byte-identical:
- `src/lib/copy.ts` — server-only resolver; confirmed it reads `process.env.CMS_INTERNAL_URL` + `process.env.STRAPI_API_TOKEN` directly (the exact env run.human's `config.cms` already carries). No `import 'server-only'` literal added (Next 16 vendors it internally; the only occurrence is the explanatory comment). `renderCopy` escape-first whitelist unchanged.
- `src/lib/copy-core.ts` — client-safe `t` / `interpolate`.
- `src/lib/copy-markdown.tsx` — `renderCopy` escape-first + http/https/mailto scheme whitelist.
- `src/components/CopyProvider.tsx` — client `CopyProvider` + `useCopy`, imports only `@/lib/copy-core` + `@/lib/copy-snapshot.json` (never the server resolver).

The `@/lib/copy-core` and `@/lib/copy-snapshot.json` imports resolve identically in run.human because its tsconfig maps `@/*` → `./src/*` with `resolveJsonModule` on.

### Task 2 — snapshot floor + guard test + namespace-aware import (commit df099551)
- `src/lib/copy-snapshot.json`: `default` map with the **full 17-key `common.*` union** — values byte-identical to run.bib's `common.*` subset (verified programmatically; see Verification). Zero `human.*` keys (D-06 defer — see below).
- `src/lib/__tests__/copy-catalog-human.test.ts`: Test A (common.* key-floor: every union key resolves from snapshot `default`, non-empty; asserts snapshot carries ONLY the common.* union / zero non-common keys) + Test C (server→client token boundary: no `"use client"` component imports the server-only `@/lib/copy`). `srcRoot` resolves two levels up since the test lives at `src/lib/__tests__/`.
- `scripts/import-copy.mjs`: ported verbatim from run.bib — already namespace-aware (`namespaceForKey = key.split('.')[0]`, enum-guarded against `[common,human,auth,gpx,bib,flash]`). Reads `CMS_INTERNAL_URL` + `STRAPI_WRITE_TOKEN` at run time only; missing env → exit 1 before any CMS call; never logs the token; never uses the reserved `locale` query key. Relative snapshot path `../src/lib/copy-snapshot.json` resolves correctly under run.human/scripts.
- `package.json`: added `"copy:import": "node scripts/import-copy.mjs"`.

### Task 3 — mount CopyProvider in both group layouts (commit 420e3dd0)
- `(protected)/layout.tsx` and `(public)/layout.tsx`: each async server component calls `const copy = await loadCopy("default")` and wraps the existing `MapBackground` + Header/main/Footer flex column in `<CopyProvider value={copy}>`, mirroring bib's `layout.tsx` placement (inside `SessionProvider`). `loadCopy` from `@/lib/copy`, `CopyProvider` from `@/components/CopyProvider`.
- The `(public)` layout's silent-SSO / redirect logic (`hasAuthSession` + `redirect(...)`) is untouched — the wrap is purely additive, and `loadCopy` is placed after the redirect block so a redirecting request skips the copy fetch.
- Only the server-resolved copy MAP crosses to the client provider — never the resolver, token, or CMS URL.

## D-06 Easy-Wins Decision (zero human.* keys authored)

Per the D-06 guardrail (bias-to-defer; anything interpolation-heavy or bound to deep client state stays MIGR-04), **zero `human.*` keys were authored**. Rationale, verified against the run.human chrome components:
- Every run.human chrome label (`Maps` / `Meshtastic` / `Bib` / `Donate $` / `Who Am I` / `FAQ` / `Profile` / `My Bib` / `CMS` / `GPS Check-in` / `Show My QR` / `Logout` / `Credits`) is already a `common.*` key — it belongs to the shared union, not `human.*`, and gets wired in 39-05.
- The only remaining visible run.human prose lives in deep-client-state components explicitly fenced to MIGR-04: the Logout modal ("Logout?", the logout confirmation sentence), the Social-QR modal ("Your Social QR", "Loading QR Code…"), and CheckInModal internals. None are "clearly-static top-level labels with no interpolation and no deep client-state coupling," so all defer.

The run.human snapshot therefore carries exactly the 17-key `common.*` union — nothing more — keeping the byte-identity contract with run.bib crisp for 39-06.

## Deviations from Plan

**[Rule 3 — Blocking issue] run.human/webapp had no node_modules.** The ported toolkit's `react` / `next/cache` imports failed typecheck because the app's dependencies were not installed. Ran `npm ci` (restores the app's OWN already-declared dependencies from the committed package-lock.json — NOT a new/unknown package install, so the Rule 3 package-manager exclusion does not apply). This was environment setup required to run the tsc / vitest / next-build verifications. No dependency versions changed; package.json's dependency set is untouched (only the `copy:import` script was added, per Task 2).

No other deviations — Rules 1, 2, 4 not triggered. No rendered run.human words changed.

## Verification

- **common.* byte-identity (D-07 / 39-06 precondition):** programmatic compare of the `common.*` subset of run.human vs run.bib snapshots → **BYTE-IDENTICAL (17 keys)**; run.human snapshot has **0** non-common keys.
- **Task 1 typecheck:** `npx tsc --noEmit` → no errors originating in `src/lib/copy*` or `src/components/CopyProvider` (grep-exit=1, PASS) after `npm ci`.
- **Task 2 guard test:** `npx vitest run src/lib/__tests__/copy-catalog-human.test.ts` (node v23.6.0) → **3 passed** (common.* floor + union-only + token-boundary Test C).
- **Task 2 snapshot floor assertion:** node one-liner for `common.header.maps/donate`, `common.profileMenu.profile/logout`, `common.footer.credits` → exit 0.
- **Task 2 import token-safety guard:** `env -u STRAPI_WRITE_TOKEN -u CMS_INTERNAL_URL node scripts/import-copy.mjs` → prints one-line reason, exits 1, no CMS call.
- **Task 3 build:** `npx next build` (node v23.6.0) → **succeeded**, 17/17 routes generated; CopyProvider mounted in both group layouts.
- **Both layouts reference CopyProvider:** `grep -rl CopyProvider` returns both `(protected)/layout.tsx` and `(public)/layout.tsx`.
- **(public) redirect logic unchanged:** diff shows only additive copy wiring + JSX re-indentation under the new provider; `hasAuthSession`/`redirect` untouched.
- **Server→client token boundary:** copy.ts reads the token via call-time `process.env`, never `NEXT_PUBLIC_*`; CopyProvider imports only client-safe modules; Test C grep-gate green.

## Known Stubs

None. The toolkit is installed and mounted; run.human chrome components are intentionally NOT rewired in this plan (that is 39-05). The mounted provider currently supplies copy that no run.human component reads yet — this is the designed gate, not a stub.

## Self-Check: PASSED

- All 7 created files + 3 modified files present on disk.
- Commits c2fc4100, df099551, 420e3dd0 present in git log.
