import { z } from "zod";
import { auth } from "@/config/auth";
import { requireBibAdmin } from "@/lib/admin-gate";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { applyPayment, getBib } from "@/entities/bib";

/**
 * POST /api/admin/bib/mark-paid — in-person cash reconcile (Kurt 2026-07-05).
 *
 * A runner who pledged "I'll give $20 in person" hands the organizer cash at
 * the event. The admin taps "PAID" beside their row on the Outstanding +
 * in-person table, and this route books the payment: it applies `amountCents`
 * (default the $20 bib price) to the bib's `paidAmount` with provider "cash".
 *
 * Effect on the dashboard: the bib now has paidAmount ≥ $20, so it drops off
 * the Outstanding list (the in-person filter is `willPayInPerson && paid === 0`)
 * and its $20 shows up in Payments / revenue + the collected totals.
 *
 * Idempotent by a deterministic `reconciled_via` marker per owner: a
 * double-tapped PAID is a no-op (applyPayment dedupes on the marker), so the
 * cash is booked exactly once. Admin-gated (D-02 pattern). Node runtime for
 * ElectroDB / AWS SDK signing; force-dynamic — a live mutation, never cached.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  ownerSub: z.string().min(1),
  // Defaults to the $20 bib price; capped at $10k so a fat-fingered digit 400s
  // rather than booking straight into the ledger (mirrors the reconcile route).
  amountCents: z.number().int().positive().max(10_000_00).default(2000),
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

  const { ownerSub, amountCents } = parsed.data;
  // One in-person cash reconcile per bib — deterministic so a re-tapped PAID is
  // an idempotent no-op (applyPayment dedupes on this marker).
  const reconciled_via = `admin_inperson_cash_${ownerSub}`;

  try {
    const existing = await getBib(ownerSub);
    if (!existing) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const deduped = (existing.paidStatusHistory ?? []).some(
      (row) => row?.reconciled_via === reconciled_via
    );

    await applyPayment(ownerSub, {
      provider: "cash",
      amount_cents: amountCents,
      reconciled_via,
    });

    return Response.json({ ok: true, deduped }, { status: 200 });
  } catch (err) {
    console.error("[run.bib] /api/admin/bib/mark-paid:", err);
    return Response.json({ error: "mark_paid_failed" }, { status: 500 });
  }
}
