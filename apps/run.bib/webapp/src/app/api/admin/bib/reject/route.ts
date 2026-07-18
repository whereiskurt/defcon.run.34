import { z } from "zod";
import { auth } from "@/config/auth";
import { requireBibAdmin } from "@/lib/admin-gate";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { invalidateBib } from "@/lib/report-cache";
import { Bib } from "@/entities/bib";
import {
  clearPendingForOwner,
  type PendingKind,
  type PendingProvider,
} from "@/entities/pending-contribution";
import { getUserQuotas, restoreQuota } from "@/lib/quota-client";

/**
 * POST /api/admin/bib/reject — v1.8 Phase 34 (Kurt 2026-07-04).
 *
 * Organizer-only endpoint to reject / reset a runner's bib from the /admin
 * roster. Deletes the bib, clears that owner's pending Venmo / Cash App intents
 * (bib + donation kinds), and restores their `bibname_change` quota to full.
 * Donations are KEPT (they are ledger history). Revisiting the site auto-creates
 * a fresh, clean bib for the runner (D-01 auto-create-on-visit unchanged).
 *
 * ownerSub is the Bib PK, exposed only on the admin-only roster (D-04). The
 * quota reset is wrapped in its own try/catch so a quota-service blip can never
 * wedge the delete path (T-34-04).
 *
 * Node runtime — ElectroDB / AWS SDK signing needs Node crypto. Force-dynamic —
 * a live mutation, never cached. Gated on the "admin" group claim.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  ownerSub: z.string().min(1),
});

const PENDING_KINDS: PendingKind[] = ["bib", "donation"];
const PENDING_PROVIDERS: PendingProvider[] = ["venmo", "cashapp"];

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

  const { ownerSub } = parsed.data;

  try {
    // 1. Delete the bib (fixed-SK primary key on ownerSub).
    await Bib.delete({ ownerSub }).go();

    // 2. Clear the owner's pending intents across both kinds × both providers.
    //    Best-effort — a stale pending hint is cosmetic and self-heals.
    for (const kind of PENDING_KINDS) {
      for (const provider of PENDING_PROVIDERS) {
        await clearPendingForOwner(ownerSub, kind, provider).catch(() => {});
      }
    }

    // 3. Reset the name-change quota to full. Isolated try/catch: a quota
    //    failure must never abort the delete (T-34-04).
    try {
      const q = await getUserQuotas(ownerSub);
      const bnc = q.quotas.find((x) => x.quotaId === "bibname_change");
      if (bnc && bnc.totalConsumed > 0) {
        await restoreQuota(ownerSub, "bibname_change", bnc.totalConsumed);
      }
    } catch (quotaErr) {
      console.warn("[run.bib] /api/admin/bib/reject: quota reset failed:", quotaErr);
    }

    invalidateBib(ownerSub);
    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    // Do NOT log the request body or the internal secret — only the error.
    console.error("[run.bib] /api/admin/bib/reject:", err);
    return Response.json({ error: "reject_failed" }, { status: 500 });
  }
}
