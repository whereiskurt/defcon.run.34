import { LAYER } from './layer-visibility';

/**
 * `?layers=` — the deep-link map-layer preselector, and the URL-side companion to
 * `layer-visibility.ts`.
 *
 * A link like `https://gpx.defcon.run/app?layers=routes` names the EXACT set of map
 * layers the visitor should land on. "Exact" is the whole feature: a layer the URL does
 * not name is forced OFF even when it is ON in the persisted `dc34LayerVisibility`
 * state, so a runner who once switched Rabbit Routes on still sees only the official
 * routes when they follow that link. An implementation that only turned layers ON would
 * render a different map per visitor, which is precisely what the parameter exists to
 * stop.
 *
 * TOKENS ARE EITHER A FOLDER ALIAS OR A LITERAL LAYER ID:
 *
 *   routes · rabbits         a public-overlay FOLDER — expands to every route in it
 *   aggregate · checkins     the two fixed toggles (`LAYER`)
 *   heat:dc33 · heat:dc34    one HEAT MAP year each (`LAYER`)
 *
 * Folder aliases exist because the alternative — spelling `route:<fileId>` in a URL —
 * would bake CMS-generated ids into printed/QR'd links that then break the moment a
 * route is re-uploaded.
 *
 * A LINK THAT NAMES ROUTES ALSO FRAMES THEM: `public-overlays.ts` fits the map to the
 * union of whatever the link turned on, so the visitor lands looking at them rather than
 * at the default view with the answer somewhere off-screen. Nothing is fitted when the
 * parameter is absent, or when it names only layers that carry no route geometry.
 *
 * OUT OF SCOPE, DELIBERATELY: ghost mode (`stores/ghost.ts`) is not in
 * `layer-visibility.ts`, is not URL-addressable, and keeps its own default. Nothing here
 * touches it. The rabbit live-pin layer USED to be excluded on the same grounds; it was
 * brought in as `runners` on 2026-08-02 because "always on, no control" is not a default,
 * it is a missing feature.
 *
 * THE SELECTION IS READ AT EACH SEEDING SITE, not applied from here. Every layer family
 * resolves its own visibility while its manifest lands (`public-overlays.ts`,
 * `heatmap-layer.ts`, `my-con-runs.ts`, `community-routes.ts`), all off the map's async
 * `load`. Consulting this module AT that resolution point is what makes the override
 * win: there is no later seeding pass to overwrite it, and because the layers are added
 * hidden and revealed once in their resolved state, there is no flash of the wrong set
 * either. An "apply afterwards" design would have had to beat both of those.
 */

/**
 * Alias token -> the GLOBAL public-overlay FOLDER NAME it stands for. A `Map`, not an
 * object literal, because the key comes from a URL: `LAYERS_BY_ALIAS['constructor']`
 * would be a truthy prototype hit, a `Map` lookup is not.
 */
const FOLDER_BY_ALIAS = new Map<string, string>([
    ['routes', 'DEF CON 34 Maps'],
    ['rabbits', 'Rabbit Routes'],
]);

/** The literal tokens, spelled from `LAYER` so a renamed id cannot drift out of sync. */
const LITERAL_TOKENS = new Set<string>([
    LAYER.aggregate,
    LAYER.checkins,
    LAYER.heatDc33,
    LAYER.heatDc34,
    LAYER.runners,
    LAYER.shuttles,
]);

export type LayerSelection = {
    /** Public-overlay folder NAMES named by an alias token. */
    folders: ReadonlySet<string>;
    /** Literal `LAYER` ids named directly. */
    keys: ReadonlySet<string>;
};

/**
 * Parse a raw `?layers=` value into the requested set, or `null` for "no override —
 * behave exactly as today".
 *
 * Unknown tokens are dropped without a word: these links get printed on signage and
 * pasted into chat, and a typo must degrade, never throw.
 *
 * A VALUE THAT NAMES NOTHING KNOWN IS ALSO `null`, not "an empty set, so hide
 * everything". `?layers=rotues` is a typo, and answering a typo with a bare basemap
 * reads as a broken site; answering it with the normal default layers reads as a link
 * that simply did not take. This is the one place the "exact set" rule yields, and it
 * yields only when the URL asked for nothing at all.
 */
