import { ghostWho, ghostDossier } from "./ghost-identities";
import { simRabbitIdentity, isSimRabbit } from "./sim-rabbit-identities";

/** Default rabbit pin tint — mirrors the studio's DEFAULT_PIN_COLOR so a real
 * rabbit with no chosen color is byte-identical to a sim in the feed. */
const DEFAULT_PIN_COLOR = "#e6007a";

export type MeshNode = {
  from?: number;
  fromStr?: string;
  longName?: string;
  shortName?: string;
  latitude?: number;
  longitude?: number;
  lastMapReport?: number;
  batteryLevel?: number;
  hwModel?: string;
  role?: string;
  region?: string;
  modemPreset?: string;
  fwVersion?: string;
  hasDefaultCh?: boolean;
  seenBy?: Record<string, number>;
  [k: string]: unknown;
};
export type NodeDb = Record<string, MeshNode>;

export type MeshMapEntry = {
  nodeNum: number;
  displayName: string;
  userType?: string;
  pinIcon?: string;
  pinColor?: string;
};

const GHOST_RE = /ghost|contest|operative/i;

export function isGhost(n: MeshNode): boolean {
  return GHOST_RE.test(n.longName ?? "") || GHOST_RE.test(n.shortName ?? "");
}

/** Mirrors meshtk IsValid: present name + non-zero position. */
export function hasValidPosition(n: MeshNode): boolean {
  return (
    !!n.longName &&
    typeof n.latitude === "number" &&
    typeof n.longitude === "number" &&
    n.latitude !== 0 &&
    n.longitude !== 0
  );
}

export function lastSeen(n: MeshNode): number {
  if (typeof n.lastMapReport === "number") return n.lastMapReport;
  const vals = Object.values(n.seenBy ?? {});
  return vals.length ? Math.max(...vals) : 0;
}

/** "ghost-condor-00" → "condor"; "operative_mudge" → "mudge". */
export function ghostSlug(longName: string): string {
  const m = longName.toLowerCase().match(/(?:ghost|contest|operative)[-_]?([a-z0-9]+)/);
  return m?.[1] ?? longName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function coord(n: MeshNode): [number, number] {
  return [(n.longitude as number) / 1e7, (n.latitude as number) / 1e7];
}

/** Allowlisted radio-config subset shown in rabbit popups. Never keys/creds. */
export function radioFields(n: MeshNode) {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    hwModel: s(n.hwModel),
    role: s(n.role),
    region: s(n.region),
    modemPreset: s(n.modemPreset),
    fwVersion: s(n.fwVersion),
    channel: n.hasDefaultCh === true ? "dc.run" : "custom",
    battery: typeof n.batteryLevel === "number" ? n.batteryLevel : -1,
  };
}

/** Numeric uint32 key from stored hex "!4359d0cc" (never assumes zero-padding). */
export function hexToNodeNum(nodeId: string): number {
  return parseInt(nodeId.replace(/^!/, ""), 16) >>> 0;
}

function keyToNum(key: string, n: MeshNode): number {
  const fromKey = Number(key);
  if (Number.isFinite(fromKey) && fromKey > 0) return fromKey >>> 0;
  return n.fromStr ? hexToNodeNum(n.fromStr) : 0;
}

/** Goldstein's published DM-unlock clue (seed + authenticator QR data-URI). */
export type GhostUnlockClue = { secret: string; qr: string };

export function ghostFeatureCollection(
  db: NodeDb,
  goldsteinClue?: GhostUnlockClue | null
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const [key, n] of Object.entries(db)) {
    if (!isGhost(n) || !hasValidPosition(n)) continue;
    const slug = ghostSlug(n.longName as string);
    const d = ghostDossier(slug);
    features.push({
      type: "Feature",
      id: keyToNum(key, n),
      geometry: { type: "Point", coordinates: coord(n) },
      properties: {
        slug,
        who: ghostWho(slug),
        alias: d?.alias ?? "",
        blurb: d?.blurb ?? "",
        link: d?.link ?? "",
        shortName: n.shortName ?? "",
        // Same allowlisted radio subset the rabbit popups show — never keys.
        ...radioFields(n),
        lastSeen: lastSeen(n),
        // Deliberately-published CTF clue: goldstein's DM-unlock seed. The
        // unlock seed is distinct from the chain/daily-claim seed (07-25 split).
        ...(slug === "goldstein" && goldsteinClue
          ? { unlockSeed: goldsteinClue.secret, unlockQr: goldsteinClue.qr }
          : {}),
      },
    });
  }
  return { type: "FeatureCollection", features };
}

export function simRabbitFeatureCollection(db: NodeDb): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const [key, n] of Object.entries(db)) {
    if (!isSimRabbit(n.longName, n.shortName) || !hasValidPosition(n)) continue;
    const id = simRabbitIdentity(n.longName as string);
    if (!id) continue; // unknown slug → not part of the crowd
    features.push({
      type: "Feature",
      id: keyToNum(key, n),
      geometry: { type: "Point", coordinates: coord(n) },
      properties: {
        displayName: id.displayName,
        userType: "rabbit",
        pinColor: id.pinColor,
        ...radioFields(n),
        lastSeen: lastSeen(n),
      },
    });
  }
  return { type: "FeatureCollection", features };
}

export function rabbitFeatureCollection(
  db: NodeDb,
  entries: MeshMapEntry[]
): GeoJSON.FeatureCollection {
  const byNum = new Map<number, MeshMapEntry>();
  for (const e of entries) byNum.set(e.nodeNum >>> 0, e);
  const features: GeoJSON.Feature[] = [];
  for (const [key, n] of Object.entries(db)) {
    const num = keyToNum(key, n);
    const id = byNum.get(num);
    if (!id || !hasValidPosition(n)) continue;
    features.push({
      type: "Feature",
      id: num,
      geometry: { type: "Point", coordinates: coord(n) },
      properties: {
        displayName: id.displayName || "a rabbit",
        userType: id.userType ?? "rabbit",
        pinColor: id.pinColor || DEFAULT_PIN_COLOR,
        ...radioFields(n),
        lastSeen: lastSeen(n),
      },
    });
  }
  return { type: "FeatureCollection", features };
}
