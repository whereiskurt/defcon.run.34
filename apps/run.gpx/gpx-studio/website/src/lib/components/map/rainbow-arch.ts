import mapboxgl from 'mapbox-gl';
import { buildRainbowFeatures, isArchActiveNow, RAINBOW_ARCHES, pitchOpacity } from './rainbow-geometry';
import { openEggModal } from './egg-modal';

const SOURCE = 'dc34-rainbow';
const LAYER = 'dc34-rainbow-arch';
const TICK_MS = 60_000; // re-evaluate schedule windows once a minute

/**
 * The hidden "Rainbow Bridges" easter egg — pride- and weed-coloured
 * fill-extrusion arches (see RAINBOW_ARCHES). Mirrors GhostLayer's lifecycle.
 *
 * Each arch declares its own gate (see rainbow-geometry `isArchActiveNow`):
 * unlock-gated arches stay hidden until the egg is unlocked; a scheduled arch is
 * *publicly* visible inside its window, and every arch is revealed once unlocked.
 * All arches share one source + one fill-extrusion layer; which ones render is
 * driven by a Mapbox filter on `archId`, and overall opacity ramps with pitch.
 *
 * Because a scheduled arch can appear without an unlock, the layer is built
 * lazily the first time *anything* is active (unlock OR a window opening), and a
 * 60s timer re-evaluates so windows open/close on their own.
 */
export class RainbowArch {
    map: mapboxgl.Map;
    private built = false;
    private unlocked = false;
    private pitchFn: (() => void) | null = null;
    private clickFn: ((e: mapboxgl.MapMouseEvent) => void) | null = null;
    private enterFn: (() => void) | null = null;
    private leaveFn: (() => void) | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(map: mapboxgl.Map) {
        this.map = map;
        // Drive scheduled arches even without an unlock: tick forever, building
        // lazily and re-applying state so windows open and close on time.
        this.timer = setInterval(() => void this.applyState(), TICK_MS);
        void this.applyState();
    }

    private whenStyleReady(): Promise<void> {
        if (this.map.isStyleLoaded()) return Promise.resolve();
        return new Promise((resolve) => this.map.once('idle', () => resolve()));
    }

    private async build() {
        await this.whenStyleReady();
        if (!this.map.getSource(SOURCE)) {
            this.map.addSource(SOURCE, {
                type: 'geojson',
                data: buildRainbowFeatures(RAINBOW_ARCHES)
            });
        }
        if (!this.map.getLayer(LAYER)) {
            this.map.addLayer({
                id: LAYER,
                type: 'fill-extrusion',
                source: SOURCE,
                layout: { visibility: 'none' },
                paint: {
                    'fill-extrusion-color': ['get', 'color'],
                    'fill-extrusion-height': ['get', 'height'],
                    'fill-extrusion-base': ['get', 'base'],
                    'fill-extrusion-opacity': 0,
                    'fill-extrusion-vertical-gradient': true
                }
            });
            // Reveal ramps with pitch, live.
            this.pitchFn = () => this.applyOpacity();
            this.map.on('pitch', this.pitchFn);

            // Click an arch → its route-style modal (keyed by the feature's archId).
            this.clickFn = (e) => {
                const f = (e as unknown as { features?: GeoJSON.Feature[] }).features?.[0];
                const archId = f?.properties?.archId as string | undefined;
                if (archId) void openEggModal(this.map, archId, e.lngLat);
            };
            this.map.on('click', LAYER, this.clickFn);

            // Pointer affordance.
            this.enterFn = () => (this.map.getCanvas().style.cursor = 'pointer');
            this.leaveFn = () => (this.map.getCanvas().style.cursor = '');
            this.map.on('mouseenter', LAYER, this.enterFn);
            this.map.on('mouseleave', LAYER, this.leaveFn);
        }
        this.built = true;
    }

    /** Which arch ids should render right now (unlock + schedule). */
    private activeArchIds(): string[] {
        const now = new Date();
        return RAINBOW_ARCHES.filter((a) => isArchActiveNow(a, { unlocked: this.unlocked, now })).map(
            (a) => a.id
        );
    }

    private applyOpacity() {
        if (!this.map.getLayer(LAYER)) return;
        const o = this.activeArchIds().length > 0 ? pitchOpacity(this.map.getPitch()) : 0;
        this.map.setPaintProperty(LAYER, 'fill-extrusion-opacity', o);
    }

    /**
     * Recompute visibility from unlock + schedule. Builds the layer lazily the
     * first time any arch is active; then shows only the active arches via a
     * per-`archId` filter and ramps opacity with pitch.
     */
    private async applyState() {
        const activeIds = this.activeArchIds();
        if (activeIds.length === 0 && !this.built) return; // nothing to show yet
        if (!this.built) await this.build();
        if (!this.map.getLayer(LAYER)) return;

        this.map.setFilter(LAYER, ['in', ['get', 'archId'], ['literal', activeIds]]);
        this.map.setLayoutProperty(LAYER, 'visibility', activeIds.length > 0 ? 'visible' : 'none');
        this.applyOpacity();
    }

    /** Flip with the hidden rainbowUnlocked store. */
    async setUnlocked(on: boolean) {
        this.unlocked = on;
        await this.applyState();
    }

    remove() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.pitchFn) {
            this.map.off('pitch', this.pitchFn);
            this.pitchFn = null;
        }
        if (this.clickFn) this.map.off('click', LAYER, this.clickFn);
        if (this.enterFn) this.map.off('mouseenter', LAYER, this.enterFn);
        if (this.leaveFn) this.map.off('mouseleave', LAYER, this.leaveFn);
        this.clickFn = this.enterFn = this.leaveFn = null;
        if (this.map.getLayer(LAYER)) this.map.removeLayer(LAYER);
        if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE);
        this.built = false;
    }
}