export function parseLayerParam(raw: string | null): LayerSelection | null {
    if (raw === null) return null;
    const folders = new Set<string>();
    const keys = new Set<string>();
    for (const token of raw.split(',')) {
        const t = token.trim().toLowerCase();
        if (t.length === 0) continue;
        const folder = FOLDER_BY_ALIAS.get(t);
        if (folder !== undefined) folders.add(folder);
        else if (LITERAL_TOKENS.has(t)) keys.add(t);
    }
    if (folders.size === 0 && keys.size === 0) return null;
    return { folders, keys };
}

// Resolved once per page load and cached. Memoising is not an optimisation — it pins
// the selection to the URL the visitor arrived on, so a client-side navigation that
// drops the query string mid-load cannot change what a still-seeding layer resolves to.
let resolved = false;
let selection: LayerSelection | null = null;

/**
 * The layer set this page load was deep-linked with, or `null` when `?layers=` is
 * absent. Safe to call from anywhere, at any time, including before the route's
 * `onMount` — the first caller resolves it.
 */
export function requestedLayers(): LayerSelection | null {
    if (!resolved) {
        resolved = true;
        selection =
            typeof location === 'undefined'
                ? null // prerender: no URL to read, and no map to seed either
                : parseLayerParam(new URLSearchParams(location.search).get('layers'));
    }
    return selection;
}

/**
 * Startup visibility for the live runner pins.
 *
 * ⚠️ RUNNERS BREAKS THE BOTH-WAYS RULE, DELIBERATELY. Every other layer is default-OFF, so
 * "the link did not name me" and "the link turned me off" are the same thing. Runners is
 * the only default-ON layer, and reading an absent token as OFF silently killed it on every
 * existing `?layers=routes` link — including all of run.human's map CTAs, which is exactly
 * how it was caught (Kurt, 2026-08-03: "where are the sims/rabbits?").
 *
 * So: an explicit `runners` token turns them ON; anything else leaves the runner's own
 * stored choice alone. The cost is that a link can turn runners on but not off. That is
 * the right trade — a link should not be able to hide people from you by omission.
 */
export function resolveRunnersVisible(
    requested: LayerSelection | null,
    stored: boolean
): boolean {
    return requested?.keys.has(LAYER.runners) ? true : stored;
}

/**
 * The hash the visitor ARRIVED with, captured at module load.
 *
 * ⚠️ DO NOT read `location.hash` later to answer "did the link specify a
 * camera?". gpx.studio rewrites the hash with the live `#zoom/lat/lng` via
 * `history.replaceState` as soon as the map settles, so a hash read from inside
 * a map `load` handler tells you where the map IS, not what was asked for. This
 * silently disabled the shuttle auto-fit: every bare `?layers=shuttles` link
 * looked like it had named its own camera. Module init runs at import, before
 * the map exists, so this snapshot is the honest one.
 */
const ARRIVAL_HASH = typeof location === 'undefined' ? '' : location.hash;

/** Did the visitor's own URL pin a `#zoom/lat/lng` camera? */
export function arrivedWithCamera(): boolean {
    return /^#\d/.test(ARRIVAL_HASH);
}

/**
 * Whether this page load was deep-linked to the hidden B-Sides shuttle layer.
 *
 * Shuttles follow the ordinary one-way rule rather than the runners exception:
 * the layer is default-OFF and has no stored preference at all (it is an easter
 * egg, not a toggle), so "the link did not name me" simply means "stay hidden".
 *
 * ⚠️ The CALLER must reveal via `revealShuttlesFromLink()`, not the normal
 * toggle. A link reveal deliberately does NOT fire the covert `bsides-shuttle`
 * award — otherwise pasting the link into a chat would hand the flag to everyone
 * who opened it, and the egg would stop being earned. See `stores/shuttle.ts`.
 */
export function resolveShuttlesLinked(requested: LayerSelection | null): boolean {
    return requested?.keys.has(LAYER.shuttles) === true;
}
