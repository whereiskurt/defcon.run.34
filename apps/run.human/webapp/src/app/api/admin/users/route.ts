import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import {
  buildUserReport,
  filterByEmail,
  sortRows,
  summaryTiles,
  toCsv,
  type ReportSort,
  type UserReportRow,
} from "@/lib/admin-report";

/**
 * GET /api/admin/users — Phase 43 admin reporting endpoint (ADMN-02..07).
 *
 * Feeds BOTH the dashboard (masked JSON: search/sort/paginate + per-row reveal)
 * and the CSV export (?format=csv → full emails/QR/bib behind the same gate).
 *
 * ── Gate (T-43-01 / T-43-02, non-disclosure) ────────────────────────────────
 * Every denial returns a BARE 404 `Response` — never a 403, never a body that
 * advertises the route. Three denial paths all collapse to 404:
 *   1. requireAdmin fails (no session / not "admin" group),
 *   2. session.user.authUserId (the OIDC sub) is missing,
 *   3. revalidateAdmin(authUserId) fails the live fresh-claims check.
 *
 * IDENTIFIER LANDMINE: revalidateAdmin MUST be called with
 * `session.user.authUserId` (the auth.defcon.run OIDC sub) — NOT
 * `session.user.id`, which is the Auth.js DynamoDB-adapter local uuid. The
 * run.auth validate endpoint is keyed by the OIDC sub; passing the adapter id
 * silently fails the claims lookup and 404s a real admin.
 *
 * ── PII (T-43-03) ───────────────────────────────────────────────────────────
 * JSON masks emails; the FULL email appears only for the single row whose userId
 * equals `?reveal=`. The CSV carries full data but only behind this gate + no-store.
 *
 * Node runtime — the ElectroDB/AWS-SDK scan pipeline needs Node crypto for
 * request signing. Force-dynamic — always a live scan, never cached.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

const SORTS: ReportSort[] = ["lastActivity", "gpxUsage", "signup"];

/** CSV columns — full data, ISO timestamps. */
const CSV_COLUMNS: { key: string; header: string }[] = [
  { key: "displayName", header: "Display Name" },
  { key: "userId", header: "User ID" },
  { key: "email", header: "Email" },
  { key: "bibCode", header: "Bib Code" },
  { key: "qrUrl", header: "Runner QR URL" },
  { key: "signedUpAt", header: "Signed Up" },
  { key: "lastLoginAt", header: "Last Login" },
  { key: "lastActivityAt", header: "Last Activity" },
  { key: "checkInCount", header: "Check-ins" },
  { key: "gpxRoutes", header: "GPX Routes" },
  { key: "gpxSaves", header: "GPX Saves" },
  { key: "gpxShares", header: "GPX Shares" },
  { key: "uploads", header: "Uploads" },
];

const iso = (ts: number | null): string => (ts ? new Date(ts).toISOString() : "");

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
  const format = url.searchParams.get("format");
  const q = url.searchParams.get("q") ?? "";
  const reveal = url.searchParams.get("reveal");
  const sortParam = url.searchParams.get("sort");
  const sort: ReportSort = SORTS.includes(sortParam as ReportSort)
    ? (sortParam as ReportSort)
    : "lastActivity";
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    500,
    Math.max(1, Number.parseInt(url.searchParams.get("pageSize") ?? "50", 10) || 50)
  );

  // ── Assemble → filter → sort (the current view) ────────────────────────────
  const all = await buildUserReport();
  const view = sortRows(filterByEmail(all, q), sort);

  // ── CSV: the FULL filtered/sorted set, full emails + ISO timestamps ────────
  if (format === "csv") {
    const csv = toCsv(
      CSV_COLUMNS,
      view.map((r) => ({
        displayName: r.displayName,
        userId: r.userId,
        email: r.emailFull ?? "",
        bibCode: r.bibCode ?? "",
        qrUrl: r.qrUrl,
        signedUpAt: iso(r.signedUpAt),
        lastLoginAt: iso(r.lastLoginAt),
        lastActivityAt: iso(r.lastActivityAt),
        checkInCount: r.checkInCount,
        gpxRoutes: r.gpxRoutes,
        gpxSaves: r.gpxSaves,
        gpxShares: r.gpxShares,
        uploads: r.uploads,
      }))
    );
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="run-users-${today}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // ── JSON: masked page slice; full email only for the explicitly revealed row ─
  const total = view.length;
  const start = (page - 1) * pageSize;
  const slice = view.slice(start, start + pageSize);

  const rows = slice.map((r: UserReportRow) => {
    const revealed = reveal != null && reveal === r.userId;
    return {
      displayName: r.displayName,
      userId: r.userId,
      // NEVER serialize an unrevealed full email: masked by default, full only
      // for the one explicitly requested row.
      email: revealed ? r.emailFull : r.emailMasked,
      revealed,
      bibCode: r.bibCode,
      qrUrl: r.qrUrl,
      signedUpAt: r.signedUpAt,
      lastLoginAt: r.lastLoginAt,
      lastActivityAt: r.lastActivityAt,
      checkInCount: r.checkInCount,
      gpxRoutes: r.gpxRoutes,
      gpxSaves: r.gpxSaves,
      gpxShares: r.gpxShares,
      uploads: r.uploads,
    };
  });

  return Response.json(
    {
      rows,
      total,
      page,
      pageSize,
      sort,
      summary: summaryTiles(all),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
