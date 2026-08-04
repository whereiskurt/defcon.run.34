import mapboxgl from 'mapbox-gl';
import { writable } from 'svelte/store';
import { shuttleSvg } from './shuttle-svg';
import { escapeHtml } from './escape-html';
import { openEggModal } from './egg-modal';
import { addInBand } from '$lib/components/map/z-bands';

const SOURCE = 'dc34-shuttles';
const LAYER = 'dc34-shuttles-buses';
const SHUTTLE_EGG_ID = 'dc34-bsides-shuttle';
const POLL_MS = 45_000;

/**
 * A bus that has not reported for this long is drawn dimmed.
 *
 * Mirrors STALE_AFTER_MS in the webapp's `lib/bsides-shuttles.ts`. The studio is
 * a separate package and cannot import from the webapp, so the threshold is
 * restated rather than shared — it is one number, and the alternative is a build
 * dependency between the two trees.
 */
const STALE_AFTER_MS = 30 * 60 * 1000;

const FALLBACK_HEX = '#94A3B8';

/** Region prefix = path before '/studio' (mirrors rabbit-layer's rabbitUrl). */
function shuttleUrl(): string {
    const path = window.location.pathname;
    const i = path.indexOf('/studio');
    const prefix = i > 0 ? path.slice(0, i) : '';
    return `${prefix}/api/gpx/public/shuttles`;
}

