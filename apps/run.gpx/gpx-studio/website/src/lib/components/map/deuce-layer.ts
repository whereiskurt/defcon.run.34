import mapboxgl from 'mapbox-gl';
import { openEggModal } from './egg-modal';
import { escapeHtml } from './escape-html';
import {
    DEUCE_ROUTE,
    DEUCE_STOPS,
    busStates,
    type BusState,
} from './deuce-route';
import {
    MONORAIL_ROUTE,
    MONORAIL_STATIONS,
    MONO_FLEET,
    monorailStates,
} from './monorail-route';

/**
 * DeuceLayer — the hidden Strip transit layer: the RTC Deuce bus line AND the
 * Las Vegas Monorail. For each line: a neon route line (public-overlays
 * glow+core pattern), circle markers for stops/stations (click → name popup),
 * and DOM vehicle markers (8 🚌 / 5 🚝) that crawl their tracks on a 1 s tick,
 * positions computed deterministically from wall-clock time (every viewer
 * sees the same vehicles). Monorail trains vanish outside service hours
 * (07:00–01:00 Vegas) while the guideway stays. Toggled by the deuceShown
 * store (search "deuce"/"monorail" / press 2-2-2); built lazily on first
 * reveal. Clicking a vehicle opens its egg modal.
 */

const SRC_ROUTE = 'dc34-deuce-route';
const LAYER_GLOW = 'dc34-deuce-route-glow';
const LAYER_CORE = 'dc34-deuce-route-core';
const SRC_STOPS = 'dc34-deuce-stops';
const LAYER_STOPS = 'dc34-deuce-stops-pins';
const SRC_MONO = 'dc34-mono-route';
const LAYER_MONO_GLOW = 'dc34-mono-route-glow';
const LAYER_MONO_CORE = 'dc34-mono-route-core';
const SRC_STATIONS = 'dc34-mono-stations';
const LAYER_STATIONS = 'dc34-mono-stations-pins';
const DEUCE_EGG_ID = 'dc34-deuce';
const MONO_EGG_ID = 'dc34-monorail';
const STYLE_ID = 'dc34-deuce-style';
/** RTC livery: Deuce blue + the double-decker's yellow trim. */
const LIVERY_BLUE = '#0067B1';
const LIVERY_YELLOW = '#FFD200';
/** Monorail: silver train, cyan glow — reads "elevated rail" on a dark map. */
const MONO_SILVER = '#B8C4D0';
const MONO_CYAN = '#22D3EE';
const TICK_MS = 1000;

const ALL_LINE_LAYERS = [LAYER_GLOW, LAYER_CORE, LAYER_STOPS, LAYER_MONO_GLOW, LAYER_MONO_CORE, LAYER_STATIONS];
const ALL_SOURCES = [SRC_ROUTE, SRC_STOPS, SRC_MONO, SRC_STATIONS];

