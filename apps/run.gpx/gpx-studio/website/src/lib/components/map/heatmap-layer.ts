import mapboxgl from 'mapbox-gl';
import { writable } from 'svelte/store';
import { LAYER, setLayerVisible, storedVisible } from '$lib/stores/layer-visibility';

/**
 * HeatmapLayer — the DC33 / DC34 stacked-flame heat layers (Phase 71, HEAT-04).
 *
 * One translucent line per submitted run, drawn from a single precomputed
 * GeoJSON artifact per year, so OVERLAP reads as heat: a lone run is a faint
 * thread, a well-trodden path saturates. This is not a new technique in this
 * repo — `public-overlays.ts` `addAggregate()` already ships exactly it for the
 * "All Runners" layer; these are the same lines re-colored per con year and
 * split into two independently toggleable sources.
 *
 * BOTH YEARS MAY BE VISIBLE AT ONCE — that simultaneous two-color view is the
 * point of the feature (Kurt: "dc33 and dc34 heatmap simultaneously =
 * legendary"). DC34 is the live year, so it always composites ABOVE DC33: DC33
 * is added beneath an existing DC34 layer rather than relying on which one the
 * runner happened to enable first.
 *
 * LAZY BY CONSTRUCTION. Map load pays only for two `?meta=1` probes of a few
 * hundred bytes each, which answer "does this year exist" and "when was it last
 * calculated". A year's geometry — hundreds of KB — is fetched the first time
 * that year is actually turned on, and never if it never is.
 *
 * UNTRUSTED INPUT. The artifact is public, unauthenticated JSON. It is shape-
 * checked before it reaches `addSource`, no feature attribute is ever read, and
 * nothing derived from it is written into the DOM by this module — the features
 * carry no attributes by construction (the builder's `assertNonAttributable`),
 * and this file declining to read any is the second half of that guarantee.
 *
 * FAILURE IS SILENT. A missing, 404-ing or malformed artifact leaves the studio
 * pixel-identical: the year stays unavailable, its row never renders, and at
 * most one `[heatmap]` warning is logged. Nothing throws into the map.
 */

// The studio is served under the region basePath (e.g. /use1/studio/app), but the API
// lives at /use1/api/... — so a root-absolute '/api/...' drops the region and 404s.
// Derive the region prefix as everything before '/studio' in the current path.
function regionPrefix(): string {
    if (typeof location === 'undefined') return '';
    const i = location.pathname.indexOf('/studio');
    return i > 0 ? location.pathname.slice(0, i) : '';
}

/** The two con years that have an artifact. Iterate this — never write both years twice. */
export const HEAT_YEARS = ['dc33', 'dc34'] as const;
export type HeatYear = (typeof HEAT_YEARS)[number];

const HEAT_BASE = `${regionPrefix()}/api/gpx/public/heatmap`;

/** Full artifact: geometry plus embedded meta. Fetched on first enable only. */
function heatUrl(year: HeatYear): string {
    return `${HEAT_BASE}/${year}`;
}

/** The meta projection — a few hundred bytes, its own CDN cache entry. */
function heatMetaUrl(year: HeatYear): string {
    return `${HEAT_BASE}/${year}?meta=1`;
}

/** Source and layer share one id, matching `addAggregate`'s convention. */
export function heatSourceId(year: HeatYear): string {
    return `heatmap-${year}`;
}

export function heatLayerId(year: HeatYear): string {
    return `heatmap-${year}`;
}

type HeatStroke = {
    'line-color': string;
    'line-width': number;
    'line-opacity': number;
};

