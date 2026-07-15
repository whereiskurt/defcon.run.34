import mapboxgl from 'mapbox-gl';
import { pinSvg, pinIconById, DEFAULT_PIN_ICON, DEFAULT_PIN_COLOR } from '$lib/dc34-pins';
import { escapeHtml } from './escape-html';

const SOURCE = 'dc34-rabbits';
const LAYER = 'dc34-rabbits-pins';
const POLL_MS = 45_000;

/** Region prefix = path before '/studio' (mirrors public-overlays/ghost-layer regionPrefix). */
function rabbitUrl(): string {
    const path = window.location.pathname;
    const i = path.indexOf('/studio');
    const prefix = i > 0 ? path.slice(0, i) : '';
    return `${prefix}/api/gpx/public/rabbits`;
}

/**
 * RabbitLayer — opt-in live attendees ("Show me on the map"). Thin polling
 * Mapbox layer: fetch the Task 10 rabbit proxy (already trust-boundary
 * filtered server-side to verified && showOnMap users) and render branded
 * pins. Sibling structure to GhostLayer; per-feature pin resolution mirrors
 * public-overlays.ts's resolvePin()/checkinFeatures().
 */
export class RabbitLayer {
    map: mapboxgl.Map;
    private popup = new mapboxgl.Popup({ closeButton: true, offset: 12, className: 'dc34-rabbit-popup' });
    private timer: ReturnType<typeof setInterval> | null = null;
    private clickFn: ((e: mapboxgl.MapMouseEvent) => void) | null = null;
    private built = false;

    constructor(map: mapboxgl.Map) {
        this.map = map;
    }

    private whenStyleReady(): Promise<void> {
        if (this.map.isStyleLoaded()) return Promise.resolve();
        return new Promise((resolve) => this.map.once('idle', () => resolve()));
    }

    /** Register a data-URI SVG as a map image (decodes async; no-op if already loaded). */
    private loadSvgImage(id: string, svg: string) {
        if (this.map.hasImage(id)) return;
        const icon = new Image(100, 100);
        icon.onload = () => { if (!this.map.hasImage(id)) this.map.addImage(id, icon); };
        icon.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
    }

    /** Register a branded pin per (icon,color) and stamp iconId onto each feature.
     * Mirrors public-overlays.ts's resolvePin(): a fixedColor icon (e.g. goldstar)
     * always renders in its own color regardless of the runner's pinColor pick. */
    private register(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
        for (const f of fc.features) {
            const p = (f.properties ?? {}) as { pinIcon?: string; pinColor?: string };
            const icon = pinIconById(p.pinIcon) ?? pinIconById(DEFAULT_PIN_ICON)!;
            const color = icon.fixedColor ?? (p.pinColor || DEFAULT_PIN_COLOR);
            const iconId = `rabbit-${icon.id}-${color}`;
            this.loadSvgImage(iconId, pinSvg(icon, color));
            (f.properties as Record<string, unknown>).iconId = iconId;
        }
        return fc;
    }

    private async build() {
        await this.whenStyleReady();
        if (!this.map.getSource(SOURCE)) {
            this.map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }
        if (!this.map.getLayer(LAYER)) {
            this.map.addLayer({
                id: LAYER, type: 'symbol', source: SOURCE,
                layout: {
                    visibility: 'none',
                    'icon-image': ['get', 'iconId'], 'icon-size': 0.5,
                    'icon-anchor': 'bottom', 'icon-allow-overlap': true,
                    'text-field': ['get', 'displayName'], 'text-size': 10,
                    'text-offset': [0, 0.4], 'text-anchor': 'top',
                },
                paint: { 'text-color': '#e6007a', 'text-halo-color': '#101015', 'text-halo-width': 1 },
            });
            this.clickFn = (e) => {
                const f = (e as unknown as { features?: GeoJSON.Feature[] }).features?.[0];
                if (!f) return;
                const p = (f.properties ?? {}) as { displayName?: string; userType?: string };
                this.popup
                    .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
                    .setHTML(`<div class="dc34-rabbit-reveal"><strong>${escapeHtml(p.displayName ?? 'a rabbit')}</strong>${p.userType ? `<br><span>${escapeHtml(p.userType)}</span>` : ''}</div>`)
                    .addTo(this.map);
            };
            this.map.on('click', LAYER, this.clickFn);
        }
        this.built = true;
    }

    private async refresh() {
        try {
            const res = await fetch(rabbitUrl(), { credentials: 'omit' });
            if (!res.ok) return;
            const fc = (await res.json()) as GeoJSON.FeatureCollection;
            const src = this.map.getSource(SOURCE) as mapboxgl.GeoJSONSource | undefined;
            if (src) src.setData(this.register(fc));
        } catch {
            // keep last frame
        }
    }

    async setVisible(visible: boolean) {
        if (visible) {
            if (!this.built) await this.build();
            if (this.map.getLayer(LAYER)) this.map.setLayoutProperty(LAYER, 'visibility', 'visible');
            await this.refresh();
            if (!this.timer) this.timer = setInterval(() => this.refresh(), POLL_MS);
        } else {
            if (this.map.getLayer(LAYER)) this.map.setLayoutProperty(LAYER, 'visibility', 'none');
            if (this.timer) { clearInterval(this.timer); this.timer = null; }
        }
    }

    remove() {
        this.popup.remove();
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        if (this.clickFn) { this.map.off('click', LAYER, this.clickFn); this.clickFn = null; }
        if (this.map.getLayer(LAYER)) this.map.removeLayer(LAYER);
        if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE);
        this.built = false;
    }
}
