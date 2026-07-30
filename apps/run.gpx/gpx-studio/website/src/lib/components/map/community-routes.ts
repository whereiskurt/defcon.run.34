import { writable } from 'svelte/store';
import { parseGPX } from 'gpx';
import mapboxgl from 'mapbox-gl';
import { routeColor } from '$lib/dc34-palette';
import { listCommunityRoutes, copyRouteToMyMaps, type RouteSummary } from '$lib/cloud-sync';
import { escapeHtml } from './escape-html';
import {
    PREFIX,
    communityRouteLayer,
    pruneLayerVisibility,
    setLayerVisible,
    setLayersVisible,
    storedVisible,
} from '$lib/stores/layer-visibility';

/**
 * "Community Routes" (2026-07-28 routes-vs-runs spec) — routes other runners
 * published for everyone, rendered read-only. Structurally the SMALL sibling of
 * my-con-runs.ts: whenStyleReady gating, glow+core line pair, listener
 * tracking, cached bounds + fit-on-toggle, silent-empty on fetch failure.
 *
 * Security: every card value (name/description/attribution) is user-controlled
 * text from OTHER users and is escapeHtml'd before entering popup innerHTML.
 * The "Add to My Maps" button copies the route server-side (fresh dateless
 * GpxFile — never scores).
 */

const SOURCE_PREFIX = 'community-route-';
const CORE_WIDTH = 4;
const GLOW_BLUR = 6;

export type CommunityRouteEntry = {
    routeId: string;
    name: string;
    visible: boolean;
};

// UI-facing state for the layer-control section. Set once, atomically, on load.
export const communityRoutes = writable<CommunityRouteEntry[]>([]);

function coreLayerId(routeId: string): string {
    return `${SOURCE_PREFIX}${routeId}`;
}
function glowLayerId(routeId: string): string {
    return `${SOURCE_PREFIX}${routeId}-glow`;
}

function formatDistance(meters?: number): string | undefined {
    if (!meters || meters <= 0) return undefined;
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

const ROUTE_TYPE_LABEL: Record<string, string> = {
    loop: 'Loop',
    'out-and-back': 'Out and back',
    'point-to-point': 'Point to point',
};

/** Popup card for a community route. EVERY interpolated value is escaped. */
export function communityPopupHtml(r: RouteSummary, color: string): string {
    const distStr = formatDistance(r.totalDistance);
    const typeLabel = r.routeType ? ROUTE_TYPE_LABEL[r.routeType] : undefined;
    const desc = (r.description ?? '').slice(0, 200);
    const by = r.createdByName?.trim();
    return `
        <div style="min-width:190px;max-width:270px;padding:10px 12px;border-left:4px solid ${color};
                    font-family:system-ui,sans-serif;color:#e4e4ef">
            <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.55">Community Route</div>
            <div style="font-size:15px;font-weight:600;margin-top:2px">${escapeHtml(r.name)}</div>
            ${by ? `<div style="font-size:11px;opacity:.7;margin-top:2px">by ${escapeHtml(by)}</div>` : ''}
            ${desc ? `<div style="font-size:12px;opacity:.85;margin-top:6px;white-space:pre-wrap">${escapeHtml(desc)}</div>` : ''}
            <div style="font-size:12px;opacity:.85;margin-top:6px">
                ${distStr ? `📏 ${distStr}` : ''}
                ${typeLabel ? ` · ${escapeHtml(typeLabel)}` : ''}
            </div>
            <button data-copy-route="${escapeHtml(r.routeId)}"
                    style="display:block;width:100%;margin-top:10px;padding:5px 8px;border-radius:8px;
                           font-size:11px;font-weight:600;font-family:inherit;cursor:pointer;
                           background:rgba(0,212,170,.12);color:#00d4aa;border:1px solid rgba(0,212,170,.55)">
                ➕ Add to My Maps</button>
        </div>`;
}

/** Wire the popup's "Add to My Maps" button. Idempotent per popup open. */
export function wireCommunityPopupCopy(
    container: HTMLElement | undefined,
    onCopied?: () => void
): void {
    const btn = container?.querySelector<HTMLButtonElement>('[data-copy-route]');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const routeId = btn.dataset.copyRoute;
        if (!routeId) return;
        btn.disabled = true;
        btn.textContent = 'Copying…';
        copyRouteToMyMaps(routeId)
            .then(() => {
                btn.textContent = '✓ Copied to My Maps';
                onCopied?.();
            })
            .catch(() => {
                btn.disabled = false;
                btn.textContent = 'Copy failed — try again';
            });
    });
}

