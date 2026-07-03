/**
 * DEF CON 34 map-styling palette (v1.8 overlay decoration).
 *
 * The studio is a separate Vite/SvelteKit build and cannot import the Next.js
 * apps' Tailwind/HeroUI theme, so the brand values are mirrored here. The primary
 * is the teal `#00d4aa` used across run.human / run.auth; magenta + cyan are the
 * values the public overlays already shipped with.
 */

export const DC34 = {
    teal: '#00d4aa',
    magenta: '#e6007a',
    cyan: '#00e5ff',
    amber: '#f59e0b',
    green: '#22c55e',
    violet: '#9933ff',
    orange: '#ff9900',
    aqua: '#50f0be',
    pink: '#ff6ebe',
} as const;

/**
 * Varied ramp cycled per route so adjacent public routes are easy to tell apart.
 * A CMS-provided `mapColor` (when present) overrides this — see public-overlays.
 */
export const DC34_ROUTE_RAMP: readonly string[] = [
    DC34.magenta,
    DC34.cyan,
    DC34.teal,
    DC34.amber,
    DC34.violet,
    DC34.green,
    DC34.orange,
    DC34.aqua,
    DC34.pink,
];

/** Deterministic per-route color from the varied ramp. */
export function routeColor(index: number): string {
    return DC34_ROUTE_RAMP[((index % DC34_ROUTE_RAMP.length) + DC34_ROUTE_RAMP.length) % DC34_ROUTE_RAMP.length];
}
