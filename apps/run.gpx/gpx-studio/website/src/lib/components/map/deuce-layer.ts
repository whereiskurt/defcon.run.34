import mapboxgl from 'mapbox-gl';
import { openEggModal } from './egg-modal';
import { escapeHtml } from './escape-html';
import {
    DEUCE_ROUTE,
    DEUCE_STOPS,
    busStates,
    type BusState,
} from './deuce-route';

/**
 * DeuceLayer — the hidden RTC Deuce bus line down the Strip. Three pieces:
 * a neon route line (public-overlays glow+core pattern), circle markers for
 * the named stops (click → stop-name popup), and 8 DOM 🚌 markers that crawl
 * the boulevard on a 1 s tick, positions computed deterministically from
 * wall-clock time (deuce-route.ts busStates — every viewer sees the same
 * buses). Toggled by the deuceShown store (search "deuce" / press 2-2-2);
 * built lazily on first reveal. Clicking a bus opens the dc34-deuce egg modal.
 */

const SRC_ROUTE = 'dc34-deuce-route';
const LAYER_GLOW = 'dc34-deuce-route-glow';
const LAYER_CORE = 'dc34-deuce-route-core';
const SRC_STOPS = 'dc34-deuce-stops';
const LAYER_STOPS = 'dc34-deuce-stops-pins';
const EGG_ID = 'dc34-deuce';
const STYLE_ID = 'dc34-deuce-style';
/** RTC livery: Deuce blue + the double-decker's yellow trim. */
const LIVERY_BLUE = '#0067B1';
const LIVERY_YELLOW = '#FFD200';
const TICK_MS = 1000;

