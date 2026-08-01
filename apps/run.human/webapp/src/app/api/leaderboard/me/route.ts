import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { LEADERBOARD_SELF_ENABLED } from "@/lib/leaderboard-launch";
import { scanAllRunUsers } from "@/entities/run-user";
import { getCachedScan } from "@/lib/leaderboard-cache";
import { buildLeaderboard } from "@/lib/leaderboard-data";
import { getCachedDrill } from "@/lib/leaderboard-drill-cache";
import { loadDrill } from "@/lib/leaderboard-drill-load";
import { maskCtfLines } from "@/lib/leaderboard-drill";

/**
 * GET /api/leaderboard/me — the SELF-SCOPED standing behind the profile's
 * "Leaderboard" button ("Your standing" modal).
 *
 * Returns the caller's OWN leaderboard row — with a true GLOBAL rank computed
 * over every runner — plus their own drill (runs / social / CTF). It is a thin
 * shell over already-shipped code: the same cached full-table scan and the same
 * pure `buildLeaderboard` the admin board uses, then a single-row pick.
 *
 * ── Self-scoped BY CONSTRUCTION (the core security property) ────────────────
 * This handler accepts NO `userId` parameter — not in the path, not in the
 * query. The identity comes solely from `session.user.id`. There is therefore
 * no input that could aim it at another runner, and the response carries
 * exactly one row. The full multi-runner board stays behind its own,
 * independent admin gate at `GET /api/leaderboard`; nothing here relaxes it.
 *
 * ── Gate (non-disclosure, mirrors the admin board) ──────────────────────────
 * Access = `LEADERBOARD_SELF_ENABLED || admin`. Every denial returns a BARE
 * 404 `Response` — never a 403/401, never a body — so before launch a
 * non-admin cannot distinguish this route from one that does not exist:
 *   1. no session                                   -> 404
 *   2. flag off AND requireAdmin fails              -> 404
 *   3. flag off, admin, but no authUserId (OIDC sub)-> 404
 *   4. flag off, admin, live claims revoked         -> 404
 *
 * IDENTIFIER LANDMINE (Phase 43): the admin path's `revalidateAdmin` MUST be
 * called with `session.user.authUserId` (the auth.defcon.run OIDC sub) — NOT
 * `session.user.id`, the Auth.js DynamoDB-adapter local uuid. The run.auth
 * validate endpoint is keyed by the OIDC sub; the adapter id silently fails the
 * claims lookup and would 404 a real admin.
 *
 * The row lookup uses the OPPOSITE identifier: leaderboard rows are keyed by
 * `RunUser.userId`, which equals `session.user.id` (the adapter uuid). Both
 * identifiers appear in this file on purpose and are NOT interchangeable.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 * Ranking needs the full set, so this rides the SAME 60s stale-while-revalidate
 * `getCachedScan` the board uses — a self-standing request adds no new scan
 * pressure. The drill rides the per-user `getCachedDrill` (60s), busted by the
 * reconcile route when a runner's accomplishments change.
 *
 * Node runtime (the ElectroDB/AWS-SDK pipeline needs Node crypto for request
 * signing); force-dynamic (the gate + identity are per-request);
 * `Cache-Control: private, max-age=30` — private because the payload is one
 * runner's own data and must never enter a shared/CDN cache.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

/** Rank over EVERYONE, so the caller's `globalRank` is a true global rank. */
const RANK_OVER_EVERYONE = { page: 1, limit: Number.MAX_SAFE_INTEGER };

export async function GET() {
  // ── Gate ──────────────────────────────────────────────────────────────────
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NOT_FOUND();

  if (!LEADERBOARD_SELF_ENABLED) {
    // Pre-launch: admins only, with the live fresh-claims check so a
    // just-revoked admin cannot linger inside the ~5-min JWT staleness window.
    if (!requireAdmin(session).ok) return NOT_FOUND();
    const authUserId = session?.user?.authUserId;
    if (!authUserId || !(await revalidateAdmin(authUserId))) return NOT_FOUND();
  }

  // ── Rank over the full set, then pick THIS caller's row ───────────────────
  const users = await getCachedScan(scanAllRunUsers);
  const { rows } = buildLeaderboard(users, RANK_OVER_EVERYONE);
  const row = rows.find((r) => r.userId === userId) ?? null;

  // A runner with no scored activity yet simply has no row. That is a normal
  // 200 with `row: null` (the modal shows an empty state), NOT an error — and
  // NOT a 404, which is reserved for the gate.
  if (!row) {
    return Response.json(
      { row: null, total: rows.length, accomplishments: [], social: { days: [], egg: null }, ctf: [] },
      { headers: { "Cache-Control": "private, max-age=30" } }
    );
  }

  // ── Own drill ─────────────────────────────────────────────────────────────
  // The caller IS the subject, so `isOwner` is true — they see their own covert
  // CTF names unmasked. Routed through maskCtfLines anyway (rather than
  // skipped) so the seam can never be silently forgotten.
  const drill = await getCachedDrill(userId, () => loadDrill(userId));

  return Response.json(
    {
      row,
      total: rows.length,
      accomplishments: drill.accomplishments,
      social: drill.social,
      ctf: maskCtfLines(drill.ctf, { isOwner: true, isAdmin: false }),
    },
    { headers: { "Cache-Control": "private, max-age=30" } }
  );
}