export class CommunityRoutesLayer {
    map: mapboxgl.Map;
    loaded = false;
    private popup: mapboxgl.Popup;
    private listeners: { id: string; type: 'click' | 'mouseenter' | 'mouseleave'; fn: any }[] = [];
    private routeBounds = new Map<string, [[number, number], [number, number]]>();
    private routeMeta = new Map<string, RouteSummary>();
    private colorByRoute = new Map<string, string>();

    constructor(map: mapboxgl.Map) {
        this.map = map;
        this.popup = new mapboxgl.Popup({
            closeButton: true,
            closeOnClick: true,
            maxWidth: '290px',
            offset: 12,
            className: 'dc34-route-popup',
        });
    }

    private whenStyleReady(): Promise<void> {
        if (this.map.isStyleLoaded()) return Promise.resolve();
        return new Promise((resolve) => this.map.once('idle', () => resolve()));
    }

    /** Fetch the community manifest and render every route (hidden by default).
     * Never breaks the studio: unauthenticated/empty/failed fetch leaves the
     * store empty and returns silently. */
    async load(): Promise<void> {
        if (this.loaded) return;
        let manifest: RouteSummary[];
        try {
            manifest = await listCommunityRoutes();
            if (manifest.length === 0) {
                // Authoritative empty — clearing is correct, and so is forgetting the
                // stored ids for routes that are no longer published.
                communityRoutes.set([]);
                pruneLayerVisibility(PREFIX.communityRoute, []);
                return;
            }
        } catch {
            communityRoutes.set([]);
            return;
        }

        await this.whenStyleReady();

        this.colorByRoute.clear();
        manifest.forEach((r, i) => this.colorByRoute.set(r.routeId, routeColor(i)));

        await Promise.all(
            manifest.map(async (r) => {
                if (!r.downloadUrl) return;
                try {
                    const gpxRes = await fetch(r.downloadUrl);
                    if (!gpxRes.ok) return;
                    const file = parseGPX(await gpxRes.text());
                    const geojson = file.toGeoJSON();
                    this.routeMeta.set(r.routeId, r);
                    this.addRouteLayer(r);
                    this.setRouteData(r.routeId, geojson);
                    if (r.bounds) {
                        this.routeBounds.set(r.routeId, [
                            [r.bounds.minLon, r.bounds.minLat],
                            [r.bounds.maxLon, r.bounds.maxLat],
                        ]);
                    }
                } catch (err) {
                    console.warn(`[community-routes] failed to load ${r.routeId}:`, err);
                }
            })
        );

        // Resolved after every fetch settles, so a toggle made during a reload wins.
        // Default stays false — nothing stored means the section looks exactly as it
        // did before this store existed.
        const entries = manifest
            .filter((r) => this.routeMeta.has(r.routeId))
            .map((r) => ({
                routeId: r.routeId,
                name: r.name,
                visible: storedVisible(communityRouteLayer(r.routeId), false),
            }));
        // Raw layout property, never setRouteVisible: that fitBounds, and a restore
        // must not move the camera on page load.
        for (const e of entries) this.setLayerPairVisible(e.routeId, e.visible);

        this.loaded = true;
        communityRoutes.set(entries);
        // Authoritative manifest in hand — forget stored ids whose route is gone.
        pruneLayerVisibility(
            PREFIX.communityRoute,
            manifest.map((r) => communityRouteLayer(r.routeId))
        );
    }

    async reload(): Promise<void> {
        this.teardownMapLayers();
        this.loaded = false;
        await this.load();
    }

