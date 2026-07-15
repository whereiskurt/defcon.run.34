import { NextRequest, NextResponse } from "next/server";
import { scanAllRunUsers } from "@/entities/run-user";
import { config } from "@/config";

/**
 * Internal API: opted-in Meshtastic map identities.
 *
 * Protected by AUTH_INTERNAL_SECRET (server-to-server only). Returns one entry
 * per radio that is BOTH verified and showOnMap, mapping the numeric node id to
 * the user's public identity. Consumed by run.gpx's rabbit proxy, which
 * intersects these against meshtk's nodes.json. Opt-in only; default off.
 *
 * Trust boundary: only presentation-safe fields are emitted — never radio
 * privateKey/publicKey or mqttUsername/mqttPassword.
 */
function hexToNodeNum(nodeId: string): number {
  return parseInt(nodeId.replace(/^!/, ""), 16) >>> 0;
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== config.auth.internalSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const users = await scanAllRunUsers();
    const entries: Array<{
      nodeNum: number;
      displayName: string;
      userType?: string;
      pinIcon?: string;
      pinColor?: string;
      hash?: string;
    }> = [];
    for (const u of users) {
      for (const r of u.meshtasticRadios ?? []) {
        if (!r.verified || !r.showOnMap || !r.nodeId) continue;
        entries.push({
          nodeNum: hexToNodeNum(r.nodeId),
          displayName: u.displayName ?? "a rabbit",
          userType: u.mqttUsertype,
          pinIcon: u.preferences?.pinIcon,
          pinColor: u.preferences?.pinColor,
          hash: u.hash,
        });
      }
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
