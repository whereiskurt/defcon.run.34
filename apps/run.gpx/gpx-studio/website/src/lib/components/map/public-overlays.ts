import { writable } from 'svelte/store';
import { parseGPX } from 'gpx';
import mapboxgl from 'mapbox-gl';
import { routeColor } from '$lib/dc34-palette';

/**
 * Public overlays — DEF CON 34 official map layers (v1.7 Phase 28, decorated v1.8).
 *
 * Fetches the unauthenticated manifest (`/api/gpx/public/maps`), which returns every
 * GLOBAL folder ("DEF CON 34 Maps", "Rabbit Routes", …) with its active GPX routes, and
 * renders each route as a READ-ONLY, glowing line layer on the map. Routes are grouped; the
 * UI (layer control) binds to `publicOverlayGroups` to render a group master toggle plus a
 * per-route toggle. Clicking a route opens a popup with its details.
 *
 * Read-only: these layers are NOT added to the editable file list / Dexie store — they are
 * plain MapLibre GeoJSON line layers a viewer can show/hide but not edit.
 *
 * Decoration (v1.8): each route gets a wide, blurred glow under-layer beneath a crisp core
 * line, colored from the DEF CON 34 palette (varied per route, or the CMS `mapColor` when
 * present). Clicking a route opens a details popup. Route details are enriched from
 * cms.defcon.run when a matching CMS Route exists (keyed by gpxFileId); until that endpoint
 * lands, the popup shows the manifest metadata we already have.
 */

// The studio is served under the region basePath (e.g. /use1/studio/app), but the API
// lives at /use1/api/... — so a root-absolute '/api/...' drops the region and 404s.
// Derive the region prefix as everything before '/studio' in the current path.
function regionPrefix(): string {
    if (typeof location === 'undefined') return '';
    const i = location.pathname.indexOf('/studio');
    return i > 0 ? location.pathname.slice(0, i) : '';
}

const MANIFEST_URL = `${regionPrefix()}/api/gpx/public/maps`;
const SOURCE_PREFIX = 'public-map-';
const CORE_WIDTH = 4;
const GLOW_WIDTH = 14;
const GLOW_BLUR = 6;

export type PublicMap = {
    fileId: string;
    fileName: string;
    downloadUrl: string;
    totalDistance?: number;
    totalElevation?: number;
    trackCount?: number;
    uploadedBy?: string;
    tags?: string[];
    color: string; // resolved DC34 palette color (or CMS mapColor)
    visible: boolean;
};

export type PublicOverlayGroup = {
    folderId: string;
    folderName: string;
    visible: boolean; // group master toggle (true if ALL children visible)
    maps: PublicMap[];
};

// UI-facing state: the layer control renders master + per-route toggles from this.
export const publicOverlayGroups = writable<PublicOverlayGroup[]>([]);

// "All Runners" aggregate (Phase 32): a single non-attributable blended layer.
export const publicAggregate = writable<{ available: boolean; visible: boolean }>({
    available: false,
    visible: false,
});

const AGGREGATE_URL = `${regionPrefix()}/api/gpx/public/aggregate`;
const AGGREGATE_LAYER = 'public-all-runners';

function coreLayerId(fileId: string): string {
    return `${SOURCE_PREFIX}${fileId}`;
}
function glowLayerId(fileId: string): string {
    return `${SOURCE_PREFIX}${fileId}-glow`;
}

function formatDistance(meters?: number): string | undefined {
    if (!meters || meters <= 0) return undefined;
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
    );
}

/** Build the details-popup HTML from a route. Manifest metadata now; CMS enrichment slots in here. */
function popupHtml(m: PublicMap, folderName: string): string {
    const rows: string[] = [];
    const dist = formatDistance(m.totalDistance);
    if (dist) rows.push(`<span>📏 ${dist}</span>`);
    if (m.totalElevation && m.totalElevation > 0)
        rows.push(`<span>⛰ ${Math.round(m.totalElevation)} m gain</span>`);
    if (m.trackCount && m.trackCount > 1) rows.push(`<span>🧭 ${m.trackCount} tracks</span>`);

    const meta = rows.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;font-size:12px;opacity:.85">${rows.join('')}</div>`
        : '';
    const by = m.uploadedBy
        ? `<div style="margin-top:6px;font-size:11px;opacity:.6">via ${escapeHtml(m.uploadedBy)}</div>`
        : '';

    return `
        <div style="min-width:180px;max-width:260px;padding:10px 12px;border-left:4px solid ${m.color};
                    font-family:system-ui,sans-serif;color:#e4e4ef">
            <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.55">${escapeHtml(folderName)}</div>
            <div style="font-size:15px;font-weight:600;margin-top:2px">${escapeHtml(m.fileName)}</div>
            ${meta}
            ${by}
        </div>`;
}

