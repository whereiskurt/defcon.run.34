import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
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
 * ── Gate (T-51-06 / T-51-07, non-disclosure) ────────────────────────────────
 * Every denial returns a BARE 404 `Response` — never a 403/401, never a body
 * that advertises the route. Three denial paths all collapse to 404:
 *   1. requireAdmin fails (no session / not an admin group),
 *   2. session.user.authUserId (the OIDC sub) is missing,
 *   3. revalidateAdmin(authUserId) fails the live fresh-claims check.
 *
 * IDENTIFIER LANDMINE (Phase 43): revalidateAdmin MUST be called with
 * `session.user.authUserId` (the auth.defcon.run OIDC sub) — NOT
 * `session.user.id`, the Auth.js DynamoDB-adapter local uuid. The run.auth
 * validate endpoint is keyed by the OIDC sub; the adapter id silently fails the
 * claims lookup and 404s a real admin.
 *
 * ── DoS (T-51-08) ──────────────────────────────────────────────────────────
 * The scan runs behind a 60s stale-while-revalidate cache (`getCachedScan`) that
 * single-flights refreshes and NEVER blocks a request on the scan, bounding scan
 * frequency regardless of request volume.
 *
 * Node runtime — the ElectroDB/AWS-SDK scan pipeline needs Node crypto for
 * request signing. Force-dynamic — the gate + params are per-request. HTTP
 * `no-store`: freshness is owned by the in-memory 60s cache, not the CDN.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

const DEFAULT_LIMIT = 25;

export async function GET(request: Request) {
  // ── Gate ──────────────────────────────────────────────────────────────────
  const session = await auth();
  const gate = requireAdmin(session);
  if (!gate.ok) return NOT_FOUND();

  // Fresh-claims revalidation keyed by the OIDC sub (NOT the adapter id).
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateAdmin(authUserId))) return NOT_FOUND();

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

  // ── Cached scan → rank/paginate → JSON ─────────────────────────────────────
  // RunUserItem[] is assignable to LeaderboardUser[] (CTF fields optional), so
  // the scan rows pass straight into buildLeaderboard with no cast.
  const users = await getCachedScan(scanAllRunUsers);
  const result = buildLeaderboard(users, { page, limit, filter });

  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
