import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { scanAllRunUsers } from "@/entities/run-user";
import { rescoreUser } from "@/lib/rescore";

/**
 * POST /api/admin/rescore-all — bulk rescore every RunUser against current
 * config (points-consistency, Task 11). Run after a seed/config retune (score
 * values are derived, so a retune is invisible until each user rescores).
 * Concurrency-limited; failures are counted, not fatal.
 *
 * ── Gate (non-disclosure, same contract as the sibling admin routes) ───────
 * Every denial → a BARE 404, never 401/403: requireAdmin fails, missing
 * session.user.authUserId, or revalidateAdmin (LIVE fresh-claims, keyed by
 * the OIDC sub — NOT the adapter id) fails.
 *
 * Node runtime (AWS-SDK signing via the ElectroDB scan/rescore path);
 * force-dynamic — always a live, per-request action. maxDuration extended
 * (event-scale table — hundreds of rows — same full-scan rationale as
 * scanAllRunUsers).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NOT_FOUND = () => new Response(null, { status: 404 });

export async function POST() {
  // ── Gate (fail-closed; every denial → 404) ────────────────────────────────
  const session = await auth();
  const gate = requireAdmin(session);
  if (!gate.ok) return NOT_FOUND();
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateAdmin(authUserId))) return NOT_FOUND();

  const users = await scanAllRunUsers();
  let ok = 0;
  let failed = 0;
  const CONCURRENCY = 5;
  for (let i = 0; i < users.length; i += CONCURRENCY) {
    const batch = users.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((u) => rescoreUser(u.userId)),
    );
    for (const r of results) r.status === "fulfilled" ? ok++ : failed++;
  }
  return Response.json({ total: users.length, ok, failed });
}
