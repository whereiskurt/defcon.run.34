/**
 * Pure geometry for the giant PublicUs coffee cup — no Mapbox / DOM imports, so
 * it can be reasoned about and sanity-checked standalone.
 *
 * The cup is a set of fill-extrusion footprints (each a 2D polygon extruded
 * vertically from `base` to `height` metres), same tech as the rainbow arches:
 *   - body:   a translucent cylinder (disc extruded ground → H)
 *   - coffee: a smaller brown disc near the rim
 *   - handle: a curved thin wall on one side (a handle silhouette)
 *   - steam:  swaying columns above the rim — ONLY when unlocked
 * Flat/overhead it reads as a faint disc; tilted, it rises into a cartoon mug.
 */

export type LngLat = [number, number];

/** PublicUs coffee, 1126 Fremont St, Las Vegas (Fremont East). */
export const COFFEE_LOCATION: LngLat = [-115.1378, 36.1591];

/** Cartoon palette: cream ceramic body, brown coffee, white steam. */
export const CUP_COLORS = {
    body: '#F5F0E6',
    coffee: '#5C3A21',
    steam: '#FFFFFF'
};

/**
 * Uniform size multiplier for the whole cup (footprint + height). The native
 * geometry is ~35 m — invisible from above and impossible to spot when the map
 * is flat, so the cup read as "not there" next to the km-scale rainbow arches
 * (Kurt: "I see rainbows but no coffee"). ~3× makes it a genuine giant-mug
 * landmark you can find from a few blocks out while still tilt-revealed.
 */
export const CUP_SCALE = 3;

const EARTH_M_PER_DEG_LAT = 111320;