/**
 * Width and opacity are year-independent. Width 3 is Kurt-locked (D-02). The
 * opacity is 0.70 — confirmed by Kurt on 2026-07-31 as D-13, after a measured
 * 0.25 / 0.45 / 0.70 sweep shot at a 40-run hotspot with every non-heat layer
 * hidden. The literal below is written 0.7; that is the same number.
 *
 * WHY IT IS NOT LOWER. This layer originally shipped at 0.25, and at that value
 * the DC33 stack was not faint — it was perceptually absent. Two controlled
 * captures settled it: identical camera, identical data, all non-heat layers off.
 * The 0.25 frame is indistinguishable from a bare basemap; the same frame at
 * 0.70 shows a dense stack with a real density gradient. Data and render path
 * were both ruled out first (36 overlapping features under one screen pixel, and
 * a forced opaque render drew a correct network), so the number was the fault.
 *
 * ACCEPTED TRADE-OFF. At 0.70 a single line is already fairly opaque, so overlap
 * saturates sooner and the gradient is coarser than a true low-alpha stack would
 * give. Legibility beat fidelity: a coarse gradient a runner can see is worth
 * more than a beautiful one they cannot.
 *
 * KNOWN AND DELIBERATELY NOT FIXED. DC33's ember orange sits on top of the
 * Mapbox basemap's own orange road casings, so DC33 contrast stays imperfect at
 * any opacity. A colour change, a dark casing / under-stroke layer beneath the
 * heat line, and a runtime-tunable paint knob were each offered to Kurt and each
 * declined. Do not add them.
 *
 * THIS IS A TUNING, NOT A REVERSAL. "Exact opacity/width tuning" was always
 * Claude's Discretion in 71-CONTEXT.md, with the original figure only a suggested
 * starting point. The colours ARE locked (D-02, reaffirmed by D-13) and did not
 * move. Do not lower this value back toward the old one on the strength of
 * `public-overlays.ts` `addAggregate()` running thinner — that comparison is what
 * produced the invisible render in the first place.
 */
const HEAT_STROKE = { 'line-width': 3, 'line-opacity': 0.7 } as const;

/**
 * DC34 flame red, DC33 ember orange (D-02, Kurt-locked).
 *
 * Exported so the HEAT MAP section's row swatches read their colour from the
 * same constant the map line paints with — a swatch can then never drift from
 * the line it stands for.
 */
export const HEAT_PAINT: Record<HeatYear, HeatStroke> = {
    dc33: { 'line-color': '#ff8c00', ...HEAT_STROKE },
    dc34: { 'line-color': '#ff0000', ...HEAT_STROKE },
};

/** Persisted-toggle id per year. Ids live in `LAYER`; this file never spells one out. */
const HEAT_STORE_ID: Record<HeatYear, string> = {
    dc33: LAYER.heatDc33,
    dc34: LAYER.heatDc34,
};

export type HeatYearState = {
    /** The artifact exists and is servable. A year that is not available never renders a row. */
    available: boolean;
    visible: boolean;
    /** ISO instant the artifact's source data was read, or null when unknown. */
    generatedAt: string | null;
    runCount: number;
    totalKm: number;
};

function blankState(): Record<HeatYear, HeatYearState> {
    return Object.fromEntries(
        HEAT_YEARS.map((year) => [
            year,
            { available: false, visible: false, generatedAt: null, runCount: 0, totalKm: 0 },
        ])
    ) as Record<HeatYear, HeatYearState>;
}

function blankFlags(): Record<HeatYear, boolean> {
    return Object.fromEntries(HEAT_YEARS.map((year) => [year, false])) as Record<HeatYear, boolean>;
}

/**
 * UI-facing state for the HEAT MAP section — availability, the restored toggle,
 * and the "last calculated" numbers. Modelled on `publicAggregate`
 * (`public-overlays.ts`), widened to carry the meta the section header renders.
 */
export const heatmapState = writable<Record<HeatYear, HeatYearState>>(blankState());

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;

/**
 * Short human-relative form of an ISO instant — `just now`, `42m ago`, `3h ago`,
 * `6d ago`, or `—` when there is nothing to say. Pure and exported so it is
 * testable on its own and so the section component stays markup.
 */
export function relativeStamp(iso: string | null): string {
    if (!iso) return '—';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '—';
    // Clamped at 0: a builder clock slightly ahead of the browser must not render
    // as a negative age.
    const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (secs < MINUTE) return 'just now';
    if (secs < HOUR) return `${Math.floor(secs / MINUTE)}m ago`;
    if (secs < DAY) return `${Math.floor(secs / HOUR)}h ago`;
    if (secs < YEAR) return `${Math.floor(secs / DAY)}d ago`;
    return `${Math.floor(secs / YEAR)}y ago`;
}

type HeatMeta = { generatedAt: string | null; runCount: number; totalKm: number };

