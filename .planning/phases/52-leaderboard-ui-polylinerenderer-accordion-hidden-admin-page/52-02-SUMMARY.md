---
phase: 52-leaderboard-ui-polylinerenderer-accordion-hidden-admin-page
plan: 02
subsystem: run.human leaderboard UI
tags: [leaderboard, accordion, heroui, chips, LDBR-10, dc33-port]
requires:
  - GET /api/leaderboard (Phase 51 — { rows, total, page, limit })
  - GET /api/leaderboard/[userId]/accomplishments (Phase 51 — { accomplishments })
  - components/leaderboard/PolylineRenderer (Phase 52 plan 01)
provides:
  - lib/leaderboard-ui (runnerClassEmoji + deriveCountChips — pure seams)
  - components/leaderboard/LeaderboardTable (client accordion component)
affects:
  - Phase 52 plan 03 hidden admin page (renders <LeaderboardTable currentUserId apiBase/>)
tech-stack:
  added: []
  patterns:
    - pure UI seams (emoji map + chip derivation) extracted for unit-testability
    - client accordion consuming Phase-51 API as-shipped (no backend change)
    - apiBase-prefixed fetches (basePath landmine) mirroring AdminConsole
    - theme via next-themes useTheme(resolvedTheme) → PolylineRenderer
key-files:
  created:
    - apps/run.human/webapp/src/lib/leaderboard-ui.ts
    - apps/run.human/webapp/src/lib/leaderboard-ui.test.ts
    - apps/run.human/webapp/src/components/leaderboard/LeaderboardTable.tsx
  modified: []
decisions:
  - "runnerClassEmoji DC34 extension: rabbit → 🐇, admin → 🛡️ (DC33 kept ⭐️/🤠)"
  - "deriveCountChips always returns exactly [activity(green), ctf(orange)], 0-graceful"
  - "Skipped DC33's useSearchParams/router URL-sync — simpler local search state, no Suspense boundary needed"
  - "'you' fast-filter chip shown only when the admin's own row is on the loaded page (API returns no separate currentUser)"
  - "Single-line accordion title layout (DC33 had mobile 2-line + desktop 1-line); count chips from the tested seam, no re-sort"
metrics:
  tasks: 2
  files: 3
  duration: ~10m
  completed: 2026-07-14
status: complete
requirements: [LDBR-10]
---

# Phase 52 Plan 02: LeaderboardTable HeroUI accordion + pure UI seams Summary

Ported DC33's `LeaderboardTable` to run.human (LDBR-10) as a `'use client'` HeroUI
`Accordion selectionMode="multiple" variant="bordered" isCompact` driven by the
Phase-51 API as-shipped, and extracted the two presentation seams (runner-class
emoji + count-chip derivation) into a pure, unit-tested `lib/leaderboard-ui.ts`.
Each row is a runner (rank / `globalScore` 🥕 / displayName + class emoji / count
chips); the current admin's own row is green-highlighted; search + fast-filter chips
+ pagination narrow the page; expanding a row lazy-fetches that runner's runs and
renders each with a `PolylineRenderer` thumbnail from `metadata.polyline`.

## What was built

- **`lib/leaderboard-ui.ts`** — two PURE functions, no React/DOM:
  - `runnerClassEmoji(mqttUsertype?)` → `⭐️` (wildhare), `🤠` (og) DC33 parity;
    DC34 additions `🐇` (rabbit — bunny mascot), `🛡️` (admin — steward shield);
    `''` for undefined/unknown (no stray trailing glyph).
  - `deriveCountChips(row)` → `[{key:'activity', count:checkin+gpx, color:'success'},
    {key:'ctf', count:ctfSolves, color:'warning'}]`, both `?? 0` so absent fields
    render 0 (never undefined/NaN) — the CTF chip stays graceful until the CTF judge ships.
- **`lib/leaderboard-ui.test.ts`** — 7 vitest cases (RED→GREEN) covering every behavior
  bullet: wildhare/og parity, rabbit/admin non-empty, undefined/unknown → '', the
  3+2=5 activity / 4 ctf derivation, absent-fields → 0, partial activityCounts, and the
  stable `[activity, ctf]` order/colors. Mirrors `leaderboard-data.test.ts`.
