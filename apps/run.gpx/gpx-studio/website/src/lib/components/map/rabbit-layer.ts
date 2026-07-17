import mapboxgl from 'mapbox-gl';
import { dcjackSvg } from './dcjack-svg';
import { escapeHtml } from './escape-html';
import { RefreshCue } from './refresh-cue';

const DEFAULT_PIN_COLOR = '#e6007a';
const SOURCE = 'dc34-rabbits';
const LAYER = 'dc34-rabbits-pins';
const CLUSTER_LAYER = 'dc34-rabbits-clusters';
const CLUSTER_COUNT = 'dc34-rabbits-cluster-count';
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
    private clusterClickFn: ((e: mapboxgl.MapMouseEvent) => void) | null = null;
    private built = false;
    private cue: RefreshCue | null = null;
    private themeObserver: MutationObserver | null = null;

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

    /** Light mode = no `dark` class on <html> (mode-watcher's convention). */
    private isLight(): boolean {
        return !document.documentElement.classList.contains('dark');
    }

    /** Register the classic DEF CON jack (both tones) and stamp the current-mode
     * one onto every rabbit: black-circle/white-face on dark, inverted on light. */
    private register(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
        this.loadSvgImage('dc34-jack-dark', dcjackSvg(false));
        this.loadSvgImage('dc34-jack-light', dcjackSvg(true));
        const id = this.isLight() ? 'dc34-jack-light' : 'dc34-jack-dark';
        for (const f of fc.features) {
            (f.properties as Record<string, unknown>).iconId = id;
        }
        return fc;
    }

    private async build() {
        await this.whenStyleReady();
        if (!this.map.getSource(SOURCE)) {
            // Cluster nearby rabbits into a count bubble when zoomed out; they
            // split into individual jacks past clusterMaxZoom.
            this.map.addSource(SOURCE, {
                type: 'geojson', data: { type: 'FeatureCollection', features: [] },
                cluster: true, clusterMaxZoom: 14, clusterRadius: 46,
            });
        }
        if (!this.map.getLayer(LAYER)) {
            // Cluster bubble: black disc + white ring, sized by count (matches the jack).
            this.map.addLayer({
                id: CLUSTER_LAYER, type: 'circle', source: SOURCE,
                filter: ['has', 'point_count'],
                layout: { visibility: 'none' },
                paint: {
                    'circle-color': '#050505', 'circle-opacity': 0.92,
                    'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2,
                    'circle-radius': ['step', ['get', 'point_count'], 15, 5, 18, 15, 22],
                },
            });
            this.map.addLayer({
                id: CLUSTER_COUNT, type: 'symbol', source: SOURCE,
                filter: ['has', 'point_count'],
                layout: {
                    visibility: 'none',
                    'text-field': ['get', 'point_count_abbreviated'],
                    'text-size': 13, 'text-allow-overlap': true,
                },
                paint: { 'text-color': '#ffffff' },
            });
            // Individual jacks (unclustered points only).
            this.map.addLayer({
                id: LAYER, type: 'symbol', source: SOURCE,
                filter: ['!', ['has', 'point_count']],
                layout: {
                    visibility: 'none',
                    'icon-image': ['get', 'iconId'], 'icon-size': 0.32,
                    'icon-anchor': 'center', 'icon-allow-overlap': true,
                    'text-field': ['get', 'displayName'], 'text-size': 10,
                    'text-offset': [0, 0.4], 'text-anchor': 'top',
                },
                paint: { 'text-color': '#ffffff', 'text-halo-color': '#101015', 'text-halo-width': 1.4 },
            });
            // Click a cluster → zoom to expand it.
            this.clusterClickFn = (e) => {
                const f = (e as unknown as { features?: GeoJSON.Feature[] }).features?.[0];
                const cid = f?.properties?.cluster_id;
                if (cid == null) return;
                const src = this.map.getSource(SOURCE) as mapboxgl.GeoJSONSource;
                src.getClusterExpansionZoom(cid as number, (err, zoom) => {
                    if (err || zoom == null) return;
                    this.map.easeTo({ center: (f!.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
                });
            };
            this.map.on('click', CLUSTER_LAYER, this.clusterClickFn);
            this.clickFn = (e) => {
                const f = (e as unknown as { features?: GeoJSON.Feature[] }).features?.[0];
                if (!f) return;
                const p = (f.properties ?? {}) as Record<string, unknown>;
                const esc = (v: unknown) => escapeHtml(v == null || v === '' ? '—' : String(v));
                const color = (p.pinColor as string) || DEFAULT_PIN_COLOR;
                const batt = typeof p.battery === 'number' && p.battery >= 0 ? `${p.battery}%` : '—';
                const rows: [string, string][] = [
                    ['Model', esc(p.hwModel)],
                    ['Role', esc(p.role)],
                    ['Region', `${esc(p.region)} · ${esc(p.modemPreset)}`],
                    ['Firmware', esc(p.fwVersion)],
                    ['Channel', esc(p.channel)],
                    ['Battery', batt],
                ];
                const grid = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
                this.popup
                    .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
                    .setHTML(
                        `<div class="dc34-rabbit-reveal">` +
                        `<div class="dc34-rabbit-head"><span class="dc34-rabbit-dot" style="background:${escapeHtml(color)}"></span>` +
                        `<strong>${esc(p.displayName)}</strong></div>` +
                        `<dl class="dc34-rabbit-grid">${grid}</dl></div>`
                    )
                    .addTo(this.map);
            };
            this.map.on('click', LAYER, this.clickFn);
        }
        // Re-stamp the jack tone when the user toggles light/dark.
        if (!this.themeObserver && typeof MutationObserver !== 'undefined') {
            this.themeObserver = new MutationObserver(() => { void this.refresh(); });
            this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        }
        this.built = true;
    }

    private async refresh() {
        try {
            const res = await fetch(rabbitUrl(), { credentials: 'omit' });
            if (!res.ok) return;
            const fc = (await res.json()) as GeoJSON.FeatureCollection;
            const src = this.map.getSource(SOURCE) as mapboxgl.GeoJSONSource | undefined;
            if (src) { src.setData(this.register(fc)); this.cue?.reset(); }
        } catch {
            // keep last frame
        }
    }

    private setLayersVisible(v: 'visible' | 'none') {
        for (const id of [CLUSTER_LAYER, CLUSTER_COUNT, LAYER]) {
            if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', v);
        }
    }

    async setVisible(visible: boolean) {
        if (visible) {
            // Create the cue up front — independent of build()/style-ready, which
            // can stall (e.g. a terrain source that never lets the map go idle).
            if (!this.cue) { this.cue = new RefreshCue(document.body, POLL_MS); this.cue.start(); }
            if (!this.built) await this.build();
            this.setLayersVisible('visible');
            await this.refresh();
            if (!this.timer) this.timer = setInterval(() => this.refresh(), POLL_MS);
        } else {
            this.setLayersVisible('none');
            if (this.timer) { clearInterval(this.timer); this.timer = null; }
            if (this.cue) { this.cue.stop(); this.cue = null; }
        }
    }

    remove() {
        this.popup.remove();
        if (this.themeObserver) { this.themeObserver.disconnect(); this.themeObserver = null; }
        if (this.cue) { this.cue.stop(); this.cue = null; }
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        if (this.clickFn) { this.map.off('click', LAYER, this.clickFn); this.clickFn = null; }
        if (this.clusterClickFn) { this.map.off('click', CLUSTER_LAYER, this.clusterClickFn); this.clusterClickFn = null; }
        for (const id of [CLUSTER_COUNT, CLUSTER_LAYER, LAYER]) {
            if (this.map.getLayer(id)) this.map.removeLayer(id);
        }
        if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE);
        this.built = false;
    }
}