/**
 * `?meta=1` returns the bare meta block at the top level. Every field is
 * defaulted rather than trusted — a truncated or reshaped response degrades to
 * "available, but we can't say when", never to a broken section.
 */
function parseMeta(v: unknown): HeatMeta | null {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    return {
        generatedAt: typeof o.generatedAt === 'string' ? o.generatedAt : null,
        runCount: typeof o.runCount === 'number' && Number.isFinite(o.runCount) ? o.runCount : 0,
        totalKm: typeof o.totalKm === 'number' && Number.isFinite(o.totalKm) ? o.totalKm : 0,
    };
}

/**
 * Structural gate on untrusted geometry (T-71-21): only a FeatureCollection
 * carrying a feature array is ever handed to `addSource`. Anything else is not a
 * heat map and is dropped without touching the map.
 *
 * AN EMPTY FEATURE ARRAY IS VALID. A year whose artifact exists but currently
 * holds no runs — DC34 at any point before the con opens — is a real artifact
 * awaiting data, not a malformed one. Rejecting it here used to make
 * `ensureGeometry` bail before it could latch `built`, so the row's checkbox
 * turned on, painted nothing, said nothing, and re-downloaded the whole artifact
 * on every subsequent toggle (WR-07).
 *
 * THIS RELAXES A LIVENESS CHECK, NOT A STRUCTURAL ONE. The type literal and the
 * array check below ARE the untrusted-input gate (T-71-21) — they are what keeps
 * an arbitrary JSON body out of `addSource` — and must not be loosened further.
 * "Has this year got data yet" is a different question from "is this JSON a
 * FeatureCollection", and only the second one belongs in this function.
 */
function isFeatureCollection(v: unknown): v is GeoJSON.FeatureCollection {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    const o = v as { type?: unknown; features?: unknown };
    return o.type === 'FeatureCollection' && Array.isArray(o.features);
}

/**
 * How long `whenStyleReady` waits on the map's `idle` event before proceeding
 * anyway.
 *
 * RESOLVING ON TIMEOUT IS DELIBERATE — it must never reject. A map that never
 * reaches idle (a style load that failed, a tab backgrounded before the first
 * idle) used to leave that promise unsettled forever, so the `await` inside
 * `ensureGeometry` never returned and that year's toggle never persisted, with
 * no timeout and no rejection to notice it by (IN-05). Rejecting instead would
 * only move the problem: `ensureGeometry`'s catch would swallow it and the layer
 * would be lost just as silently.
 *
 * Proceeding early is safe because readiness is a HINT here, not a precondition:
 * the `getSource` / `getLayer` guards downstream already tolerate a style that is
 * not quite ready, so the worst case of going early is a no-op that the next
 * toggle repeats, while the worst case of waiting forever is a wedged control.
 */
const STYLE_READY_TIMEOUT_MS = 10_000;

export class HeatmapLayer {
    map: mapboxgl.Map;
    private built: Record<HeatYear, boolean> = blankFlags();
    private visible: Record<HeatYear, boolean> = blankFlags();

    constructor(map: mapboxgl.Map) {
        this.map = map;
    }

    private whenStyleReady(): Promise<void> {
        if (this.map.isStyleLoaded()) return Promise.resolve();
        // Raced, and the loser is harmless: whichever fires first settles, and a second
        // resolve on an already-settled promise is a no-op.
        return new Promise((resolve) => {
            const settle = () => resolve();
            setTimeout(settle, STYLE_READY_TIMEOUT_MS);
            this.map.once('idle', settle);
        });
    }

    /**
     * Probe both years cheaply at map load: availability plus the "last
     * calculated" numbers, with no geometry fetched. Each year fails
     * independently — an unbuilt DC34 must not hide a live DC33.
     */
    async loadMeta(): Promise<void> {
        const metas = await Promise.all(HEAT_YEARS.map((year) => this.fetchMeta(year)));

        const next = blankState();
        HEAT_YEARS.forEach((year, i) => {
            const meta = metas[i];
            const available = meta !== null;
            // A stored ON for a year that no longer exists must not resurrect it.
            const visible = available && storedVisible(HEAT_STORE_ID[year], false);
            next[year] = {
                available,
                visible,
                generatedAt: meta?.generatedAt ?? null,
                runCount: meta?.runCount ?? 0,
                totalKm: meta?.totalKm ?? 0,
            };
            this.visible[year] = visible;
        });

        // Committed in ONE store write (never "available, off" then "on"): the layer
        // control derives collapse from an ON/OFF transition, so a two-step restore
        // would read as a user toggle and rewrite the persisted collapse state. Same
        // reasoning as `public-overlays.ts` addAggregate and `community-routes.ts`.
        heatmapState.set(next);

        // Restored-ON years load their geometry in the background. Deliberately not
        // awaited and deliberately no second store write — the state above is already
        // the truth, and ensureGeometry only drives the raw layout property.
        for (const year of HEAT_YEARS) {
            if (next[year].visible) void this.ensureGeometry(year);
        }
    }

