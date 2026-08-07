import { auth } from "@/config/auth";
import { ADMIN_GROUPS, isMemberOf } from "@/lib/admin-gate";
import { getCachedDrill } from "@/lib/leaderboard-drill-cache";
import { loadDrill } from "@/lib/leaderboard-drill-load";
import { maskCtfLines } from "@/lib/leaderboard-drill";

/**
 * GET /api/leaderboard/[userId]/accomplishments — the leaderboard's lazy
 * per-runner drill-down (LDBR-08). The Phase-52 accordion expands one row and
 * fetches this to render that runner's runs (incl. route polylines), plus
 * (Task 5) a social-scan day rollup, named CTF capture lines and cluster
 * check-in bonuses.
 *
 * A thin shell over already-shipped code: the gate, the Phase-49
 * `getAccomplishmentsByUser` reader, and the Task-3/4/5 drill assembly. The
 * only real contract here is the 404 non-disclosure gate and the named privacy
 * seams (accomplishment privacy filter + covert-flag CTF masking).
 *
 * The whole assembled payload (accomplishments + social + ctf + cluster,
 * UNMASKED) is cached per-user via `getCachedDrill` (Task 3) — the reconcile
 * route busts a user's entry when their accomplishments change. CTF masking
 * runs AFTER the cache read, keyed to the REQUESTING viewer, never baked into
 * the cached value (a cache hit must not leak one viewer's unmask into
 * another's).
 *
 * ── Gate: SIGNED-IN, no longer admin-only (Kurt, 2026-08-06) ───────────────
 * The 2026-08-03 launch (#1212) opened the /leaderboard page and GET
 * /api/leaderboard to every signed-in runner but LEFT THIS ROUTE admin-only.
 * The board therefore listed everyone while expanding any row 404'd for an
 * ordinary runner — which `LeaderboardTable` swallows into an empty drill, so
 * every row read "No runs yet." unless an admin was looking. Opening this gate
 * is what makes the launched board actually work.
 *
 * Anonymous callers still get a BARE 404 `Response` — never a 403/401, never a
 * body that advertises the route. Only the ADMIN requirement was dropped, not
 * the fail-closed posture. The elevation checks (`requireAdmin` + the
 * `revalidateAdmin` fresh-claims round-trip) still govern every OTHER admin
 * route; do not copy this simpler gate into one.
 *
 * ── What admin-ness still buys ─────────────────────────────────────────────
 * Exactly one thing: COVERT flag names. `isAdmin` is now the REAL session
 * check (`isMemberOf(session, ADMIN_GROUPS)`) instead of the hardcoded `true`
 * it could safely be while the route was admin-gated — leaving that literal in
 * place while opening the gate would have unmasked every covert challenge name
 * to every signed-in runner. It is deliberately the SYNC claim check with no
 * `revalidateAdmin` round-trip: this fires on every row expansion (con-critical
 * latency), and the worst case inside the ~5-min JWT staleness window is that a
 * just-revoked admin sees covert flag NAMES they already knew.
 *
 * Node runtime — the ElectroDB/AWS-SDK query pipeline needs Node crypto for
 * request signing. Force-dynamic — the gate + params are per-request. HTTP
 * `Cache-Control: private, max-age=60` (Task 5) mirrors the in-memory
 * per-user drill cache's 60s TTL; freshness beyond a stale entry is owned by
 * `bustDrillCache` (the reconcile route), not the CDN — `private` because the
 * response is viewer-scoped (covert masking depends on WHO asked) and must
 * never enter a shared/CDN cache.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  // ── Gate: signed-in (the board's own rule), anonymous → bare 404 ──────────
  const session = await auth();
  const viewerId = session?.user?.id;
  if (!viewerId) return NOT_FOUND();

  // ── Cached read → viewer-scoped CTF masking ────────────────────────────────
  const { userId } = await params;
  const data = await getCachedDrill(userId, () => loadDrill(userId));

  // Covert flag names are unmasked ONLY for the runner who solved them or an
  // admin. `isAdmin` must be the real check — see the header block: a hardcoded
  // `true` here would expose every covert challenge name to the whole board.
  const masked = {
    ...data,
    ctf: maskCtfLines(data.ctf, {
      isOwner: viewerId === userId,
      isAdmin: isMemberOf(session, ADMIN_GROUPS),
    }),
  };

  return Response.json(masked, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