export class PublicOverlaysLayer {
    map: mapboxgl.Map;
    loaded = false;
    private popup: mapboxgl.Popup;
    // Track per-layer listeners so we can detach them on remove().
    private listeners: { id: string; type: 'click' | 'mouseenter' | 'mouseleave'; fn: any }[] = [];

    constructor(map: mapboxgl.Map) {
        this.map = map;
        this.popup = new mapboxgl.Popup({
            closeButton: true,
            closeOnClick: true,
            maxWidth: '280px',
            offset: 12,
            className: 'dc34-route-popup',
        });
    }

    /** Fetch the manifest and render every route (hidden until toggled on by the group default). */
    async add() {
        if (this.loaded) return;
        let groups: PublicOverlayGroup[];
        try {
            const res = await fetch(MANIFEST_URL, { credentials: 'omit' });
            if (!res.ok) return;
            const body = (await res.json()) as {
                groups: {
                    folderId: string;
                    folderName: string;
                    maps: (Omit<PublicMap, 'visible' | 'color'> & { mapColor?: string })[];
                }[];
            };
            // Assign a varied palette color across the whole set so adjacent routes differ.
            let routeIndex = 0;
            groups = body.groups.map((g) => ({
                folderId: g.folderId,
                folderName: g.folderName,
                // Default off — the viewer opts in via the "DEF CON 34 maps on/off" toggle.
                visible: false,
                maps: g.maps.map((m) => ({
                    ...m,
                    // CMS-provided mapColor wins; otherwise cycle the DC34 varied ramp.
                    color: m.mapColor || routeColor(routeIndex++),
                    visible: false,
                })),
            }));
        } catch {
            return; // manifest unavailable → no overlays, studio unaffected
        }

        // Fetch + parse each route's GPX, add a read-only glow+core line layer (initially hidden).
        await Promise.all(
            groups.flatMap((group) =>
                group.maps.map(async (m) => {
                    try {
                        const gpxRes = await fetch(m.downloadUrl);
                        if (!gpxRes.ok) return;
                        const geojson = parseGPX(await gpxRes.text()).toGeoJSON();
                        this.addRouteLayer(m, group.folderName);
                        this.setRouteData(m.fileId, geojson);
                    } catch {
                        // skip a route that fails to load; others still render
                    }
                })
            )
        );

        this.loaded = true;
        publicOverlayGroups.set(groups);

        await this.addAggregate();
    }

    /** Load the "All Runners" aggregate as one hidden, non-attributable line layer. */
    private async addAggregate() {
        try {
            const res = await fetch(AGGREGATE_URL, { credentials: 'omit' });
            if (!res.ok) return;
            const geojson = (await res.json()) as GeoJSON.FeatureCollection;
            if (!geojson.features || geojson.features.length === 0) return;

            if (!this.map.getSource(AGGREGATE_LAYER)) {
                this.map.addSource(AGGREGATE_LAYER, { type: 'geojson', data: geojson });
            }
            if (!this.map.getLayer(AGGREGATE_LAYER)) {
                this.map.addLayer({
                    id: AGGREGATE_LAYER,
                    type: 'line',
                    source: AGGREGATE_LAYER,
                    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
                    // Low opacity so overlapping tracks read as density (a soft heatmap).
                    paint: { 'line-color': '#00e5ff', 'line-width': 2, 'line-opacity': 0.15 },
                });
            }
            publicAggregate.set({ available: true, visible: false });
        } catch {
            // aggregate unavailable → no layer, studio unaffected
        }
    }

