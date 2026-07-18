import { z } from "zod";
import { auth } from "@/config/auth";
import { requireBibAdmin } from "@/lib/admin-gate";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { invalidateBib } from "@/lib/report-cache";
import { applyPayment, getBib } from "@/entities/bib";
import { recordDonation, getDonation } from "@/entities/general-donation";
import { clearPendingById } from "@/entities/pending-contribution";

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
 * The response carries `deduped` (WR-01): pendingId embeds the ORIGINAL amount,
 * so re-approving an EDITED amount reuses the same marker/PK and the write is a
 * no-op that keeps the first-recorded amount. `deduped: true` tells AdminActions
 * to surface "already reconciled — amount unchanged" instead of a false success.
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
  // IN-03: cap at $10k (1_000_000 cents) so a fat-fingered extra digit is
  // rejected 400 rather than booked straight into the money ledger. Admin-gated,
  // so this is a guardrail against typos, not a security boundary.
  amountCents: z.number().int().positive().max(10_000_00),
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

  const { pendingId, ownerSub, kind, provider, amountCents } = parsed.data;
  const reconciled_via = `admin_manual_${pendingId}`;

  try {
    // Detect the idempotent no-op BEFORE the write so we can tell the admin
    // their edit did NOT land (WR-01). pendingId embeds the ORIGINAL amount, so
    // re-approving an edited amount reuses the same marker/PK and silently keeps
    // the first-recorded amount — the admin needs an explicit signal, not a
    // false success.
    let deduped = false;
    if (kind === "bib") {
      const existing = await getBib(ownerSub);
      deduped = (existing?.paidStatusHistory ?? []).some(
        (row) => row?.reconciled_via === reconciled_via
      );
      await applyPayment(ownerSub, {
        provider,
        amount_cents: amountCents,
        reconciled_via,
        // Clear ONLY the reconciled intent below — do NOT let applyPayment wipe
        // the whole (owner, bib, provider) bucket (WR-01).
        skipPendingClear: true,
      });
    } else {
      // donationId is recordDonation's REQUIRED deterministic PK — idempotency
      // is keyed on it (duplicate → ConditionalCheckFailed → read-back), NOT on
      // reconciledVia (provenance only). Reuse admin_manual_<pendingId> so a
      // re-tapped Approve dedupes.
      const donationId = `admin_manual_${pendingId}`;
      deduped = (await getDonation(donationId)) !== null;
      await recordDonation({
        donationId,
        ownerSub,
        amountCents,
        provider,
        reconciledVia: reconciled_via,
      });
    }

    // Best-effort: drop ONLY this reconciled pending intent (targeted by its
    // deterministic pendingId) so the ledger row doesn't double-count in the UI
    // — a second same-provider intent for a different amount must survive on the
    // dashboard (WR-01). A cleanup miss is cosmetic and must never fail reconcile.
    await clearPendingById(pendingId).catch(() => {});

    // `deduped: true` means the marker already existed — the write was a no-op
    // and the amount was NOT changed. AdminActions surfaces this so an admin
    // correcting an amount knows the correction did not apply.
    invalidateBib(ownerSub);
    return Response.json({ ok: true, deduped }, { status: 200 });
  } catch (err) {
    // Do NOT log the request body (payment intent details) or the internal
    // secret — only the error itself.
    console.error("[run.bib] /api/admin/bib/reconcile:", err);
    return Response.json({ error: "reconcile_failed" }, { status: 500 });
  }
}