/** Coarse "2 minutes ago" / "10h ago" phrasing for the popup. */
function ago(ms: number): string {
    const mins = Math.floor(ms / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

export type ShuttleState = { available: boolean; visible: boolean; count: number };

export const shuttleState = writable<ShuttleState>({
    available: false,
    visible: false,
    count: 0,
});

/**
 * ShuttleLayer — the B-Sides Las Vegas shuttle fleet, live from their GPS
 * vendor via the run.gpx proxy (`/api/gpx/public/shuttles`, already trust-boundary
 * filtered to position + light status). Sibling structure to RabbitLayer: poll,
 * setData, popup on click.
 *
 * Unlike the Deuce layer next door, nothing here is simulated — these are real
 * vehicles reporting real positions, so markers jump to the reported point
 * instead of being interpolated along a schedule. The fleet is usually parked,
 * and often not reporting at all, which is why stale buses stay on the map
 * dimmed rather than disappearing: hiding them would empty the layer for most of
 * the year and make the egg behind it unfindable.
 */
export class ShuttleLayer {
    map: mapboxgl.Map;
    private popup = new mapboxgl.Popup({ closeButton: true, offset: 14, className: 'dc34-shuttle-popup' });
    private timer: ReturnType<typeof setInterval> | null = null;
    private clickFn: ((e: mapboxgl.MapMouseEvent) => void) | null = null;
    private built = false;
    /** Livery hexes already registered as map images, keyed by color name. */
    private icons = new Set<string>();

    constructor(map: mapboxgl.Map) {
        this.map = map;
    }

    private whenStyleReady(): Promise<void> {
        if (this.map.isStyleLoaded()) return Promise.resolve();
        return new Promise((resolve) => this.map.once('idle', () => resolve()));
    }

    /** Register a data-URI SVG as a map image (decodes async; no-op if present). */
    private loadSvgImage(id: string, svg: string) {
        if (this.map.hasImage(id)) return;
        const icon = new Image(64, 64);
        icon.onload = () => { if (!this.map.hasImage(id)) this.map.addImage(id, icon); };
        icon.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
    }

    /**
     * Stamp each feature with the icon to draw and whether it is stale.
     *
     * Staleness is computed here, on every poll, rather than server-side: it is a
     * function of wall-clock now, so a bus that goes quiet while you are watching
     * should fade on the next tick without the proxy having to say anything new.
     */
    private register(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
        const now = Date.now();
        for (const f of fc.features) {
            const p = (f.properties ?? {}) as Record<string, unknown>;
            const color = typeof p.color === 'string' ? p.color : 'unknown';
            const hex = typeof p.colorHex === 'string' ? p.colorHex : FALLBACK_HEX;
            const iconId = `dc34-shuttle-${color}`;
            this.loadSvgImage(iconId, shuttleSvg(hex));
            this.icons.add(iconId);
            p.iconId = iconId;
            const last = typeof p.lastFixMs === 'number' ? p.lastFixMs : null;
            p.stale = last === null || now - last > STALE_AFTER_MS;
        }
        return fc;
    }

    private async build() {
        await this.whenStyleReady();
        if (!this.map.getSource(SOURCE)) {
            this.map.addSource(SOURCE, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
        }
        if (!this.map.getLayer(LAYER)) {
            addInBand(this.map, {
                id: LAYER, type: 'symbol', source: SOURCE,
                layout: {
                    visibility: 'none',
                    'icon-image': ['get', 'iconId'],
                    'icon-size': 0.5,
                    'icon-anchor': 'center',
                    'icon-allow-overlap': true,
                    // Real compass bearing from the feed; the glyph is drawn nose-up.
                    'icon-rotate': ['get', 'hdg'],
                    'icon-rotation-alignment': 'map',
                    'text-field': ['get', 'name'],
                    'text-size': 10,
                    'text-offset': [0, 1.6],
                    'text-anchor': 'top',
                    'text-allow-overlap': false,
                },
                paint: {
                    // A bus that has stopped reporting fades but never vanishes.
                    'icon-opacity': ['case', ['get', 'stale'], 0.45, 1],
                    'text-opacity': ['case', ['get', 'stale'], 0.5, 1],
                    'text-color': '#ffffff',
                    'text-halo-color': '#101015',
                    'text-halo-width': 1.4,
                },
            }, 'markers');

            this.clickFn = (e) => {
                const f = (e as unknown as { features?: GeoJSON.Feature[] }).features?.[0];
                if (!f) return;
                const p = (f.properties ?? {}) as Record<string, unknown>;
                const hex = typeof p.colorHex === 'string' ? p.colorHex : FALLBACK_HEX;
                const kmh = typeof p.kmh === 'number' ? p.kmh : 0;
                const last = typeof p.lastFixMs === 'number' ? p.lastFixMs : null;
                const motion = kmh > 1 ? `moving · ${Math.round(kmh)} km/h` : 'parked';
                const seen = last === null ? 'no fix reported' : `last seen ${ago(Date.now() - last)}`;
                const rows: [string, string][] = [
                    ['Status', motion],
                    ['Last fix', seen],
                    ['Heading', typeof p.hdg === 'number' ? `${Math.round(p.hdg)}°` : '—'],
                ];
                const grid = rows
                    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`)
                    .join('');
                const at = (f.geometry as GeoJSON.Point).coordinates as [number, number];
                this.popup
                    .setLngLat(at)
                    .setHTML(
                        `<div class="dc34-shuttle-reveal">` +
                        `<div class="dc34-shuttle-head">` +
                        `<span class="dc34-shuttle-dot" style="background:${escapeHtml(hex)}"></span>` +
                        `<strong>${escapeHtml(String(p.name ?? 'Shuttle'))}</strong></div>` +
                        `<div class="dc34-shuttle-sub">BSides Las Vegas shuttle</div>` +
                        `<dl class="dc34-shuttle-grid">${grid}</dl>` +
                        `<button type="button" class="dc34-shuttle-more" data-dc34-shuttle-egg>` +
                        `About the shuttles →</button></div>`
                    )
                    .addTo(this.map);
                // The popup is raw HTML, not a component, so wire the footer
                // button after it mounts. It hands off to the shared egg modal,
                // whose copy is CMS-overridable (see api/gpx/public/eggs).
                this.popup
                    .getElement()
                    ?.querySelector<HTMLButtonElement>('[data-dc34-shuttle-egg]')
                    ?.addEventListener('click', () => {
                        this.popup.remove();
                        void openEggModal(this.map, SHUTTLE_EGG_ID, at);
                    });
            };
            this.map.on('click', LAYER, this.clickFn);
        }
        this.built = true;
    }

    private async refresh() {
        try {
            const res = await fetch(shuttleUrl(), { credentials: 'omit' });
            if (!res.ok) return;
            const fc = (await res.json()) as GeoJSON.FeatureCollection;
            const src = this.map.getSource(SOURCE) as mapboxgl.GeoJSONSource | undefined;
            if (src) src.setData(this.register(fc));
            shuttleState.update((s) => ({ ...s, available: true, count: fc.features?.length ?? 0 }));
        } catch {
            // keep last frame
        }
    }

    private setLayersVisible(v: 'visible' | 'none') {
        if (this.map.getLayer(LAYER)) this.map.setLayoutProperty(LAYER, 'visibility', v);
    }

    async setVisible(visible: boolean) {
        shuttleState.update((s) => ({ ...s, visible }));
        if (visible) {
            if (!this.built) await this.build();
            this.setLayersVisible('visible');
            await this.refresh();
            if (!this.timer) this.timer = setInterval(() => this.refresh(), POLL_MS);
        } else {
            this.setLayersVisible('none');
            if (this.timer) { clearInterval(this.timer); this.timer = null; }
        }
    }

    remove() {
        this.popup.remove();
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        if (this.clickFn) { this.map.off('click', LAYER, this.clickFn); this.clickFn = null; }
        if (this.map.getLayer(LAYER)) this.map.removeLayer(LAYER);
        if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE);
        for (const id of this.icons) {
            if (this.map.hasImage(id)) this.map.removeImage(id);
        }
        this.icons.clear();
        this.built = false;
    }
}
