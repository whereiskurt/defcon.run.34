import mapboxgl from 'mapbox-gl';
import { buildRainbowFeatures, isArchActiveNow, RAINBOW_ARCHES, pitchOpacity } from './rainbow-geometry';
import { openEggModal } from './egg-modal';

const SOURCE = 'dc34-rainbow';
const LAYER = 'dc34-rainbow-arch';
const BOOST_LAYER = 'dc34-rainbow-arch-boost'; // arches with a custom opacity ramp
const TICK_MS = 60_000; // re-evaluate schedule windows once a minute

/**
 * The hidden "Rainbow Bridges" easter egg — pride- and weed-coloured
 * fill-extrusion arches (see RAINBOW_ARCHES). Mirrors GhostLayer's lifecycle.
 *
 * Each arch declares its own gate (see rainbow-geometry `isArchActiveNow`):
 * unlock-gated arches stay hidden until the egg is unlocked; a scheduled arch is
 * *publicly* visible inside its window, and every arch is revealed once unlocked.
 * All arches share one geojson source; default-ramp arches render on one
 * fill-extrusion layer and `opacity`-declaring arches on a boost layer with a
 * punchier ramp. Which arches render is driven by Mapbox filters on `archId`,
 * and opacity ramps with pitch.
 *
 * Because a scheduled arch can appear without an unlock, the layer is built
 * lazily the first time *anything* is active (unlock OR a window opening), and a
 * 60s timer re-evaluates so windows open/close on their own.
 */
export class RainbowArch {
    map: mapboxgl.Map;
    private built = false;
    private unlocked = false;
    private forced: string[] = [];
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
            // Two identical layers over the one source: LAYER carries default-ramp
            // arches, BOOST_LAYER the ones declaring `opacity` in the roster —
            // fill-extrusion-opacity is layer-wide (not data-driven), so a
            // punchier ramp needs its own layer.
            for (const id of [LAYER, BOOST_LAYER]) {
                this.map.addLayer({
                    id,
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
            }
            // Reveal ramps with pitch, live.
            this.pitchFn = () => this.applyOpacity();
            this.map.on('pitch', this.pitchFn);

            // Click an arch → its route-style modal (keyed by the feature's archId).
            this.clickFn = (e) => {
                const f = (e as unknown as { features?: GeoJSON.Feature[] }).features?.[0];
                const archId = f?.properties?.archId as string | undefined;
                if (archId) void openEggModal(this.map, archId, e.lngLat);
            };
            // Pointer affordance.
            this.enterFn = () => (this.map.getCanvas().style.cursor = 'pointer');
            this.leaveFn = () => (this.map.getCanvas().style.cursor = '');
            for (const id of [LAYER, BOOST_LAYER]) {
                this.map.on('click', id, this.clickFn);
                this.map.on('mouseenter', id, this.enterFn);
                this.map.on('mouseleave', id, this.leaveFn);
            }
        }
        this.built = true;
    }

    /** Which arch ids should render right now (unlock + schedule + search toggles). */
    private activeArchIds(): string[] {
        const now = new Date();
        const ids = RAINBOW_ARCHES.filter((a) =>
            isArchActiveNow(a, { unlocked: this.unlocked, now })
        ).map((a) => a.id);
        // Search-keyword toggles (ARCH_SEARCH_WORDS) force-show single arches,
        // independent of the master unlock; still pitch-revealed like the rest.
        for (const id of this.forced) if (!ids.includes(id)) ids.push(id);
        return ids;
    }

    /** Split active ids between the default-ramp layer and the boost layer. */
    private partitionActive(): { main: string[]; boost: string[] } {
        const ids = this.activeArchIds();
        const boosted = new Set(RAINBOW_ARCHES.filter((a) => a.opacity).map((a) => a.id));
        return {
            main: ids.filter((id) => !boosted.has(id)),
            boost: ids.filter((id) => boosted.has(id))
        };
    }

    private applyOpacity() {
        if (!this.map.getLayer(LAYER)) return;
        const { main, boost } = this.partitionActive();
        const pitch = this.map.getPitch();
        this.map.setPaintProperty(
            LAYER,
            'fill-extrusion-opacity',
            main.length > 0 ? pitchOpacity(pitch) : 0
        );
        // Boosted arches share one ramp profile (first `opacity` in the roster wins).
        const prof = RAINBOW_ARCHES.find((a) => a.opacity)?.opacity;
        if (this.map.getLayer(BOOST_LAYER)) {
            this.map.setPaintProperty(
                BOOST_LAYER,
                'fill-extrusion-opacity',
                boost.length > 0 && prof ? pitchOpacity(pitch, 0, 60, prof.max, prof.floor) : 0
            );
        }
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

        const { main, boost } = this.partitionActive();
        this.map.setFilter(LAYER, ['in', ['get', 'archId'], ['literal', main]]);
        this.map.setLayoutProperty(LAYER, 'visibility', main.length > 0 ? 'visible' : 'none');
        if (this.map.getLayer(BOOST_LAYER)) {
            this.map.setFilter(BOOST_LAYER, ['in', ['get', 'archId'], ['literal', boost]]);
            this.map.setLayoutProperty(
                BOOST_LAYER,
                'visibility',
                boost.length > 0 ? 'visible' : 'none'
            );
        }
        this.applyOpacity();
    }

    /** Flip with the hidden rainbowUnlocked store. */
    async setUnlocked(on: boolean) {
        this.unlocked = on;
        await this.applyState();
    }

    /** Follow the forcedArchIds store — force-show the searched-for arches. */
    async setForced(ids: string[]) {
        this.forced = ids;
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
        for (const id of [LAYER, BOOST_LAYER]) {
            if (this.clickFn) this.map.off('click', id, this.clickFn);
            if (this.enterFn) this.map.off('mouseenter', id, this.enterFn);
            if (this.leaveFn) this.map.off('mouseleave', id, this.leaveFn);
            if (this.map.getLayer(id)) this.map.removeLayer(id);
        }
        this.clickFn = this.enterFn = this.leaveFn = null;
        if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE);
        this.built = false;
    }
}
