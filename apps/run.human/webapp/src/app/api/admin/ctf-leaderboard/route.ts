import { auth } from "@/config/auth";
import {
  ADMIN_GROUPS,
  requireGroups,
  revalidateGroups,
} from "@/lib/admin-gate";
import { buildLeaderboard, leaderboardCsv } from "@/lib/ctf-leaderboard";

/**
 * GET /api/admin/ctf-leaderboard — CTF standings CSV export (Phase 47, CTF-11).
 *
 * The leaderboard PAGE consumes buildLeaderboard() directly; this route exists
 * only to stream the formula-guarded CSV (?format=csv, also the default).
 *
 * ── Gate (T-47-09, non-disclosure) ──────────────────────────────────────────
 * Gated EXACTLY like /api/admin/qr: sync requireGroups(ADMIN_GROUPS) —
 * admin | runadmin; qradmin deliberately does NOT reach anything under
 * /api/admin — then a LIVE revalidateGroups keyed by the OIDC sub. Every denial
 * (no session / not admin / failed revalidation) collapses to a BARE 404, never
 * a 401/403, so the route's existence is not advertised.
 *
 * IDENTIFIER LANDMINE: revalidateGroups MUST be called with
 * `session.user.authUserId` (the auth.defcon.run OIDC sub) — NOT
 * `session.user.id`, which is the Auth.js DynamoDB-adapter local uuid. Passing
 * the adapter id silently fails the live claims lookup and 404s a real admin.
 *
 * ── Caching (T-47-12) ───────────────────────────────────────────────────────
 * Cache-Control: no-store + force-dynamic keep the CSV (and its emails-free but
 * still admin-only standings) off every cache. Node runtime — the ElectroDB /
 * AWS-SDK scan needs Node crypto for request signing.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

export async function GET(): Promise<Response> {
  // ── Gate (fail-closed; every denial → 404) ────────────────────────────────
  const session = await auth();
  if (!requireGroups(session, ADMIN_GROUPS).ok) return NOT_FOUND();
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateGroups(authUserId, ADMIN_GROUPS)))
    return NOT_FOUND();

  // ── Build → serialize (formula-guarded) ───────────────────────────────────
  const rows = await buildLeaderboard();
  const csv = leaderboardCsv(rows);
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ctf-leaderboard-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
