import { z } from "zod";
import { auth } from "@/config/auth";
import { requireBibAdmin } from "@/lib/admin-gate";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { invalidateBib, invalidateReports } from "@/lib/report-cache";
import { denyPendingById } from "@/entities/pending-contribution";

/**
 * POST /api/admin/bib/deny-pending — Kurt 2026-07-11.
 *
 * Organizer-only. Soft-denies a fake/unwanted pending Venmo/Cash App intent
 * shown in the Outstanding table (beside "Approve"). Sets deniedAt/deniedBy on
 * the PendingContribution row so it drops off the outstanding list but stays
 * auditable. Does NOT restore donation quota — a denied attempt still counts.
 *
 * Node runtime — ElectroDB/AWS signing needs Node crypto. Force-dynamic — a live
 * mutation, never cached. Gated on the bibadmin/admin group claim.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ pendingId: z.string().min(1) });

export async function POST(req: Request) {
  const session = await auth();
  const gate = requireBibAdmin(session);
  if (!gate.ok) {
    const status = gate.reason === "no_session" ? 401 : 403;
    return new Response(
      gate.reason === "no_session" ? "unauthorized" : "forbidden",
      { status }
    );
  }
  if (await assertNotLockedLive(session?.user?.id)) {
    return Response.json({ error: "Account locked out" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    await denyPendingById(parsed.data.pendingId, gate.email ?? "admin");
    // pendingId = "pending:{ownerSub}:{kind}:{provider}:{amt}" — index [1] is
    // the ownerSub. Invalidate that runner's cache too; fall back to the admin
    // aggregate alone if the id doesn't parse.
    const deniedOwnerSub = parsed.data.pendingId.split(":")[1];
    if (deniedOwnerSub) invalidateBib(deniedOwnerSub);
    else invalidateReports();
    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    // Do not log the pending intent details — only the error.
    console.error("[run.bib] /api/admin/bib/deny-pending:", err);
    return Response.json({ error: "deny_failed" }, { status: 500 });
  }
}
