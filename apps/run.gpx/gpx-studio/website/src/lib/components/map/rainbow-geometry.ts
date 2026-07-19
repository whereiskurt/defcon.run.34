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

/**
 * Optional visibility window for an arch. Days are `Date.getDay()` numbers
 * (0=Sun … 6=Sat) evaluated *in `tz`*, and the window is `[startHour, endHour)`
 * on the hour, also in `tz`. Fixing the timezone means every viewer sees the
 * arch appear at the same absolute moment regardless of their own locale.
 */
export interface ArchSchedule {
    days: number[]; // getDay() values, in tz
    startHour: number; // inclusive, 0–23
    endHour: number; // exclusive, 0–24
    tz: string; // IANA zone, e.g. 'America/Los_Angeles'
}

export interface RainbowArch {
    id: string;
    from: LngLat; // [lng, lat]
    to: LngLat;
    colors?: string[]; // per-arch palette, outer→inner; defaults to PRIDE_COLORS
    requiresUnlock?: boolean; // default true — the doubly-hidden egg arches
    schedule?: ArchSchedule; // optional public window (see isArchActiveNow)
}

/** Six-stripe pride flag, outer→inner. */
export const PRIDE_COLORS = [
    '#E40303', // red
    '#FF8C00', // orange
    '#FFED00', // yellow
    '#008026', // green
    '#004DFF', // blue
    '#750787' // violet
];

/** Six-band "weed" green gradient, dark→light (outer→inner). */
export const WEED_COLORS = [
    '#0A2E0A', // deep forest
    '#14591A',
    '#1E7D22',
    '#3AA53A',
    '#66C266',
    '#A6E5A6' // pale bud
];

/**
 * The bridges. Add another rainbow by appending an entry — per-arch `colors`,
 * `requiresUnlock`, and `schedule` are all optional. Coordinates are approximate
 * landmark centres and are safe to nudge — the arches are decorative.
 */
export const RAINBOW_ARCHES: RainbowArch[] = [
    {
        // LVCC (DEF CON HQ / the con) ↔ ReBar (Arts District, 1225 S Main St).
        id: 'lvcc-rebar',
        from: [-115.1512, 36.1316], // Las Vegas Convention Center
        to: [-115.1553, 36.1555] // ReBar
    },
    {
        // Green "weed" arch → NuWu Cannabis Marketplace drive-thru (Paiute land).
        // Unlock-gated, revealed together with the pride arch.
        id: 'lvcc-nuwu',
        from: [-115.1512, 36.1316], // Las Vegas Convention Center
        to: [-115.1398, 36.1836], // NuWu Cannabis Marketplace
        colors: WEED_COLORS
    },
    {
        // Timed pride arch → "Welcome to Fabulous Las Vegas" sign. Publicly
        // visible only Thu–Sun 06:00–08:00 Vegas time, and any time once unlocked.
        id: 'lvcc-lvsign',
        from: [-115.1512, 36.1316], // Las Vegas Convention Center
        to: [-115.1728, 36.0821], // Welcome to Las Vegas sign
        requiresUnlock: false,
        schedule: { days: [4, 5, 6, 0], startHour: 6, endHour: 8, tz: 'America/Los_Angeles' }
    }
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
    const bandWidthM = opts.bandWidthM ?? 22;
    const peakRatio = opts.peakRatio ?? 0.3;
    const thicknessM = opts.thicknessM ?? 60; // ribbon rides at altitude, not the ground

    const features: GeoJSON.Feature[] = [];

    for (const arch of arches) {
        const { from, to } = arch;
        const colors = arch.colors ?? opts.colors ?? PRIDE_COLORS;
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
 * Pitch → layer opacity ramp (applied only while unlocked; locked = hidden).
 * Once unlocked it shows a faint `floor` immediately — even flat/overhead — as a
 * "you found it" hint, then blooms up to `max` as you tilt toward `end`°.
 */
export function pitchOpacity(
    pitch: number,
    start = 0,
    end = 60,
    max = 0.55,
    floor = 0.12
): number {
    const t = Math.max(0, Math.min(1, (pitch - start) / (end - start)));
    return floor + t * (max - floor);
}

/**
 * Is `now` inside the schedule's window, evaluated in the schedule's timezone?
 * Pure given `now` — reads the weekday + hour *in `schedule.tz`* via Intl so the
 * answer is the same for every viewer regardless of their own locale. Window is
 * `[startHour, endHour)` on the matched days.
 */
export function isWithinSchedule(schedule: ArchSchedule, now: Date): boolean {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: schedule.tz,
        weekday: 'short',
        hour: 'numeric',
        hour12: false
    }).formatToParts(now);

    const wk = parts.find((p) => p.type === 'weekday')?.value ?? '';
    const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
    // Intl can emit '24' for midnight in hour12:false; fold it back to 0.
    const hour = parseInt(hourStr, 10) % 24;

    const dayMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6
    };
    const day = dayMap[wk];
    if (day === undefined || !schedule.days.includes(day)) return false;
    return hour >= schedule.startHour && hour < schedule.endHour;
}

/**
 * Should this arch render right now? Unlock is a master reveal — it shows every
 * arch regardless of clock. When locked, an arch falls back to its public rule:
 * unlock-gated arches (the default) stay hidden; scheduled arches show only
 * inside their window; a public arch with no schedule is always visible.
 */
export function isArchActiveNow(
    arch: RainbowArch,
    { unlocked, now }: { unlocked: boolean; now: Date }
): boolean {
    if (unlocked) return true;
    if (arch.requiresUnlock ?? true) return false;
    if (arch.schedule) return isWithinSchedule(arch.schedule, now);
    return true;
}
