import { auth } from "@/config/auth";
import { scanAllRunUsers } from "@/entities/run-user";
import { getCachedScan } from "@/lib/leaderboard-cache";
import { buildLeaderboard } from "@/lib/leaderboard-data";

/**
 * GET /api/leaderboard — the main (hidden) admin-gated board (LDBR-07).
 *
 * A thin shell: gate → cached full-table `RunUser` scan → the pure
 * `buildLeaderboard` (ranks over the FULL sorted set, then filters/paginates) →
 * JSON `{ rows, total, page, limit }`. All the real work lives in already-shipped
 * pure code — this handler only gates, parses params, and wires the cache to the
 * assembler.
 *
 * ── Gate (non-disclosure) ───────────────────────────────────────────────────
 * LAUNCHED 2026-08-03 (Kurt): admin-only → every SIGNED-IN runner, alongside the
 * /leaderboard page and the new header nav entry.
 *
 * Every denial still returns a BARE 404 `Response` — never a 403/401, never a
 * body that advertises the route. Only the admin requirement was dropped; an
 * anonymous caller is still told nothing.
 *
 * The Phase-43 identifier landmine no longer applies HERE (no revalidateAdmin
 * call left), but it still governs every other admin route: revalidateAdmin
 * takes `session.user.authUserId` (the OIDC sub), NOT `session.user.id` (the
 * adapter uuid). Do not copy this file's simpler gate into an admin route.
 *
 * ── DoS (T-51-08) ──────────────────────────────────────────────────────────
 * The scan runs behind a 60s stale-while-revalidate cache (`getCachedScan`) that
 * single-flights refreshes and NEVER blocks a request on the scan, bounding scan
 * frequency regardless of request volume.
 *
 * Node runtime — the ElectroDB/AWS-SDK scan pipeline needs Node crypto for
 * request signing. Force-dynamic — the gate + params are per-request.
 * `Cache-Control: private, max-age=30` (Task 5): a short private browser-side
 * cache on top of the in-memory 60s scan cache — private because the payload
 * is admin-only, never a shared/CDN cache.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

const DEFAULT_LIMIT = 25;

export async function GET(request: Request) {
  // ── Gate: SIGNED-IN, no longer admin-only (Kurt, 2026-08-03) ──────────────
  // Opened for the con along with the /leaderboard page and the header nav
  // entry. Anonymous callers still get a BARE 404 (never 403, never a body that
  // advertises the route) — only the admin requirement was dropped, not the
  // fail-closed posture.
  const session = await auth();
  if (!session?.user?.id) return NOT_FOUND();

  // ── Params ──────────────────────────────────────────────────────────────
  const url = new URL(request.url);
  const page = Math.max(
    1,
    Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1
  );
  const limit = Math.max(
    1,
    Number.parseInt(url.searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) ||
      DEFAULT_LIMIT
  );
  const filter = url.searchParams.get("filter") ?? "";
  // "named only" — keep runners who have set a name (not the rabbit_ default).
  // Neutral (off) by default at the API; the board turns it ON by default.
  const namedParam = url.searchParams.get("named");
  const namedOnly = namedParam === "1" || namedParam === "true";

  // ── Cached scan → rank/paginate → JSON ─────────────────────────────────────
  // RunUserItem[] is assignable to LeaderboardUser[] (CTF fields optional), so
  // the scan rows pass straight into buildLeaderboard with no cast.
  const users = await getCachedScan(scanAllRunUsers);
  const result = buildLeaderboard(users, { page, limit, filter, namedOnly });

  return Response.json(result, {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}
