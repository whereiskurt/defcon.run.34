---
phase: v1.8 Phase 4 — Check-in personalization & map filters
status: BUILT (2026-07-04, branch gsd/gpx-pins-filters) — PR open, awaiting Kurt review
depends_on: PR #368 (merged 2026-07-04)
---

# v1.8 Phase 4 — Check-in personalization & map filters

**One-liner:** Runners pick their check-in pin (curated icon + any color, DC34
palette first), with secret icons gated by services (gold star for admins);
the public map gains time chips and runner-highlight filters.

## Kurt's decisions (2026-07-04)

- **Pin choice lives in BOTH places:** profile default (`RunUser.preferences`)
  + per-check-in override in the check-in modal ("gold star this event").
- **Curated icons + any color.** No user-supplied SVG (public-map abuse risk).
  Color = full hex picker that **leads with the DC34 palette as one-tap
  swatches** (brand colors easy, exact bunny color possible).
- **Secret pins gated by services tag now, unlock codes later.** Catalog
  entries carry `requiredService` (e.g. gold star → `admin`, or a `vip` tag
  granted via run.auth). Design leaves room for a later `unlockedPins: string[]`
  on RunUser (validation becomes services-OR-unlocked) with no schema break.
- **One phase, one PR** — pins + time chips + runner highlight together (same
  files: public API, overlay layer, layer control).

## Spec

### 1. Icon catalog (curated, gated)

Shared module defining ~9 pin icons — bunny (DEFAULT), star, flag, skull, paw,
lightning, diamond, crown, gold-star(`requiredService`) — each a parameterized
SVG `svg(color: string)` with a stable `id`. Mirrored between run.human and the
studio the same way `dc34-palette.ts` is (separate builds; parity comment both
sides). Picker only shows gated entries when `session.user.services` includes
`requiredService`; server enforces the same rule.

### 2. Data model

- `RunUser.preferences` += `pinIcon?: string`, `pinColor?: string` (profile identity).
- `CheckIn` += `pinIcon?: string`, `pinColor?: string` — **denormalized at
  creation** so history is immutable (recolor your bunny later, old pins keep
  their look; a gold-starred event stays gold-starred).
- Missing fields → today's default pin. Existing check-ins unaffected.

### 3. API

- `POST /api/checkins`: accepts `pinIcon`/`pinColor`; validates icon id against
  catalog + service gate, color as `#rrggbb`; defaults from profile prefs when
  omitted.
- Profile prefs endpoint extended for `pinIcon`/`pinColor` (same validation).
- `GET /api/checkins/public`: projects `pinIcon`/`pinColor`; gains
  `?since=<epoch-ms>` and switches from rolling-200 caps to a **time-window
  query** on the `byGlobalRecent` GSI (sort key is already timestamp) with a
  sane hard cap (~5000). Also resolves the event-scale cap concern from
  Phase 3 review (~4k check-ins over the con).
- run.gpx proxy passes `since` through — the three chip values map to three
  CDN-cacheable URLs (120s cache unchanged).

### 4. Studio rendering

- Check-in feature properties += `pinIcon`, `pinColor`; register map images on
  demand per unique (icon, color) pair (`dc34-checkin-<icon>-<hex>`); symbol
  layer switches to `icon-image: ['get', 'iconId']`. Clusters unchanged (teal
  count bubbles). Popup unchanged (optionally shows the icon).

### 5. Picker UI (run.human)

- Profile settings: icon grid + color picker (DC34 swatches row on top, free
  hex below). Secret icons appear only when unlocked/gated-in.
- `CheckInModal.tsx`: same picker, pre-filled from profile, swappable for just
  that check-in.

### 6. Map filters (studio layer control, under the User Check-ins toggle)

- **Time chips:** `Hour / Today / Whole con` — instant client-side
  `map.setFilter` on the timestamp property; data fetched with `since=` event
  start by default.
- **Runner highlight:** click a runner's name in a pin popup → show only their
  check-ins (`setFilter` on displayName), with a "showing only <name> ✕" clear
  chip in the layer control.

### 7. Testing & verification

- Vitest: icon/color validation, service gating (secret icon rejected without
  the service), public projection includes pin fields + never leaks userId,
  `since` windowing.
- Extend `apps/run.human/webapp/scripts/seed-local-checkins.mts` with varied
  pins; visual verify via the local recipe
  (memory `reference_gpx_overlay_local_verify`).

### Out of scope (later phases)

- Unlock codes for secret pins (design accommodates via `unlockedPins`).
- Time-lapse/animation mode, leaderboard widget, live auto-refresh.

## Build result (2026-07-04)

Implemented as specced on `gsd/gpx-pins-filters`. Verified: 26/26 vitest
(16 new), tsc clean both webapps, studio build clean, svelte-check errors all
pre-existing. VISUALLY VERIFIED on the local stack: varied pins render
(bunny/star/skull/flag/paw/bolt/crown + gold star staying gold), time chips
filter with honest re-clustering (Hour→0, Whole con→9), runner highlight
via popup name click + clear chip. Picker UI (profile card + modal) covered
by tests/typecheck only — needs an authenticated session to eyeball.

## Build notes

- Branch off **main after PR #368 merges** (this builds directly on the
  overlay code; don't stack PRs).
- REVIEW_REQUIRED — v1.8 scope needs Kurt's review before merge.
- Deploy: run.human + run.gpx images (no new infra beyond Phase 3's
  `RUN_HUMAN_INTERNAL_URL` terragrunt apply).
