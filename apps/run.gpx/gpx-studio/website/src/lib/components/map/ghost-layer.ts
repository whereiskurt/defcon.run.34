import mapboxgl from 'mapbox-gl';

const SOURCE = 'dc34-ghosts';
const LAYER = 'dc34-ghosts-pins';
const IMAGE = 'dc34-ghost-icon';
const POLL_MS = 90_000;

/** Region prefix = path before '/studio' (mirrors public-overlays regionPrefix). */
function ghostUrl(): string {
    const path = window.location.pathname;
    const i = path.indexOf('/studio');
    const prefix = i > 0 ? path.slice(0, i) : '';
    return `${prefix}/api/gpx/public/ghosts`;
}

// Spooky ghost silhouette (Pac-Man-style wisp) in DC34 violet.
const GHOST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path d="M4 20V11a8 8 0 0 1 16 0v9l-2.7-1.6L14.6 20 12 18.4 9.4 20 6.7 18.4z"
        fill="#9b5de5" stroke="#e0aaff" stroke-width="0.8" opacity="0.9"/>
  <circle cx="9.4" cy="10" r="1.3" fill="#101015"/>
  <circle cx="14.6" cy="10" r="1.3" fill="#101015"/>
</svg>`;

export class GhostLayer {
    map: mapboxgl.Map;
    private popup = new mapboxgl.Popup({ closeButton: true, offset: 14, className: 'dc34-ghost-popup' });
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

    private loadImage() {
        if (this.map.hasImage(IMAGE)) return;
        const img = new Image(64, 64);
        img.onload = () => { if (!this.map.hasImage(IMAGE)) this.map.addImage(IMAGE, img); };
        img.src = 'data:image/svg+xml,' + encodeURIComponent(GHOST_SVG);
    }

    private async build() {
        await this.whenStyleReady();
        this.loadImage();
        if (!this.map.getSource(SOURCE)) {
            this.map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }
        if (!this.map.getLayer(LAYER)) {
            this.map.addLayer({
                id: LAYER, type: 'symbol', source: SOURCE,
                layout: {
                    visibility: 'none',
                    'icon-image': IMAGE, 'icon-size': 0.7, 'icon-allow-overlap': true, 'icon-anchor': 'bottom',
                    'text-field': ['get', 'shortName'], 'text-size': 10,
                    'text-offset': [0, 0.6], 'text-anchor': 'top', 'text-allow-overlap': true,
                },
                paint: { 'icon-opacity': 0.9, 'text-color': '#e0aaff', 'text-halo-color': '#101015', 'text-halo-width': 1 },
            });
            this.clickFn = (e) => {
                const f = (e as unknown as { features?: GeoJSON.Feature[] }).features?.[0];
                if (!f) return;
                const p = (f.properties ?? {}) as { who?: string; shortName?: string };
                this.popup
                    .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
                    .setHTML(`<div class="dc34-ghost-reveal"><strong>${p.who ?? 'a ghost'}</strong><br><span>${p.shortName ?? ''}</span></div>`)
                    .addTo(this.map);
            };
            this.map.on('click', LAYER, this.clickFn);
        }
        this.built = true;
    }

    private async refresh() {
        try {
            const res = await fetch(ghostUrl(), { credentials: 'omit' });
            if (!res.ok) return;
            const fc = (await res.json()) as GeoJSON.FeatureCollection;
            const src = this.map.getSource(SOURCE) as mapboxgl.GeoJSONSource | undefined;
            if (src) src.setData(fc);
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
