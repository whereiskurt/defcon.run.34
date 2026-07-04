import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { createBibChallenge, type AltchaLevel } from "@/lib/altcha";

/**
 * GET /api/altcha/challenge?level=save|toggle — issue an ALTCHA PoW challenge.
 *
 * Session-gated (the whole bib app is behind auth). `level` picks the friction:
 * save (~5s, bib-name change) or toggle (~1-2s, pay-in-person pledge). Node
 * runtime for the HMAC crypto; never cached.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const levelParam = req.nextUrl.searchParams.get("level");
  const level: AltchaLevel = levelParam === "toggle" ? "toggle" : "save";

  try {
    const challenge = await createBibChallenge(level);
    return NextResponse.json(challenge, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[run.bib] /api/altcha/challenge:", err);
    return NextResponse.json({ error: "challenge_failed" }, { status: 500 });
  }
}
