import { notFound } from "next/navigation";

import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";

import LeaderboardTable from "@/components/leaderboard/LeaderboardTable";

/**
 * /leaderboard — the HIDDEN admin ranked accordion (LDBR-11, Phase 52).
 *
 * Lives in the (protected) route group so it renders INSIDE the real run.human
 * chrome (glass-nav header, footer, map background). This server component is
 * only the gate: it admits admins and hands the region-aware `apiBase` to the
 * <LeaderboardTable> client, which owns every fetch + the interactive board.
 *
 * ── Gate / non-disclosure (SC #1, mirrors (protected)/admin/page.tsx) ─────────
 * EVERY denial → notFound() (404), never a 403, never the page. Admits members
 * of ADMIN_GROUPS (admin + runadmin). revalidateAdmin MUST be called with
 * `session.user.authUserId` (the OIDC sub) — NOT `session.user.id` (the adapter
 * uuid): the Phase-43 identity landmine that would 404 a real admin.
 *
 * ── Hidden (SC #2) ───────────────────────────────────────────────────────────
 * This route is linked from NO navigation component — header, dropdown, or menu.
 * It is reachable by URL only until launch. leaderboard-hidden.test.ts proves the
 * route string is absent from every nav source under src/components/header/.
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
  // ── Gate (fail-closed; every denial → 404) ────────────────────────────────
  const session = await auth();
  const gate = requireAdmin(session);
  if (!gate.ok) notFound();
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateAdmin(authUserId))) notFound();

  return (
    <div className="w-full space-y-3">
      <h1 className="text-2xl font-bold text-center">🥕 Leaderboard 🥕</h1>
      <LeaderboardTable currentUserId={session.user.id} apiBase={apiBase()} />
    </div>
  );
}
