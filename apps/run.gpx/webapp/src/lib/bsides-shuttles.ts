/**
 * bsides-shuttles — pure normalizer for the B-Sides Las Vegas shuttle feed.
 *
 * Upstream is a third-party fleet tracker (portal.gps-tracking.com) that exports
 * a GeoJSON FeatureCollection carrying far more than position: device serial
 * numbers, battery and cell/GPS signal, tamper flags, and the reported street
 * address. This module is the trust boundary — it maps the upstream shape to the
 * short whitelist the map actually needs, and everything else is dropped here so
 * it can never reach a browser. We should not be republishing another
 * organization's device health.
 *
 * Everything is total: malformed input yields an empty collection and a
 * malformed single feature is skipped, because the layer treats "no features" as
 * a quiet map and an exception as a broken one. No I/O — the route handler owns
 * fetching, caching and fail-soft.
 */

/** What the map layer receives per bus. Nothing else crosses the boundary. */
export type ShuttleProperties = {
  id: string;
  name: string;
  /** Livery name parsed from the vendor icon path, e.g. "pink". */
  color: string;
  /** Hex swatch for `color`, used for the popup dot and the tinted glyph. */
  colorHex: string;
  /** Heading in degrees, 0-359. */
  hdg: number;
  /** Ground speed in km/h. */
  kmh: number;
  /** Epoch ms of the last position fix, or null if the feed's stamp was unreadable. */
  lastFixMs: number | null;
};

/**
 * Fallback position: the Tuscany Suites lot on E Flamingo, which is where the
 * fleet reports itself parked. Only used for a bus whose own coordinates are
 * missing or unusable — normally every bus carries its own position.
 */
export const TUSCANY_ANCHOR: [number, number] = [-115.160809, 36.112728];

/** A bus that has not reported for this long is drawn dimmed. */
export const STALE_AFTER_MS = 30 * 60 * 1000;

const LIVERY_HEX: Record<string, string> = {
  pink: "#EC4899",
  orange: "#F97316",
  blue: "#3B82F6",
  green: "#22C55E",
  red: "#EF4444",
  yellow: "#EAB308",
  purple: "#A855F7",
  white: "#E5E7EB",
  black: "#4B5563",
};

/** Neutral swatch for a livery we have not seen before. */
const UNKNOWN_HEX = "#94A3B8";

/**
 * Read the livery color out of the vendor's icon path.
 *
 * The path looks like `pink-bus/pink-bus-345.png`, where the trailing number is
 * `hdg` snapped to 15 degrees. We want only the color prefix — the rotation is
 * redundant with `hdg`, which we use directly to spin our own glyph.
 *
 * An unrecognized color still returns a usable swatch rather than failing the
 * feature: a bus we can't color is better than a bus that vanishes.
 */
export function shuttleColor(icon: unknown): { name: string; hex: string } {
  if (typeof icon !== "string") return { name: "unknown", hex: UNKNOWN_HEX };
  const m = /^([a-z]+)-bus\b/i.exec(icon.trim());
  if (!m) return { name: "unknown", hex: UNKNOWN_HEX };
  const name = m[1].toLowerCase();
  return { name, hex: LIVERY_HEX[name] ?? UNKNOWN_HEX };
}

/** Offset (ms) between a timezone's local wall clock and UTC at a given instant. */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  // `hour` comes back as 24 for midnight under hour12:false in some ICU builds.
  const hour = p.hour === 24 ? 0 : p.hour;
  return Date.UTC(p.year, p.month - 1, p.day, hour, p.minute, p.second) - utcMs;
}

const FEED_DATE =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i;

/**
 * Parse the feed's `date` field as a bare WALL CLOCK, epoch-ms as if it were UTC.
 *
 * Only used by tests that need the raw stamp independent of any zone; the
 * normalizer uses `parseFeedDate`, which applies FEED_TIME_ZONE.
 */
export function parseFeedWallMs(value: unknown): number | null {
  return parseFeedDate(value, "UTC");
}

/**
 * The zone the vendor stamps its `date` field in.
 *
 * ⚠️ IT IS **NOT** LAS VEGAS TIME — and it is not Eastern either. Both were
 * shipped wrong before this was pinned; the resolution is empirical, so do not
 * "correct" it back to Pacific because the fleet is in Vegas.
 *
 * SETTLED 2026-08-05 by polling while a bus was actively reporting. The device
 * emits roughly every 70 s, and its stamp tracks the vendor's own HTTP `Date`
 * header to within seconds — but only under Central:
 *
 *     server 16:01:42 GMT | stamp 11:00:45  ->  Central 57 s   Eastern 61 min
 *     server 16:02:53 GMT | stamp 11:02:46  ->  Central  7 s   Eastern 60 min
 *     server 16:04:03 GMT | stamp 11:03:56  ->  Central  7 s   Eastern 60 min
 *
 * An earlier single sample only ruled out Pacific and Mountain (both put the fix
 * in the FUTURE) and could not separate Central from Eastern, because the fleet
 * was parked and the stamp never advanced. Catching it live is what decided it.
 *
 * Why it matters in both directions: Pacific made every fix look up to three
 * hours NEWER, so a bus dead all morning rendered awake. Eastern was an hour too
 * conservative the other way, drawing a bus that was reporting every 70 seconds
 * as asleep. Future values are clamped regardless, and the layer additionally
 * lets observed speed beat age.
 */
export const FEED_TIME_ZONE = "America/Chicago";

