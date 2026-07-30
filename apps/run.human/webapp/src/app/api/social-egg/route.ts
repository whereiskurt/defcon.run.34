import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { judgeSolve } from "@/lib/ctf-judge";
import { rescoreBestEffort } from "@/lib/rescore";

/**
 * POST /api/social-egg — DC-jack egg claim for the session user, routed
 * through the judge (grant: server has already proven the gesture
 * out-of-band). Idempotent-ok: a replay is still `solved: true` (the
 * judge returns the prior award, never re-scores) so it responds the
 * same as a first claim.
 * Body: { via?: "hold" | "tap" } — accepted for compatibility, unused.
 */
export async function POST(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Sign in first" }, { status: 401 });
  }
  if (await assertNotLockedLive(session.user.authUserId)) {
    return NextResponse.json({ message: "Account locked out" }, { status: 403 });
  }

  const userId = session.user.id;
  const result = await judgeSolve(
    { user: userId, challenge: "jack-egg", channel: "qr", grant: true },
    {}
  );
  if (!result.solved) {
    return NextResponse.json({ ok: false });
  }
  await rescoreBestEffort(userId);
  return NextResponse.json({ ok: true, points: result.points });
}
