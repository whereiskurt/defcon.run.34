import mapboxgl from 'mapbox-gl';
import { buildRainbowFeatures, pitchOpacity, RAINBOW_ARCHES } from './rainbow-geometry';

const SOURCE = 'dc34-rainbow';
const LAYER = 'dc34-rainbow-arch';

/**
 * The hidden "Rainbow Bridges" easter egg — pride-coloured fill-extrusion arches
 * (LVCC ↔ ReBar, plus any others in RAINBOW_ARCHES). Mirrors GhostLayer's
 * lifecycle. Doubly hidden: the layer is only built + shown once the egg is
 * unlocked (see stores/rainbow.ts), and even then its opacity is driven by map
 * pitch (invisible flat, full when tilted).
 */
export class RainbowArch {
    map: mapboxgl.Map;
    private built = false;
    private unlocked = false;
    private pitchFn: (() => void) | null = null;

    constructor(map: mapboxgl.Map) {
        this.map = map;
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
                    'fill-extrusion-base': 0,
                    'fill-extrusion-opacity': 0,
                    'fill-extrusion-vertical-gradient': true
                }
            });
            // Reveal ramps with pitch, live.
            this.pitchFn = () => this.applyOpacity();
            this.map.on('pitch', this.pitchFn);
        }
        this.built = true;
    }

    private applyOpacity() {
        if (!this.map.getLayer(LAYER)) return;
        const o = this.unlocked ? pitchOpacity(this.map.getPitch()) : 0;
        this.map.setPaintProperty(LAYER, 'fill-extrusion-opacity', o);
    }

    /** Flip with the hidden rainbowUnlocked store. Builds lazily on first unlock. */
    async setUnlocked(on: boolean) {
        this.unlocked = on;
        if (on && !this.built) await this.build();
        if (this.map.getLayer(LAYER)) {
            this.map.setLayoutProperty(LAYER, 'visibility', on ? 'visible' : 'none');
        }
        this.applyOpacity();
    }

    remove() {
        if (this.pitchFn) {
            this.map.off('pitch', this.pitchFn);
            this.pitchFn = null;
        }
        if (this.map.getLayer(LAYER)) this.map.removeLayer(LAYER);
        if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE);
        this.built = false;
    }
}
