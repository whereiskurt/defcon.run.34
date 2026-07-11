import { auth } from "@/config/auth";
import { requireBibAdmin } from "@/lib/admin-gate";
import {
  loadReports,
  reportToCsv,
  type ReportType,
} from "@/lib/admin-reports";

/**
 * GET /api/admin/bib/report/{type} — v1.6 admin CSV export.
 *
 * type ∈ print-names | payments | outstanding | registrations. Gated on the
 * "admin" group claim (same as the /admin page). Returns text/csv as an
 * attachment for the print / finance handoff.
 *
 * Node runtime — the ElectroDB scan pipeline needs Node crypto for AWS SDK
 * request signing. Force-dynamic — always a live scan, never cached.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID: ReportType[] = [
  "print-names",
  "payments",
  "outstanding",
  "registrations",
];

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ type: string }> }
) {
  const session = await auth();
  const gate = requireBibAdmin(session);
  if (!gate.ok) {
    const status = gate.reason === "no_session" ? 401 : 403;
    return new Response(gate.reason === "no_session" ? "unauthorized" : "forbidden", {
      status,
    });
  }

  const { type } = await ctx.params;
  if (!VALID.includes(type as ReportType)) {
    return new Response("unknown report", { status: 404 });
  }

  try {
    const bundle = await loadReports();
    const csv = reportToCsv(bundle, type as ReportType);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bib-${type}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[run.bib] /api/admin/bib/report:", err);
    return new Response("report_failed", { status: 500 });
  }
}
