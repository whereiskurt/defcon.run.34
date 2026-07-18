import mapboxgl from 'mapbox-gl';
import { buildCupFeatures, cupOpacity, COFFEE_LOCATION } from './coffee-cup-geometry';
import { fireCoffeeEgg } from './coffee-egg';
import { openEggModal } from './egg-modal';

const EGG_ID = 'dc34-coffee';

const SOURCE = 'dc34-coffee';
const LAYER = 'dc34-coffee-cup';

/**
 * The giant translucent PublicUs coffee cup (see coffee-cup-geometry). Mirrors
 * the rainbow arch's fill-extrusion + pitch-opacity lifecycle, but is ALWAYS
 * built and visible (faint overhead, blooms when tilted). Searching
 * `publicus`/`coffee` sets coffeeUnlocked → setUnlocked(true), which rebuilds
 * the source with steam and raises the opacity ceiling. Clicking the cup opens a
 * PublicUs popup and fires the covert coffee-egg CTF award.
 */
export class CoffeeCup {
    map: mapboxgl.Map;
    private built = false;
    private unlocked = false;
    private pitchFn: (() => void) | null = null;
    private clickFn: ((e: mapboxgl.MapMouseEvent) => void) | null = null;
    private enterFn: (() => void) | null = null;
    private leaveFn: (() => void) | null = null;

    constructor(map: mapboxgl.Map) {
        this.map = map;
        void this.build();
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
                data: buildCupFeatures({ unlocked: this.unlocked })
            });
        }
        if (!this.map.getLayer(LAYER)) {
            this.map.addLayer({
                id: LAYER,
                type: 'fill-extrusion',
                source: SOURCE,
                paint: {
                    'fill-extrusion-color': ['get', 'color'],
                    'fill-extrusion-height': ['get', 'height'],
                    'fill-extrusion-base': ['get', 'base'],
                    'fill-extrusion-opacity': 0,
                    'fill-extrusion-vertical-gradient': true
                }
            });
            this.pitchFn = () => this.applyOpacity();
            this.map.on('pitch', this.pitchFn);

            // Click the cup → route-style PublicUs modal + covert CTF award.
            this.clickFn = (e) => {
                void openEggModal(this.map, EGG_ID, e.lngLat);
                fireCoffeeEgg();
            };
            this.map.on('click', LAYER, this.clickFn);

            // Pointer affordance.
            this.enterFn = () => (this.map.getCanvas().style.cursor = 'pointer');
            this.leaveFn = () => (this.map.getCanvas().style.cursor = '');
            this.map.on('mouseenter', LAYER, this.enterFn);
            this.map.on('mouseleave', LAYER, this.leaveFn);
        }
        this.built = true;
        this.applyOpacity();
    }

    private applyOpacity() {
        if (!this.map.getLayer(LAYER)) return;
        this.map.setPaintProperty(LAYER, 'fill-extrusion-opacity', cupOpacity(this.map.getPitch(), this.unlocked));
    }

    /** Search-triggered bonus: rebuild with steam + raise the opacity ceiling. */
    async setUnlocked(on: boolean) {
        this.unlocked = on;
        if (!this.built) await this.build();
        const src = this.map.getSource(SOURCE) as mapboxgl.GeoJSONSource | undefined;
        if (src) src.setData(buildCupFeatures({ unlocked: on }));
        this.applyOpacity();
    }

    /** Recentre the map on the cup (used by "fly to PublicUs" flows if wired). */
    static readonly location = COFFEE_LOCATION;

    remove() {
        if (this.pitchFn) this.map.off('pitch', this.pitchFn);
        if (this.clickFn) this.map.off('click', LAYER, this.clickFn);
        if (this.enterFn) this.map.off('mouseenter', LAYER, this.enterFn);
        if (this.leaveFn) this.map.off('mouseleave', LAYER, this.leaveFn);
        this.pitchFn = this.clickFn = this.enterFn = this.leaveFn = null;
        if (this.map.getLayer(LAYER)) this.map.removeLayer(LAYER);
        if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE);
        this.built = false;
    }
}
