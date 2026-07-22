import { writable } from 'svelte/store';
import { parseGPX } from 'gpx';
import mapboxgl from 'mapbox-gl';
import { routeColor } from '$lib/dc34-palette';
import { deleteFromCloud, getApiBase } from '$lib/cloud-sync';
import { notifyStravaRunRemoved } from '$lib/stores/strava-strip';
import { conRunDayColors, conRunMetaByFileId, runPopupHtml, wireRunPopupRemove } from './run-popup';

/**
 * "My DEF CON Runs" — the signed-in runner's own con-day-tagged files, rendered
 * as a READ-ONLY glow+core line layer grouped and colored per con day (task 11,
 * 2026-07-21 spec).
 *
 * Structurally this follows `public-overlays.ts` (whenStyleReady gating, glow+core
 * line pair, listener tracking, routeBounds cache + fitToRoutes union), but is the
 * SMALL version: no POIs, no hover tooltips, no CMS enrichment — just lines, a
 * simple click popup (fileName + day label + distance), and toggles.
 *
 * Never breaks the studio: an unauthenticated/empty/failed manifest fetch just
 * leaves the store empty and returns silently.
 */

const SOURCE_PREFIX = 'my-con-run-';
const CORE_WIDTH = 4;
const GLOW_BLUR = 6;

/** Server manifest entry — GET `${getApiBase()}/files/con-runs` (Task 5). */
type RunManifestEntry = {
    fileId: string;
    fileName: string;
    conDay: string;
    totalDistance?: number;
    bounds?: { minLat: number; maxLat: number; minLon: number; maxLon: number };
    downloadUrl: string;
};

export type MyConRunGroup = {
    conDay: string;
    label: string;
    visible: boolean;
    runs: { fileId: string; fileName: string; visible: boolean }[];
};

// UI-facing state: the layer control renders a group toggle (per con day) plus
// per-run toggles from this. Groups are ordered ascending by conDay.
export const myConRunGroups = writable<MyConRunGroup[]>([]);

function coreLayerId(fileId: string): string {
    return `${SOURCE_PREFIX}${fileId}`;
}
function glowLayerId(fileId: string): string {
    return `${SOURCE_PREFIX}${fileId}-glow`;
}

/** Group/eyebrow label for a con day: weekday + short date, e.g. "Saturday · Aug 8" —
 * distinguishes the two DEF CON days that happen to share a weekday. */
