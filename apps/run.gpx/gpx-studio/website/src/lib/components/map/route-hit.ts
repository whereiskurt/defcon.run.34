import type mapboxgl from 'mapbox-gl';

/**
 * Route click/tap hit-testing.
 *
 * WHY THIS EXISTS: every route family (public overlays, my con runs, community
 * routes) bound its click handler straight to the crisp `core` line layer. That
 * line is 3px wide at z12 and 8px at z16 (see route-style.ts), so the clickable
 * target was 3-8px — against the 44px minimum touch target in Apple's HIG. On a
 * phone, where mapbox hit-tests the single synthesized touch point rather than
 * the ~40px finger contact patch, opening a route popup worked roughly one try
 * in ten (Kurt 2026-08-04). The wide blurred `glow` layer that makes a route
 * LOOK tappable carries no handlers at all, so it never helped.
 *
 * The fix is a radius search rather than a wider invisible layer: DEF CON routes
 * run parallel along the Strip, and overlapping invisible hit layers would both
 * match, leaving whichever was added last to win arbitrarily. Here every route
 * within the radius is a candidate and the CLOSEST one wins, so the route you
 * aimed at is the route you get.
 */

/** Half of Apple's 44px minimum touch target. */
export const HIT_RADIUS_TOUCH = 22;
/** A mouse is precise; still far more generous than the 3-8px line itself. */
export const HIT_RADIUS_MOUSE = 12;

export interface Pt {
    x: number;
    y: number;
}

/** A route reduced to its on-screen polylines, in pixel space. */
export interface HitCandidate {
    layerId: string;
    /** One entry per line part — a MultiLineString contributes several. */
    parts: Pt[][];
}

/** Search radius in pixels. Coarse pointers (touch) get the full HIG target. */
export function hitRadiusPx(coarsePointer: boolean): number {
    return coarsePointer ? HIT_RADIUS_TOUCH : HIT_RADIUS_MOUSE;
}

/** Squared distance from `p` to segment `a`-`b`. Squared to avoid a sqrt per segment. */
export function distSqToSegment(p: Pt, a: Pt, b: Pt): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    // Degenerate segment (a === b) — fall through to point distance.
    let t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    const ex = p.x - cx;
    const ey = p.y - cy;
    return ex * ex + ey * ey;
}

/** Squared distance from `p` to the nearest point on a candidate's polylines. */
export function distSqToCandidate(p: Pt, c: HitCandidate): number {
    let best = Infinity;
    for (const part of c.parts) {
        if (part.length === 1) {
            const ex = p.x - part[0].x;
            const ey = p.y - part[0].y;
            best = Math.min(best, ex * ex + ey * ey);
            continue;
        }
        for (let i = 1; i < part.length; i++) {
            const d = distSqToSegment(p, part[i - 1], part[i]);
            if (d < best) best = d;
        }
    }
    return best;
}

/**
 * The layer id of the candidate closest to `p`, or null when nothing is within
 * `radius`. Ties resolve to the first candidate, so caller order is the
 * tie-breaker (mapbox returns topmost-first).
 */
export function nearestCandidate(p: Pt, candidates: HitCandidate[], radius: number): string | null {
    const maxSq = radius * radius;
    let bestId: string | null = null;
    let bestSq = Infinity;
    for (const c of candidates) {
        const d = distSqToCandidate(p, c);
        if (d <= maxSq && d < bestSq) {
            bestSq = d;
            bestId = c.layerId;
        }
    }
    return bestId;
}

/** True when the primary pointer is coarse (touch). Safe on SSR / old browsers. */
export function hasCoarsePointer(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    try {
        return window.matchMedia('(pointer: coarse)').matches;
    } catch {
        return false;
    }
}

type RouteClickHandler = (e: mapboxgl.MapMouseEvent) => void;

/**
 * Routes a map click to the nearest registered route layer within the hit radius.
 *
 * One map-level `click` listener replaces the per-layer ones. Modules register
 * the SAME handler closure they used to bind directly, so popup content and
 * wiring are unchanged — only the hit test moved.
 */
