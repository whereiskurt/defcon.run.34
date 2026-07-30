import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { judgeSolve } from "@/lib/ctf-judge";
import { rescoreBestEffort } from "@/lib/rescore";

/**
 * POST /api/admin/ctf-award — admin-only "exceptional run" award (+1000,
 * points-consistency Task 10).
 *
 * A thin operator trigger over the judge's server-proven `grant` path
 * (Task 6): the `exceptional-run` Ctf row is the ONLY challenge this route
 * will ever submit — never caller-chosen — so an admin cannot use this
 * endpoint to award an arbitrary flag. `judgeSolve` still applies every
 * OTHER gate (enabled, unlockAfter, scoreWindow, claims/ordinals); it only
 * skips step-4 answer validation. The seeded row's `perPlayerIntervalHours:
 * 24` makes this a repeatable-daily award — a same-day double-click replays
 * as the SAME non-solve shape (NON_SOLVE) as any other window collision, so
 * it 409s rather than double-crediting.
 *
 * On a credited solve, `rescoreBestEffort` (the ONLY writer of RunUser score
 * fields) re-derives the target's score — mirrors the recalculate route's
 * post-award rescore.
 *
 * ── Gate (non-disclosure, same contract as the sibling admin routes) ───────
 * Every denial → a BARE 404, never 401/403: requireAdmin fails, missing
 * session.user.authUserId, or revalidateAdmin (LIVE fresh-claims, keyed by
 * the OIDC sub — NOT the adapter id) fails.
 *
 * Node runtime (AWS-SDK signing via judgeSolve's electro store);
 * force-dynamic — always a live, per-request action.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

/** The ONLY grantable challenge from this route — never caller-chosen. */
const AWARDABLE = "exceptional-run";

export async function POST(req: NextRequest) {
  // ── Gate (fail-closed; every denial → 404) ────────────────────────────────
  const session = await auth();
  const gate = requireAdmin(session);
  if (!gate.ok) return NOT_FOUND();
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateAdmin(authUserId))) return NOT_FOUND();

  let userId = "";
  try {
    const body = await req.json();
    userId = typeof body?.userId === "string" ? body.userId : "";
  } catch {
    /* 400 below */
  }
  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const result = await judgeSolve(
    { user: userId, challenge: AWARDABLE, channel: "qr", grant: true },
    {},
  );
  if (result.solved && result.points > 0) {
    await rescoreBestEffort(userId);
    return NextResponse.json({ ok: true, points: result.points });
  }
  // Repeat same-day award (repeatable window collision) or disabled/missing flag.
  return NextResponse.json({ ok: false, reason: "not-awarded" }, { status: 409 });
}
