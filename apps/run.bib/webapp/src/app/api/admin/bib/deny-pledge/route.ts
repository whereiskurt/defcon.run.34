import { z } from "zod";
import { auth } from "@/config/auth";
import { requireBibAdmin } from "@/lib/admin-gate";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { updateBibWillPayInPerson } from "@/entities/bib";

/**
 * POST /api/admin/bib/deny-pledge — Kurt 2026-07-12.
 *
 * Organizer-only. Soft-denies a runner's in-person pledge shown in the
 * Outstanding table (beside "Approve"). Clears willPayInPerson (=false) so the
 * row drops off the outstanding list. The bib, name, and quota are untouched —
 * the runner can re-pledge later. NOT the destructive roster Reject (delete).
 *
 * Node runtime — ElectroDB/AWS signing needs Node crypto. Force-dynamic — a live
 * mutation, never cached. Gated on the bibadmin/admin group claim.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ ownerSub: z.string().min(1) });

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
    await updateBibWillPayInPerson(parsed.data.ownerSub, false);
    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    // Do not log the request body — only the error.
    console.error("[run.bib] /api/admin/bib/deny-pledge:", err);
    return Response.json({ error: "deny_pledge_failed" }, { status: 500 });
  }
}
