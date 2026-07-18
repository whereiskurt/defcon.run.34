/**
 * Pure geometry for the hidden "Rainbow Bridges" easter egg — no Mapbox / DOM
 * imports, so it can be reasoned about and sanity-checked standalone.
 *
 * Each rainbow is built as a set of short fill-extrusion "wall" quads along the
 * from→to line. Per colour band we lay a ribbon of quads offset sideways from
 * the centreline; each quad's height follows a sine profile (0 at both anchors,
 * peak in the middle). Flat/top-down that reads as a faint coloured footprint;
 * tilted, the walls rise into a rainbow arch. (Fill-extrusion can't overhang,
 * so the "arch" is the silhouette of the sine-height walls seen from the side —
 * which is exactly what the pitch-gated reveal shows off.)
 */

export type LngLat = [number, number];

export interface RainbowArch {
    id: string;
    from: LngLat; // [lng, lat]
    to: LngLat;
}

/**
 * The bridges. v1 ships one; add another rainbow by appending an entry.
 * Coordinates are approximate landmark centres and are safe to nudge — the
 * arch is decorative.
 */
export const RAINBOW_ARCHES: RainbowArch[] = [
    {
        // LVCC (DEF CON HQ / the con) ↔ ReBar (Arts District, 1225 S Main St).
        id: 'lvcc-rebar',
        from: [-115.1512, 36.1316], // Las Vegas Convention Center
        to: [-115.1553, 36.1555] // ReBar
    }
];

/** Six-stripe pride flag, outer→inner. */
export const PRIDE_COLORS = [
    '#E40303', // red
    '#FF8C00', // orange
    '#FFED00', // yellow
    '#008026', // green
    '#004DFF', // blue
    '#750787' // violet
];

export interface BuildOpts {
    segments?: number; // quads per band along the span (smoothness)
    colors?: string[]; // colour bands, outer→inner
    bandWidthM?: number; // width of each colour ribbon, metres
    peakRatio?: number; // arch peak height as a fraction of span
    thicknessM?: number; // vertical thickness of the floating ribbon, metres
}

const EARTH_M_PER_DEG_LAT = 111320;

function metresPerDegLng(lat: number): number {
    return EARTH_M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/** Great-circle-ish planar distance in metres (fine at city scale). */
export function spanMetres(a: LngLat, b: LngLat): number {
    const midLat = (a[1] + b[1]) / 2;
    const dx = (b[0] - a[0]) * metresPerDegLng(midLat);
    const dy = (b[1] - a[1]) * EARTH_M_PER_DEG_LAT;
    return Math.hypot(dx, dy);
}

/**
 * Build a GeoJSON FeatureCollection of coloured wall-quads for every arch.
 * Each feature carries `color` (fill-extrusion-color), `height`
 * (fill-extrusion-height, metres) and `archId`.
 */
export function buildRainbowFeatures(
    arches: RainbowArch[],
    opts: BuildOpts = {}
): GeoJSON.FeatureCollection {
    const segments = opts.segments ?? 160; // finer → smoother, less "stepped"
    const colors = opts.colors ?? PRIDE_COLORS;
    const bandWidthM = opts.bandWidthM ?? 22;
    const peakRatio = opts.peakRatio ?? 0.3;
    const thicknessM = opts.thicknessM ?? 60; // ribbon rides at altitude, not the ground

    const features: GeoJSON.Feature[] = [];

    for (const arch of arches) {
        const { from, to } = arch;
        const midLat = (from[1] + to[1]) / 2;
        const mPerLng = metresPerDegLng(midLat);
        const span = spanMetres(from, to);
        const peak = span * peakRatio;

        // Unit direction (metres space) and its left-hand perpendicular.
        const dxm = (to[0] - from[0]) * mPerLng;
        const dym = (to[1] - from[1]) * EARTH_M_PER_DEG_LAT;
        const len = Math.hypot(dxm, dym) || 1;
        const ux = dxm / len;
        const uy = dym / len;
        const px = -uy; // perpendicular
        const py = ux;

        // Convert an along-t position + lateral metre offset into [lng, lat].
        const point = (t: number, lateralM: number): LngLat => {
            const baseLng = from[0] + (to[0] - from[0]) * t;
            const baseLat = from[1] + (to[1] - from[1]) * t;
            const offX = px * lateralM; // metres east
            const offY = py * lateralM; // metres north
            return [baseLng + offX / mPerLng, baseLat + offY / EARTH_M_PER_DEG_LAT];
        };

        const nBands = colors.length;
        for (let k = 0; k < nBands; k++) {
            // Centre the ribbon stack on the path; band 0 (red) sits outermost.
            const centerLateral = (k - (nBands - 1) / 2) * bandWidthM;
            const left = centerLateral - bandWidthM / 2;
            const right = centerLateral + bandWidthM / 2;

            for (let i = 0; i < segments; i++) {
                const t0 = i / segments;
                const t1 = (i + 1) / segments;
                const tm = (t0 + t1) / 2;
                const height = Math.sin(Math.PI * tm) * peak;
                // Float a thin ribbon at the arch altitude instead of a solid
                // ground-to-curve wall — you see the map through the gap below it.
                const base = Math.max(0, height - thicknessM);

                const A = point(t0, left);
                const B = point(t0, right);
                const C = point(t1, right);
                const D = point(t1, left);

                features.push({
                    type: 'Feature',
                    geometry: { type: 'Polygon', coordinates: [[A, B, C, D, A]] },
                    properties: { color: colors[k], height, base, archId: arch.id }
                });
            }
        }
    }

    return { type: 'FeatureCollection', features };
}

/**
 * Pitch → layer opacity ramp. Invisible below `start`°, linearly up to `max`
 * by `end`°. This is what makes the egg "only visible when you tilt it".
 */
export function pitchOpacity(pitch: number, start = 15, end = 60, max = 0.55): number {
    const t = (pitch - start) / (end - start);
    return Math.max(0, Math.min(1, t)) * max;
}
