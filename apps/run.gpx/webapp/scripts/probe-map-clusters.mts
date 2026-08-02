/**
 * READ-ONLY probe: fetch the LIVE public check-in feed and run the map's own
 * clustering module over it, printing exactly what the check-in layer will
 * draw — cluster markers and leftover pins.
 *
 * The studio's layer code does nothing but call `clusterCheckins` and turn the
 * result into GeoJSON features, so this reproduces the layer's contents without
 * needing a browser. Writes nothing and touches no credentials.
 *
 *   npx tsx scripts/probe-map-clusters.mts [feedUrl]
 */
import {
    clusterCheckins,
    DEFAULT_MAP_CLUSTER_CONFIG,
    type MapClusterConfig,
} from '../../gpx-studio/website/src/lib/checkin-cluster';

const DEFAULT_FEED = 'https://run.defcon.run/use1/api/checkins/public';
const feedBase = process.argv[2] || DEFAULT_FEED;

// The studio requests a two-week window, `since` floored to the hour.
const since = Math.floor((Date.now() - 14 * 24 * 3600_000) / 3600_000) * 3600_000;
const url = `${feedBase}?since=${since}`;

type Feed = {
    checkIns: {
        lat: number;
        lon: number;
        rid?: string;
        displayName: string;
        timestamp: number;
    }[];
    truncated?: boolean;
    clusterConfig?: Partial<MapClusterConfig> & { enabled?: boolean };
};

const res = await fetch(url);
if (!res.ok) {
    console.error(`feed returned HTTP ${res.status}`);
    process.exit(1);
}
const body = (await res.json()) as Feed;

const cc = body.clusterConfig;
const cfg: MapClusterConfig =
    cc && cc.enabled !== false
        ? {
              radiusMeters: cc.radiusMeters ?? DEFAULT_MAP_CLUSTER_CONFIG.radiusMeters,
              windowMinutes: cc.windowMinutes ?? DEFAULT_MAP_CLUSTER_CONFIG.windowMinutes,
              minRunners: cc.minRunners ?? DEFAULT_MAP_CLUSTER_CONFIG.minRunners,
          }
        : { ...DEFAULT_MAP_CLUSTER_CONFIG, minRunners: Number.MAX_SAFE_INTEGER };

const byId = new Map(body.checkIns.map((c, i) => [`ci-${i}`, c]));
const { clusters, orphans } = clusterCheckins(
    body.checkIns.map((c, i) => ({
        id: `ci-${i}`,
        rid: c.rid ?? `anon-${i}`,
        lat: c.lat,
        lng: c.lon,
        t: c.timestamp,
    })),
    cfg
);

const pdt = (ms: number) => new Date(ms - 7 * 3600_000).toISOString().replace('T', ' ').slice(0, 16);

console.log(`Feed:      ${url}`);
console.log(`Config:    ${cfg.radiusMeters}m / ${cfg.windowMinutes}min / min ${cfg.minRunners}`);
console.log(`Check-ins: ${body.checkIns.length} public${body.truncated ? ' (TRUNCATED)' : ''}`);
console.log(`With rid:  ${body.checkIns.filter((c) => c.rid).length}\n`);

console.log(`Map will draw ${clusters.length} cluster marker(s) and ${orphans.length} pin(s):\n`);
for (const cl of clusters) {
    const names = [
        ...new Set(
            cl.memberIds
                .map((id) => byId.get(id))
                .filter(Boolean)
                .sort((a, b) => a!.timestamp - b!.timestamp)
                .map((c) => c!.displayName)
        ),
    ];
    console.log(
        `  👥 ${String(cl.size).padStart(3)} runners  ${pdt(cl.startAt)} PDT  ` +
            `(${cl.lat.toFixed(4)}, ${cl.lng.toFixed(4)})  ${cl.memberIds.length} check-ins`
    );
    console.log(`      ${names.slice(0, 6).join(', ')}${names.length > 6 ? ', …' : ''}`);
}

const total = clusters.reduce((s, c) => s + c.memberIds.length, 0) + orphans.length;
console.log(
    `\nPartition check: ${total} accounted for of ${body.checkIns.length} ` +
        `(${total === body.checkIns.length ? 'OK — none lost, none doubled' : 'MISMATCH'})`
);
console.log(
    `Pins avoided:    ${body.checkIns.length} check-ins → ${clusters.length + orphans.length} markers`
);
