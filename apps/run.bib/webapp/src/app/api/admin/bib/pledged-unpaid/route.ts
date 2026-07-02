import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { Bib } from "@/entities/bib";
import { requireAdmin } from "@/lib/admin-gate";

/**
 * GET /api/admin/bib/pledged-unpaid — Phase 22-05-07 admin report.
 *
 * Returns all bibs where `willPayInPerson === true AND paidAmount === 0`.
 * These are participants who registered, pledged to pay at defcon.run 34
 * in person, but have not yet been reconciled via Stripe / Venmo /
 * CashApp. Kurt / Jesse use the list to prepare cash / card intake at
 * the event.
 *
 * Auth model (Option A per PLAN-22-05.md §22-05-07; Kurt 2026-07-02
 * email + container-cache correction):
 *   - Session required (401 if missing).
 *   - `session.user.email` must be in the SSM allowlist at
 *     /dc34/secrets/use1/bib/admin/allowlist (403 if missing).
 *   - Allowlist read ONCE at first call and cached at module scope for
 *     the container's lifetime; rotating an admin off requires a
 *     container restart (i.e., a redeploy).
 *
 * Response shape:
 *   { count: number, bibs: Array<{ ownerSub, nameOnBib, runnerCode, createdAt }> }
 *
 * Uses ElectroDB scan with an inline where-filter. Scans are O(n) over
 * the whole electro-table but the bib row-count is bounded (single
 * thousands MAX at defcon.run 34 attendance forecast), so this is fine at
 * v1.5. A future v1.6 could add a byWillPayInPerson GSI if scan latency
 * becomes a problem.
 *
 * Runtime pinned to Node.js because the ElectroDB scan pipeline needs
 * Node crypto for AWS SDK request signing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Minimal shape of a Bib row after projection. Keeps the response body
 * lean (no paidStatusHistory, no runnerCodeSk, no updatedAt) and avoids
 * leaking any admin-only bookkeeping.
 */
type PledgedBibRow = {
  ownerSub: string;
  nameOnBib: string;
  runnerCode: string;
  createdAt: string;
};

export async function GET() {
  const session = await auth();
  const gate = await requireAdmin(session);
  if (!gate.ok) {
    if (gate.reason === "no_session") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    // Deliberately opaque body — don't leak "allowlist exists but you're
    // not on it" vs. "allowlist misconfigured". Both are just 403.
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const result = await Bib.scan
      .where(({ willPayInPerson, paidAmount }, { eq }) => {
        return `${eq(willPayInPerson, true)} AND ${eq(paidAmount, 0)}`;
      })
      .go();

    const bibs: PledgedBibRow[] = result.data.map((row) => ({
      ownerSub: row.ownerSub,
      nameOnBib: row.nameOnBib ?? "",
      runnerCode: row.runnerCode,
      createdAt: row.createdAt ?? "",
    }));

    return NextResponse.json(
      { count: bibs.length, bibs },
      { status: 200 }
    );
  } catch (err) {
    console.error(
      "[run.bib] /api/admin/bib/pledged-unpaid: scan failed:",
      err
    );
    return NextResponse.json(
      { error: "scan_failed" },
      { status: 500 }
    );
  }
}