function metresPerDegLng(lat: number): number {
    return EARTH_M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/** Metre offset (east, north) from a centre → [lng, lat]. */
function offset(center: LngLat, dxM: number, dyM: number): LngLat {
    return [
        center[0] + dxM / metresPerDegLng(center[1]),
        center[1] + dyM / EARTH_M_PER_DEG_LAT
    ];
}

export interface BuildCupOpts {
    unlocked?: boolean; // add steam when true
    radiusM?: number; // cup body radius
    bodyHeightM?: number; // cup body height
    segments?: number; // disc smoothness
    scale?: number; // uniform size multiplier about the centre (default CUP_SCALE)
}

/**
 * Build the cup as a GeoJSON FeatureCollection. Each feature carries `color`
 * (fill-extrusion-color), `height` + `base` (metres) and `part`
 * (body|coffee|handle|steam).
 */
export function buildCupFeatures(opts: BuildCupOpts = {}): GeoJSON.FeatureCollection {
    const R = opts.radiusM ?? 35;
    const H = opts.bodyHeightM ?? 80;
    const seg = opts.segments ?? 40;
    const c = COFFEE_LOCATION;
    const features: GeoJSON.Feature[] = [];

    // Closed ring of `n` points at a given radius (metres) about the centre.
    const ring = (radius: number, n: number): LngLat[] => {
        const pts: LngLat[] = [];
        for (let i = 0; i <= n; i++) {
            const a = (2 * Math.PI * i) / n;
            pts.push(offset(c, Math.cos(a) * radius, Math.sin(a) * radius));
        }
        return pts;
    };

    // Body — translucent cylinder (disc extruded ground → H).
    features.push({
        type: 'Feature',
        properties: { part: 'body', color: CUP_COLORS.body, height: H, base: 0 },
        geometry: { type: 'Polygon', coordinates: [ring(R, seg)] }
    });

    // Coffee surface — thin brown disc set just below the rim.
    features.push({
        type: 'Feature',
        properties: { part: 'coffee', color: CUP_COLORS.coffee, height: H, base: H - 4 },
        geometry: { type: 'Polygon', coordinates: [ring(R * 0.86, seg)] }
    });

    // Handle — a curved thin wall (±60° arc on +x), extruded mid-height.
    const h0 = H * 0.25;
    const h1 = H * 0.75;
    const handleR = R + 14; // sticks out from the body
    const wallW = 8; // radial thickness
    const aStart = -Math.PI / 3;
    const aEnd = Math.PI / 3;
    const hSeg = 16;
    for (let i = 0; i < hSeg; i++) {
        const a0 = aStart + (aEnd - aStart) * (i / hSeg);
        const a1 = aStart + (aEnd - aStart) * ((i + 1) / hSeg);
        const p0i = offset(c, Math.cos(a0) * (handleR - wallW / 2), Math.sin(a0) * (handleR - wallW / 2));
        const p0o = offset(c, Math.cos(a0) * (handleR + wallW / 2), Math.sin(a0) * (handleR + wallW / 2));
        const p1o = offset(c, Math.cos(a1) * (handleR + wallW / 2), Math.sin(a1) * (handleR + wallW / 2));
        const p1i = offset(c, Math.cos(a1) * (handleR - wallW / 2), Math.sin(a1) * (handleR - wallW / 2));
        features.push({
            type: 'Feature',
            properties: { part: 'handle', color: CUP_COLORS.body, height: h1, base: h0 },
            geometry: { type: 'Polygon', coordinates: [[p0i, p0o, p1o, p1i, p0i]] }
        });
    }

    // Steam — 3 swaying translucent columns above the rim, unlocked only.
    if (opts.unlocked) {
        const steamBase = H;
        const steamTop = H + 70;
        const steamSeg = 18;
        const colW = 6; // footprint square side, metres
        const cols = [
            { x: -12, phase: 0 },
            { x: 0, phase: 1.5 },
            { x: 12, phase: 3.0 }
        ];
        for (const col of cols) {
            for (let i = 0; i < steamSeg; i++) {
                const t0 = i / steamSeg;
                const t1 = (i + 1) / steamSeg;
                const tm = (t0 + t1) / 2;
                const z0 = steamBase + (steamTop - steamBase) * t0;
                const z1 = steamBase + (steamTop - steamBase) * t1;
                const xm = col.x + Math.sin(tm * Math.PI * 2 + col.phase) * 10; // sway
                const A = offset(c, xm - colW / 2, -colW / 2);
                const B = offset(c, xm + colW / 2, -colW / 2);
                const D = offset(c, xm + colW / 2, colW / 2);
                const E = offset(c, xm - colW / 2, colW / 2);
                features.push({
                    type: 'Feature',
                    properties: { part: 'steam', color: CUP_COLORS.steam, height: z1, base: z0 },
                    geometry: { type: 'Polygon', coordinates: [[A, B, D, E, A]] }
                });
            }
        }
    }

    // Blow the whole cup up about its centre so it reads as a giant landmark
    // even flat/zoomed-out (native ~35 m was invisible from above). Uniform:
    // scale the footprint (about `c`) AND the vertical extents together so the
    // carefully-tuned proportions (handle, coffee inset, steam) are preserved.
    const scale = opts.scale ?? CUP_SCALE;
    if (scale !== 1) {
        for (const f of features) {
            const poly = f.geometry as GeoJSON.Polygon;
            for (const ring of poly.coordinates) {
                for (const p of ring) {
                    p[0] = c[0] + (p[0] - c[0]) * scale;
                    p[1] = c[1] + (p[1] - c[1]) * scale;
                }
            }
            const pr = f.properties as { height?: number; base?: number };
            if (typeof pr.height === 'number') pr.height *= scale;
            if (typeof pr.base === 'number') pr.base *= scale;
        }
    }

    return { type: 'FeatureCollection', features };
}

/**
 * Pitch → layer opacity ramp. The cup is ALWAYS on and meant to read as a
 * landmark at PublicUs, so it stays clearly visible even flat/overhead (`floor`)
 * and blooms toward solid as you tilt (`max`). Unlocking (searching publicus /
 * coffee) lifts BOTH the floor and the ceiling — once you've found it, it shows
 * plainly even without tilting. (Earlier 0.1 floor / 0.4 ceiling was so faint the
 * cup was effectively invisible flat — Kurt "don't see it at all".)
 */
export function cupOpacity(pitch: number, unlocked: boolean, start = 0, end = 60): number {
    const t = Math.max(0, Math.min(1, (pitch - start) / (end - start)));
    const floor = unlocked ? 0.5 : 0.35; // visible overhead; clearer once found
    const max = unlocked ? 0.85 : 0.7; // near-solid when tilted
    return floor + t * (max - floor);
}
