import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { getConDayUsage } from "@/lib/con-day-usage";
import type { QuotaTier } from "@/lib/quota-client";

/**
 * GET /api/gpx/conday-usage (Phase 59)
 *
 * Per-con-day usage for the signed-in runner: count, remaining, and whether each
 * con-day is loggable right now. Feeds the "Log a run" card's day picker and the
 * "N of 10 · Sat" quota line. Read-only; no state change.
 */
export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const tier: QuotaTier = services.includes("admin") ? "admin" : "upload";

  try {
    const usage = await getConDayUsage(session.user.id, tier, Date.now());
    return NextResponse.json({ usage });
  } catch (error) {
    console.error("Error reading con-day usage:", error);
    return NextResponse.json(
      { error: "Failed to read con-day usage" },
      { status: 500 }
    );
  }
}
