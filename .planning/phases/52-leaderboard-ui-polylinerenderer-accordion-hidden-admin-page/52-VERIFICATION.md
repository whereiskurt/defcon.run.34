---
phase: 52-leaderboard-ui-polylinerenderer-accordion-hidden-admin-page
verified: 2026-07-14T02:30:00Z
status: human_needed
score: 3/4 must-haves verified
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:
  - truth: "SC3 — Expanding a row renders each run's <canvas> thumbnail from its stored {lat,lng} polyline (OSM tile + route + green-start/red-end dots), with the current admin's own row highlighted."
    test: "Run run.human locally against local DynamoDB, sign in as an admin, open /leaderboard, expand a runner row that has a GPX/check-in run with a stored metadata.polyline."
    expected: "A <canvas> thumbnail draws one OSM tile behind the route with a green start dot and a red end dot (dark-mode filter in dark theme; route still draws if the tile 404s). The current admin's own accordion row shows the green highlight (bg-green-400/20)."
    why_human: "Canvas pixel output and the HeroUI accordion expand interaction are inherently not unit-testable — the draw pipeline and wiring are code-verified + tsc-clean, but the rendered image and the visible highlight require a browser. This is the expected end-of-milestone local-browser checkpoint, not a gap."
human_verification:
  - test: "Local-browser checkpoint (orchestrator drives run.human vs local DynamoDB): (1) non-admin/signed-out GET /leaderboard, (2) admin GET /leaderboard, (3) admin expands a row with a stored polyline."
    expected: "(1) 404 (bare notFound, never a 403, never the page). (2) Ranked HeroUI accordion renders (rank / globalScore 🥕 / name+emoji / count chips). (3) Each run shows a <canvas> OSM-tile thumbnail with green-start/red-end dots; the admin's own row is green-highlighted."
    why_human: "Runtime gate outcome (404 vs render) and canvas/accordion visuals cannot be exercised by grep or a Node unit test. The gate CODE is verified (both denial paths present, mirrors the Phase-43 admin gate that is already live-smoke-verified); this checkpoint confirms the runtime + visual payoff."
---

# Phase 52: Leaderboard UI — PolylineRenderer + Accordion + Hidden Admin Page Verification Report

**Phase Goal:** The DC33 look, ported — a client-canvas `PolylineRenderer`, a HeroUI `LeaderboardTable` accordion, and a hidden admin page at `(protected)/leaderboard/page.tsx` (`requireAdmin`→`notFound()` + `revalidateAdmin`), linked from no navigation.
**Verified:** 2026-07-14
**Status:** human_needed (all code delivered, wired, and gated; one inherent runtime/visual browser checkpoint remains)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (Success Criterion) | Status | Evidence |
|---|---------------------------|--------|----------|
| SC1 | Non-admin visiting `/leaderboard` gets 404; admin sees the ranked accordion | ✓ VERIFIED | `page.tsx` gate mirrors the live-verified Phase-43 admin page: `const gate = requireAdmin(session); if (!gate.ok) notFound();` (denial path 1 — no_session/not_admin) then `const authUserId = session?.user?.authUserId; if (!authUserId || !(await revalidateAdmin(authUserId))) notFound();` (denial path 2 — fail-closed live claims). `revalidateAdmin` keyed by `authUserId` (OIDC sub). Admin path renders `<LeaderboardTable>`. `requireAdmin`/`revalidateAdmin` come from the verified `@/lib/admin-gate`. Runtime 404/render confirmation folded into the browser checkpoint. |
| SC2 | Board renders no navigation entry anywhere — grep-verifiable | ✓ VERIFIED | `leaderboard-hidden.test.ts` recursively scans **all of** `src/components` + `src/app` (broader than header-only), excludes the feature's own files, guards `expect(files.length).toBeGreaterThan(0)`, and asserts zero files match a path-boundary `/leaderboard` regex. Test passes 2/2. `git diff b10e0b1b..HEAD -- src/components/header/` is empty — no header/dropdown/menu file was modified. |
| SC3 | Expanding a row renders each run's `<canvas>` thumbnail from its stored polyline (OSM tile + route + start/end dots); own row highlighted | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Wiring fully verified: `LeaderboardTable` lazy-fetches `${apiBase}/api/leaderboard/${userId}/accomplishments` on `onSelectionChange`, and when `metadata.polyline.length > 1` renders `<PolylineRenderer points={polyline!} theme={theme} />`. `PolylineRenderer` takes `{lat,lng}[]` objects (no Google decode), uses `computeBounds`/`centerTile` from the tested seam, fetches one OSM tile (`crossOrigin='anonymous'`), applies the DC33 dark-mode filter, draws white-halo route + green `#10B981` start / red `#EF4444` end dots, and falls back to route-only on `tileImage.onerror`. Own-row highlight `row.userId === currentUserId` → `bg-green-400/20`. **Canvas pixel output + accordion expand interaction are inherently browser-only** → local-browser checkpoint (expected, not a gap). |
| SC4 | Rank/score/count chips match the API; runner-class emoji reflect `mqttUsertype` | ✓ VERIFIED | Title renders `#{globalRank}`, a `{globalScore} 🥕` chip when `> 0`, `runnerClassEmoji(row.mqttUsertype)`, and `deriveCountChips(row)` (activity = checkin+gpx green, ctf = ctfSolves orange, both `?? 0` graceful). Pure seams unit-tested (7/7). The component's `LeaderboardRow` type matches the Phase-51 `leaderboard-data.ts` DTO field-for-field (`globalRank, userId, displayName?, mqttUsertype?, globalScore, activityCounts:{checkin,gpx}, ctfSolves`). |