    private async fetchMeta(year: HeatYear): Promise<HeatMeta | null> {
        try {
            // credentials omitted: this is a CDN-cached public path, and a credentialed
            // request against a shared s-maxage entry is how private data leaks into one.
            const res = await fetch(heatMetaUrl(year), { credentials: 'omit' });
            // An unbuilt year 404s — that IS the availability answer, not an error.
            if (!res.ok) return null;
            return parseMeta(await res.json());
        } catch {
            console.warn(`[heatmap] ${year} meta unavailable`);
            return null;
        }
    }

    /** Fetch and build one year's geometry. No-op once built; silent on any failure. */
    private async ensureGeometry(year: HeatYear): Promise<void> {
        if (this.built[year]) return;
        try {
            await this.whenStyleReady();
            const res = await fetch(heatUrl(year), { credentials: 'omit' });
            if (!res.ok) return;
            const parsed: unknown = await res.json();
            if (!isFeatureCollection(parsed)) return;

            const sourceId = heatSourceId(year);
            if (!this.map.getSource(sourceId)) {
                this.map.addSource(sourceId, { type: 'geojson', data: parsed });
            }
            const layerId = heatLayerId(year);
            if (!this.map.getLayer(layerId)) {
                // DC34 — the live year — wins where the two overlap. Enable order is the
                // runner's, not ours, so DC33 is inserted BENEATH an already-built DC34
                // rather than trusting "added first".
                const beneath =
                    year === 'dc33' && this.map.getLayer(heatLayerId('dc34'))
                        ? heatLayerId('dc34')
                        : undefined;
                this.map.addLayer(
                    {
                        id: layerId,
                        type: 'line',
                        source: sourceId,
                        layout: {
                            'line-join': 'round',
                            'line-cap': 'round',
                            visibility: 'none',
                        },
                        paint: HEAT_PAINT[year],
                    },
                    beneath
                );
            }
            // Raw layout property, never the public setter: that setter is a user path
            // and this can run during a page-load restore.
            this.applyVisibility(year);
            this.built[year] = true;
        } catch {
            console.warn(`[heatmap] ${year} geometry unavailable`);
        }
    }

    private applyVisibility(year: HeatYear): void {
        const layerId = heatLayerId(year);
        if (!this.map.getLayer(layerId)) return;
        this.map.setLayoutProperty(layerId, 'visibility', this.visible[year] ? 'visible' : 'none');
    }

    /** The user path: toggle one year, fetching its geometry the first time it goes on. */
    async setVisible(year: HeatYear, visible: boolean): Promise<void> {
        this.visible[year] = visible;
        if (visible && !this.built[year]) {
            await this.ensureGeometry(year);
            if (!this.visible[year]) return; // toggled off while the artifact was loading
        }
        this.applyVisibility(year);
        heatmapState.update((s) => {
            const nextState = { ...s };
            nextState[year] = { ...nextState[year], visible };
            return nextState;
        });
        setLayerVisible(HEAT_STORE_ID[year], visible);
    }

    remove(): void {
        for (const year of HEAT_YEARS) {
            const layerId = heatLayerId(year);
            if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
            const sourceId = heatSourceId(year);
            if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
            this.built[year] = false;
            this.visible[year] = false;
        }
        // The store is documented as the HEAT MAP section's source of truth, so a teardown
        // that leaves it populated makes that documentation false — the section would go on
        // rendering rows for layers that no longer exist until the next loadMeta() lands.
        heatmapState.set(blankState());
    }
}