    /** Toggle the aggregate "All Runners" layer. */
    setAggregateVisible(visible: boolean) {
        if (this.map.getLayer(AGGREGATE_LAYER)) {
            this.map.setLayoutProperty(AGGREGATE_LAYER, 'visibility', visible ? 'visible' : 'none');
        }
        publicAggregate.update((s) => ({ ...s, visible }));
    }

    /** Add the glow + core line layers for a route, plus its click/hover handlers. */
    private addRouteLayer(m: PublicMap, folderName: string) {
        const core = coreLayerId(m.fileId);
        const glow = glowLayerId(m.fileId);
        try {
            if (!this.map.getSource(core)) {
                this.map.addSource(core, {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] },
                });
            }
            // Wide, blurred glow beneath — the DEF CON neon look.
            if (!this.map.getLayer(glow)) {
                this.map.addLayer({
                    id: glow,
                    type: 'line',
                    source: core,
                    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
                    paint: {
                        'line-color': m.color,
                        'line-width': GLOW_WIDTH,
                        'line-blur': GLOW_BLUR,
                        'line-opacity': 0.35,
                    },
                });
            }
            // Crisp core line on top.
            if (!this.map.getLayer(core)) {
                this.map.addLayer({
                    id: core,
                    type: 'line',
                    source: core,
                    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
                    paint: { 'line-color': m.color, 'line-width': CORE_WIDTH, 'line-opacity': 0.95 },
                });

                const onClick = (e: mapboxgl.MapMouseEvent) => {
                    this.popup.setLngLat(e.lngLat).setHTML(popupHtml(m, folderName)).addTo(this.map);
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
        } catch {
            // map not ready to accept sources/layers yet
        }
    }

    private setRouteData(fileId: string, geojson: GeoJSON.FeatureCollection) {
        const source = this.map.getSource(coreLayerId(fileId)) as mapboxgl.GeoJSONSource | undefined;
        if (source) source.setData(geojson);
    }

    private setLayerPairVisible(fileId: string, visible: boolean) {
        const vis = visible ? 'visible' : 'none';
        for (const id of [glowLayerId(fileId), coreLayerId(fileId)]) {
            if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', vis);
        }
    }

    /** Toggle a single route (glow + core together). */
    setRouteVisible(fileId: string, visible: boolean) {
        this.setLayerPairVisible(fileId, visible);
        publicOverlayGroups.update((groups) =>
            groups.map((g) => {
                const maps = g.maps.map((m) => (m.fileId === fileId ? { ...m, visible } : m));
                return { ...g, maps, visible: maps.every((m) => m.visible) };
            })
        );
    }

    /** Master toggle: show/hide every route in a group. */
    setGroupVisible(folderId: string, visible: boolean) {
        publicOverlayGroups.update((groups) =>
            groups.map((g) => {
                if (g.folderId !== folderId) return g;
                for (const m of g.maps) this.setLayerPairVisible(m.fileId, visible);
                return { ...g, visible, maps: g.maps.map((m) => ({ ...m, visible })) };
            })
        );
    }

    remove() {
        try {
            for (const l of this.listeners) this.map.off(l.type, l.id, l.fn);
            this.listeners = [];
            this.popup.remove();
            for (const group of getGroupsSnapshot()) {
                for (const m of group.maps) {
                    for (const id of [coreLayerId(m.fileId), glowLayerId(m.fileId)]) {
                        if (this.map.getLayer(id)) this.map.removeLayer(id);
                    }
                    const src = coreLayerId(m.fileId);
                    if (this.map.getSource(src)) this.map.removeSource(src);
                }
            }
            if (this.map.getLayer(AGGREGATE_LAYER)) this.map.removeLayer(AGGREGATE_LAYER);
            if (this.map.getSource(AGGREGATE_LAYER)) this.map.removeSource(AGGREGATE_LAYER);
        } catch {
            // map not ready
        }
        this.loaded = false;
        publicOverlayGroups.set([]);
        publicAggregate.set({ available: false, visible: false });
    }
}

let _snapshot: PublicOverlayGroup[] = [];
publicOverlayGroups.subscribe((g) => (_snapshot = g));
function getGroupsSnapshot(): PublicOverlayGroup[] {
    return _snapshot;
}
