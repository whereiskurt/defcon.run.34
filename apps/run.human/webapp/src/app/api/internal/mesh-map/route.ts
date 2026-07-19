import { NextRequest, NextResponse } from "next/server";
import { scanAllRunUsers } from "@/entities/run-user";
import { scanAllMeshRadios } from "@/entities/mesh-radio";
import { config } from "@/config";

/**
 * Internal API: opted-in Meshtastic map identities.
 *
 * Protected by AUTH_INTERNAL_SECRET (server-to-server only). Returns one entry
 * per radio that is BOTH verified and showOnMap, mapping the numeric node id to
 * the user's public identity. Consumed by run.gpx's rabbit proxy, which
 * intersects these against meshtk's nodes.json. Opt-in only; default off.
 *
 * Source of truth is the first-class MeshRadio entity (Phase 66 hard-switch),
 * not the retired RunUser.meshtasticRadios[] list. nodeNum is read straight off
 * the stored MeshRadio row (no hex reversal). A single low-frequency entity scan
 * is fine here — the meshtk no-Scan rule applies ONLY to meshtk's decrypt hot
 * path, not this app feed.
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
      scanAllMeshRadios(),
      scanAllRunUsers(),
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