export class RouteHitRouter {
    private handlers = new Map<string, RouteClickHandler>();
    private clickFn: ((e: mapboxgl.MapMouseEvent) => void) | null = null;

    /**
     * @param priorityLayers Layers that outrank routes at the exact click point
     * (POI pins, check-in pins/clusters). Without this, tapping a pin sitting on
     * a route would fire both handlers and the route popup would clobber the
     * pin's. Evaluated lazily — the set changes as layers are added.
     */
    constructor(
        private map: mapboxgl.Map,
        private priorityLayers: () => string[] = () => []
    ) {}

    register(layerId: string, handler: RouteClickHandler) {
        this.handlers.set(layerId, handler);
        this.install();
    }

    unregister(layerId: string) {
        this.handlers.delete(layerId);
    }

    private install() {
        if (this.clickFn) return;
        this.clickFn = (e) => this.onClick(e);
        this.map.on('click', this.clickFn);
    }

    /** Registered layers that currently exist in the style and are visible. */
    private liveLayers(): string[] {
        const ids: string[] = [];
        for (const id of this.handlers.keys()) {
            if (!this.map.getLayer(id)) continue;
            // Undefined means the layout property was never set — mapbox's default is visible.
            if (this.map.getLayoutProperty(id, 'visibility') === 'none') continue;
            ids.push(id);
        }
        return ids;
    }

    private onClick(e: mapboxgl.MapMouseEvent) {
        const layers = this.liveLayers();
        if (layers.length === 0) return;

        // A pin directly under the pointer wins outright — its own handler runs.
        const priority = this.priorityLayers().filter((id) => this.map.getLayer(id));
        if (priority.length > 0) {
            try {
                if (this.map.queryRenderedFeatures(e.point, { layers: priority }).length > 0) {
                    return;
                }
            } catch {
                // a layer vanished mid-click — fall through to the route test
            }
        }

        const radius = hitRadiusPx(hasCoarsePointer());
        const box: [mapboxgl.PointLike, mapboxgl.PointLike] = [
            [e.point.x - radius, e.point.y - radius],
            [e.point.x + radius, e.point.y + radius],
        ];
        let features: mapboxgl.MapboxGeoJSONFeature[];
        try {
            features = this.map.queryRenderedFeatures(box, { layers });
        } catch {
            return;
        }
        if (features.length === 0) return;

        // Project to pixel space so "nearest" means nearest ON SCREEN — the same
        // space the radius is expressed in. Degrees would weight latitude wrongly.
        //
        // A layer can yield SEVERAL features (a route clipped across tile
        // boundaries, or a MultiLineString). They must be merged, not deduped:
        // keeping only the first feature would measure the distance to part of a
        // route and could hand the click to a route that is actually further away.
        // Map insertion order preserves mapbox's topmost-first ordering, which is
        // what breaks exact ties in nearestCandidate.
        const byLayer = new Map<string, Pt[][]>();
        for (const f of features) {
            const layerId = f.layer?.id;
            if (!layerId) continue;
            const parts = this.pixelParts(f);
            if (parts.length === 0) continue;
            const acc = byLayer.get(layerId);
            if (acc) acc.push(...parts);
            else byLayer.set(layerId, parts);
        }
        const candidates: HitCandidate[] = [...byLayer].map(([layerId, parts]) => ({
            layerId,
            parts,
        }));

        const winner = nearestCandidate(e.point, candidates, radius);
        if (!winner) return;
        this.handlers.get(winner)?.(e);
    }

    /** A feature's line geometry as pixel-space polylines. */
    private pixelParts(f: mapboxgl.MapboxGeoJSONFeature): Pt[][] {
        const g = f.geometry;
        const toPx = (c: number[]) => this.map.project([c[0], c[1]] as [number, number]);
        if (g.type === 'LineString') return [g.coordinates.map(toPx)];
        if (g.type === 'MultiLineString') return g.coordinates.map((line) => line.map(toPx));
        return [];
    }

    destroy() {
        if (this.clickFn) {
            this.map.off('click', this.clickFn);
            this.clickFn = null;
        }
        this.handlers.clear();
    }
}