function dayLabel(conDay: string): string {
    const d = new Date(conDay + 'T12:00:00');
    const weekday = d.toLocaleDateString(undefined, { weekday: 'long' });
    const monthDay = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${weekday} · ${monthDay}`;
}

/** Derive a `[[minLon,minLat],[maxLon,maxLat]]` bounding box from a parsed GPX
 * FeatureCollection when the manifest carries no precomputed bounds. Returns
 * null when there are no usable coordinates so a degenerate/NaN box is never cached. */
function boundsFromGeoJSON(
    fc: GeoJSON.FeatureCollection
): [[number, number], [number, number]] | null {
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    const visit = (lon: number, lat: number) => {
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        if (lon < minLon) minLon = lon;
        if (lat < minLat) minLat = lat;
        if (lon > maxLon) maxLon = lon;
        if (lat > maxLat) maxLat = lat;
    };
    for (const f of fc.features ?? []) {
        const g = f.geometry;
        if (!g) continue;
        if (g.type === 'LineString') {
            for (const c of g.coordinates) visit(c[0], c[1]);
        } else if (g.type === 'MultiLineString') {
            for (const line of g.coordinates) for (const c of line) visit(c[0], c[1]);
        } else if (g.type === 'Point') {
            visit(g.coordinates[0], g.coordinates[1]);
        }
    }
    if (minLon === Infinity) return null;
    return [[minLon, minLat], [maxLon, maxLat]];
}

export class MyConRunsLayer {
    map: mapboxgl.Map;
    loaded = false;
    private popup: mapboxgl.Popup;
    // Track per-layer listeners so we can detach them on remove().
    private listeners: { id: string; type: 'click' | 'mouseenter' | 'mouseleave'; fn: any }[] = [];
    // fileId -> [[minLon,minLat],[maxLon,maxLat]] for fit-on-toggle.
    private routeBounds = new Map<string, [[number, number], [number, number]]>();
    // conDay -> fixed color (all runs of one day share a hue).
    private dayColor = new Map<string, string>();

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

    /** Resolve once the style (incl. the async basemap import) can accept sources/layers. */
    private whenStyleReady(): Promise<void> {
        if (this.map.isStyleLoaded()) return Promise.resolve();
        return new Promise((resolve) => this.map.once('idle', () => resolve()));
    }

    /** Fetch the signed-in runner's con-day manifest and render every run (hidden by default). */
    async load(): Promise<void> {
        if (this.loaded) return;
        let manifest: RunManifestEntry[];
        try {
            const res = await fetch(`${getApiBase()}/files/con-runs`, { credentials: 'include' });
            if (!res.ok) {
                // 401/403 (not signed in / no gpxstudio access) → genuinely no
                // layer. Any OTHER failure (5xx flake right after an import
                // triggered a reload) must NOT collapse the panel — keep
                // whatever groups are currently shown (UAT round 3 fix A).
                if (res.status === 401 || res.status === 403) myConRunGroups.set([]);
                return;
            }
            const body = (await res.json()) as { runs: RunManifestEntry[] };
            manifest = body.runs ?? [];
            if (manifest.length === 0) {
                // A real, authoritative empty answer — clearing is correct.
                myConRunGroups.set([]);
                return;
            }
        } catch {
            // Transient network failure — keep the current groups on screen.
            return;
        }

        await this.whenStyleReady();

        // Distinct con days, sorted ascending — index drives the fixed per-day color.
        const days = Array.from(new Set(manifest.map((r) => r.conDay))).sort();
        this.dayColor.clear();
        days.forEach((d, i) => this.dayColor.set(d, routeColor(i)));

        // Refresh the cross-layer bridges (gpx-layer.ts reads these for its own
        // editable-file-track click popup — UAT round 2 fix B).
        conRunDayColors.clear();
        this.dayColor.forEach((color, day) => conRunDayColors.set(day, color));
        conRunMetaByFileId.clear();
        manifest.forEach((r) =>
            conRunMetaByFileId.set(r.fileId, {
                conDay: r.conDay,
                fileName: r.fileName,
                totalDistance: r.totalDistance,
            })
        );

        const groups: MyConRunGroup[] = days.map((conDay) => ({
            conDay,
            label: dayLabel(conDay),
            visible: false,
            runs: manifest
                .filter((r) => r.conDay === conDay)
                .map((r) => ({ fileId: r.fileId, fileName: r.fileName, visible: false })),
        }));

        // Fetch + parse each run's GPX, add a read-only glow+core line layer (initially hidden).
        await Promise.all(
            manifest.map(async (r) => {
                try {
                    const gpxRes = await fetch(r.downloadUrl);
                    if (!gpxRes.ok) return;
                    const file = parseGPX(await gpxRes.text());
                    const geojson = file.toGeoJSON();
                    this.addRouteLayer(r);
                    this.setRouteData(r.fileId, geojson);
                    if (r.bounds) {
                        this.routeBounds.set(r.fileId, [
                            [r.bounds.minLon, r.bounds.minLat],
                            [r.bounds.maxLon, r.bounds.maxLat],
                        ]);
                    } else {
                        const box = boundsFromGeoJSON(geojson);
                        if (box) this.routeBounds.set(r.fileId, box);
                    }
                } catch (err) {
                    // skip a run that fails to fetch/parse; others still render
                    console.warn(`[my-con-runs] failed to load ${r.fileId}:`, err);
                }
            })
        );

        this.loaded = true;
        myConRunGroups.set(groups);
    }

    /** Idempotent re-fetch (e.g. after a fresh import/re-tag). Tears the old map
     * layers down but deliberately does NOT clear `myConRunGroups` first — the
     * old `remove()`-then-`load()` sequence flashed the "My DEF CON Runs" panel
     * section to empty for the length of the refetch (a network round trip +
     * per-run GPX fetches), and if the layer-control panel happened to be open
     * under the pointer at that moment, the sudden height drop (then regrowth
     * once `load()` finished) shifted the panel out from under the cursor and
     * produced the hover open/close oscillation seen in UAT round 3. `load()`
     * still only commits `myConRunGroups` ONCE, atomically, when the fresh data
     * is ready, so the panel's stale content just stays put in the meantime. */
    async reload(): Promise<void> {
        this.teardownMapLayers();
        this.loaded = false;
        await this.load();
    }

    /** Add the glow + core line layers for a run, plus its click handler. */
    private addRouteLayer(r: RunManifestEntry) {
        const core = coreLayerId(r.fileId);
        const glow = glowLayerId(r.fileId);
        const color = this.dayColor.get(r.conDay) ?? routeColor(0);
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
                        'line-color': color,
                        'line-width': CORE_WIDTH * 2,
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
                        'line-color': color,
                        'line-width': CORE_WIDTH,
                        'line-opacity': 0.95,
                    },
                });

                const onClick = (e: mapboxgl.MapMouseEvent) => {
                    this.popup
                        .setLngLat(e.lngLat)
                        .setHTML(runPopupHtml(r.fileName, r.conDay, color, r.totalDistance, r.fileId))
                        .addTo(this.map);
                    wireRunPopupRemove(this.popup.getElement(), (id) => this.removeRun(id));
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
            // Should not happen now that load() gates on whenStyleReady(); warn instead of
            // silently dropping the run so any regression is visible in the console.
            console.warn(`[my-con-runs] failed to add layer for ${r.fileId}:`, err);
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

    /** Recenter/zoom so the given runs are in view when toggled on. Unions the
     * cached per-run bounds. */
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

    /** Master toggle: show/hide every run tagged with a given con day.
     * `fit` lets revealConRun suppress the day-wide fitBounds so its own
     * single-run fit is the only camera move (no double animation). */
    setDayVisible(conDay: string, visible: boolean, fit = true) {
        const fitIds: string[] = [];
        myConRunGroups.update((groups) =>
            groups.map((g) => {
                if (g.conDay !== conDay) return g;
                for (const r of g.runs) {
                    this.setLayerPairVisible(r.fileId, visible);
                    fitIds.push(r.fileId);
                }
                return { ...g, visible, runs: g.runs.map((r) => ({ ...r, visible })) };
            })
        );
        if (visible && fit) this.fitToRoutes(fitIds);
    }

    /** Toggle a single run (glow + core together). */
    setRunVisible(fileId: string, visible: boolean) {
        this.setLayerPairVisible(fileId, visible);
        if (visible) this.fitToRoutes([fileId]);
        myConRunGroups.update((groups) =>
            groups.map((g) => {
                const runs = g.runs.map((r) => (r.fileId === fileId ? { ...r, visible } : r));
                return { ...g, runs, visible: runs.every((r) => r.visible) };
            })
        );
    }

    /** Show the same click-popup a runner would get from clicking this run's
     * line, anchored at the center of its cached bounds. No-ops silently if the
     * run isn't (yet) known to this layer — e.g. `reload()` hasn't finished. */
    private showRunPopup(fileId: string) {
        const meta = conRunMetaByFileId.get(fileId);
        const box = this.routeBounds.get(fileId);
        if (!meta || !box) return;
        const lngLat: [number, number] = [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2];
        const color = this.dayColor.get(meta.conDay) ?? routeColor(0);
        this.popup
            .setLngLat(lngLat)
            .setHTML(runPopupHtml(meta.fileName, meta.conDay, color, meta.totalDistance, fileId))
            .addTo(this.map);
        wireRunPopupRemove(this.popup.getElement(), (id) => this.removeRun(id));
    }

    /** "Remove run" (Kurt 2026-07-21): fully delete the cloud file (S3 + DDB
     * cascade server-side), then reload the layer and tell the Strava strip so
     * the source activity becomes selectable again — dedupe joins the live
     * file index, so a removed run can always be re-imported. Returns false on
     * failure so the popup button can offer a retry. */
    private async removeRun(fileId: string): Promise<boolean> {
        try {
            await deleteFromCloud(fileId);
        } catch (err) {
            console.warn(`[my-con-runs] remove failed for ${fileId}:`, err);
            return false;
        }
        this.popup.remove();
        notifyStravaRunRemoved(fileId);
        void this.reload().catch((err) => console.warn('[my-con-runs] reload failed', err));
        return true;
    }

    /** Reveal one run right after an import/tag completes: make its day group
     * visible, fit the map to just this run, and show its click-popup — the
     * "lands as a My DEF CON Runs layer entry" presentation from UAT round 3
     * fix B (the strip no longer lands the run as a second, editable file).
     * No-ops silently if `fileId` isn't in the just-reloaded manifest (e.g. the
     * reload failed or the server rejected the import). */
    revealConRun(fileId: string) {
        const group = getGroupsSnapshot().find((g) => g.runs.some((r) => r.fileId === fileId));
        if (!group) return;
        this.setDayVisible(group.conDay, true, false);
        this.fitToRoutes([fileId]);
        this.showRunPopup(fileId);
    }

    /** Detach listeners/popup and remove every current run's map layers+sources,
     * plus the derived caches (dayColor/routeBounds/cross-layer bridges). Shared
     * by `remove()` (full teardown) and `reload()` (teardown-then-rebuild,
     * which intentionally leaves `myConRunGroups` alone — see reload() above). */
    private teardownMapLayers() {
        try {
            for (const l of this.listeners) this.map.off(l.type, l.id, l.fn);
            this.listeners = [];
            this.popup.remove();
            for (const group of getGroupsSnapshot()) {
                for (const r of group.runs) {
                    for (const id of [coreLayerId(r.fileId), glowLayerId(r.fileId)]) {
                        if (this.map.getLayer(id)) this.map.removeLayer(id);
                    }
                    if (this.map.getSource(coreLayerId(r.fileId))) this.map.removeSource(coreLayerId(r.fileId));
                }
            }
        } catch {
            // map not ready
        }
        this.dayColor.clear();
        this.routeBounds.clear();
        conRunDayColors.clear();
        conRunMetaByFileId.clear();
    }

    remove() {
        this.teardownMapLayers();
        this.loaded = false;
        myConRunGroups.set([]);
    }
}

let _snapshot: MyConRunGroup[] = [];
myConRunGroups.subscribe((g) => (_snapshot = g));
function getGroupsSnapshot(): MyConRunGroup[] {
    return _snapshot;
}
