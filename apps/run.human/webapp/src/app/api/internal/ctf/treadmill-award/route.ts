import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config";
import { getAdapterUserIdBySub } from "@/entities/auth-user";
import { judgeSolve } from "@/lib/ctf-judge";
import { rescoreBestEffort } from "@/lib/rescore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal API: award the ELKENTARO 2000 treadmill flag (2026-08-05, Kurt).
 *
 * Called by run.gpx (x-internal-secret, same contract as ../mint and
 * ../unlock-award) when it imports an INDOOR activity recorded Aug 3–10 2026.
 * run.gpx owns that judgement — it is the side that sees Strava's `trainer`
 * flag and the GPS streams — so this route trusts the caller's entitlement and
 * admits the solve via the judge's `grant` path, exactly as ../unlock-award
 * does for a bot-verified ghost unlock.
 *
 * The challenge name is HARD-CODED rather than taken from the body on purpose:
 * a generic "grant any challenge" endpoint would let anything holding the
 * internal secret mint arbitrary flags. This one can only ever award treadmill.
 *
 * `grant` skips answer validation only — every other judge gate (enabled,
 * unlockAfter, scoreWindow, claims/ordinals) still applies, and a repeat award
 * replays the existing solve rather than double-scoring. A missing or disabled
 * `treadmill` Ctf row awards nothing and the import is unaffected.
 *
 * Body: { oidcSub }.  The wire identity is the OIDC sub (run.gpx's
 * session.user.id); it is resolved here to run.human's adapter userId, because
 * the two namespaces differ and a wrong-id solve silently awards nobody.
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== config.auth.internalSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let oidcSub = "";
  try {
    const body = await req.json();
    oidcSub = typeof body?.oidcSub === "string" ? body.oidcSub.trim() : "";
  } catch {
    /* fall through to 400 */
  }
  if (!oidcSub) {
    return NextResponse.json({ error: "Missing oidcSub" }, { status: 400 });
  }

  const userId = await getAdapterUserIdBySub(oidcSub);
  if (!userId) {
    return NextResponse.json({ error: "Unknown user" }, { status: 404 });
  }

  const result = await judgeSolve(
    { user: userId, challenge: "treadmill", channel: "qr", grant: true },
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
