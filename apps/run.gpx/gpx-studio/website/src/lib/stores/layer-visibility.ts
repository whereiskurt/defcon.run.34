import { writable } from 'svelte/store';

/**
 * Persisted ON/OFF state for every layer toggle in the Map Layers dialog (Kurt
 * 2026-07-30: "let's get it surviving page load"). Sibling of
 * `layer-section-collapse.ts` — same localStorage idiom, same stable-id rule, same
 * per-call-site default rule — but for VISIBILITY rather than the fold.
 *
 * WHY A STORE AND NOT THE LAYER CLASSES — visibility lives in the layer instances
 * (`public-overlays.ts`, `my-con-runs.ts`, `community-routes.ts`), which are
 * constructed fresh on every page load and rebuild their groups from a manifest with
 * hardcoded defaults. Collapse state already survives a reload; visibility did not,
 * so a runner who turned Rabbit Routes on found them off again tomorrow.
 *
 * KEYS ARE STABLE IDS, never an array index and never a CMS-driven display label:
 * folder/route/run names are data driven and change under us, and a re-order would
 * otherwise shuffle one layer's state onto another. Shape:
 *
 *   checkins · aggregate     the two fixed (non data-driven) toggles
 *   heat:<year>              one HEAT MAP year row (dc33, dc34 — also fixed)
 *   route:<fileId>           one public route row
 *   run:<fileId>             one "My DEF CON Runs" run row
 *   croute:<routeId>         one Community Routes row
 *
 * Only LEAF rows are stored. Every master toggle in the dialog already derives from
 * "all children visible" (see `setRouteVisible` / `setRunVisible`), so persisting the
 * leaves reproduces the masters exactly and there is no second source of truth to
 * disagree with itself.
 *
 * An id absent from the map means "never touched" — each call site supplies its own
 * default, so a first-time visitor sees precisely today's behaviour (con runs hidden,
 * Rabbit Routes off, "DEF CON 34 Maps" on).
 *
 * RESTORE MUST NOT MOVE THE CAMERA. Callers apply a restored value by driving the map
 * layout property directly, never through the `setRouteVisible`/`setDayVisible` user
 * paths — those `fitBounds`, and a page load that yanked the map away from wherever the
 * runner is would be a worse bug than the one this fixes.
 */
const KEY = 'dc34LayerVisibility';

/**
 * Stable ids for the fixed (non data-driven) toggles.
 *
 * The two heat-map years live here rather than behind a `PREFIX` helper because
 * they are a closed set decided at build time — exactly like `checkins` and
 * `aggregate`, and unlike routes/runs there will never be a third year keyed off
 * runtime data. Every consumer reads these constants; no other module may
 * hand-write the string form, or a typo would silently orphan a saved preference.
 */
export const LAYER = {
    checkins: 'checkins',
    aggregate: 'aggregate',
    heatDc33: 'heat:dc33',
    heatDc34: 'heat:dc34',
} as const;

/** Key prefixes, exported so a load can prune ids whose layer no longer exists. */
export const PREFIX = {
    publicRoute: 'route:',
    conRun: 'run:',
    communityRoute: 'croute:',
} as const;

/** Stable id for one public route row, keyed by its GPX file id. */
export function publicRouteLayer(fileId: string): string {
    return `${PREFIX.publicRoute}${fileId}`;
}

/** Stable id for one "My DEF CON Runs" run row, keyed by its GPX file id. */
export function conRunLayer(fileId: string): string {
    return `${PREFIX.conRun}${fileId}`;
}

/** Stable id for one Community Routes row, keyed by its route id. */
export function communityRouteLayer(routeId: string): string {
    return `${PREFIX.communityRoute}${routeId}`;
}

function initial(): Record<string, boolean> {
    if (typeof localStorage === 'undefined') return {};
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        // Booleans only: a hand-edited or half-written value must degrade to the
        // built-in defaults rather than feeding junk into a layer's visibility.
        const out: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === 'boolean') out[k] = v;
        }
        return out;
    } catch {
        return {};
    }
}

export const layerVisibility = writable<Record<string, boolean>>(initial());

// Synchronous snapshot for the restore path: a layer resolving its defaults during a
// manifest load needs the current value without subscribing.
let snapshot: Record<string, boolean> = {};
layerVisibility.subscribe((v) => {
    snapshot = v;
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(KEY, JSON.stringify(v));
    } catch {
        // Private mode / quota. Remembering a toggle is a nicety; never break the dialog.
    }
});

/**
 * The stored value for a layer id, or the caller's own default when nothing is
 * stored. The default belongs to the call site — that is what keeps a first-time
 * visitor's dialog byte-identical to how it looked before this store existed.
 */
export function storedVisible(id: string, fallback: boolean): boolean {
    const v = snapshot[id];
    return typeof v === 'boolean' ? v : fallback;
}

/** Persist one layer's visibility. */
export function setLayerVisible(id: string, visible: boolean): void {
    layerVisibility.update((m) => (m[id] === visible ? m : { ...m, [id]: visible }));
}

/** Persist a whole master-toggle cascade in one write. */
export function setLayersVisible(ids: string[], visible: boolean): void {
    if (ids.length === 0) return;
    layerVisibility.update((m) => {
        if (ids.every((id) => m[id] === visible)) return m;
        const next = { ...m };
        for (const id of ids) next[id] = visible;
        return next;
    });
}

/**
 * Drop stored ids under `prefix` that are not in `keep` — a route deleted from the CMS
 * or a run the runner removed would otherwise leave its key behind forever. Called
 * only from a load that actually holds an authoritative manifest, so a transient fetch
 * failure can never wipe a runner's preferences.
 */
export function pruneLayerVisibility(prefix: string, keep: Iterable<string>): void {
    const live = new Set(keep);
    layerVisibility.update((m) => {
        const stale = Object.keys(m).filter((k) => k.startsWith(prefix) && !live.has(k));
        if (stale.length === 0) return m;
        const next = { ...m };
        for (const k of stale) delete next[k];
        return next;
    });
}
