# PayPhone beacon + Goldstein unlock-seed popup — Design

**Date:** 2026-07-27 · **Apps:** run.gpx (map + feed), run.human (internal endpoint)

Two CTF clues published on the gpx.defcon.run map:

1. A **☎️ PayPhone beacon at The Strat** whose popup says "Call me! 725-404-3234".
2. **Goldstein's ghost popup carries his DM-unlock TOTP seed** (base32 + authenticator
   QR), and his map pin goes **gold** so players are drawn to click him.

## 1. PayPhone beacon (run.gpx only)

Clone of the `the-spot.ts` beacon pattern (bobbing emoji + conic-gradient rays +
pill label + egg-modal click; no unlock, no covert CTF egg — Kurt's call: the
reward is on the other end of the line).

- `apps/run.gpx/gpx-studio/website/src/lib/components/map/payphone.ts` — class
  `PayPhone`, ☎️ emoji, label "PayPhone / The Strat", anchored at
  **`[-115.1561024, 36.1476992]`** (Nominatim pin for The Strat, 2000 Las Vegas
  Blvd S — geocoded, not eyeballed). `EGG_ID = 'dc34-payphone'`. Click →
  `openEggModal(map, 'dc34-payphone', PAYPHONE_LOCATION)`.
- `LayerControl.svelte` — instantiate next to `TheSpot` (same remove/new guard).
- `apps/run.gpx/webapp/src/app/api/gpx/public/eggs/route.ts` — new
  `DEFAULT_EGGS` entry `dc34-payphone`: eyebrow "Public Utility", title
  "☎️ PayPhone", descriptionHtml **"Call me! 725-404-3234"** (tel: link), map
  link, accent (bell-system yellow `#F2A900`). CMS-overridable like the others.
- `route.test.ts` `EXPECTED_IDS` gains `dc34-payphone` (order-sensitive list).

## 2. Goldstein unlock seed in his ghost popup

### Sourcing (chosen: live-derived via internal endpoint)

The unlock seed is HKDF-derived (`meshtk-otp-seed:` label) from
`MESHTK_GHOST_KEY_SECRET`, held only by run.human and run.mqtt. Options
considered: (a) run.human internal endpoint, live-derived — **chosen**;
(b) give run.gpx the secret + duplicate derive code — spreads a sensitive
secret for no gain; (c) hardcode the derived value — rots silently if the
key secret rotates (it has before) and commits a live credential to git.

- **run.human**: new `GET /api/internal/ghost-unlock?ghostId=ghost.goldstein`
  — same `x-internal-secret` / `AUTH_INTERNAL_SECRET` guard as the five
  existing `/api/internal/*` routes; returns `revealGhostOtp(ghostId)` →
  `{ ghostId, configured, secret, otpauth }`; 404 unknown ghost, 403 bad secret.
  Exposes the **unlock** seed only (post-07-25 split this is distinct from the
  chain/daily-claim seed — publishing it grants goldstein chat access, which is
  the point of the clue, and nothing else).
- **run.gpx ghosts feed** (`api/gpx/public/ghosts/route.ts` + `mesh-nodes.ts`):
  fetch the seed via the existing rabbit-proxy plumbing
  (`RUN_HUMAN_INTERNAL_URL` + `x-internal-secret`, `AbortSignal.timeout(3000)`,
  fail-soft). Value is deterministic → cache in module memory after first
  success. Render the otpauth URL as a **QR PNG data-URI server-side**
  (`qrcode` npm dep in run.gpx webapp — keeps the vendored gpx-studio fork
  dependency-free). Attach to **goldstein's feature only**:
  `unlockSeed` (base32) + `unlockQr` (data URI). On any failure the properties
  are absent and the popup renders the normal dossier.
- **ghost popup** (`ghost-layer.ts`): when `unlockSeed` is present, append a
  seed section after the dossier grid: "🔑 SEED" header, mono base32 line,
  QR `<img>` (~110px), hint line "send him the 6-digit code". Gold-accented
  border.

### Goldstein gold styling (`ghost-layer.ts`)

Today: one violet wisp icon (`dc34-ghost-icon`) + violet text for all ghosts.
Change: parameterize the wisp SVG color; register a second image
`dc34-ghost-icon-gold`; data-drive by slug:

- `icon-image`: `['match', ['get','slug'], 'goldstein', 'dc34-ghost-icon-gold', 'dc34-ghost-icon']`
- `icon-size`: goldstein ~1.25× others
- `text-color`: goldstein gold `#FFD700`, others violet (match expression)
- Popup: gold tint on name/alias + gold seed box for goldstein; other ghosts
  unchanged.

## Error handling

- Internal call fails / secret unset → feed omits seed props; popup = plain
  dossier (fail-soft, same philosophy as the rabbit proxy).
- Eggs endpoint failure already falls back to `DEFAULT_EGGS`.

## Testing

- run.gpx vitest: eggs route `EXPECTED_IDS` + a feed test asserting goldstein
  (and only goldstein) gains `unlockSeed`/`unlockQr` when the internal call
  succeeds, and none on failure (mock fetch).
- run.human vitest: ghost-unlock route — 403 without secret, 404 unknown ghost,
  200 shape with mocked `MESHTK_GHOST_KEY_SECRET`.
- gpx-studio: `./build-frontend.sh` + svelte-check no new errors (no unit
  framework there — same as prior beacons).
- Live verify after deploy: feed shows seed props; map probe (Playwright recipe
  from coffee-egg memory) confirms gold pin + payphone beacon + popups.

## Ship

One PR (both apps) → buildpub `run.human,run.gpx` use1 → deploy.yml us-east-1 →
live verify. No infra/task-def changes (all env vars already present).
