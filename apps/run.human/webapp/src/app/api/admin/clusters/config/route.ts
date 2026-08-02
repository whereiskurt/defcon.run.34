import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { getClusterConfig, saveClusterConfig } from "@/lib/cluster-config-store";

/**
 * GET  /api/admin/clusters/config — read the cluster bonus tunables.
 * PUT  /api/admin/clusters/config — save them (server re-validates + clamps).
 *
 * ── Gate (non-disclosure, same contract as every sibling admin route) ───────
 * Every denial → a BARE 404, never 401/403: requireAdmin fails, missing
 * session.user.authUserId, or revalidateAdmin (LIVE fresh-claims, keyed by the
 * OIDC sub — NOT the adapter id) fails.
 *
 * The body is untrusted: `saveClusterConfig` runs it through
 * `normalizeClusterConfig`, which clamps every knob and repairs the tier table
 * rather than throwing, so a malformed save can never take scoring offline.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

async function gate() {
  const session = await auth();
  if (!requireAdmin(session).ok) return null;
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateAdmin(authUserId))) return null;
  return authUserId;
}

export async function GET() {
  if (!(await gate())) return NOT_FOUND();
  return Response.json(await getClusterConfig());
}

export async function PUT(request: Request) {
  const authUserId = await gate();
  if (!authUserId) return NOT_FOUND();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const saved = await saveClusterConfig(body, authUserId);
  return Response.json(saved);
}
