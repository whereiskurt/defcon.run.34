import { writable } from 'svelte/store';
import { parseGPX } from 'gpx';
import mapboxgl from 'mapbox-gl';
import { DC34, routeColor } from '$lib/dc34-palette';
import { pinIconById, pinSvg, DEFAULT_PIN_ICON, DEFAULT_PIN_COLOR } from '$lib/dc34-pins';
import { getSvgForSymbol } from './gpx-layer/gpx-layer';
import { getSymbolKey } from '$lib/assets/symbols';

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
const GLOW_BLUR = 6;
// Lines read too thin on the map — scale the CMS/base weight up so routes pop.
const WIDTH_SCALE = 2.5;

export type PublicMap = {
    fileId: string;
    fileName: string;
    title?: string; // CMS-curated title (keyed by gpxFileId); falls back to filename
    // CMS enrichment (all optional)
    shortDescription?: string; // hover tooltip
    descriptionHtml?: string; // rich-text blurb, pre-rendered to safe HTML
    distanceKm?: number; // curated distance (km)
    elevationM?: number; // curated elevation gain (m)
    mapColor?: string; // raw CMS line color (also folded into `color`)
    mapWeight?: number; // line width (1–10)
    mapOpacity?: number; // line opacity (0–1)
    coverImageUrl?: string; // full-size cover image (click-through)
    coverImageDisplayUrl?: string; // sized-down variant shown in the popup
    stravaUrl?: string; // link to the route on Strava
    downloadUrl: string;
    bounds?: { minLat: number; maxLat: number; minLon: number; maxLon: number };
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

// "User Check-ins" (v1.8 Phase 3): public (isPrivate === false) check-ins rendered
// as big branded pins, clustered at scale. Fed by the same-origin proxy below.
export const publicCheckIns = writable<{ available: boolean; visible: boolean; count: number }>({
    available: false,
    visible: false,
    count: 0,
});

// Fetch a two-week window (covers the whole con) — `since` rounded down to the
// hour so the URL stays stable and CDN-cacheable for an hour at a time.
function checkinsUrl(): string {
    const since = Math.floor((Date.now() - 14 * 24 * 3600_000) / 3600_000) * 3600_000;
    return `${regionPrefix()}/api/gpx/public/checkins?since=${since}`;
}
const CHECKINS_SOURCE = 'public-checkins';
const CHECKINS_PIN_LAYER = 'public-checkins-pin';
const CHECKINS_CLUSTER_LAYER = 'public-checkins-cluster';
const CHECKINS_COUNT_LAYER = 'public-checkins-count';

type PublicCheckIn = {
    lat: number;
    lon: number;
    displayName: string;
    timestamp: number;
    checkInType?: string;
    pinIcon?: string; // dc34-pins catalog id; absent → default pin
    pinColor?: string; // #rrggbb; absent → default color
};

// Check-in view filters (v1.8 Phase 4): time window chips + runner highlight.
export type CheckinWindow = 'hour' | 'today' | 'all';
export const checkinFilters = writable<{ window: CheckinWindow; runner: string | null }>({
    window: 'all',
    runner: null,
});

// Structural view of the parsed GPX waypoints (avoids importing the class).
type GpxWaypoint = {
    getLatitude(): number;
    getLongitude(): number;
    name?: string;
    desc?: string;
    sym?: string;
};

function coreLayerId(fileId: string): string {
    return `${SOURCE_PREFIX}${fileId}`;
}
function glowLayerId(fileId: string): string {
    return `${SOURCE_PREFIX}${fileId}-glow`;
}
function poiLayerId(fileId: string): string {
    return `${SOURCE_PREFIX}${fileId}-poi`;
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

/** Display name for a public route — the stored GPX filename with the ".gpx"
 * extension stripped (Kurt 2026-07-04). Exported so the layer control shows
 * the same label. Custom titles beyond this need CMS enrichment. */
export function prettyRouteName(fileName: string): string {
    return fileName.replace(/\.gpx$/i, '').trim() || fileName;
}

/** Build the details-popup HTML from a route — CMS metadata when present, GPX-derived otherwise. */
function popupHtml(m: PublicMap, folderName: string): string {
    const rows: string[] = [];
    // Prefer curated CMS distance/elevation (km/m); fall back to GPX-derived.
    const distStr = m.distanceKm != null ? `${m.distanceKm} km` : formatDistance(m.totalDistance);
    if (distStr) rows.push(`<span>📏 ${distStr}</span>`);
    const elev = m.elevationM != null
        ? m.elevationM
        : m.totalElevation && m.totalElevation > 0 ? m.totalElevation : undefined;
    if (elev != null) rows.push(`<span>⛰ ${Math.round(elev)} m gain</span>`);
    if (m.trackCount && m.trackCount > 1) rows.push(`<span>🧭 ${m.trackCount} tracks</span>`);

    const meta = rows.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;font-size:12px;opacity:.85">${rows.join('')}</div>`
        : '';

    // Cover image — click opens the full-size original in a new tab.
    const cover = m.coverImageDisplayUrl
        ? `<a href="${escapeHtml(m.coverImageUrl || m.coverImageDisplayUrl)}" target="_blank" rel="noopener noreferrer">
              <img src="${escapeHtml(m.coverImageDisplayUrl)}" alt="${escapeHtml(m.title || prettyRouteName(m.fileName))}"
                   loading="lazy" style="width:100%;border-radius:6px;margin-top:8px;display:block" /></a>`
        : '';

    // Rich-text description (already rendered to safe HTML by the manifest).
    const desc = m.descriptionHtml
        ? `<div class="dc34-route-desc" style="margin-top:8px;font-size:12px;line-height:1.45;opacity:.9">${m.descriptionHtml}</div>`
        : '';

    // Download link — reuses the presigned S3 GET url the manifest already provides.
    const download = m.downloadUrl
        ? `<a href="${escapeHtml(m.downloadUrl)}" download="${escapeHtml(prettyRouteName(m.fileName))}.gpx"
              style="display:inline-block;margin-top:8px;font-size:12px;font-weight:600;color:${m.color};text-decoration:none">⬇ Download GPX</a>`
        : '';
    // Strava link — opens the route on Strava in a new tab (CMS stravaUrl).
    const strava = m.stravaUrl
        ? `<a href="${escapeHtml(m.stravaUrl)}" target="_blank" rel="noopener noreferrer"
              style="display:inline-block;margin-top:8px;margin-left:14px;font-size:12px;font-weight:600;color:#fc5200;text-decoration:none">↗ Strava</a>`
        : '';

    return `
        <div style="min-width:200px;max-width:280px;padding:10px 12px;border-left:4px solid ${m.color};
                    font-family:system-ui,sans-serif;color:#e4e4ef">
            <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.55">${escapeHtml(folderName)}</div>
            <div style="font-size:15px;font-weight:600;margin-top:2px">${escapeHtml(m.title || prettyRouteName(m.fileName))}</div>
            ${meta}
            ${cover}
            ${desc}
            <div>${download}${strava}</div>
            <div style="margin-top:8px;font-size:9px;font-family:ui-monospace,monospace;opacity:.35;user-select:all">id: ${escapeHtml(m.fileId)}</div>
        </div>`;
}

/** Resolve a check-in's pin (catalog icon + color) with defaults, and the map
 * image id that (icon, color) pair renders under. */
function resolvePin(c: PublicCheckIn): { iconId: string; svg: string } {
    const icon = pinIconById(c.pinIcon) ?? pinIconById(DEFAULT_PIN_ICON)!;
    const color = icon.fixedColor ?? c.pinColor ?? DEFAULT_PIN_COLOR;
    return { iconId: `dc34-pin-${icon.id}-${color}`, svg: pinSvg(icon, color) };
}

function checkinPopupHtml(displayName: string, timestamp: number, checkInType?: string): string {
    const when = new Date(timestamp).toLocaleString();
    const type = checkInType ? ` · ${escapeHtml(checkInType)}` : '';
    return `
        <div style="padding:8px 10px;border-left:4px solid ${DC34.teal};font-family:system-ui,sans-serif;color:#e4e4ef">
            <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.55">Check-in</div>
            <button class="dc34-runner-filter" title="Show only this runner's check-ins"
                    style="font-size:14px;font-weight:600;margin-top:2px;background:none;border:none;padding:0;
                           color:${DC34.teal};cursor:pointer;font-family:inherit">🐇 ${escapeHtml(displayName)}</button>
            <div style="font-size:12px;opacity:.8;margin-top:4px">${escapeHtml(when)}${type}</div>
        </div>`;
}

function poiPopupHtml(name: string, desc: string, color: string): string {
    const detail = desc
        ? `<div style="font-size:12px;opacity:.8;margin-top:4px">${escapeHtml(desc)}</div>`
        : '';
    return `
        <div style="padding:8px 10px;border-left:4px solid ${color};font-family:system-ui,sans-serif;color:#e4e4ef">
            <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.55">Point of interest</div>
            <div style="font-size:14px;font-weight:600;margin-top:2px">${escapeHtml(name)}</div>
            ${detail}
        </div>`;
}

export class PublicOverlaysLayer {
    map: mapboxgl.Map;
    loaded = false;
    private popup: mapboxgl.Popup;
    private hoverPopup: mapboxgl.Popup;
    // Track per-layer listeners so we can detach them on remove().
    private listeners: { id: string; type: 'click' | 'mouseenter' | 'mouseleave' | 'mousemove'; fn: any }[] = [];
    // fileId -> [[minLon,minLat],[maxLon,maxLat]] for fit-on-toggle (Kurt 2026-07-04).
    private routeBounds = new Map<string, [[number, number], [number, number]]>();

    constructor(map: mapboxgl.Map) {
        this.map = map;
        this.popup = new mapboxgl.Popup({
            closeButton: true,
            closeOnClick: true,
            maxWidth: '280px',
            offset: 12,
            className: 'dc34-route-popup',
        });
        // Lightweight hover tooltip showing the CMS shortDescription (when set).
        this.hoverPopup = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            maxWidth: '240px',
            offset: 12,
            className: 'dc34-route-tip',
        });
    }

    /** Resolve once the style (incl. the async basemap import) can accept sources/layers. */
    private whenStyleReady(): Promise<void> {
        if (this.map.isStyleLoaded()) return Promise.resolve();
        return new Promise((resolve) => this.map.once('idle', () => resolve()));
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
                    maps: Omit<PublicMap, 'visible' | 'color'>[];
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
            // Cache per-route bounds so toggling a layer on can fit it in view.
            for (const g of groups) {
                for (const m of g.maps) {
                    if (m.bounds) {
                        this.routeBounds.set(m.fileId, [
                            [m.bounds.minLon, m.bounds.minLat],
                            [m.bounds.maxLon, m.bounds.maxLat],
                        ]);
                    }
                }
            }
        } catch {
            return; // manifest unavailable → no overlays, studio unaffected
        }

        // add() is called on the map 'load' event, but the basemap is a STYLE IMPORT that
        // loads slightly later — adding sources/layers before it is ready throws, which used
        // to silently drop whichever routes happened to resolve first. Gate on style-ready so
        // every route is added against a ready map, not a race.
        await this.whenStyleReady();

        // Fetch + parse each route's GPX, add a read-only glow+core line layer (initially hidden).
        await Promise.all(
            groups.flatMap((group) =>
                group.maps.map(async (m) => {
                    try {
                        const gpxRes = await fetch(m.downloadUrl);
                        if (!gpxRes.ok) return;
                        const file = parseGPX(await gpxRes.text());
                        this.addRouteLayer(m, group.folderName);
                        this.setRouteData(m.fileId, file.toGeoJSON());
                        // toGeoJSON() only emits tracks — waypoints (POIs) ride separately.
                        this.addRoutePois(m, (file.wpt as GpxWaypoint[]) ?? []);
                    } catch (err) {
                        // skip a route that fails to fetch/parse; others still render
                        console.warn(`[public-overlays] failed to load ${m.fileId}:`, err);
                    }
                })
            )
        );

        this.loaded = true;
        publicOverlayGroups.set(groups);

        await this.addAggregate();
        await this.addCheckIns();
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

    /** Register a data-URI SVG as a map image (decodes async; no-op if already loaded). */
    private loadSvgImage(id: string, svg: string) {
        if (this.map.hasImage(id)) return;
        const icon = new Image(100, 100);
        icon.onload = () => {
            if (!this.map.hasImage(id)) this.map.addImage(id, icon);
        };
        icon.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
    }

    // Raw fetched check-ins — filters re-derive the source data from this list
    // (setData re-clusters; a layer filter would leave cluster counts stale).
    private checkins: PublicCheckIn[] = [];

    /** Feature collection for the check-ins passing the current filters,
     * registering each (icon, color) pin image on first use. */
    private checkinFeatures(): GeoJSON.FeatureCollection {
        const f = getCheckinFiltersSnapshot();
        const sinceByWindow: Record<CheckinWindow, number> = {
            hour: Date.now() - 3600_000,
            today: new Date().setHours(0, 0, 0, 0),
            all: 0,
        };
        const since = sinceByWindow[f.window];
        const visible = this.checkins.filter(
            (c) => c.timestamp >= since && (!f.runner || c.displayName === f.runner)
        );
        return {
            type: 'FeatureCollection',
            features: visible.map((c) => {
                const pin = resolvePin(c);
                this.loadSvgImage(pin.iconId, pin.svg);
                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
                    properties: {
                        displayName: c.displayName,
                        timestamp: c.timestamp,
                        checkInType: c.checkInType ?? '',
                        iconId: pin.iconId,
                    },
                };
            }),
        };
    }

    /** Update the check-in filters (time window / runner) and re-cluster. */
    setCheckInFilters(partial: Partial<{ window: CheckinWindow; runner: string | null }>) {
        checkinFilters.update((f) => ({ ...f, ...partial }));
        const source = this.map.getSource(CHECKINS_SOURCE) as mapboxgl.GeoJSONSource | undefined;
        if (source) source.setData(this.checkinFeatures());
    }

    /** Load public user check-ins as hidden, clustered layers of big branded pins. */
    private async addCheckIns() {
        try {
            const res = await fetch(checkinsUrl(), { credentials: 'omit' });
            if (!res.ok) return;
            const body = (await res.json()) as { checkIns: PublicCheckIn[] };
            if (!body.checkIns || body.checkIns.length === 0) return;
            this.checkins = body.checkIns;

            if (!this.map.getSource(CHECKINS_SOURCE)) {
                this.map.addSource(CHECKINS_SOURCE, {
                    type: 'geojson',
                    data: this.checkinFeatures(),
                    cluster: true,
                    clusterMaxZoom: 14,
                    clusterRadius: 40,
                });
            }
            // Cluster bubbles — teal, sized by member count, magenta ring.
            if (!this.map.getLayer(CHECKINS_CLUSTER_LAYER)) {
                this.map.addLayer({
                    id: CHECKINS_CLUSTER_LAYER,
                    type: 'circle',
                    source: CHECKINS_SOURCE,
                    filter: ['has', 'point_count'],
                    layout: { visibility: 'none' },
                    paint: {
                        'circle-color': DC34.teal,
                        'circle-opacity': 0.85,
                        'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 24],
                        'circle-stroke-width': 2,
                        'circle-stroke-color': DC34.magenta,
                    },
                });

                const onClusterClick = (e: mapboxgl.MapMouseEvent) => {
                    const features = this.map.queryRenderedFeatures(e.point, {
                        layers: [CHECKINS_CLUSTER_LAYER],
                    });
                    const clusterId = features[0]?.properties?.cluster_id;
                    const source = this.map.getSource(CHECKINS_SOURCE) as
                        | mapboxgl.GeoJSONSource
                        | undefined;
                    if (clusterId === undefined || !source) return;
                    source.getClusterExpansionZoom(clusterId, (err, zoom) => {
                        if (err || zoom == null) return;
                        this.map.easeTo({
                            center: (features[0].geometry as GeoJSON.Point).coordinates as [
                                number,
                                number,
                            ],
                            zoom,
                        });
                    });
                };
                const onClusterEnter = () => (this.map.getCanvas().style.cursor = 'pointer');
                const onClusterLeave = () => (this.map.getCanvas().style.cursor = '');
                this.map.on('click', CHECKINS_CLUSTER_LAYER, onClusterClick);
                this.map.on('mouseenter', CHECKINS_CLUSTER_LAYER, onClusterEnter);
                this.map.on('mouseleave', CHECKINS_CLUSTER_LAYER, onClusterLeave);
                this.listeners.push(
                    { id: CHECKINS_CLUSTER_LAYER, type: 'click', fn: onClusterClick },
                    { id: CHECKINS_CLUSTER_LAYER, type: 'mouseenter', fn: onClusterEnter },
                    { id: CHECKINS_CLUSTER_LAYER, type: 'mouseleave', fn: onClusterLeave }
                );
            }
            if (!this.map.getLayer(CHECKINS_COUNT_LAYER)) {
                this.map.addLayer({
                    id: CHECKINS_COUNT_LAYER,
                    type: 'symbol',
                    source: CHECKINS_SOURCE,
                    filter: ['has', 'point_count'],
                    layout: {
                        visibility: 'none',
                        'text-field': ['get', 'point_count_abbreviated'],
                        'text-font': ['Open Sans Bold'],
                        'text-size': 12,
                    },
                    paint: { 'text-color': '#101015' },
                });
            }
            // Individual check-ins — the runner's chosen pin with a details popup.
            if (!this.map.getLayer(CHECKINS_PIN_LAYER)) {
                this.map.addLayer({
                    id: CHECKINS_PIN_LAYER,
                    type: 'symbol',
                    source: CHECKINS_SOURCE,
                    filter: ['!', ['has', 'point_count']],
                    layout: {
                        visibility: 'none',
                        'icon-image': ['get', 'iconId'],
                        'icon-size': 0.5,
                        'icon-anchor': 'bottom',
                        'icon-allow-overlap': true,
                    },
                });

                const onPinClick = (e: mapboxgl.MapMouseEvent) => {
                    const f = (e as unknown as { features?: GeoJSON.Feature[] }).features?.[0];
                    if (!f) return;
                    const p = f.properties as {
                        displayName?: string;
                        timestamp?: number | string;
                        checkInType?: string;
                    };
                    const name = p.displayName || 'a rabbit';
                    this.hoverPopup.remove();
                    this.popup
                        .setLngLat(
                            (f.geometry as GeoJSON.Point).coordinates as [number, number]
                        )
                        .setHTML(
                            checkinPopupHtml(name, Number(p.timestamp) || 0, p.checkInType || undefined)
                        )
                        .addTo(this.map);
                    // Runner highlight: the popup name is a button that filters
                    // the layer to just this runner's check-ins.
                    this.popup
                        .getElement()
                        ?.querySelector('.dc34-runner-filter')
                        ?.addEventListener('click', () => {
                            this.setCheckInFilters({ runner: name });
                            this.popup.remove();
                        });
                };
                const onPinEnter = () => (this.map.getCanvas().style.cursor = 'pointer');
                const onPinLeave = () => (this.map.getCanvas().style.cursor = '');
                this.map.on('click', CHECKINS_PIN_LAYER, onPinClick);
                this.map.on('mouseenter', CHECKINS_PIN_LAYER, onPinEnter);
                this.map.on('mouseleave', CHECKINS_PIN_LAYER, onPinLeave);
                this.listeners.push(
                    { id: CHECKINS_PIN_LAYER, type: 'click', fn: onPinClick },
                    { id: CHECKINS_PIN_LAYER, type: 'mouseenter', fn: onPinEnter },
                    { id: CHECKINS_PIN_LAYER, type: 'mouseleave', fn: onPinLeave }
                );
            }

            publicCheckIns.set({ available: true, visible: false, count: body.checkIns.length });
        } catch {
            // check-ins unavailable → no layer, studio unaffected
        }
    }

    /** Toggle the "User Check-ins" layers (pins + clusters together). */
    setCheckInsVisible(visible: boolean) {
        const vis = visible ? 'visible' : 'none';
        for (const id of [CHECKINS_CLUSTER_LAYER, CHECKINS_COUNT_LAYER, CHECKINS_PIN_LAYER]) {
            if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', vis);
        }
        publicCheckIns.update((s) => ({ ...s, visible }));
    }

    /** Add the glow + core line layers for a route, plus its click/hover handlers. */
    private addRouteLayer(m: PublicMap, folderName: string) {
        const core = coreLayerId(m.fileId);
        const glow = glowLayerId(m.fileId);
        // Scaled-up widths: the crisp core plus a wider blurred glow halo.
        const coreW = (m.mapWeight ?? CORE_WIDTH) * WIDTH_SCALE;
        const glowW = coreW * 2;
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
                        'line-width': glowW,
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
                    paint: {
                        'line-color': m.color,
                        // Curated CMS weight (scaled up) / opacity when present, else the defaults.
                        'line-width': coreW,
                        'line-opacity': m.mapOpacity ?? 0.95,
                    },
                });

                const onClick = (e: mapboxgl.MapMouseEvent) => {
                    this.hoverPopup.remove();
                    this.popup.setLngLat(e.lngLat).setHTML(popupHtml(m, folderName)).addTo(this.map);
                };
                const onEnter = (e: mapboxgl.MapMouseEvent) => {
                    this.map.getCanvas().style.cursor = 'pointer';
                    if (m.shortDescription) {
                        this.hoverPopup
                            .setLngLat(e.lngLat)
                            .setHTML(
                                `<div style="font-family:system-ui,sans-serif;font-size:12px;color:#e4e4ef;max-width:220px;border-left:4px solid ${m.color};padding-left:8px">${escapeHtml(m.shortDescription)}</div>`
                            )
                            .addTo(this.map);
                    }
                };
                const onMove = (e: mapboxgl.MapMouseEvent) => {
                    if (m.shortDescription && this.hoverPopup.isOpen()) this.hoverPopup.setLngLat(e.lngLat);
                };
                const onLeave = () => {
                    this.map.getCanvas().style.cursor = '';
                    this.hoverPopup.remove();
                };
                this.map.on('click', core, onClick);
                this.map.on('mouseenter', core, onEnter);
                this.map.on('mousemove', core, onMove);
                this.map.on('mouseleave', core, onLeave);
                this.listeners.push(
                    { id: core, type: 'click', fn: onClick },
                    { id: core, type: 'mouseenter', fn: onEnter },
                    { id: core, type: 'mousemove', fn: onMove },
                    { id: core, type: 'mouseleave', fn: onLeave }
                );
            }
        } catch (err) {
            // Should not happen now that add() gates on whenStyleReady(); warn instead of
            // silently dropping the route so any regression is visible in the console.
            console.warn(`[public-overlays] failed to add layer for ${m.fileId}:`, err);
        }
    }

    /** Drop a route's GPX waypoints (POIs) as small branded icons with a details popup.
     * Hidden by default; shows/hides together with the route via setLayerPairVisible. */
    private addRoutePois(m: PublicMap, waypoints: GpxWaypoint[]) {
        if (!waypoints.length) return;
        const poi = poiLayerId(m.fileId);
        try {
            const features: GeoJSON.Feature[] = waypoints.map((w) => {
                const symbol = getSymbolKey(w.sym);
                const iconId = `dc34-poi-${symbol ?? 'default'}-${m.color}`;
                // Color the pin body with the route color (not the stock Mapbox blue);
                // drop the corner badge (undefined layerColor) for a clean route-colored pin.
                this.loadSvgImage(iconId, getSvgForSymbol(symbol, undefined, m.color));
                return {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [w.getLongitude(), w.getLatitude()],
                    },
                    properties: { name: w.name ?? '', desc: w.desc ?? '', icon: iconId },
                };
            });

            if (!this.map.getSource(poi)) {
                this.map.addSource(poi, {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features },
                });
            }
            if (!this.map.getLayer(poi)) {
                this.map.addLayer({
                    id: poi,
                    type: 'symbol',
                    source: poi,
                    layout: {
                        visibility: 'none',
                        'icon-image': ['get', 'icon'],
                        'icon-size': 0.3,
                        'icon-anchor': 'bottom',
                        'icon-padding': 0,
                        'icon-allow-overlap': true,
                    },
                });

                const onClick = (e: mapboxgl.MapMouseEvent) => {
                    const f = (e as unknown as { features?: GeoJSON.Feature[] }).features?.[0];
                    if (!f) return;
                    const p = f.properties as { name?: string; desc?: string };
                    this.hoverPopup.remove();
                    this.popup
                        .setLngLat(
                            (f.geometry as GeoJSON.Point).coordinates as [number, number]
                        )
                        .setHTML(poiPopupHtml(p.name || 'Waypoint', p.desc || '', m.color))
                        .addTo(this.map);
                };
                const onEnter = () => (this.map.getCanvas().style.cursor = 'pointer');
                const onLeave = () => (this.map.getCanvas().style.cursor = '');
                this.map.on('click', poi, onClick);
                this.map.on('mouseenter', poi, onEnter);
                this.map.on('mouseleave', poi, onLeave);
                this.listeners.push(
                    { id: poi, type: 'click', fn: onClick },
                    { id: poi, type: 'mouseenter', fn: onEnter },
                    { id: poi, type: 'mouseleave', fn: onLeave }
                );
            }
        } catch (err) {
            console.warn(`[public-overlays] failed to add POIs for ${m.fileId}:`, err);
        }
    }

    private setRouteData(fileId: string, geojson: GeoJSON.FeatureCollection) {
        const source = this.map.getSource(coreLayerId(fileId)) as mapboxgl.GeoJSONSource | undefined;
        if (source) source.setData(geojson);
    }

    private setLayerPairVisible(fileId: string, visible: boolean) {
        const vis = visible ? 'visible' : 'none';
        for (const id of [glowLayerId(fileId), coreLayerId(fileId), poiLayerId(fileId)]) {
            if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', vis);
        }
    }

    /** Recenter/zoom so the given routes are in view when toggled on
     * (Kurt 2026-07-04). Unions the cached per-route bounds. */
    private fitToRoutes(fileIds: string[]) {
        let box: [[number, number], [number, number]] | null = null;
        for (const id of fileIds) {
            const b = this.routeBounds.get(id);
            if (!b) continue;
            if (!box) {
                box = [[b[0][0], b[0][1]], [b[1][0], b[1][1]]];
            } else {
                box[0][0] = Math.min(box[0][0], b[0][0]);
                box[0][1] = Math.min(box[0][1], b[0][1]);
                box[1][0] = Math.max(box[1][0], b[1][0]);
                box[1][1] = Math.max(box[1][1], b[1][1]);
            }
        }
        if (box) this.map.fitBounds(box, { padding: 80, maxZoom: 15, duration: 700 });
    }

    /** Toggle a single route (glow + core together). */
    setRouteVisible(fileId: string, visible: boolean) {
        this.setLayerPairVisible(fileId, visible);
        if (visible) this.fitToRoutes([fileId]);
        publicOverlayGroups.update((groups) =>
            groups.map((g) => {
                const maps = g.maps.map((m) => (m.fileId === fileId ? { ...m, visible } : m));
                return { ...g, maps, visible: maps.every((m) => m.visible) };
            })
        );
    }

    /** Master toggle: show/hide every route in a group. */
    setGroupVisible(folderId: string, visible: boolean) {
        const fitIds: string[] = [];
        publicOverlayGroups.update((groups) =>
            groups.map((g) => {
                if (g.folderId !== folderId) return g;
                for (const m of g.maps) {
                    this.setLayerPairVisible(m.fileId, visible);
                    fitIds.push(m.fileId);
                }
                return { ...g, visible, maps: g.maps.map((m) => ({ ...m, visible })) };
            })
        );
        if (visible) this.fitToRoutes(fitIds);
    }

    remove() {
        try {
            for (const l of this.listeners) this.map.off(l.type, l.id, l.fn);
            this.listeners = [];
            this.popup.remove();
            this.hoverPopup.remove();
            for (const group of getGroupsSnapshot()) {
                for (const m of group.maps) {
                    for (const id of [
                        coreLayerId(m.fileId),
                        glowLayerId(m.fileId),
                        poiLayerId(m.fileId),
                    ]) {
                        if (this.map.getLayer(id)) this.map.removeLayer(id);
                    }
                    for (const src of [coreLayerId(m.fileId), poiLayerId(m.fileId)]) {
                        if (this.map.getSource(src)) this.map.removeSource(src);
                    }
                }
            }
            if (this.map.getLayer(AGGREGATE_LAYER)) this.map.removeLayer(AGGREGATE_LAYER);
            if (this.map.getSource(AGGREGATE_LAYER)) this.map.removeSource(AGGREGATE_LAYER);
            for (const id of [CHECKINS_CLUSTER_LAYER, CHECKINS_COUNT_LAYER, CHECKINS_PIN_LAYER]) {
                if (this.map.getLayer(id)) this.map.removeLayer(id);
            }
            if (this.map.getSource(CHECKINS_SOURCE)) this.map.removeSource(CHECKINS_SOURCE);
        } catch {
            // map not ready
        }
        this.loaded = false;
        this.checkins = [];
        publicOverlayGroups.set([]);
        publicAggregate.set({ available: false, visible: false });
        publicCheckIns.set({ available: false, visible: false, count: 0 });
        checkinFilters.set({ window: 'all', runner: null });
    }
}

let _snapshot: PublicOverlayGroup[] = [];
publicOverlayGroups.subscribe((g) => (_snapshot = g));
function getGroupsSnapshot(): PublicOverlayGroup[] {
    return _snapshot;
}

let _filtersSnapshot: { window: CheckinWindow; runner: string | null } = {
    window: 'all',
    runner: null,
};
checkinFilters.subscribe((f) => (_filtersSnapshot = f));
function getCheckinFiltersSnapshot() {
    return _filtersSnapshot;
}