- **`components/leaderboard/LeaderboardTable.tsx`** — `'use client'` accordion. Props
  `currentUserId` (own-row highlight) + `apiBase` (region prefix). On mount + page/filter
  change it fetches `${apiBase}/api/leaderboard?page&limit&filter` and reads
  `{ rows, total, page, limit }` (limit default 25). Per-row title: `#{globalRank}`, a
  `{globalScore} 🥕` chip when score > 0, displayName + `runnerClassEmoji(mqttUsertype)`,
  and the `deriveCountChips(row)` chips (activity green, ctf orange). DC33 green highlight
  (`bg-green-400/20 dark:bg-green-500/30 …`) when `row.userId === currentUserId`. On
  `onSelectionChange` it lazy-fetches `${apiBase}/api/leaderboard/${userId}/accomplishments`
  once per user (cached), showing a Spinner; each run renders name + a source badge
  (STRAVA/GPX/CHECKIN) + `formatDate(completedAt)` + description, with a two-column layout
  and a `<PolylineRenderer points={metadata.polyline} theme={…} />` when the polyline is a
  non-empty array, single-column otherwise, and a "No runs yet." empty state. Bottom
  HeroUI `Pagination` when `total` exceeds one page. Search Input + Search/Clear buttons +
  `you / ⭐️ Wild Hares / 🤠 OG` fast-filter chips.

## Key links (from must_haves)

- `LeaderboardTable` imports `runnerClassEmoji` + `deriveCountChips` from `lib/leaderboard-ui`
  (the tested seam) — no inline emoji/chip logic.
- `LeaderboardTable` imports `PolylineRenderer` (plan 01) and feeds it
  `metadata.polyline` `{lat,lng}[]` objects directly (no decode).
- All fetches are `${apiBase}/api/leaderboard...` — the basePath landmine, mirroring
  AdminConsole's `apiBase` pattern (prod `/use1`, dev '').

## Verification

- `npx vitest run src/lib/leaderboard-ui.test.ts` — 7/7 pass (Node 23.6.0).
- `npx tsc --noEmit` — NO error in `LeaderboardTable.tsx` or `leaderboard-ui.ts`. Only the
  2 known pre-existing out-of-scope errors remain (`dropdown-user.tsx` `@public/.../dcjack.svg`
  import; `entities/__tests__/checkin.test.ts` `.model`) — neither in a phase-52 file.
- Manual/local browser render is deferred to the orchestrator's end-of-phase check (plan 03
  wires the page + apiBase and runs run.human against local DynamoDB).

## Deviations from Plan

Auto-fixes applied (none material):

**1. [Rule 3 — Blocking] `apiBase` prop threaded from the caller, not read from env**
- The component takes `apiBase` as a prop (plan 03 passes it). No deviation from the plan
  intent — documented here because the "you" fast-filter derives the admin's displayName
  from the loaded rows (the Phase-51 API returns no separate `currentUser` object), so the
  "you" chip only appears when the admin's own row is on the current page. This is within
  the plan's "Claude's discretion for the filter-chip set."

**2. [simplification] Dropped DC33's `useSearchParams`/`router.replace` URL sync**
- DC33 mirrored the filter into the URL query. Kept search purely in local state — avoids a
  Next.js Suspense boundary requirement for `useSearchParams` and keeps the component boring.
  Search/Clear/fast-filter all reset to page 1. Functionally equivalent for the hidden board.

Otherwise the plan executed as written.

## Known Stubs

None. The empty-state copy ("No runs yet.") and the loading spinners are intentional UI
states, not data stubs — every rendered field is wired to the live Phase-51 API. The
`ctfSolves` chip renders 0 by design until the CTF judge worktree ships (LDBR-12), which is
the documented graceful-zero contract, not a stub.

## Self-Check: PASSED

- FOUND: apps/run.human/webapp/src/lib/leaderboard-ui.ts
- FOUND: apps/run.human/webapp/src/lib/leaderboard-ui.test.ts
- FOUND: apps/run.human/webapp/src/components/leaderboard/LeaderboardTable.tsx
- FOUND commit e28dccfd (test RED), 8026a669 (feat GREEN), 39c595be (feat component)