/** Inject the vehicle-marker CSS once (keyframes can't be inlined on elements). */
function ensureStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
.dc34-deuce-bus{display:flex;flex-direction:column;align-items:center;cursor:pointer;user-select:none;line-height:1;pointer-events:auto;}
.dc34-deuce-bus-emoji{font-size:26px;animation:dc34deucebob 2.4s ease-in-out infinite;filter:drop-shadow(0 0 .18em rgba(0,103,177,.9)) drop-shadow(0 .06em .12em rgba(0,0,0,.5));}
/* vehicles heading back up the route face the other way (emoji art faces left) */
.dc34-deuce-bus.dc34-deuce-nb .dc34-deuce-bus-emoji{transform:scaleX(-1);}
.dc34-deuce-label{margin-top:3px;background:${LIVERY_BLUE};color:${LIVERY_YELLOW};border:1px solid ${LIVERY_YELLOW};border-radius:8px;padding:1px 6px;text-align:center;font:700 9px/1.3 system-ui,sans-serif;letter-spacing:.08em;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.45);}
.dc34-mono-train .dc34-deuce-bus-emoji{filter:drop-shadow(0 0 .18em rgba(34,211,238,.9)) drop-shadow(0 .06em .12em rgba(0,0,0,.5));}
.dc34-mono-train .dc34-deuce-label{background:#1E2A36;color:${MONO_CYAN};border-color:${MONO_CYAN};}
@keyframes dc34deucebob{0%,100%{transform:translateY(0)}50%{transform:translateY(-.09em)}}
@media (prefers-reduced-motion: reduce){
  /* kill the bob only — position ticks and visibility are never gated */
  .dc34-deuce-bus-emoji{animation:none}
}`;
    document.head.appendChild(s);
}

type VehicleMarker = { marker: mapboxgl.Marker; el: HTMLElement; attached: boolean };

export class DeuceLayer {
    map: mapboxgl.Map;
    private popup = new mapboxgl.Popup({
        closeButton: false,
        offset: 10,
        className: 'dc34-route-popup dc34-deuce-popup',
    });
    private buses: VehicleMarker[] = [];
    private trains: VehicleMarker[] = [];
    private timer: ReturnType<typeof setInterval> | null = null;
    private stopClickFn: ((e: mapboxgl.MapMouseEvent) => void) | null = null;
    private stationClickFn: ((e: mapboxgl.MapMouseEvent) => void) | null = null;
    private built = false;
    private visible = false;

    constructor(map: mapboxgl.Map) {
        this.map = map;
    }

    private whenStyleReady(): Promise<void> {
        if (this.map.isStyleLoaded()) return Promise.resolve();
        return new Promise((resolve) => this.map.once('idle', () => resolve()));
    }

    private addLineWithGlow(
        src: string,
        glowId: string,
        coreId: string,
        coords: [number, number][],
        color: string,
        coreWidth: number
    ) {
        if (!this.map.getSource(src)) {
            this.map.addSource(src, {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'LineString', coordinates: coords },
                },
            });
        }
        // Wide, blurred glow beneath — the DEF CON neon look (public-overlays).
        if (!this.map.getLayer(glowId)) {
            this.map.addLayer({
                id: glowId,
                type: 'line',
                source: src,
                layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
                paint: { 'line-color': color, 'line-width': 10, 'line-blur': 6, 'line-opacity': 0.35 },
            });
        }
        if (!this.map.getLayer(coreId)) {
            this.map.addLayer({
                id: coreId,
                type: 'line',
                source: src,
                layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
                paint: { 'line-color': color, 'line-width': coreWidth, 'line-opacity': 0.9 },
            });
        }
    }

    private addPins(
        src: string,
        layerId: string,
        pts: { name: string; lngLat: [number, number] }[],
        fill: string,
        stroke: string
    ) {
        if (!this.map.getSource(src)) {
            this.map.addSource(src, {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: pts.map((s) => ({
                        type: 'Feature' as const,
                        properties: { name: s.name },
                        geometry: { type: 'Point' as const, coordinates: s.lngLat },
                    })),
                },
            });
        }
        if (!this.map.getLayer(layerId)) {
            this.map.addLayer({
                id: layerId,
                type: 'circle',
                source: src,
                layout: { visibility: 'none' },
                paint: {
                    'circle-radius': 4.5,
                    'circle-color': fill,
                    'circle-stroke-color': stroke,
                    'circle-stroke-width': 2,
                    'circle-opacity': 0.95,
                },
            });
        }
    }

    private pinPopupHandler(icon: string, sub: string) {
        return (e: mapboxgl.MapMouseEvent) => {
            const f = (e as unknown as { features?: GeoJSON.Feature[] }).features?.[0];
            if (!f) return;
            const name = String((f.properties ?? {}).name ?? 'Stop');
            this.popup
                .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
                .setHTML(
                    `<div class="dc34-deuce-stop"><strong>${icon} ${escapeHtml(name)}</strong>` +
                    `<span>${escapeHtml(sub)}</span></div>`
                )
                .addTo(this.map);
        };
    }

    private async build() {
        await this.whenStyleReady();
        ensureStyle();
        this.addLineWithGlow(SRC_ROUTE, LAYER_GLOW, LAYER_CORE, DEUCE_ROUTE, LIVERY_BLUE, 3.5);
        this.addPins(SRC_STOPS, LAYER_STOPS, DEUCE_STOPS, LIVERY_YELLOW, LIVERY_BLUE);
        this.addLineWithGlow(SRC_MONO, LAYER_MONO_GLOW, LAYER_MONO_CORE, MONORAIL_ROUTE, MONO_CYAN, 2.5);
        this.addPins(SRC_STATIONS, LAYER_STATIONS, MONORAIL_STATIONS, MONO_SILVER, '#1E2A36');
        if (!this.stopClickFn) {
            this.stopClickFn = this.pinPopupHandler('🚏', 'Deuce — every ~17 min, 24/7');
            this.map.on('click', LAYER_STOPS, this.stopClickFn);
        }
        if (!this.stationClickFn) {
            this.stationClickFn = this.pinPopupHandler('🚝', 'Monorail — every ~6 min, 7am–1am');
            this.map.on('click', LAYER_STATIONS, this.stationClickFn);
        }
        this.built = true;
    }

    private makeVehicle(cls: string, emoji: string, label: string, title: string, eggId: string): VehicleMarker {
        const el = document.createElement('div');
        el.className = `dc34-deuce-bus ${cls}`.trim();
        el.title = title;
        el.innerHTML =
            `<div class="dc34-deuce-bus-emoji">${emoji}</div>` +
            `<div class="dc34-deuce-label">${label}</div>`;
        const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' });
        const v: VehicleMarker = { marker, el, attached: false };
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            void openEggModal(this.map, eggId, marker.getLngLat().toArray() as [number, number]);
        });
        return v;
    }

    private buildMarkers() {
        if (!this.buses.length) {
            for (const b of busStates(Date.now())) {
                const v = this.makeVehicle('', '🚌', 'DEUCE', 'The Deuce — double-decker down the Strip', DEUCE_EGG_ID);
                v.marker.setLngLat(b.lngLat);
                this.buses.push(v);
            }
        }
        if (!this.trains.length) {
            for (let k = 0; k < MONO_FLEET; k++) {
                const v = this.makeVehicle('dc34-mono-train', '🚝', 'MONORAIL', 'Las Vegas Monorail', MONO_EGG_ID);
                v.marker.setLngLat(MONORAIL_ROUTE[0]);
                this.trains.push(v);
            }
        }
    }

    private syncFleet(fleet: VehicleMarker[], states: BusState[]) {
        for (let k = 0; k < fleet.length; k++) {
            const v = fleet[k];
            const s = states[k];
            if (!s || !this.visible) {
                // out of service (monorail overnight) or layer hidden
                if (v.attached) {
                    v.marker.remove();
                    v.attached = false;
                }
                continue;
            }
            v.marker.setLngLat(s.lngLat);
            v.el.classList.toggle('dc34-deuce-nb', !s.southbound);
            if (!v.attached) {
                v.marker.addTo(this.map);
                v.attached = true;
            }
        }
    }

    /** Move every vehicle to its wall-clock position. */
    private tick() {
        const now = Date.now();
        this.syncFleet(this.buses, busStates(now));
        this.syncFleet(this.trains, monorailStates(now));
    }

    private setLayersVisible(v: 'visible' | 'none') {
        for (const id of ALL_LINE_LAYERS) {
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
            if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
        } else {
            this.setLayersVisible('none');
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
            for (const v of [...this.buses, ...this.trains]) {
                if (v.attached) {
                    v.marker.remove();
                    v.attached = false;
                }
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
        for (const v of [...this.buses, ...this.trains]) v.marker.remove();
        this.buses = [];
        this.trains = [];
        if (this.stopClickFn) {
            this.map.off('click', LAYER_STOPS, this.stopClickFn);
            this.stopClickFn = null;
        }
        if (this.stationClickFn) {
            this.map.off('click', LAYER_STATIONS, this.stationClickFn);
            this.stationClickFn = null;
        }
        for (const id of ALL_LINE_LAYERS) {
            if (this.map.getLayer(id)) this.map.removeLayer(id);
        }
        for (const id of ALL_SOURCES) {
            if (this.map.getSource(id)) this.map.removeSource(id);
        }
        this.built = false;
    }
}
