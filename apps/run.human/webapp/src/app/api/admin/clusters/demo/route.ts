import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { loadDemoData, clearDemoData, demoStatus } from "@/lib/cluster-demo";
import { sweepCon } from "@/lib/cluster-sweep";

/**
 * GET  /api/admin/clusters/demo — is the demo data loaded?
 * POST /api/admin/clusters/demo — `{ "action": "load" | "clear" }`.
 *
 * "load" seeds the demo runners + con-day check-ins and then runs a whole-con
 * sweep, so the admin sees awards immediately rather than having to press two
 * buttons. "clear" removes every trace by walking the ClusterDemoUser manifest
 * — an explicit list of what the seeder created, never a userId prefix match.
 *
 * ── Gate (non-disclosure, same contract as the sibling admin routes) ────────
 * Every denial → a BARE 404, never 401/403.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NOT_FOUND = () => new Response(null, { status: 404 });

async function gate() {
  const session = await auth();
  if (!requireAdmin(session).ok) return false;
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateAdmin(authUserId))) return false;
  return true;
}

export async function GET() {
  if (!(await gate())) return NOT_FOUND();
  return Response.json(await demoStatus());
}

export async function POST(request: Request) {
  if (!(await gate())) return NOT_FOUND();

  let action: string | undefined;
  try {
    const body = (await request.json()) as { action?: unknown };
    action = typeof body?.action === "string" ? body.action : undefined;
  } catch {
    action = undefined;
  }

  if (action === "load") {
    const seeded = await loadDemoData();
    const sweep = await sweepCon({});
    return Response.json({
      action: "load",
      ...seeded,
      awardsWritten: sweep.puts.length,
      clusters: sweep.clusters.length,
      rescored: sweep.rescored,
    });
  }

  if (action === "clear") {
    const cleared = await clearDemoData();
    return Response.json({ action: "clear", ...cleared });
  }

  return Response.json(
    { error: 'action must be "load" or "clear"' },
    { status: 400 },
  );
}
