import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config";
import { getMeshRadio } from "@/entities/mesh-radio";
import { normalizeNodeId } from "@/lib/mesh-radio-canonical";
import { judgeSolve } from "@/lib/ctf-judge";
import { rescoreBestEffort } from "@/lib/rescore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal API: admit a bot-unlock solve (points-consistency, 2026-07-30).
 *
 * Called by the meshtk fleet (x-internal-secret, same contract as ../mint)
 * when a radio passes a ghost's TOTP unlock. Maps the radio's nodeId to its
 * owning RunUser and grants the ghost's `unlock-<name>` flag through the
 * judge (grant: static once-ever claim → repeat unlocks replay, never
 * double-award). A missing/disabled unlock flag or unowned radio awards
 * nothing — the mesh flow is unaffected either way.
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== config.auth.internalSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let ghost = "";
  let node = "";
  try {
    const body = await req.json();
    ghost = typeof body?.ghost === "string" ? body.ghost : "";
    node = typeof body?.node === "string" ? body.node : "";
  } catch {
    /* fall through to 400 */
  }
  if (!ghost || !node) {
    return NextResponse.json({ error: "Missing ghost/node" }, { status: 400 });
  }

  const name = ghost.split(".").pop() ?? "";
  if (!name) {
    return NextResponse.json({ error: "Unawardable" }, { status: 422 });
  }

  const radio = await getMeshRadio(normalizeNodeId(node));
  const userId = radio?.userId;
  if (!userId) {
    return NextResponse.json({ error: "Unknown radio" }, { status: 404 });
  }

  const result = await judgeSolve(
    { user: userId, challenge: `unlock-${name}`, channel: "qr", grant: true },
    {},
  );
  if (result.solved) {
    await rescoreBestEffort(userId);
  }
  return NextResponse.json(
    { solved: result.solved, points: result.points },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
