/**
 * Semantic check-in clustering for the map. PURE — no map, no DOM, no network.
 *
 * A LOCAL PORT of run.human's `src/lib/cluster-detect.ts`. run.gpx cannot
 * import across apps, so this mirrors the algorithm the way `con-days.ts` is
 * already mirrored between the two services. The geometry knobs are NOT copied
 * — they ride along on the `/api/checkins/public` response, so retuning the
 * radius in /admin/clusters moves the map too.
 *
 * ── How this differs from the scoring detector, deliberately ────────────────
 *  1. NO con-day gate. Scoring only counts con days; the map should show what
 *     is happening whenever it happens (a pre-con social still clusters).
 *  2. NO tier/points. The map sees PUBLIC check-ins only, so its cluster of 12
 *     may be a scoring cluster of 31 — attaching an award value to that number
 *     would be wrong. The map reports presence, never points.
 *  3. Returns ORPHANS as well as clusters. The layer renders clusters plus the
 *     check-ins that did not cluster, and nothing twice.
 *  4. Absorbs a runner's REPEAT check-ins into their cluster, so a second
 *     check-in at the same spot does not surface as a stray pin on top of it.
 *
 * Identity is `rid`, the opaque per-runner grouping key from the feed — NOT
 * `displayName`, because every runner without a custom name shares the literal
 * "a rabbit" and would otherwise collapse into a single person.
 */

export type CheckinPoint = {
    /** Stable unique key for this check-in within the loaded set. */
    id: string;
    /** Opaque per-runner grouping key (`rid` from the feed). */
    rid: string;
    lat: number;
    lng: number;
    /** Check-in time, epoch ms. */
    t: number;
};

export type CheckinCluster = {
    id: string;
    lat: number;
    lng: number;
    startAt: number;
    endAt: number;
    /** Distinct RUNNERS, not check-ins. */
    size: number;
    /** Ids of every check-in absorbed (includes a runner's repeats). */
    memberIds: string[];
};

export type MapClusterConfig = {
    radiusMeters: number;
    windowMinutes: number;
    minRunners: number;
};

export const DEFAULT_MAP_CLUSTER_CONFIG: MapClusterConfig = {
    radiusMeters: 200,
    windowMinutes: 60,
    minRunners: 4,
};

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(
    aLat: number,
    aLng: number,
    bLat: number,
    bLng: number
): number {
    const toRad = Math.PI / 180;
    const dLat = (bLat - aLat) * toRad;
    const dLng = (bLng - aLng) * toRad;
    const lat1 = aLat * toRad;
    const lat2 = bLat * toRad;
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** FNV-1a — stable, dependency-free id hash. Not security-relevant. */
function fnv1a(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

function centroidOf(points: { lat: number; lng: number }[]): { lat: number; lng: number } {
    let lat = 0;
    let lng = 0;
    for (const p of points) {
        lat += p.lat;
        lng += p.lng;
    }
    return { lat: lat / points.length, lng: lng / points.length };
}

function distinctRunners(points: CheckinPoint[]): number {
    const s = new Set<string>();
    for (const p of points) s.add(p.rid);
    return s.size;
}

/**
 * Group check-ins into place-and-time clusters, returning the clusters plus
 * every check-in that did not join one.
 *
 * Mirrors the scoring detector: forward time-window seeds → radius filter →
 * one centroid refinement pass → distinct-runner threshold → greedy claim,
 * where a runner already in an accepted cluster is ineligible for another
 * within one window of it. Deterministic and order-independent.
 */
export function clusterCheckins(
    points: CheckinPoint[],
    cfg: MapClusterConfig
): { clusters: CheckinCluster[]; orphans: CheckinPoint[] } {
    const windowMs = cfg.windowMinutes * 60_000;

    const pool = points
        .filter(
            (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.t)
        )
        .sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));

    if (pool.length === 0 || cfg.minRunners < 1) {
        return { clusters: [], orphans: [...pool] };
    }

    // ── Candidate generation ────────────────────────────────────────────────
    const candidates: { seedId: string; slice: CheckinPoint[] }[] = [];
    for (let i = 0; i < pool.length; i++) {
        const seed = pool[i];

        const slice: CheckinPoint[] = [];
        for (let j = i; j < pool.length && pool[j].t - seed.t <= windowMs; j++) {
            slice.push(pool[j]);
        }

        const nearSeed = slice.filter(
            (p) => haversineMeters(seed.lat, seed.lng, p.lat, p.lng) <= cfg.radiusMeters
        );
        if (distinctRunners(nearSeed) < cfg.minRunners) continue;

        // Refinement: recentre on the crowd, re-filter from the same slice.
        const c = centroidOf(nearSeed);
        const nearCentroid = slice.filter(
            (p) => haversineMeters(c.lat, c.lng, p.lat, p.lng) <= cfg.radiusMeters
        );
        if (distinctRunners(nearCentroid) < cfg.minRunners) continue;

        candidates.push({ seedId: seed.id, slice: nearCentroid });
    }

    candidates.sort(
        (a, b) =>
            distinctRunners(b.slice) - distinctRunners(a.slice) ||
            a.slice[0].t - b.slice[0].t ||
            (a.seedId < b.seedId ? -1 : 1)
    );

    // ── Greedy claim ────────────────────────────────────────────────────────
    const acceptedTimes = new Map<string, number[]>();
    const claimed = new Set<string>();
    const clusters: CheckinCluster[] = [];

    for (const cand of candidates) {
        // Each runner's EARLIEST unclaimed check-in in this candidate decides
        // their eligibility; a runner already clustered within one window is out.
        const earliest = new Map<string, CheckinPoint>();
        for (const p of cand.slice) {
            if (claimed.has(p.id)) continue;
            const cur = earliest.get(p.rid);
            if (!cur || p.t < cur.t || (p.t === cur.t && p.id < cur.id)) earliest.set(p.rid, p);
        }

        const eligible = [...earliest.values()].filter((p) => {
            const times = acceptedTimes.get(p.rid);
            return !times || !times.some((t) => Math.abs(t - p.t) < windowMs);
        });
        if (eligible.length < cfg.minRunners) continue;

        // Absorb every unclaimed check-in belonging to an eligible runner —
        // including their repeats — so none re-appears as a stray pin.
        const rids = new Set(eligible.map((p) => p.rid));
        const absorbed = cand.slice.filter((p) => !claimed.has(p.id) && rids.has(p.rid));
        const c = centroidOf(absorbed);
        const times = absorbed.map((p) => p.t).sort((a, b) => a - b);

        clusters.push({
            id: fnv1a(
                `${times[0]}|${c.lat.toFixed(5)},${c.lng.toFixed(5)}|` +
                    absorbed.map((p) => p.id).sort().join(',')
            ),
            lat: c.lat,
            lng: c.lng,
            startAt: times[0],
            endAt: times[times.length - 1],
            size: eligible.length,
            memberIds: absorbed.map((p) => p.id),
        });

        for (const p of absorbed) claimed.add(p.id);
        for (const p of eligible) {
            acceptedTimes.set(p.rid, [...(acceptedTimes.get(p.rid) ?? []), p.t]);
        }
    }

    return {
        clusters: clusters.sort((a, b) => a.startAt - b.startAt),
        orphans: pool.filter((p) => !claimed.has(p.id)),
    };
}
