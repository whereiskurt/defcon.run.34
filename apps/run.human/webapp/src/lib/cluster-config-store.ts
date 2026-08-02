/**
 * Persisted cluster config read/write. SERVER-ONLY (touches DynamoDB).
 *
 * The read is behind a short module-level cache because `rescoreUser` needs the
 * per-day cap on every single rescore — an uncached read would add a DynamoDB
 * round-trip to the hot scoring path. The TTL is deliberately short so a retune
 * from the admin UI takes effect within a minute across warm instances, and the
 * admin write busts the local cache immediately.
 *
 * A missing row (the normal state until an admin first saves) reads as
 * DEFAULT_CLUSTER_CONFIG, and any read failure falls back to the last known
 * good value — never to "disabled", which would silently zero everyone's bonus.
 */
import { ClusterConfig as ClusterConfigEntity } from "@/entities/cluster";
import {
  DEFAULT_CLUSTER_CONFIG,
  normalizeClusterConfig,
  type ClusterConfig,
} from "./cluster-config";

const TTL_MS = 60_000;

let cached: ClusterConfig = DEFAULT_CLUSTER_CONFIG;
let cachedAt = 0;

export function invalidateClusterConfigCache(): void {
  cachedAt = 0;
}

export async function getClusterConfig(): Promise<ClusterConfig> {
  if (Date.now() - cachedAt < TTL_MS) return cached;

  try {
    const result = await ClusterConfigEntity.get({}).go();
    cached = normalizeClusterConfig(result.data ?? undefined);
    cachedAt = Date.now();
  } catch (err) {
    // Keep serving the last known good config rather than failing the caller —
    // a config read hiccup must never take scoring offline.
    console.error("[cluster-config] read failed; serving cached", err);
  }
  return cached;
}

export async function saveClusterConfig(
  raw: unknown,
  updatedBy: string,
): Promise<ClusterConfig> {
  const cfg = normalizeClusterConfig(raw);

  await ClusterConfigEntity.put({
    enabled: cfg.enabled,
    radiusMeters: cfg.radiusMeters,
    windowMinutes: cfg.windowMinutes,
    minRunners: cfg.minRunners,
    maxPerUserPerDay: cfg.maxPerUserPerDay,
    tiers: cfg.tiers,
    updatedBy,
  }).go();

  cached = cfg;
  cachedAt = Date.now();
  return cfg;
}
