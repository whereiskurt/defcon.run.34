import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { isQrAdmin } from "@/lib/admin-gate";
import { judgeScan, defaultScanStore } from "@/lib/social-scan";
import { rescoreBestEffort } from "@/lib/rescore";

/**
 * POST /api/social-scan — mutual scan award.
 * Body: { p?: string (short token) , h?: string (legacy full hash) }.
 * Success credits BOTH the scanner (session user) and the QR's owner.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Sign in to connect" }, { status: 401 });
  }
  if (await assertNotLockedLive(session.user.authUserId)) {
    return NextResponse.json({ message: "Account locked out" }, { status: 403 });
  }

  let body: { p?: string; h?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body → falls through to bad_token
  }

  const result = await judgeScan(
    {
      scannerId: session.user.id,
      token: typeof body.p === "string" ? body.p : undefined,
      hash: typeof body.h === "string" ? body.h : undefined,
      nowMs: Date.now(),
      // Attendance mode: admin/runadmin/qradmin scanners bypass the daily cap
      // so a full run's worth of attendees can be paired (usage still counted).
      capExempt: isQrAdmin(session),
    },
    defaultScanStore
  );

  if (result.ok) {
    await Promise.all([
      rescoreBestEffort(session.user.id),
      rescoreBestEffort(result.ownerId),
    ]);
    return NextResponse.json(result);
  }
  const responses: Record<string, { status: number; message: string }> = {
    bad_token: { status: 400, message: "That QR code didn't parse." },
    not_found: { status: 404, message: "No runner matches that QR code." },
    self: { status: 400, message: "You cannot scan your own QR code!" },
    already_today: {
      status: 409,
      message: "Already connected today - find new rabbits!",
    },
    cap: { status: 429, message: "Daily connection limit reached." },
  };
  const r = responses[result.code];
  return NextResponse.json(
    { message: r.message, code: result.code },
    { status: r.status }
  );
}