/**
 * Parse a wall-clock stamp in an explicit zone. Kept for the UTC path above;
 * resolving a wall clock to an instant needs the offset and the offset needs the
 * instant, so we iterate twice — the first pass lands within an hour, the second
 * settles it (including across a DST boundary).
 */
export function parseFeedDate(value: unknown, timeZone = FEED_TIME_ZONE): number | null {
  if (typeof value !== "string") return null;
  const m = FEED_DATE.exec(value.trim());
  if (!m) return null;
  const [, mo, d, y, h, mi, s, ampm] = m;
  const month = Number(mo);
  const day = Number(d);
  let hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour < 1 || hour > 12 || minute > 59 || second > 59) return null;
  // 12 AM is hour 0 and 12 PM is hour 12 — the two cases a bare +12 gets wrong.
  if (ampm.toUpperCase() === "PM") hour = hour === 12 ? 12 : hour + 12;
  else hour = hour === 12 ? 0 : hour;

  const wall = Date.UTC(Number(y), month - 1, day, hour, minute, second);
  let utc = wall;
  for (let i = 0; i < 2; i++) utc = wall - tzOffsetMs(utc, timeZone);
  return Number.isFinite(utc) ? utc : null;
}

/** A bus with no fix, or one older than the threshold, is stale. */
export function isStale(lastFixMs: number | null | undefined, nowMs: number): boolean {
  if (typeof lastFixMs !== "number" || !Number.isFinite(lastFixMs)) return true;
  return nowMs - lastFixMs > STALE_AFTER_MS;
}

/**
 * Map the vendor's fleet names onto ours for the map label.
 *
 * The vendor calls them `Shuttle1`, `Shuttle2`, which on a map covered in other
 * DEF CON layers says nothing about whose shuttle it is. `BSides1` does. The
 * ticket popup's OPERATOR field reads the same value, so both follow.
 *
 * Only the exact `Shuttle<n>` shape is rewritten — anything else the vendor ever
 * puts in `name` passes through untouched rather than being mangled by a
 * too-clever rule. Casing follows BSidesLV's own ("BSides Las Vegas").
 */
export function displayName(vendorName: string): string {
  const m = /^shuttle\s*(\d+)$/i.exec(vendorName.trim());
  return m ? `BSides${m[1]}` : vendorName;
}

function finiteNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Usable lng/lat, or null. Rejects [0,0] — the tracker emits it for a device
 * that has never had a fix, and it would otherwise drop a bus in the Atlantic.
 */
function coordinates(geometry: unknown): [number, number] | null {
  const g = geometry as { type?: unknown; coordinates?: unknown } | null;
  if (!g || g.type !== "Point" || !Array.isArray(g.coordinates)) return null;
  const [lng, lat] = g.coordinates as unknown[];
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng === 0 && lat === 0) return null;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return [lng, lat];
}

/**
 * Normalize one upstream feature, or null if it is not a feature at all.
 * A feature that is structurally fine but positionally useless still renders —
 * at the anchor — so a bus never silently disappears from the map.
 */
function normalize(raw: unknown): GeoJSON.Feature | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const f = raw as { id?: unknown; properties?: unknown; geometry?: unknown };
  const props = (f.properties && typeof f.properties === "object" ? f.properties : {}) as Record<string, unknown>;

  const id = typeof f.id === "string" ? f.id : String(props.idx ?? "");
  if (!id) return null;

  const color = shuttleColor(props.icon);
  const vendorName =
    typeof props.name === "string" && props.name.trim() ? props.name.trim() : "Shuttle";
  const name = displayName(vendorName);

  // Heading normalized into 0-359 so `icon-rotate` never gets a negative or a
  // value past a full turn.
  const hdg = ((finiteNumber(props.hdg, 0) % 360) + 360) % 360;

  const properties: ShuttleProperties = {
    id,
    name,
    color: color.name,
    colorHex: color.hex,
    hdg,
    kmh: Math.max(0, finiteNumber(props.kmh, 0)),
    // Wall clock only — the feed's offset is applied by the caller.
    lastFixMs: parseFeedDate(props.date),
  };

  return {
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: coordinates(f.geometry) ?? TUSCANY_ANCHOR },
    properties: properties as unknown as GeoJSON.GeoJsonProperties,
  };
}

/**
 * Normalize the whole upstream payload. Total: never throws, never partial-fails.
 *
 * `serverNowMs` should be the vendor's own `Date` response header — it is the
 * reference the future-clamp is measured against, and the vendor's clock is the
 * honest one to compare its own stamps to. Defaults to our clock.
 */
export function shuttleFeatureCollection(
  raw: unknown,
  serverNowMs: number = Date.now(),
): GeoJSON.FeatureCollection {
  const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  if (!raw || typeof raw !== "object") return empty;
  const fc = raw as { type?: unknown; features?: unknown };
  if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) return empty;

  const features: GeoJSON.Feature[] = [];
  for (const f of fc.features) {
    const d = normalize(f);
    if (!d) continue;
    const p = d.properties as unknown as ShuttleProperties;
    // Belt and braces: a fix in the future is always a parsing artefact, never
    // real, and it would make a dead bus immortal — never older than the stale
    // threshold, so never drawn asleep.
    if (p.lastFixMs !== null) p.lastFixMs = Math.min(p.lastFixMs, serverNowMs);
    features.push(d);
  }
  return { type: "FeatureCollection", features };
}
