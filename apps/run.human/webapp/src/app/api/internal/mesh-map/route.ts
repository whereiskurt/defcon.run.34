import { NextRequest, NextResponse } from "next/server";
import { scanAllRunUsers } from "@/entities/run-user";
import { scanAllMeshRadios } from "@/entities/mesh-radio";
import { createScanCache } from "@/lib/scan-cache";
import { config } from "@/config";

/**
 * 60s stale-while-revalidate caches in front of the two full-table scans below.
 *
 * The comment above `GET` calls these scans "low-frequency". That was true when
 * this feed was written and is no longer: run.gpx's rabbit proxy calls it on
 * behalf of EVERY map viewer, and the Runners layer is default-on with a 45s
 * client poll. Uncached, 300 concurrent viewers turn into ~800 full-table scans
 * per minute against `run-human-electro` — the single largest DynamoDB read
 * source at event scale, and enough JSON to saturate this task's 0.1875 vCPU
 * long before DynamoDB itself notices.
 *
 * Cached, the origin cost is ~1 scan/minute each regardless of crowd size.
 * Module scope = one instance per warm container, matching leaderboard-cache.
 *
 * Freshness cost: a runner who newly opts a radio in, renames, or recolours
 * their pin can take up to 60s to appear here (plus the client's own poll).
 * Rabbit POSITIONS are unaffected — those come from meshtk's feed via the gpx
 * proxy, not from this identity join, so pins keep moving in real time.
 */
const radiosCache = createScanCache("mesh-radios", scanAllMeshRadios);
const usersCache = createScanCache("run-users", scanAllRunUsers);

/**
 * Internal API: opted-in Meshtastic map identities.
 *
 * Protected by AUTH_INTERNAL_SECRET (server-to-server only). Returns one entry
 * per radio that is BOTH verified and showOnMap, mapping the numeric node id to
 * the user's public identity. Consumed by run.gpx's rabbit proxy, which
 * intersects these against meshtk's nodes.json. Opt-in only; default off.
 *
 * Source of truth is the first-class MeshRadio entity (Phase 66 hard-switch),
 * not the retired embedded RunUser radios list. nodeNum is read straight off
 * the stored MeshRadio row (no hex reversal). The entity scans are fine here —
 * the meshtk no-Scan rule applies ONLY to meshtk's decrypt hot path, not this
 * app feed — but they are NOT low-frequency and are cached; see the caches above.
 *
 * Trust boundary: only presentation-safe fields are emitted — never radio
 * privateKey/publicKey or mqttUsername/mqttPassword.
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== config.auth.internalSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const [radios, users] = await Promise.all([
      radiosCache.get(),
      usersCache.get(),
    ]);
    const userById = new Map(users.map((u) => [u.userId, u]));
    const entries: Array<{
      nodeNum: number;
      displayName: string;
      userType?: string;
      pinIcon?: string;
      pinColor?: string;
    }> = [];
    for (const r of radios) {
      if (!r.verified || !r.showOnMap) continue;
      const u = userById.get(r.userId);
      entries.push({
        nodeNum: r.nodeNum,
        displayName: u?.displayName ?? "a rabbit",
        userType: u?.mqttUsertype,
        pinIcon: u?.preferences?.pinIcon,
        pinColor: u?.preferences?.pinColor,
      });
    }
    return NextResponse.json(
      { entries },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("[run.human] /api/internal/mesh-map error:", error);
    return NextResponse.json({ entries: [] }, { status: 200 });
  }
}
