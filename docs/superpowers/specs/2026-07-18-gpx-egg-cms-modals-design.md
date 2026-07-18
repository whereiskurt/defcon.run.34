# CMS-backed egg modals — design

**Date:** 2026-07-18
**Author:** Kurt (KPH) + Claude
**Status:** approved, building
**Branch:** `feat/gpx-egg-cms-modals` (worktree off `origin/main`)

## Goal

Give the run.gpx map easter eggs a **click → route-style modal** whose content is
served by a new **public unauthenticated gpx endpoint**, with **hardcoded default
content baked in** so it ships without a run.cms deploy. CMS rows override the
defaults later — exactly the way public routes are enriched today.

First shippable slice:

1. Rainbow arches gain a click→modal (they have **no** click handler today).
2. The coffee cup's static popup migrates to the same CMS-backed path.

Eggs covered (ids match the studio geometry exactly):

| id            | egg                        | studio source/layer        |
|---------------|----------------------------|----------------------------|
| `lvcc-rebar`  | pride arch → ReBar         | `dc34-rainbow` / `archId`  |
| `lvcc-nuwu`   | weed arch → NuWu Cannabis  | `dc34-rainbow` / `archId`  |
| `lvcc-lvsign` | pride arch → LV sign       | `dc34-rainbow` / `archId`  |
| `dc34-coffee` | PublicUs coffee cup        | `dc34-coffee`              |

## Non-goals (deferred)

- **No run.cms changes** — no new Strapi content-type, no deploy, no seed.
- No covert-CTF changes (`fireRainbowEgg`/`fireCoffeeEgg` stay exactly as-is).
- No new unlock mechanics; clicking an already-visible egg opens the modal.

## Architecture

### 1. Public endpoint — `apps/run.gpx/webapp/src/app/api/gpx/public/eggs/route.ts`

`GET /api/gpx/public/eggs` → `{ eggs: EggModal[] }`, unauthenticated, same CDN
caching (`s-maxage=300, stale-while-revalidate=300`) as `/api/gpx/public/maps`.

```ts
type EggLink = { label: string; url: string };
type EggModal = {
  id: string;
  eyebrow: string;         // e.g. "Rainbow Bridge"
  title: string;
  descriptionHtml: string; // server-safe HTML (hardcoded, or blocksToHtml from CMS)
  address?: string;
  coverImageUrl?: string;
  coverImageDisplayUrl?: string;
  links?: EggLink[];
  accent?: string;         // left-tab / link color (hex, hardcoded-only — never CMS)
};
```

- **`DEFAULT_EGGS: EggModal[]`** — hardcoded content for all four ids. This is what
  ships and renders with zero CMS dependency.
- **CMS override** via `fetchEggMeta(ids)` (below). For each egg, override
  `title / descriptionHtml / coverImageUrl / coverImageDisplayUrl` when a CMS row
  exists; everything else (eyebrow, address, links, accent) stays from defaults.
- Endpoint never throws to the client: on any failure it returns `DEFAULT_EGGS`.

### 2. CMS seam — `fetchEggMeta(ids)` in `apps/run.gpx/webapp/src/lib/strapi.ts`

**Reuses the existing `route` Strapi type, keyed by `gpxFileId`** (Kurt's choice —
no new CMS type). A focused query: `filters[gpxFileId][$in]` = the egg ids,
`fields=gpxFileId,name,description`, `populate=coverImage`, `status=published`.
Returns `Map<eggId, EggMeta>` where `EggMeta = { title?, descriptionHtml?,
coverImageUrl?, coverImageDisplayUrl? }`. Reuses the existing `blocksToHtml` safe
renderer. **Best-effort**: unconfigured / unreachable / non-200 / timeout → empty
map, defaults ship. A CMS admin overrides an egg later by adding a `Route` row
whose `gpxFileId` is the egg id (e.g. `dc34-coffee`) — such rows carry no GPX
asset, so they are invisible to the `/maps` manifest (standalone emission requires
`gpxUrl`, enrichment requires a matching DynamoDB fileId).

### 3. Studio shared module — `.../gpx-studio/website/src/lib/components/map/egg-modal.ts`

- Fetches `${regionPrefix()}/api/gpx/public/eggs` once (module cache + in-flight
  dedupe), `credentials: 'omit'`. `regionPrefix()` mirrors public-overlays (derives
  the `/use1` prefix; a root-absolute `/api` drops the region → 404).
- `openEggModal(map, id, lngLat)` → looks up the egg, renders a `mapboxgl.Popup`
  (one per map via `WeakMap`) with `eggPopupHtml`.
- `eggPopupHtml(egg)` mirrors the routes popup (`public-overlays.popupHtml`): dark
  card, colored left tab (`accent`), eyebrow, title, `address`, cover `<a><img>`,
  `descriptionHtml`, links. **`escapeHtml` on every interpolated field**;
  `descriptionHtml` is the only trusted-HTML slot (server-rendered whitelist or
  hardcoded default). `accent` is hardcoded-only, never from CMS.

### 4. Wiring

- **`rainbow-arch.ts`**: inside `build()` (right after `addLayer`), register
  `click` on `dc34-rainbow-arch` → read the hit feature's `archId` →
  `openEggModal(map, archId, e.lngLat)`, plus `mouseenter`/`mouseleave` cursor.
  Detach all three in `remove()`. `fireRainbowEgg` on unlock is untouched.
- **`coffee-cup.ts`**: `clickFn` swaps `cardHtml()` static popup →
  `openEggModal(map, 'dc34-coffee', e.lngLat)`. `fireCoffeeEgg()` still fires on
  click. Delete the now-dead `cardHtml()` + owned `this.popup`.

## Safety / XSS

- All dynamic text escaped via `escapeHtml` (stored-XSS landmine — see the Mapbox
  popup XSS fix in the mesh-map-layers work). `descriptionHtml` from CMS is passed
  through `blocksToHtml` (whitelist + per-node escape) exactly like route
  descriptions; hardcoded defaults are author-controlled static strings.
- `links[].url` / `coverImageUrl` are escaped inside the `href`/`src` attribute.

## Verification

- `npx tsx` sanity: assert `DEFAULT_EGGS` covers all four ids and that the
  default→override merge keeps defaults when the override map is empty.
- `./build-frontend.sh` (studio prod build).
- `svelte-check` on touched studio files (studio has no vitest; token is
  `*.defcon.run`-locked so the map won't render locally — CI + prod Playwright is
  the real gate, per the rainbow/coffee playbooks).
- Stop at the PR. No deploy, no seed.
