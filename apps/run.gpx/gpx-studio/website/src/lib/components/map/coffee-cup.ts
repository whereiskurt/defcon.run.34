import mapboxgl from 'mapbox-gl';
import { buildCupFeatures, cupOpacity, COFFEE_LOCATION } from './coffee-cup-geometry';
import { fireCoffeeEgg } from './coffee-egg';

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
    private popup = new mapboxgl.Popup({ closeButton: true, offset: 16, className: 'dc34-coffee-popup' });

    constructor(map: mapboxgl.Map) {
        this.map = map;
        void this.build();
    }

    private whenStyleReady(): Promise<void> {
        if (this.map.isStyleLoaded()) return Promise.resolve();
        return new Promise((resolve) => this.map.once('idle', () => resolve()));
    }

    private cardHtml(): string {
        // Static content only (no user input) — safe inline HTML.
        return `<div class="dc34-coffee-card" style="font:13px/1.4 system-ui,sans-serif;max-width:200px">
            <div style="font-weight:700;font-size:15px;margin-bottom:2px">☕ PublicUs</div>
            <div>Rabbit fuel stop — grab a coffee on Fremont East.</div>
            <div style="opacity:.7;margin-top:4px">1126 Fremont St, Las Vegas</div>
            <a href="https://publicuslv.com" target="_blank" rel="noopener noreferrer">publicuslv.com</a>
        </div>`;
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

            // Click the cup → PublicUs popup + covert CTF award.
            this.clickFn = (e) => {
                this.popup.setLngLat(e.lngLat).setHTML(this.cardHtml()).addTo(this.map);
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
        this.popup.remove();
        if (this.map.getLayer(LAYER)) this.map.removeLayer(LAYER);
        if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE);
        this.built = false;
    }
}
