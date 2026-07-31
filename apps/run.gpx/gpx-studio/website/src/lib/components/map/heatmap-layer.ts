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
 * Width and opacity are year-independent and Kurt-locked (D-02).
 *
 * DC33's own renderer used opacity 0.7 / weight 4, but that was Leaflet drawing
 * one polyline per activity; Mapbox composites a single multi-feature source far
 * more aggressively, and the shipped in-repo precedent for this exact effect is
 * `public-overlays.ts` `addAggregate()` at opacity 0.15 / width 2. 0.25 at width
 * 3 sits deliberately between the two.
 */
const HEAT_STROKE = { 'line-width': 3, 'line-opacity': 0.25 } as const;

/** DC34 flame red, DC33 ember orange (D-02, Kurt-locked). */
const HEAT_PAINT: Record<HeatYear, HeatStroke> = {
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
 * Structural gate on untrusted geometry (T-71-21): only a FeatureCollection with
 * a non-empty feature array is ever handed to `addSource`. Anything else is not
 * a heat map and is dropped without touching the map.
 */
function isFeatureCollection(v: unknown): v is GeoJSON.FeatureCollection {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    const o = v as { type?: unknown; features?: unknown };
    return o.type === 'FeatureCollection' && Array.isArray(o.features) && o.features.length > 0;
}

export class HeatmapLayer {
    map: mapboxgl.Map;
    private built: Record<HeatYear, boolean> = blankFlags();
    private visible: Record<HeatYear, boolean> = blankFlags();

    constructor(map: mapboxgl.Map) {
        this.map = map;
    }

    private whenStyleReady(): Promise<void> {
        if (this.map.isStyleLoaded()) return Promise.resolve();
        return new Promise((resolve) => this.map.once('idle', () => resolve()));
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
    }
}
