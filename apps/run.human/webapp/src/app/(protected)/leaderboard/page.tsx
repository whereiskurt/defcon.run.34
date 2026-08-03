import { notFound } from "next/navigation";

import { auth } from "@/config/auth";

import LeaderboardTable from "@/components/leaderboard/LeaderboardTable";

/**
 * /leaderboard — the HIDDEN admin ranked accordion (LDBR-11, Phase 52).
 *
 * Lives in the (protected) route group so it renders INSIDE the real run.human
 * chrome (glass-nav header, footer, map background). This server component is
 * only the gate: it admits signed-in runners and hands the region-aware
 * `apiBase` to the <LeaderboardTable> client, which owns every fetch + the
 * interactive board.
 *
 * ── LAUNCHED 2026-08-03 (Kurt) ───────────────────────────────────────────────
 * This board was admin-only and deliberately unlinked until the con. It is now
 * PUBLIC TO EVERY SIGNED-IN RUNNER and linked from the header nav (desktop) and
 * the mobile dropdown. `leaderboard-hidden.test.ts` — which proved the route
 * string was absent from every nav source — was RETIRED in the same change,
 * deliberately, because it existed to guard a property we intentionally gave up.
 * Do not resurrect it without also unlinking the nav.
 *
 * ── Gate / non-disclosure ────────────────────────────────────────────────────
 * EVERY denial → notFound() (404), never a 403, never the page. The ADMIN
 * requirement is gone but the fail-closed posture is not: an anonymous caller
 * still cannot tell the route exists. Note the (protected) segment is NOT itself
 * a gate — the session check here is what admits.
 *
 * ── currentUserId (own-row highlight) ────────────────────────────────────────
 * The board highlights the current admin's OWN row. That match is against
 * RunUser.userId, which equals `session.user.id` (the adapter uuid) per
 * 52-CONTEXT — so `currentUserId={session.user.id}` here is correct and is a
 * DIFFERENT value than the `authUserId` used for the gate above.
 *
 * Node runtime; force-dynamic (always a live gate + a live board).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** API base for client fetches: region-prefixed in prod, bare in dev. */
function apiBase(): string {
  return process.env.NODE_ENV === "production"
    ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || "use1"}`
    : "";
}

export default async function LeaderboardPage() {
  // ── Gate: SIGNED-IN, no longer admin-only (Kurt, 2026-08-03) ──────────────
  // The board went public for the con. It is still fail-closed for anonymous
  // callers and still 404s rather than 403s, so an unauthenticated probe cannot
  // tell the route exists — only the ADMIN requirement was dropped. Being in
  // the (protected) segment is not on its own a gate; check the session here.
  const session = await auth();
  if (!session?.user?.id) notFound();

  return (
    <div className="w-full space-y-3">
      <h1 className="text-2xl font-bold text-center">🥕 Leaderboard 🥕</h1>
      <LeaderboardTable currentUserId={session.user.id} apiBase={apiBase()} />
    </div>
  );
}
