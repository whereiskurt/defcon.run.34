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

## Enhancement v2 — "The Booth" marker art (2026-07-27, after v1 shipped)

Kurt: the emoji didn't sell it — make it *look* like a payphone with the number
on it, 2600-zine energy, "implying someone should call it." Chosen via visual
companion from three directions (Booth / Zine Cutout / Off-The-Hook): **A2 —
The Booth with a number pill.**

- Replace the ☎️ emoji div in `payphone.ts` with an inline **SVG payphone**
  (~48×78 px, viewBox 0 0 60 98): Bell-blue enclosure `#1e3a5f` with `#4a6f9e`
  stroke, dark inset, silver faceplate `#c9ced6`, black handset on left hooks,
  2×4 keypad, coin slot + coin return, two legs — and a slightly-rotated taped
  paper note on the faceplate reading **"CALL ME!"** (red, marker-style font
  w/ cursive fallback) over **"725-404-3234"** (bold monospace).
- The label pill text changes from "PayPhone / The Strat" to monospace
  **"☎ 725-404-3234"** so the number is legible at every zoom even when the
  taped note isn't. Pill keeps the amber border style.
- Everything else unchanged: bob + amber conic rays (rays now sized to the SVG
  box), `anchor:'bottom'`, click → `dc34-payphone` modal, reduced-motion guard.
- No copyrighted 2600 photos — the art is an original SVG homage (photos would
  be a licensing problem and a raster blob in the bundle).
- Ship: run.gpx only (studio bundle) → buildpub `run.gpx` use1 → deploy.yml.

## Enhancement v3 — two more booths (2026-07-27)

Same Booth layout, parameterized. `payphone.ts` becomes spec-driven
(`PAYPHONES: PhoneSpec[]`, one `PayPhone` class instance manages all markers;
`boothSvg(number)` templates the taped note; pill shows each phone's number):

| eggId | Place | Number | Location (Nominatim) |
|---|---|---|---|
| `dc34-payphone` | ReBAR, 1225 S Main St *(moved from The Strat 2026-07-29; photo file keeps the `strat.jpg` name)* | 725-404-3234 | `[-115.1535043, 36.1565826]` |
| `dc34-payphone-sign` | Welcome to Fabulous Las Vegas Sign | 725-404-3283 | `[-115.1727735, 36.0820593]` |
| `dc34-payphone-rio` | The Rio, 3700 W Flamingo Rd | 725-404-8283 | `[-115.1882831, 36.1175311]` |
| `dc34-payphone-doubledown` | Double Down Saloon, 4640 Paradise Rd *(added 2026-07-29)* | 1-855-916-4636 | `[-115.1503087, 36.1055201]` |

v5 addendum (2026-07-29): Double Down booth carries ghost-mode violet spray
**"7425678"** on its popup photo (`tone: 'violet'` added to the coverGraffiti
union + `.dc34-graf-violet` CSS); its photo is the CC0 Wikimedia
"Payphone near Richmond, Virginia, 2024" (blue kiosk on rusty post,
EXIF-stripped) at `public/payphones/doubledown.jpg`. Long toll-free numbers
shrink the taped-note font (`boothSvg` steps 4.8 → 4.1 above 12 chars).

Each gets its own `DEFAULT_EGGS` entry ("Call me! <number>", same eyebrow/
accent); `EXPECTED_IDS` extended. LayerControl unchanged (same class name and
constructor). Ship: run.gpx only, same CI flow.

## Enhancement v4 — popup photos + ghost-mode graffiti (2026-07-27)

Approved via visual companion (v2 screen). Two additions, run.gpx only:

**Real payphone photos in the popups.** Three CC0 (public-domain) photos from
Wikimedia Commons, bundled at ~960px into
`apps/run.gpx/webapp/public/payphones/{strat,sign,rio}.jpg`:
- Strat → "Payphone (Unsplash).jpg" (clean chrome booth)
- Sign → "Payphone (Unsplash WtZqMLOEwlI).jpg" (tagged phone on chain-link fence)
- Rio → "Payphone in Boston littered with coffee, stickers, and graffiti.jpg"
The eggs route sets `coverImageUrl`/`coverImageDisplayUrl` to
`/${REGION_SHORT}/payphones/<f>.jpg` (public/ is served under the region
basePath — same origin path scheme as `/use1/studio`). CC0 = no attribution
required; source filenames recorded here for provenance.

**Ghost-mode spray-paint graffiti** (clue codes; Strat stays clean).
*Revised per Kurt after v4 shipped: graffiti lives ONLY on the popup photos —
never on the map markers — and must react live to ghost mode while a popup is
open (no reopening required).*
- Popup photos: `EggModal` gains optional `coverGraffiti?: { text; tone }`
  (sign = pink "1337", rio = green "696969"). The spray span is ALWAYS in the
  popup DOM (CSS-hidden, `~34px/28px`, -14°); a module-level `ghostMode`
  subscription in egg-modal.ts toggles `.dc34-egg-graffiti-on` on every such
  span, so flipping ghost mode sprays/unsprays open popups in place. Generic
  field — any future egg can use it; CMS override cannot set it (default-only).
- Markers: unchanged Booth art in every mode (the v4 marker tags were removed).
- Styles live with the existing dc34 rules in `app.css`.

Ship: run.gpx only → buildpub `run.gpx` use1 → deploy.yml → verify photos serve
(200 + content-type) and graffiti markup in bundle.
