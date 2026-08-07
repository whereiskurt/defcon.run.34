import { auth } from "@/config/auth";
import { getCachedDrill } from "@/lib/leaderboard-drill-cache";
import { loadDrill } from "@/lib/leaderboard-drill-load";

/**
 * GET /api/leaderboard/[userId]/accomplishments — the leaderboard's lazy
 * per-runner drill-down (LDBR-08). The Phase-52 accordion expands one row and
 * fetches this to render that runner's runs (incl. route polylines), plus
 * (Task 5) a social-scan day rollup, named CTF capture lines and cluster
 * check-in bonuses.
 *
 * A thin shell over already-shipped code: the gate, the Phase-49
 * `getAccomplishmentsByUser` reader, and the Task-3/4/5 drill assembly. The
 * only real contract here is the 404 non-disclosure gate.
 *
 * The whole assembled payload (accomplishments + social + ctf + cluster) is
 * cached per-user via `getCachedDrill` (Task 3) — the reconcile route busts a
 * user's entry when their accomplishments change. The response is now the
 * cached value VERBATIM: there is no per-viewer transform left, so nothing can
 * bake one viewer's view into another's cache entry.
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
 * ── Admin-ness buys NOTHING here (Kurt, 2026-08-06) ────────────────────────
 * It briefly decided whether COVERT flag names were shown: a covert solve's
 * name was replaced by a generic "Covert flag" for anyone but the solver or an
 * admin. Kurt cut that the same day — the board is public for the con, four
 * distinct covert eggs all rendering as the same label read like one flag
 * awarded repeatedly, and the flag names are meant to be seen. Every signed-in
 * viewer now gets identical data, so there is no viewer branch left in this
 * handler at all.
 *
 * Node runtime — the ElectroDB/AWS-SDK query pipeline needs Node crypto for
 * request signing. Force-dynamic — the gate + params are per-request. HTTP
 * `Cache-Control: private, max-age=60` (Task 5) mirrors the in-memory
 * per-user drill cache's 60s TTL; freshness beyond a stale entry is owned by
 * `bustDrillCache` (the reconcile route), not the CDN. Still `private`: the
 * payload is one runner's activity behind a signed-in gate, and a shared/CDN
 * cache would serve it to anonymous callers the gate is meant to refuse.
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

  // ── Cached read ────────────────────────────────────────────────────────────
  // Returned verbatim: there is no longer a viewer-scoped transform, so the
  // cached value IS the response for every viewer (see the header block).
  const { userId } = await params;
  const data = await getCachedDrill(userId, () => loadDrill(userId));

  return Response.json(data, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
