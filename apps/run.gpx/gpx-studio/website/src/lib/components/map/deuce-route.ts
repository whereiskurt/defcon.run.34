/**
 * The Deuce — deterministic Strip-bus simulator (pure module, no Mapbox).
 *
 * Route: the RTC Deuce's spine down South Las Vegas Boulevard, Fremont Street
 * Experience → Mandalay Bay (~9.3 km). Polyline extracted from OpenStreetMap
 * (Overpass, southbound carriageway of "South Las Vegas Boulevard", chained by
 * shared nodes and Douglas-Peucker-simplified to 2 m tolerance), so it hugs the
 * real roadway at any zoom.
 *
 * Simulation: bus positions are a pure function of wall-clock epoch time — no
 * server, no randomness — so every viewer sees the SAME buses in the same
 * places, "real-time-ish" like the actual 24/7 Deuce. A bus runs one way in
 * ONE_WAY_MIN minutes (the real Deuce crawls the Strip in about an hour) and
 * buses depart every HEADWAY_MIN minutes, giving a FLEET of 8 spread over the
 * out-and-back cycle (4-ish per direction). Same epoch-anchored determinism
 * trick as isWithinSchedule in rainbow-geometry.ts.
 */

/** One-way end-to-end run time, minutes (real Deuce: ~60–75 in traffic). */
export const ONE_WAY_MIN = 65;
/** Departure headway, minutes (real Deuce: 15–20). */
export const HEADWAY_MIN = 17;
/** Full out-and-back cycle, minutes. */
export const CYCLE_MIN = 2 * ONE_WAY_MIN;
/** Buses on the road — one per headway slot across the cycle. */
export const FLEET = Math.ceil(CYCLE_MIN / HEADWAY_MIN); // 8

/** [lng, lat] southbound along S Las Vegas Blvd, Fremont → Mandalay Bay. */
export const DEUCE_ROUTE: [number, number][] = [
    [-115.14074, 36.16927],
    [-115.15041, 36.15445],
    [-115.15061, 36.15422],
    [-115.15095, 36.15392],
    [-115.15113, 36.15368],
    [-115.15127, 36.15343],
    [-115.15144, 36.15293],
    [-115.15168, 36.15251],
    [-115.15571, 36.14643],
    [-115.15739, 36.14381],
    [-115.15882, 36.14176],
    [-115.15971, 36.1403],
    [-115.16387, 36.13391],
    [-115.16473, 36.13267],
    [-115.16566, 36.13117],
    [-115.16792, 36.12771],
    [-115.16938, 36.12556],
    [-115.17083, 36.1233],
    [-115.1716, 36.12222],
    [-115.17201, 36.12146],
    [-115.17252, 36.1201],
    [-115.17276, 36.11926],
    [-115.17294, 36.11815],
    [-115.17298, 36.11747],
    [-115.17298, 36.11477],
    [-115.17313, 36.11096],
    [-115.17318, 36.10767],
    [-115.17316, 36.1032],
    [-115.17308, 36.10214],
    [-115.1731, 36.09922],
    [-115.17303, 36.09185],
];

/** Named stops, pre-snapped onto DEUCE_ROUTE (nearest-point projection). */
export const DEUCE_STOPS: { name: string; lngLat: [number, number] }[] = [
    { name: 'Fremont Street Experience', lngLat: [-115.14074, 36.16927] },
    { name: 'The STRAT', lngLat: [-115.15517, 36.14724] },
    { name: 'SAHARA Las Vegas', lngLat: [-115.15812, 36.14276] },
    { name: 'Convention Center', lngLat: [-115.16318, 36.13498] },
    { name: 'Fashion Show / Wynn', lngLat: [-115.16891, 36.12626] },
    { name: 'The Venetian', lngLat: [-115.1718, 36.12184] },
    { name: 'Caesars / Flamingo', lngLat: [-115.17298, 36.1165] },
    { name: 'Bellagio', lngLat: [-115.17306, 36.11263] },
    { name: 'MGM Grand / Tropicana', lngLat: [-115.17309, 36.10225] },
    { name: 'Luxor', lngLat: [-115.17306, 36.0955] },
    { name: 'Mandalay Bay', lngLat: [-115.17303, 36.09185] },
];

const EARTH_R = 6371000;

function haversineM(a: [number, number], b: [number, number]): number {
    const t = Math.PI / 180;
    const dLat = (b[1] - a[1]) * t;
    const dLng = (b[0] - a[0]) * t;
    const s =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(a[1] * t) * Math.cos(b[1] * t) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

/** Cumulative meters at each route vertex: [0, …, total]. */
export function routeCumulativeM(route: [number, number][]): number[] {
    const cum: number[] = [0];
    for (let i = 1; i < route.length; i++) {
        cum.push(cum[i - 1] + haversineM(route[i - 1], route[i]));
    }
    return cum;
}

/**
 * Point at arc-length fraction f (0 = first vertex, 1 = last), linear lng/lat
 * interpolation within the containing segment. f is clamped to [0, 1].
 */
export function pointAtFraction(
    route: [number, number][],
    cum: number[],
    f: number
): [number, number] {
    if (route.length === 0) return [0, 0];
    if (route.length === 1) return route[0];
    const total = cum[cum.length - 1];
    const target = Math.min(1, Math.max(0, f)) * total;
    // Walk segments (31 vertices — linear scan is plenty fast at 1 Hz × 8 buses).
    for (let i = 1; i < cum.length; i++) {
        if (target <= cum[i] || i === cum.length - 1) {
            const segLen = cum[i] - cum[i - 1];
            const t = segLen === 0 ? 0 : (target - cum[i - 1]) / segLen;
            const a = route[i - 1];
            const b = route[i];
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        }
    }
    return route[route.length - 1];
}

export type BusState = {
    id: number;
    lngLat: [number, number];
    /** true = heading Fremont → Mandalay Bay (down the route array). */
    southbound: boolean;
};

const DEFAULT_CUM = routeCumulativeM(DEUCE_ROUTE);

/**
 * All bus positions at `nowMs` (epoch ms). Bus k is offset k·HEADWAY_MIN into
 * the shared out-and-back cycle: phase ∈ [0,1) runs southbound at fraction
 * `phase`, phase ∈ [1,2) runs northbound at `2 − phase`.
 */
export function busStates(
    nowMs: number,
    route: [number, number][] = DEUCE_ROUTE,
    cum: number[] = route === DEUCE_ROUTE ? DEFAULT_CUM : routeCumulativeM(route)
): BusState[] {
    if (route.length < 2) return [];
    const out: BusState[] = [];
    const nowMin = nowMs / 60000;
    for (let k = 0; k < FLEET; k++) {
        const cyclePos =
            (((nowMin + k * HEADWAY_MIN) % CYCLE_MIN) + CYCLE_MIN) % CYCLE_MIN;
        const phase = cyclePos / ONE_WAY_MIN;
        const southbound = phase < 1;
        const f = southbound ? phase : 2 - phase;
        out.push({ id: k, lngLat: pointAtFraction(route, cum, f), southbound });
    }
    return out;
}
