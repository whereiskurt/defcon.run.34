import { z } from "zod";
import { auth } from "@/config/auth";
import { requireAdmin } from "@/lib/admin-gate";
import { applyPayment } from "@/entities/bib";
import { recordDonation } from "@/entities/general-donation";
import { clearPendingForOwner } from "@/entities/pending-contribution";

/**
 * POST /api/admin/bib/reconcile — v1.8 Phase 34 (Kurt 2026-07-04).
 *
 * Organizer-only endpoint to manually reconcile a pending Venmo / Cash App
 * intent surfaced on the /admin dashboard. The admin taps "Approve" beside a
 * pending-intent row (optionally editing the amount), and this route applies
 * the payment to the ledger.
 *
 * Idempotency is per-kind and keyed on the pending intent's id:
 *   - kind="bib"      → applyPayment(..., reconciled_via = admin_manual_<pendingId>)
 *                       dedupes on the reconciled_via marker (a re-tapped
 *                       Approve is a no-op).
 *   - kind="donation" → recordDonation({ donationId: admin_manual_<pendingId> })
 *                       dedupes on the donationId PK (ConditionalCheckFailed →
 *                       read-back). reconciledVia carries provenance only.
 *
 * Node runtime — ElectroDB / AWS SDK signing needs Node crypto. Force-dynamic —
 * a live mutation, never cached. Gated on the "admin" group claim (D-02).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  pendingId: z.string().min(1),
  ownerSub: z.string().min(1),
  kind: z.enum(["bib", "donation"]),
  provider: z.enum(["venmo", "cashapp"]),
  amountCents: z.number().int().positive(),
});

export async function POST(req: Request) {
  const gate = requireAdmin(await auth());
  if (!gate.ok) {
    const status = gate.reason === "no_session" ? 401 : 403;
    return new Response(
      gate.reason === "no_session" ? "unauthorized" : "forbidden",
      { status }
    );
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

  const { pendingId, ownerSub, kind, provider, amountCents } = parsed.data;
  const reconciled_via = `admin_manual_${pendingId}`;

  try {
    if (kind === "bib") {
      await applyPayment(ownerSub, {
        provider,
        amount_cents: amountCents,
        reconciled_via,
      });
    } else {
      // donationId is recordDonation's REQUIRED deterministic PK — idempotency
      // is keyed on it (duplicate → ConditionalCheckFailed → read-back), NOT on
      // reconciledVia (provenance only). Reuse admin_manual_<pendingId> so a
      // re-tapped Approve dedupes.
      await recordDonation({
        donationId: `admin_manual_${pendingId}`,
        ownerSub,
        amountCents,
        provider,
        reconciledVia: reconciled_via,
      });
    }

    // Best-effort: drop the pending hint so the ledger row doesn't double-count
    // in the UI. A cleanup miss is cosmetic and must never fail reconcile.
    await clearPendingForOwner(ownerSub, kind, provider).catch(() => {});

    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    // Do NOT log the request body (payment intent details) or the internal
    // secret — only the error itself.
    console.error("[run.bib] /api/admin/bib/reconcile:", err);
    return Response.json({ error: "reconcile_failed" }, { status: 500 });
  }
}
