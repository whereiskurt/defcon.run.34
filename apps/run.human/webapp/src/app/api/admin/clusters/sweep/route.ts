import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { RunUser } from "@/entities/run-user";
import { sweepCon } from "@/lib/cluster-sweep";

/**
 * POST /api/admin/clusters/sweep — detect clusters across the whole con and
 * reconcile the ClusterAward ledger.
 *
 * Body: `{ "dryRun": true }` previews without writing. Preview and the real
 * sweep are THE SAME code path (the dry run stops just before applying the
 * diff), so what the preview shows is exactly what a sweep would do.
 *
 * ── Gate (non-disclosure, same contract as the sibling admin routes) ────────
 * Every denial → a BARE 404, never 401/403.
 *
 * maxDuration is extended for the same reason `/api/admin/rescore-all` extends
 * it: a whole-con sweep reads every check-in and then rescores every affected
 * runner, which is an event-scale but not web-request-scale amount of work.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NOT_FOUND = () => new Response(null, { status: 404 });

export async function POST(request: Request) {
  const session = await auth();
  if (!requireAdmin(session).ok) return NOT_FOUND();
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateAdmin(authUserId))) return NOT_FOUND();

  let dryRun = false;
  try {
    const body = (await request.json()) as { dryRun?: unknown };
    dryRun = body?.dryRun === true;
  } catch {
    // No body is fine — default to the real sweep.
  }

  const result = await sweepCon({ dryRun });

  // Resolve display names for the preview table. Batch-get only the runners
  // this sweep actually touched rather than scanning the whole user table.
  const memberIds = [
    ...new Set(result.clusters.flatMap((c) => c.members.map((m) => m.userId))),
  ];
  const names = new Map<string, string>();
  if (memberIds.length > 0) {
    const rows = await RunUser.get(memberIds.map((userId) => ({ userId }))).go();
    for (const r of rows.data) {
      if (r?.userId) names.set(r.userId, r.displayName ?? r.userId);
    }
  }

  return Response.json({
    enabled: result.enabled,
    dryRun: result.dryRun,
    scannedCheckIns: result.scannedCheckIns,
    written: result.puts.length,
    deleted: result.deletes.length,
    rescored: result.rescored,
    rescoreFailed: result.rescoreFailed,
    totalAwarded: result.clusters.reduce((sum, c) => sum + c.points * c.size, 0),
    clusters: result.clusters.map((c) => ({
      clusterId: c.clusterId,
      day: c.day,
      startAt: c.startAt,
      endAt: c.endAt,
      size: c.size,
      points: c.points,
      centroidLat: c.centroidLat,
      centroidLng: c.centroidLng,
      members: c.members.map((m) => ({
        userId: m.userId,
        displayName: names.get(m.userId) ?? m.userId,
      })),
    })),
  });
}