/** Inject the bus-marker CSS once (keyframes can't be inlined on elements). */
function ensureStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
.dc34-deuce-bus{display:flex;flex-direction:column;align-items:center;cursor:pointer;user-select:none;line-height:1;pointer-events:auto;}
.dc34-deuce-bus-emoji{font-size:26px;animation:dc34deucebob 2.4s ease-in-out infinite;filter:drop-shadow(0 0 .18em rgba(0,103,177,.9)) drop-shadow(0 .06em .12em rgba(0,0,0,.5));}
/* northbound buses face the other way (emoji art faces left by default) */
.dc34-deuce-bus.dc34-deuce-nb .dc34-deuce-bus-emoji{transform:scaleX(-1);}
.dc34-deuce-label{margin-top:3px;background:${LIVERY_BLUE};color:${LIVERY_YELLOW};border:1px solid ${LIVERY_YELLOW};border-radius:8px;padding:1px 6px;text-align:center;font:700 9px/1.3 system-ui,sans-serif;letter-spacing:.08em;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.45);}
@keyframes dc34deucebob{0%,100%{transform:translateY(0)}50%{transform:translateY(-.09em)}}
@media (prefers-reduced-motion: reduce){
  /* kill the bob only — position ticks and visibility are never gated */
  .dc34-deuce-bus-emoji{animation:none}
}`;
    document.head.appendChild(s);
}

export class DeuceLayer {
    map: mapboxgl.Map;
    private popup = new mapboxgl.Popup({
        closeButton: false,
        offset: 10,
        className: 'dc34-route-popup dc34-deuce-popup',
    });
    private markers: { marker: mapboxgl.Marker; el: HTMLElement }[] = [];
    private timer: ReturnType<typeof setInterval> | null = null;
    private stopClickFn: ((e: mapboxgl.MapMouseEvent) => void) | null = null;
    private built = false;
    private visible = false;

    constructor(map: mapboxgl.Map) {
        this.map = map;
    }

    private whenStyleReady(): Promise<void> {
        if (this.map.isStyleLoaded()) return Promise.resolve();
        return new Promise((resolve) => this.map.once('idle', () => resolve()));
    }

    private async build() {
        await this.whenStyleReady();
        ensureStyle();
        if (!this.map.getSource(SRC_ROUTE)) {
            this.map.addSource(SRC_ROUTE, {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'LineString', coordinates: DEUCE_ROUTE },
                },
            });
        }
        // Wide, blurred glow beneath — the DEF CON neon look (public-overlays).
        if (!this.map.getLayer(LAYER_GLOW)) {
            this.map.addLayer({
                id: LAYER_GLOW,
                type: 'line',
                source: SRC_ROUTE,
                layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
                paint: {
                    'line-color': LIVERY_BLUE,
                    'line-width': 10,
                    'line-blur': 6,
                    'line-opacity': 0.35,
                },
            });
        }
        if (!this.map.getLayer(LAYER_CORE)) {
            this.map.addLayer({
                id: LAYER_CORE,
                type: 'line',
                source: SRC_ROUTE,
                layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
                paint: {
                    'line-color': LIVERY_BLUE,
                    'line-width': 3.5,
                    'line-opacity': 0.9,
                },
            });
        }
        if (!this.map.getSource(SRC_STOPS)) {
            this.map.addSource(SRC_STOPS, {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: DEUCE_STOPS.map((s) => ({
                        type: 'Feature' as const,
                        properties: { name: s.name },
                        geometry: { type: 'Point' as const, coordinates: s.lngLat },
                    })),
                },
            });
        }
        if (!this.map.getLayer(LAYER_STOPS)) {
            this.map.addLayer({
                id: LAYER_STOPS,
                type: 'circle',
                source: SRC_STOPS,
                layout: { visibility: 'none' },
                paint: {
                    'circle-radius': 4.5,
                    'circle-color': LIVERY_YELLOW,
                    'circle-stroke-color': LIVERY_BLUE,
                    'circle-stroke-width': 2,
                    'circle-opacity': 0.95,
                },
            });
            this.stopClickFn = (e) => {
                const f = (e as unknown as { features?: GeoJSON.Feature[] }).features?.[0];
                if (!f) return;
                const name = String((f.properties ?? {}).name ?? 'Deuce stop');
                this.popup
                    .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
                    .setHTML(
                        `<div class="dc34-deuce-stop"><strong>🚏 ${escapeHtml(name)}</strong>` +
                        `<span>Deuce — every ~17 min, 24/7</span></div>`
                    )
                    .addTo(this.map);
            };
            this.map.on('click', LAYER_STOPS, this.stopClickFn);
        }
        this.built = true;
    }

    private buildMarkers() {
        if (this.markers.length) return;
        for (const b of busStates(Date.now())) {
            const el = document.createElement('div');
            el.className = 'dc34-deuce-bus';
            el.title = 'The Deuce — double-decker down the Strip';
            el.innerHTML =
                '<div class="dc34-deuce-bus-emoji">🚌</div>' +
                '<div class="dc34-deuce-label">DEUCE</div>';
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const m = this.markers[b.id]?.marker;
                void openEggModal(this.map, EGG_ID, (m?.getLngLat().toArray() as [number, number]) ?? b.lngLat);
            });
            const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat(b.lngLat);
            this.markers.push({ marker, el });
        }
    }

    /** Move every bus to its wall-clock position; flip northbound art. */
    private tick() {
        const states: BusState[] = busStates(Date.now());
        for (const b of states) {
            const m = this.markers[b.id];
            if (!m) continue;
            m.marker.setLngLat(b.lngLat);
            m.el.classList.toggle('dc34-deuce-nb', !b.southbound);
        }
    }

    private setLayersVisible(v: 'visible' | 'none') {
        for (const id of [LAYER_GLOW, LAYER_CORE, LAYER_STOPS]) {
            if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', v);
        }
    }

    async setVisible(visible: boolean) {
        this.visible = visible;
        if (visible) {
            if (!this.built) await this.build();
            if (!this.visible) return; // toggled off while style was loading
            this.setLayersVisible('visible');
            this.buildMarkers();
            this.tick();
            for (const m of this.markers) m.marker.addTo(this.map);
            if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
        } else {
            this.setLayersVisible('none');
            for (const m of this.markers) m.marker.remove();
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
            this.popup.remove();
        }
    }

    remove() {
        this.popup.remove();
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        for (const m of this.markers) m.marker.remove();
        this.markers = [];
        if (this.stopClickFn) {
            this.map.off('click', LAYER_STOPS, this.stopClickFn);
            this.stopClickFn = null;
        }
        for (const id of [LAYER_GLOW, LAYER_CORE, LAYER_STOPS]) {
            if (this.map.getLayer(id)) this.map.removeLayer(id);
        }
        for (const id of [SRC_ROUTE, SRC_STOPS]) {
            if (this.map.getSource(id)) this.map.removeSource(id);
        }
        this.built = false;
    }
}
