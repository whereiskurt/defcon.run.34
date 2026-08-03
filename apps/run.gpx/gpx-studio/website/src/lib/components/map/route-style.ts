/**
 * One source of truth for the DEF CON neon route look — a blurred glow halo under a
 * crisp core line.
 *
 * These constants previously lived in four files (`public-overlays.ts`, `my-con-runs.ts`,
 * `community-routes.ts`, `deuce-layer.ts`) with identical values and nothing linking them,
 * so a tuning pass had to be applied four times and could silently drift.
 *
 * WIDTH FOLLOWS ZOOM. The old core was a flat `(mapWeight ?? 4) * 2.5` = 10px, which reads
 * as a fat pipe at street zoom and as clutter with the whole Strip on screen. Kurt picked
 * the interpolated option from the 2026-08-02 styling review: thin when zoomed out,
 * full-bodied close in. At z14.55 — the zoom the original bug report was screenshotted at
 * — the core goes 10px -> ~6.1px.
 *
 * NOT USED BY `gpx-layer.ts`, deliberately. That draws the track you are actively editing,
 * straight from feature properties (`['get','width']`), and stays crisp so dragging points
 * is unaffected. It is also the vendor-forked upstream file.
 */

/** A mapbox `interpolate` expression over zoom. Typed loosely — mapbox validates it. */
type ZoomExpr = ['interpolate', ['linear'], ['zoom'], number, number, number, number];

/** Nominal CMS `mapWeight`. A route without a curated weight is treated as this. */
export const NOMINAL_WEIGHT = 4;

const ZOOM_LO = 12;
const ZOOM_HI = 16;
const CORE_AT_LO = 3;
const CORE_AT_HI = 8;

/** How much wider the blurred halo is than the core, at every zoom. */
const GLOW_RATIO = 3.6;

export const ROUTE_BLUR = 10;
export const CORE_OPACITY = 0.8;
export const GLOW_OPACITY = 0.42;

/**
 * Plain linear interpolation mirroring what mapbox does with `coreWidth()`. Exists so the
 * width curve can be asserted on directly in tests rather than by reading expression
 * internals — and so the two can be proven to agree.
 */
export function coreWidthAt(zoom: number, weight: number = NOMINAL_WEIGHT): number {
    const scale = weight / NOMINAL_WEIGHT;
    const t = Math.min(1, Math.max(0, (zoom - ZOOM_LO) / (ZOOM_HI - ZOOM_LO)));
    return (CORE_AT_LO + (CORE_AT_HI - CORE_AT_LO) * t) * scale;
}

function ramp(lo: number, hi: number): ZoomExpr {
    return ['interpolate', ['linear'], ['zoom'], ZOOM_LO, lo, ZOOM_HI, hi];
}

/** `line-width` for the crisp core line. `weight` is the CMS `mapWeight` when curated. */
export function coreWidth(weight: number = NOMINAL_WEIGHT): ZoomExpr {
    const s = weight / NOMINAL_WEIGHT;
    return ramp(CORE_AT_LO * s, CORE_AT_HI * s);
}

/** `line-width` for the blurred halo beneath the core. */
export function glowWidth(weight: number = NOMINAL_WEIGHT): ZoomExpr {
    const s = (weight / NOMINAL_WEIGHT) * GLOW_RATIO;
    return ramp(CORE_AT_LO * s, CORE_AT_HI * s);
}