**Score:** 3/4 truths verified; 1 present (SC3 — wired, canvas/accordion visual pending the browser checkpoint).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/polyline-geometry.ts` | Pure bounds/zoom/center-tile seam | ✓ VERIFIED | 97 lines, pure (no DOM/fetch/React); `computeBounds`/`latLngToTile`/`calculateZoomLevel`/`centerTile`; 14 unit tests pass. Imported by `PolylineRenderer`. |
| `src/components/leaderboard/PolylineRenderer.tsx` | Client canvas thumbnail | ✓ VERIFIED | 235 lines, `'use client'`; imports `computeBounds`/`centerTile` from seam; OSM tile + route + start/end dots + dark-mode filter + tile-error fallback; consumed by `LeaderboardTable`. |
| `src/lib/leaderboard-ui.ts` | Pure emoji + chip seams | ✓ VERIFIED | 76 lines, pure; `runnerClassEmoji` (⭐️/🤠 DC33 parity + 🐇/🛡️ DC34), `deriveCountChips` (0-graceful); 7 unit tests pass; imported by `LeaderboardTable`. |
| `src/components/leaderboard/LeaderboardTable.tsx` | HeroUI accordion | ✓ VERIFIED | 439 lines, `'use client'`; Accordion `selectionMode="multiple" variant="bordered" isCompact`; imports both seams + `PolylineRenderer`; apiBase-prefixed fetches; search/fast-filter/pagination; own-row highlight. |
| `src/app/(protected)/leaderboard/page.tsx` | Hidden gated server page | ✓ VERIFIED | 59 lines; `requireAdmin`→`notFound()` + `revalidateAdmin(authUserId)`→`notFound()`; renders `<LeaderboardTable currentUserId={session.user.id} apiBase={apiBase()} />`. |
| `src/lib/leaderboard-hidden.test.ts` | No-nav assertion test | ✓ VERIFIED | 106 lines; broad `src/components`+`src/app` scan, feature-file exclusion, `>0` guard, path-boundary regex; 2/2 pass. |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| `PolylineRenderer.tsx` | `lib/polyline-geometry.ts` | `import { computeBounds, centerTile }` — draws from tested seam, no inline math | ✓ WIRED |
| `PolylineRenderer.tsx` | input contract | `points: LatLng[]` objects, `points.map(({lat,lng}) => [lat,lng])` — NO Google decode | ✓ WIRED |
| `LeaderboardTable.tsx` | `lib/leaderboard-ui.ts` | `import { deriveCountChips, runnerClassEmoji }` | ✓ WIRED |
| `LeaderboardTable.tsx` | `PolylineRenderer.tsx` | `<PolylineRenderer points={polyline!} theme={theme} />` fed `metadata.polyline` | ✓ WIRED |
| `LeaderboardTable.tsx` | Phase-51 API | `fetch(\`${apiBase}/api/leaderboard...\`)` — apiBase prop = basePath landmine handled | ✓ WIRED |
| `page.tsx` | `@/lib/admin-gate` | `requireAdmin`→`notFound()`; `revalidateAdmin(authUserId)`→`notFound()` | ✓ WIRED |
| `page.tsx` | `LeaderboardTable.tsx` | `<LeaderboardTable currentUserId={session.user.id} apiBase={apiBase()} />` | ✓ WIRED |

### Boundary / Landmine Checks

| Check | Status | Evidence |
|-------|--------|----------|
| UI-only — no API/scoring/entity change | ✓ | `git diff b10e0b1b..HEAD -- src/` = exactly the 8 planned UI files; `accomplishment.ts`, `run-user.ts`, `leaderboard-scoring.ts`, `leaderboard-data.ts`, `app/api/leaderboard/` all untouched. |
| basePath handled | ✓ | `apiBase()` region helper in `page.tsx` (prod `/use1`, dev '') → threaded as prop → all `LeaderboardTable` fetches use `${apiBase}/api/leaderboard...`. |
| Identity landmine (both axes) | ✓ | Gate: `revalidateAdmin(session.user.authUserId)` (OIDC sub). Highlight: `currentUserId={session.user.id}` (adapter uuid = RunUser.userId). Both correct and deliberately different. |
| No nav link added | ✓ | `header/` untouched (git); `leaderboard-hidden.test.ts` asserts it. |
| No profile widget / privacy change / CTF write | ✓ | No profile/whoami files touched; component only reads score/count/name/class DTO fields; no privacy filter or CTF write introduced. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status |
|-------------|-------------|-------------|--------|
| LDBR-09 | 52-01 | PolylineRenderer client-canvas thumbnail (OSM tile + route + start/end dots + dark-mode; DC33 port) | ✓ SATISFIED (canvas pixel draw → browser checkpoint) |
| LDBR-10 | 52-02 | LeaderboardTable accordion (rank/score/name/chips, highlight, search/filter, pagination, expand→thumbnails; emoji from mqttUsertype) | ✓ SATISFIED (expand visual → browser checkpoint) |
| LDBR-11 | 52-03 | Hidden admin page (`requireAdmin`→`notFound()` + `revalidateAdmin`; not linked in any nav) | ✓ SATISFIED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Pure geometry + UI + hidden-nav tests | `npx vitest run src/lib/polyline-geometry.test.ts src/lib/leaderboard-ui.test.ts src/lib/leaderboard-hidden.test.ts` | 3 files, **23 passed** (14+7+2) | ✓ PASS |
| Typecheck | `npx tsc --noEmit` | Only the 2 known pre-existing out-of-scope errors (`dropdown-user.tsx` svg import; `entities/__tests__/checkin.test.ts` `.model` ×3 lines) — **no phase-52 file** | ✓ PASS |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `LeaderboardTable.tsx` | 207 | `placeholder="Keyword Search"` | ℹ️ Info | Legitimate HTML `<Input>` placeholder attribute — not a stub/debt marker. |

No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK` debt markers in any phase-52 file. No empty-return stubs; empty-state copy ("No runs yet.") and spinners are intentional UI states wired to the live API.

### Human Verification Required

**1. Local-browser checkpoint (orchestrator drives run.human vs local DynamoDB)** — bundles the two inherently-runtime items:
- **SC1 runtime gate:** non-admin/signed-out `/leaderboard` → 404; admin → ranked accordion. (Gate CODE is verified and mirrors the Phase-43 admin page already live-smoke-verified as 404-without-session / 200-with-admin.)
- **SC3 canvas + interaction:** expand a runner row with a stored polyline → `<canvas>` OSM-tile thumbnail with green-start/red-end dots renders; the admin's own row shows the green highlight.

This is the expected end-of-milestone browser check, not a gap — the code is complete, wired, tsc-clean, and unit-tested where testable.

### Gaps Summary

No gaps. All six artifacts exist, are substantive, are wired, and pass the automated gates (23 vitest, tsc clean modulo the 2 documented pre-existing out-of-scope errors). Scope is strictly the 8 planned UI files — no entity/scoring/API/nav files were modified, both identity axes are correct, and the basePath landmine is handled. The only outstanding item is the inherent runtime/visual browser checkpoint (SC1 live 404/render + SC3 canvas draw + accordion expand), which the orchestrator runs next.

---

_Verified: 2026-07-14T02:30:00Z_
_Verifier: Claude (gsd-verifier)_
