import { writable } from 'svelte/store';
import { parseGPX } from 'gpx';

/**
 * Public overlays — DEF CON 34 official map layers (v1.7 Phase 28).
 *
 * Fetches the unauthenticated manifest (`/api/gpx/public/maps`), which returns every
 * GLOBAL folder ("DEF CON 34 Maps", "Rabbit Routes", …) with its active GPX routes, and
 * renders each route as a READ-ONLY line layer on the map. Routes are grouped; the UI
 * (layer control) binds to `publicOverlayGroups` to render a group master toggle plus a
 * per-route toggle.
 *
 * Read-only: these layers are NOT added to the editable file list / Dexie store — they are
 * plain MapLibre GeoJSON line layers a viewer can show/hide but not edit.
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
const LINE_COLOR = '#e6007a'; // DEF CON magenta; per-group theming is a follow-up
const LINE_WIDTH = 4;

export type PublicMap = {
    fileId: string;
    fileName: string;
    downloadUrl: string;
    totalDistance?: number;
    totalElevation?: number;
    trackCount?: number;
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

function layerIdFor(fileId: string): string {
    return `${SOURCE_PREFIX}${fileId}`;
}

export class PublicOverlaysLayer {
    map: mapboxgl.Map;
    loaded = false;

    constructor(map: mapboxgl.Map) {
        this.map = map;
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
                    maps: Omit<PublicMap, 'visible'>[];
                }[];
            };
            groups = body.groups.map((g) => ({
                folderId: g.folderId,
                folderName: g.folderName,
                // Default off — the viewer opts in via the "DEF CON 34 maps on/off" toggle.
                visible: false,
                maps: g.maps.map((m) => ({ ...m, visible: false })),
            }));
        } catch {
            return; // manifest unavailable → no overlays, studio unaffected
        }

        // Fetch + parse each route's GPX, add a read-only line layer (initially hidden).
        await Promise.all(
            groups.flatMap((group) =>
                group.maps.map(async (m) => {
                    try {
                        const gpxRes = await fetch(m.downloadUrl);
                        if (!gpxRes.ok) return;
                        const geojson = parseGPX(await gpxRes.text()).toGeoJSON();
                        this.addRouteLayer(m.fileId, geojson);
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

    private addRouteLayer(fileId: string, geojson: GeoJSON.FeatureCollection) {
        const id = layerIdFor(fileId);
        try {
            if (!this.map.getSource(id)) {
                this.map.addSource(id, { type: 'geojson', data: geojson });
            }
            if (!this.map.getLayer(id)) {
                this.map.addLayer({
                    id,
                    type: 'line',
                    source: id,
                    layout: {
                        'line-join': 'round',
                        'line-cap': 'round',
                        visibility: 'none', // hidden until toggled on
                    },
                    paint: {
                        'line-color': LINE_COLOR,
                        'line-width': LINE_WIDTH,
                        'line-opacity': 0.85,
                    },
                });
            }
        } catch {
            // map not ready to accept sources/layers yet
        }
    }

    /** Toggle a single route. */
    setRouteVisible(fileId: string, visible: boolean) {
        const id = layerIdFor(fileId);
        if (this.map.getLayer(id)) {
            this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
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
                for (const m of g.maps) {
                    const id = layerIdFor(m.fileId);
                    if (this.map.getLayer(id)) {
                        this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
                    }
                }
                return { ...g, visible, maps: g.maps.map((m) => ({ ...m, visible })) };
            })
        );
    }

    remove() {
        try {
            for (const group of getGroupsSnapshot()) {
                for (const m of group.maps) {
                    const id = layerIdFor(m.fileId);
                    if (this.map.getLayer(id)) this.map.removeLayer(id);
                    if (this.map.getSource(id)) this.map.removeSource(id);
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