    private addRouteLayer(r: RouteSummary) {
        const core = coreLayerId(r.routeId);
        const glow = glowLayerId(r.routeId);
        const color = this.colorByRoute.get(r.routeId) ?? routeColor(0);
        try {
            if (!this.map.getSource(core)) {
                this.map.addSource(core, {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] },
                });
            }
            if (!this.map.getLayer(glow)) {
                this.map.addLayer({
                    id: glow,
                    type: 'line',
                    source: core,
                    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
                    paint: {
                        'line-color': color,
                        'line-width': CORE_WIDTH * 2,
                        'line-blur': GLOW_BLUR,
                        'line-opacity': 0.35,
                    },
                });
            }
            if (!this.map.getLayer(core)) {
                this.map.addLayer({
                    id: core,
                    type: 'line',
                    source: core,
                    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
                    paint: {
                        'line-color': color,
                        'line-width': CORE_WIDTH,
                        'line-opacity': 0.95,
                    },
                });

                const onClick = (e: mapboxgl.MapMouseEvent) => {
                    const meta = this.routeMeta.get(r.routeId);
                    if (!meta) return;
                    this.popup
                        .setLngLat(e.lngLat)
                        .setHTML(communityPopupHtml(meta, color))
                        .addTo(this.map);
                    wireCommunityPopupCopy(this.popup.getElement());
                };
                const onEnter = () => (this.map.getCanvas().style.cursor = 'pointer');
                const onLeave = () => (this.map.getCanvas().style.cursor = '');
                this.map.on('click', core, onClick);
                this.map.on('mouseenter', core, onEnter);
                this.map.on('mouseleave', core, onLeave);
                this.listeners.push(
                    { id: core, type: 'click', fn: onClick },
                    { id: core, type: 'mouseenter', fn: onEnter },
                    { id: core, type: 'mouseleave', fn: onLeave }
                );
            }
        } catch (err) {
            console.warn(`[community-routes] failed to add layer for ${r.routeId}:`, err);
        }
    }

    private setRouteData(routeId: string, geojson: GeoJSON.FeatureCollection) {
        const source = this.map.getSource(coreLayerId(routeId)) as
            | mapboxgl.GeoJSONSource
            | undefined;
        if (source) source.setData(geojson);
    }

    private setLayerPairVisible(routeId: string, visible: boolean) {
        const vis = visible ? 'visible' : 'none';
        for (const id of [glowLayerId(routeId), coreLayerId(routeId)]) {
            if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', vis);
        }
    }

    private fitToRoute(routeId: string) {
        const b = this.routeBounds.get(routeId);
        if (b) this.map.fitBounds(b, { padding: 80, maxZoom: 15, duration: 700 });
    }

    /** Toggle one community route. */
    setRouteVisible(routeId: string, visible: boolean) {
        this.setLayerPairVisible(routeId, visible);
        setLayerVisible(communityRouteLayer(routeId), visible);
        if (visible) this.fitToRoute(routeId);
        communityRoutes.update((routes) =>
            routes.map((r) => (r.routeId === routeId ? { ...r, visible } : r))
        );
    }

    /** Master toggle for the whole section. */
    setAllVisible(visible: boolean) {
        const ids: string[] = [];
        communityRoutes.update((routes) =>
            routes.map((r) => {
                this.setLayerPairVisible(r.routeId, visible);
                ids.push(communityRouteLayer(r.routeId));
                return { ...r, visible };
            })
        );
        // One write for the whole cascade (the section master is derived from the rows).
        setLayersVisible(ids, visible);
    }

    private teardownMapLayers() {
        try {
            for (const l of this.listeners) this.map.off(l.type, l.id, l.fn);
            this.listeners = [];
            this.popup.remove();
            for (const routeId of this.routeMeta.keys()) {
                for (const id of [coreLayerId(routeId), glowLayerId(routeId)]) {
                    if (this.map.getLayer(id)) this.map.removeLayer(id);
                }
                if (this.map.getSource(coreLayerId(routeId)))
                    this.map.removeSource(coreLayerId(routeId));
            }
        } catch {
            // map not ready
        }
        this.routeBounds.clear();
        this.routeMeta.clear();
        this.colorByRoute.clear();
    }

    remove() {
        this.teardownMapLayers();
        this.loaded = false;
        communityRoutes.set([]);
    }
}
