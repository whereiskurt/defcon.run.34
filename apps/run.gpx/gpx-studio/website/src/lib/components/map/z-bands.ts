import type mapboxgl from 'mapbox-gl';

/**
 * Explicit paint order for every DEF CON map layer.
 *
 * WHY THIS EXISTS — of ~30 `addLayer()` calls in this tree, exactly two passed a
 * `beforeId`. Every other layer was appended, landing on top of the stack at the moment
 * it was created, and each family (public overlays, con runs, community routes,
 * check-ins, ghosts, rabbits) adds its layers when ITS OWN fetch resolves. Stacking was
 * therefore a race, not a design: on a slow link the route lines landed last and buried
 * the very markers you are meant to click. Kurt reported it from a live screenshot
 * (2026-08-02) — cluster badges and ghost pins under the route lines.
 *
 * HOW — five zero-feature anchor layers are installed SYNCHRONOUSLY at style load, before
 * any feed resolves. Each anchor is the CEILING of its band, so inserting "before" an
 * anchor puts you inside that band. Arrival order stops mattering entirely.
 *
 * WHY REAL LAYERS AND NOT A LOOKUP TABLE — a band-classifier keyed on layer id would have
 * to be kept in sync with every new id (and ids here are per-file and dynamic:
 * `public-map-<fileId>`, `community-route-<routeId>`). Anchors cost nothing (no features,
 * `visibility: none`), need no table, and make the intended order visible in the style
 * when you are debugging a stack that looks wrong.
 *
 * A CENTRAL `restack()` SWEEP was the other candidate and is worse: it only repairs the
 * stack when something remembers to call it, so a feed that resolves after the last sweep
 * floats on top until the next one — the same flash this module exists to remove.
 */
export const BANDS = ['heat', 'routes', 'tracks', 'markers', 'tools'] as const;
export type Band = (typeof BANDS)[number];

const SOURCE = 'dc34-z-anchors';

const ANCHOR: Record<Band, string> = {
    heat: 'dc34-z-heat',
    routes: 'dc34-z-routes',
    tracks: 'dc34-z-tracks',
    markers: 'dc34-z-markers',
    tools: 'dc34-z-tools',
};

/** The layer id that marks the top of `band`. Pure — safe to assert on in tests. */
export function bandAnchor(band: Band): string {
    return ANCHOR[band];
}

/**
 * Idempotent. Call once at style load; every helper below also calls it defensively, so a
 * basemap swap that ever wiped root layers self-heals.
 *
 * ORDER MATTERS ON FIRST INSTALL: anchors appended to a stack that already holds content
 * would sit ABOVE that content, dropping all of it into the bottom band. That is why
 * `map.ts` installs at style load, before `LayerControl` constructs any layer class.
 */
export function installBands(map: mapboxgl.Map): void {
    if (!map.getSource(SOURCE)) {
        map.addSource(SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
        });
    }
    for (const band of BANDS) {
        const id = ANCHOR[band];
        if (!map.getLayer(id)) {
            map.addLayer({ id, type: 'line', source: SOURCE, layout: { visibility: 'none' } });
        }
    }
}

/**
 * `beneath` preserves a relative rule that already exists INSIDE a band — DC33 heat under
 * DC34's, direction arrows under distance markers. It is ignored when that layer is not on
 * the map yet, which is the common case on a cold load.
 */
export function addInBand(
    map: mapboxgl.Map,
    spec: Parameters<mapboxgl.Map['addLayer']>[0],
    band: Band,
    beneath?: string
): void {
    installBands(map);
    const before = beneath && map.getLayer(beneath) ? beneath : ANCHOR[band];
    map.addLayer(spec, before);
}

/**
 * Replaces bare `moveLayer(id)`, which moves a layer to the ABSOLUTE top of the stack.
 * Four call sites did that — most damagingly `GPXLayer.moveToFront()`, which fires on
 * every track selection and would otherwise undo this module's whole purpose on the first
 * click a runner makes.
 */
export function moveToBand(map: mapboxgl.Map, id: string, band: Band): void {
    if (!map.getLayer(id)) return;
    installBands(map);
    map.moveLayer(id, ANCHOR[band]);
}
