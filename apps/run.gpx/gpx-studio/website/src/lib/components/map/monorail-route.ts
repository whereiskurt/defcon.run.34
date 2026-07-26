/**
 * Las Vegas Monorail — deterministic train simulator (pure module, no Mapbox).
 *
 * Track: the elevated guideway behind the east-Strip casinos, SAHARA →
 * MGM Grand (~5.8 km). Extracted from OpenStreetMap (Overpass
 * railway=monorail, Dijkstra over the way graph between the station termini —
 * skips the maintenance-yard spurs — Douglas-Peucker 2 m). Stations snapped
 * onto the guideway by perpendicular projection.
 *
 * Simulation: same epoch-anchored out-and-back model as the Deuce
 * (deuce-route.ts vehicleStates): ~15 min end-to-end, ~6 min headways → 5
 * trains. Unlike the 24/7 Deuce, the monorail sleeps: outside service hours
 * (07:00–01:00 America/Los_Angeles) monorailStates returns [] and the trains
 * vanish while the guideway and stations stay put.
 */
import { routeCumulativeM, vehicleStates, type BusState } from './deuce-route';

/** One-way SAHARA → MGM run time, minutes (real monorail: ~13–15). */
export const MONO_ONE_WAY_MIN = 15;
/** Departure headway, minutes (real monorail: 4–8). */
export const MONO_HEADWAY_MIN = 6;
/** Trains on the guideway. */
export const MONO_FLEET = Math.ceil((2 * MONO_ONE_WAY_MIN) / MONO_HEADWAY_MIN); // 5

/** [lng, lat] along the guideway, SAHARA (N) → MGM Grand (S). */
export const MONORAIL_ROUTE: [number, number][] = [
    [-115.15464, 36.14238],
    [-115.15465, 36.14031],
    [-115.15453, 36.13967],
    [-115.15452, 36.1391],
    [-115.15443, 36.13875],
    [-115.15433, 36.13856],
    [-115.15415, 36.13834],
    [-115.15366, 36.13793],
    [-115.15352, 36.13777],
    [-115.15281, 36.1368],
    [-115.15267, 36.13657],
    [-115.15261, 36.13633],
    [-115.15278, 36.1358],
    [-115.1529, 36.13563],
    [-115.15308, 36.13549],
    [-115.15405, 36.13495],
    [-115.15427, 36.1348],
    [-115.15447, 36.13454],
    [-115.15454, 36.13432],
    [-115.15466, 36.13072],
    [-115.15464, 36.13047],
    [-115.15453, 36.12993],
    [-115.15454, 36.12876],
    [-115.15459, 36.12843],
    [-115.15484, 36.12795],
    [-115.15492, 36.12762],
    [-115.15497, 36.12514],
    [-115.15495, 36.12274],
    [-115.15499, 36.12248],
    [-115.15505, 36.12237],
    [-115.1552, 36.12222],
    [-115.15533, 36.12215],
    [-115.15564, 36.12209],
    [-115.15947, 36.1223],
    [-115.1635, 36.12238],
    [-115.16373, 36.12235],
    [-115.16385, 36.12231],
    [-115.16401, 36.1222],
    [-115.16411, 36.12206],
    [-115.16415, 36.12195],
    [-115.16414, 36.12105],
    [-115.16404, 36.12037],
    [-115.16412, 36.12013],
    [-115.16426, 36.12002],
    [-115.16442, 36.11996],
    [-115.1646, 36.11995],
    [-115.16794, 36.11998],
    [-115.16816, 36.11992],
    [-115.16832, 36.11983],
    [-115.16846, 36.1197],
    [-115.16856, 36.11952],
    [-115.1686, 36.11931],
    [-115.16856, 36.11705],
    [-115.16865, 36.11664],
    [-115.16861, 36.1149],
    [-115.16854, 36.11472],
    [-115.16838, 36.11456],
    [-115.16818, 36.11447],
    [-115.16769, 36.11436],
    [-115.16753, 36.11427],
    [-115.16737, 36.11411],
    [-115.16731, 36.11387],
    [-115.16734, 36.11316],
    [-115.16749, 36.11284],
    [-115.16752, 36.1127],
    [-115.16749, 36.1057],
    [-115.16743, 36.10512],
    [-115.1672, 36.10429],
    [-115.16716, 36.10402],
    [-115.16727, 36.10366],
    [-115.16742, 36.10346],
    [-115.16771, 36.10316],
    [-115.16782, 36.10299],
    [-115.16787, 36.10279],
    [-115.16787, 36.10252],
];

/** Stations, pre-snapped onto MONORAIL_ROUTE. */
export const MONORAIL_STATIONS: { name: string; lngLat: [number, number] }[] = [
    { name: 'SAHARA Las Vegas', lngLat: [-115.15464, 36.14238] },
    { name: 'Westgate', lngLat: [-115.15302, 36.13709] },
    { name: 'Convention Center', lngLat: [-115.15464, 36.13117] },
    { name: "Harrah's/The LINQ", lngLat: [-115.16859, 36.11888] },
    { name: 'Caesars Palace/Flamingo', lngLat: [-115.16864, 36.11604] },
    { name: 'Horseshoe/Paris', lngLat: [-115.16752, 36.11233] },
    { name: 'MGM Grand', lngLat: [-115.16787, 36.10261] },
];

const MONO_CUM = routeCumulativeM(MONORAIL_ROUTE);

/** Vegas local hour (0–23) at nowMs — tz-correct like isWithinSchedule. */
export function vegasHour(nowMs: number): number {
    return Number(
        new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Los_Angeles',
            hour: 'numeric',
            hour12: false,
        }).format(new Date(nowMs))
    ) % 24;
}

/** Service window: 07:00–01:00 Vegas time (approximates the real schedule). */
export function isMonorailRunning(nowMs: number): boolean {
    const h = vegasHour(nowMs);
    return h >= 7 || h < 1;
}

/** All train positions at nowMs — [] outside service hours. */
export function monorailStates(nowMs: number): BusState[] {
    if (!isMonorailRunning(nowMs)) return [];
    return vehicleStates(nowMs, MONORAIL_ROUTE, MONO_CUM, {
        oneWayMin: MONO_ONE_WAY_MIN,
        headwayMin: MONO_HEADWAY_MIN,
        fleet: MONO_FLEET,
    });
}
