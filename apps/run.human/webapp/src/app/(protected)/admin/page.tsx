import { notFound } from "next/navigation";

import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { buildUserReport, summaryTiles } from "@/lib/admin-report";

import { AdminConsole, type MaskedRow } from "./AdminConsole";

/**
 * /admin — run.human user-management console (Phase 43 UX rework).
 *
 * Lives in the (protected) route group so it renders INSIDE the real run.human
 * chrome (glass-nav header, footer, map background) instead of the old
 * standalone dark page. This server component is only the gate + data spine: it
 * assembles the report, strips PII to MASKED rows, and hands them to the
 * <AdminConsole> client for the interactive table + drill-in drawer.
 *
 * ── Gate / non-disclosure (unchanged contract) ──────────────────────────────
 * EVERY denial → notFound() (404), never a 403, never the page. Admits members
 * of ADMIN_GROUPS (admin + runadmin). revalidateAdmin MUST be called with
 * `session.user.authUserId` (the OIDC sub) — NOT `session.user.id` (adapter uuid).
 *
 * ── PII ─────────────────────────────────────────────────────────────────────
 * The client payload carries emailMasked ONLY — full emails NEVER cross in bulk.
 * A full email reaches the browser one user at a time via the drawer's gated
 * /api/admin/users/[userId] fetch, or in the admin-only CSV export.
 *
 * Node runtime (AWS-SDK signing); force-dynamic (always a live scan).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** API base for client fetches / CSV: region-prefixed in prod, bare in dev. */
function apiBase(): string {
  return process.env.NODE_ENV === "production"
    ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || "use1"}`
    : "";
}

export default async function AdminUsersPage() {
  // ── Gate (fail-closed; every denial → 404) ────────────────────────────────
  const session = await auth();
  const gate = requireAdmin(session);
  if (!gate.ok) notFound();
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateAdmin(authUserId))) notFound();

  // ── Assemble → strip to masked rows (no full emails cross the wire) ────────
  const all = await buildUserReport();
  const rows: MaskedRow[] = all.map((r) => ({
    userId: r.userId,
    displayName: r.displayName,
    emailMasked: r.emailMasked,
    bibCode: r.bibCode,
    qrUrl: r.qrUrl,
    signedUpAt: r.signedUpAt,
    lastLoginAt: r.lastLoginAt,
    lastActivityAt: r.lastActivityAt,
    checkInCount: r.checkInCount,
    gpxRoutes: r.gpxRoutes,
    gpxSaves: r.gpxSaves,
    gpxShares: r.gpxShares,
    gpxUploads: r.gpxUploads,
    photoUploads: r.photoUploads,
    uploads: r.uploads,
    services: r.services,
  }));

  return (
    <AdminConsole
      rows={rows}
      summary={summaryTiles(all)}
      apiBase={apiBase()}
      adminEmail={gate.email}
    />
  );
}
