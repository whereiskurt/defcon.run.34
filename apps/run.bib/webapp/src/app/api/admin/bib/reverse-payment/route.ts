import { z } from "zod";
import { auth } from "@/config/auth";
import { requireBibAdmin } from "@/lib/admin-gate";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { reverseCashPayment } from "@/entities/bib";

/**
 * POST /api/admin/bib/reverse-payment — Kurt 2026-07-11.
 *
 * Organizer-only. Reverses a mistaken CASH payment booked via the in-person
 * PAID button: subtracts the amount from paidAmount and deletes the exact
 * paidStatusHistory entry. Cash-only is enforced in reverseCashPayment (the
 * provider="cash" match), so a stripe/venmo target is a safe no-op.
 *
 * Node runtime — ElectroDB/AWS signing needs Node crypto. Force-dynamic — a live
 * mutation, never cached. Gated on the bibadmin/admin group claim.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  ownerSub: z.string().min(1),
  timestamp: z.string().min(1),
  reconciledVia: z.string().min(1),
});

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
    const { ownerSub, timestamp, reconciledVia } = parsed.data;
    const result = await reverseCashPayment(ownerSub, { timestamp, reconciledVia });
    return Response.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    // Do not log the request body — only the error.
    console.error("[run.bib] /api/admin/bib/reverse-payment:", err);
    return Response.json({ error: "reverse_failed" }, { status: 500 });
  }
}
