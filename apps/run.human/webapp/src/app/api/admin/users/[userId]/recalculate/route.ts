import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { config } from "@/config";
import { getSubByAdapterUserId } from "@/entities/auth-user";
import { bustDrillCache } from "@/lib/leaderboard-drill-cache";
import { rescoreBestEffort } from "@/lib/rescore";

/**
 * POST /api/admin/users/[userId]/recalculate — admin per-user "Recalculate
 * score" action (LDBR-08 Task 7).
 *
 * A thin operator trigger over run.gpx's internal reconcile: resolves the
 * adapter userId to its OIDC sub, asks run.gpx's
 * `POST /api/gpx/internal/reconcile` (secret-gated, same trust model as
 * `api/internal/accomplishment/reconcile/route.ts`) to reconcile that
 * runner's Accomplishment rows against its own source of truth, rescores the
 * user's derived score (rescoreBestEffort, points-consistency), then busts
 * this user's leaderboard drill cache so the admin drill-down reflects the
 * change on next read instead of waiting out the 60s TTL.
 *
 * ── Gate (non-disclosure, same contract as the sibling admin routes) ───────
 * Every denial → a BARE 404, never 403/401. Three denial paths collapse to
 * 404: requireAdmin fails, missing session.user.authUserId, or
 * revalidateAdmin (LIVE fresh-claims, keyed by the OIDC sub — NOT the
 * adapter id) fails.
 *
 * A user with no linked run.auth identity (no ACCOUNT# record) can't be
 * reconciled — 422 `{error:"no sub"}` rather than a silent no-op or a 404
 * that would read as "not admin".
 *
 * An upstream reconcile failure (non-2xx or a thrown fetch, e.g. run.gpx
 * down) maps to 502 `{error:"reconcile failed"}` — the drill cache is left
 * untouched so a stale-but-correct cached view isn't busted for nothing.
 *
 * Node runtime (AWS-SDK signing via the auth-user lookup); force-dynamic —
 * always a live, per-request action.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
): Promise<Response> {
  // ── Gate (fail-closed; every denial → 404) ────────────────────────────────
  const session = await auth();
  if (!requireAdmin(session).ok) return NOT_FOUND();
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateAdmin(authUserId))) return NOT_FOUND();

  const { userId } = await params;
  if (!userId) return NOT_FOUND();

  const sub = await getSubByAdapterUserId(userId);
  if (!sub) {
    return Response.json({ error: "no sub" }, { status: 422 });
  }

  try {
    const base = process.env.RUN_GPX_INTERNAL_URL ?? "http://localhost:3003";
    const res = await fetch(`${base}/api/gpx/internal/reconcile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": config.auth.internalSecret,
      },
      body: JSON.stringify({ sub }),
    });
    if (!res.ok) {
      return Response.json({ error: "reconcile failed" }, { status: 502 });
    }

    const data = (await res.json()) as { created: number; deleted: number };
    bustDrillCache(userId);
    // The reconcile's own accomplishment writes each fire a rescore, but an
    // explicit call here also covers the zero-change case — e.g. the scoring
    // config was retuned and this user's ledger needs revaluing even though
    // reconcile created/deleted nothing.
    await rescoreBestEffort(userId);

    return Response.json({
      ok: true,
      created: data.created,
      deleted: data.deleted,
    });
  } catch (error) {
    console.error(
      `[admin] recalculate(${userId}) upstream reconcile failed:`,
      error
    );
    return Response.json({ error: "reconcile failed" }, { status: 502 });
  }
}
