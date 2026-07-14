# Phase 52: Leaderboard UI — PolylineRenderer + Accordion + Hidden Admin Page - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning
**Source:** Design spec §8.2 + DC33 source (the components Kurt specifically loved — port faithfully) + Phase 51 API contract

<domain>
## Phase Boundary

**run.human-only, UI only — the final phase of v2.2.** A faithful port of the
DC33 leaderboard the user explicitly wants reproduced ("it was so well designed…
bring it all back exactly"):

- `PolylineRenderer` — a client `<canvas>` thumbnail: one OpenStreetMap tile +
  the route polyline + green-start/red-end dots + a dark-mode canvas filter.
- `LeaderboardTable` — a HeroUI `Accordion` where each row is a runner (rank /
  `globalScore` 🥕 / display name / count chips), the current admin's own row
  highlighted; search + fast-filter chips; pagination; expanding a row
  lazy-loads that runner's runs, each with a `PolylineRenderer` thumbnail.
- The page at `(protected)/leaderboard/page.tsx` — admin-gated
  (`requireAdmin` → `notFound()` + `revalidateAdmin` on entry) and **linked from
  NO navigation** (hidden until launch).

**NOT in this phase:** no new API/scoring/entity work (all shipped in Phases
49-51); no nav link anywhere; no profile rank widget (launch-time); no privacy
changes; no CTF work.
</domain>

<decisions>
## Implementation Decisions (LOCKED — faithful DC33 port, adapted to DC34)

### Port these three DC33 files (read them; reproduce the look)
DC33 root: `/Users/khundeck/working/defcon.run.33/apps/nx/apps/webapp/src`
- `components/routes/PolylineRenderer.tsx` (canvas + single OSM tile + zoom calc +
  white-halo route + green start / red end markers + dark-mode filter
  `invert(1) hue-rotate(180deg) …`).
- `components/leaderboard/LeaderboardTable.tsx` (HeroUI `Accordion
  selectionMode="multiple" variant="bordered" isCompact`; per-row rank + points
  🥕 chip + name + count chips; current-user green highlight
  `bg-green-400/20`; search + fast-filter chips; lazy accomplishments on expand;
  two-column run layout with the thumbnail).
- `app/(headfoot)/leaderboard/page.tsx` (server component shell).

### DC34 adaptations (the important deltas)
- **Data source = Phase 51 API (already shipped):**
  - `GET /api/leaderboard?page&limit&filter` → `{ rows: [{ globalRank, userId,
    displayName, mqttUsertype, globalScore, activityCounts:{checkin,gpx},
    ctfSolves }], page, limit, total }`.
  - Expand → `GET /api/leaderboard/[userId]/accomplishments` →
    `{ accomplishments: [{ type, source, name, description, completedAt, year,
    metadata:{ polyline, distance, elevation, gpxFileId, ... } }] }`.
  Both are admin-gated (404 otherwise) — the page is already behind the same gate,
  so a signed-in admin's fetches succeed.
- **Score chip:** `globalScore` 🥕 (DC33 used `totalPoints` 🥕). Count chips:
  activity = `activityCounts.checkin + activityCounts.gpx` (green/success), CTF =
  `ctfSolves` (warning/orange). `ctfSolves` may be 0/absent until the CTF judge
  ships — render 0 gracefully.
- **Runner-class emoji from `mqttUsertype`** (`rabbit`/`admin`/`wildhare`/`og`) —
  DC33 mapped `mqtt_usertype` to ⭐️ (wildhare) / 🤠 (og); keep that mapping,
  extend for rabbit/admin as sensible. Put the mapping in a PURE helper.
- **PolylineRenderer input is simpler than DC33:** DC34's polyline is already an
  array of `{lat,lng}` OBJECTS (from `Accomplishment.metadata.polyline`, produced
  in Phase 50). So the renderer takes `points: {lat,lng}[]` directly — NO
  Google-polyline decode needed (drop DC33's `decodePolyline`). Keep the bounds →
  zoom → single-tile math and the draw logic.
- **Theme:** inherit run.human's existing HeroUI + Tailwind tokens (the app's
  `AdminConsole.tsx` uses `bg-content1`, `text-primary` teal, `border-divider`).
  Keep DC33's semantic colors (green highlight, 🥕, success/warning chips) but let
  everything else ride the app theme. Support light + dark (the canvas dark-mode
  filter handles the thumbnail).

### The hidden admin page (LDBR-11)
- `apps/run.human/webapp/src/app/(protected)/leaderboard/page.tsx` — server
  component: `const g = requireAdmin(session); if (!g.ok) notFound();` then
  `await revalidateAdmin(session.user.authUserId)` (authUserId, NOT session.user.id
  — the identity landmine) and `notFound()` on failure. Mirror the Phase-43
  `(protected)/admin/page.tsx` gate exactly.
- **NO navigation entry anywhere** — do not touch `header.tsx`,
  `dropdown-user.tsx`, or any menu. (Note: a separate v1.6 effort is REMOVING an
  old dead Leaderboard nav link; do not re-add one.) A test/grep should assert the
  string `/leaderboard` appears in no nav component.
- Renders `<LeaderboardTable currentUserId={session.user.id} />` (client
  component does the fetching/pagination/expand).

### Testable pure seams (mirror the Phase 49-51 convention)
Extract and unit-test (no canvas/DOM needed):
- runner-class emoji mapping (`mqttUsertype` → emoji).
- count-chip derivation (`activityCounts` + `ctfSolves` → chip numbers).
- polyline bounds + zoom + center-tile math (pure geometry from `{lat,lng}[]`).
The canvas draw + the accordion wiring are proven by `tsc --noEmit` + the
end-of-milestone local browser check (the orchestrator runs run.human locally
against local DynamoDB and confirms the page renders for an admin, 404s for a
non-admin).

### Claude's Discretion
- Exact chip colors/labels within the DC33 palette; skeleton/loading states;
  empty-state copy ("no runs yet").
- Whether the fetching lives in `LeaderboardTable` or a small hook.
- Page size default (DC33 used 25) and filter-chip set (`you` / `wildhare` / `og`).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design spec
- `docs/superpowers/specs/2026-07-13-leaderboard-activity-table-design.md` §8.2
  (UI), §3 (admin-gated + hidden), §9 (privacy deferred — not here).

### DC33 source to port (read-only, different repo — reproduce the look)
- `/Users/khundeck/working/defcon.run.33/apps/nx/apps/webapp/src/components/routes/PolylineRenderer.tsx`
- `/Users/khundeck/working/defcon.run.33/apps/nx/apps/webapp/src/components/leaderboard/LeaderboardTable.tsx`
- `/Users/khundeck/working/defcon.run.33/apps/nx/apps/webapp/src/app/(headfoot)/leaderboard/page.tsx`

### DC34 targets + patterns (this repo)
- NEW: `apps/run.human/webapp/src/components/leaderboard/PolylineRenderer.tsx`,
  `.../LeaderboardTable.tsx`, `apps/run.human/webapp/src/app/(protected)/leaderboard/page.tsx`.
- Gate pattern to mirror: `apps/run.human/webapp/src/app/(protected)/admin/page.tsx` + `AdminConsole.tsx` (Phase 43 — plain-table admin surface, `requireAdmin`→`notFound()`, `revalidateAdmin`).
- Phase 51 API shapes: `apps/run.human/webapp/src/lib/leaderboard-data.ts` (row DTO), `app/api/leaderboard/route.ts`, `app/api/leaderboard/[userId]/accomplishments/route.ts`.
- HeroUI is already a dep (`@heroui/react`); the app uses `Accordion`, `Chip`, `Pagination`, `Card`, `Avatar`, `Skeleton`, `Input`, `Button`.
- Existing "my runs" surface for reference: `apps/run.human/webapp/src/components/profile/CheckInHistory.tsx`.
</canonical_refs>

<specifics>
## Specific Ideas
- The current admin's own row must be visually highlighted (DC33 `bg-green-400/20`)
  — that IS the "my runs" affordance.
- `PolylineRenderer` fetches ONE OSM tile with `crossOrigin="anonymous"`; on tile
  error, still draw the polyline (DC33 fallback). Reduced-motion is irrelevant
  (static canvas).
- Fidelity to DC33 beats novelty here — Kurt loved the existing design; match it,
  don't redesign it. Let it inherit run.human's theme tokens.
- The page must appear in NO nav — this is the "ships hidden" guarantee.
</specifics>

<deferred>
## Deferred Ideas (launch-time, NOT this phase)
- Nav link + gate relaxation (admin-only → signed-in) → launch flip.
- Profile rank widget on whoami → launch flip (would leak the hidden feature).
- Privacy filter on other runners' private runs → spec §9 (the API already has the
  marked no-op hook).
</deferred>

---

*Phase: 52-leaderboard-ui-polylinerenderer-accordion-hidden-admin-page*
*Context gathered: 2026-07-14 from spec + DC33 source + Phase 51 API contract*
