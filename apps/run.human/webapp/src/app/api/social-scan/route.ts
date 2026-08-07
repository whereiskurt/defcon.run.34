import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { isQrAdmin } from "@/lib/admin-gate";
import { judgeScan, defaultScanStore } from "@/lib/social-scan";
import { rescoreBestEffort } from "@/lib/rescore";
import { judgeBibPickup } from "@/lib/bib-pickup";

/**
 * POST /api/social-scan — mutual scan award.
 * Body: { p?: string (short token) , h?: string (legacy full hash) }.
 * Success credits BOTH the scanner (session user) and the QR's owner.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Sign in to connect" }, { status: 401 });
  }
  if (await assertNotLockedLive(session.user.authUserId)) {
    return NextResponse.json({ message: "Account locked out" }, { status: 403 });
  }

  let body: { p?: string; h?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body → falls through to bad_token
  }

  const result = await judgeScan(
    {
      scannerId: session.user.id,
      token: typeof body.p === "string" ? body.p : undefined,
      hash: typeof body.h === "string" ? body.h : undefined,
      nowMs: Date.now(),
      // Attendance mode: admin/runadmin/qradmin scanners bypass the daily cap
      // so a full run's worth of attendees can be paired (usage still counted).
      capExempt: isQrAdmin(session),
      // Same group: an operator scan also PRIMES the scanned runner's bib for
      // pickup (mints a BibPickupPass). Ordinary runner scans pay no extra reads.
      operator: isQrAdmin(session),
    },
    defaultScanStore
  );

  if (result.ok) {
    await Promise.all([
      rescoreBestEffort(session.user.id),
      rescoreBestEffort(result.ownerId),
    ]);
    return NextResponse.json(result);
  }

  // ── Priming succeeded even though the social pair is spent for the day ──────
  // The mint sits before the pair claim, so a scan can prime a bib while the
  // pair itself is already burned for the day (an operator who connected with
  // this runner earlier, before their bib was bought). A red 409 would read as
  // "that didn't work" when the bib IS now primed. Narrow by construction: only
  // a scan that ACTUALLY primed carries a bibStatus, so a re-scan of someone
  // already primed — and every runner's own duplicate scan — takes the ordinary
  // 409 below.
  if (result.code === "already_today" && result.bibStatus) {
    return NextResponse.json({
      code: "bib_ready",
      bibStatus: result.bibStatus,
      ownerName: result.ownerName,
    });
  }
  // ── Bib pickup: the FIRST self-scan is the identity check ─────────────────
  // A runner scanning their own QR at the pickup table proves the bib in their
  // hand is theirs. Only the first one — every later self-scan falls through to
  // the ordinary "that's your own QR" below, which is what makes the pickup
  // screen meaningful. Returns 200 (a success), unlike every other self outcome,
  // so both clients MUST branch on `code === "bib_pickup"` before `res.ok`.
  if (result.code === "self") {
    const pickup = await judgeBibPickup(session.user.id);
    if (pickup) {
      await rescoreBestEffort(session.user.id);
      return NextResponse.json({ code: "bib_pickup", ...pickup });
    }
  }

  const responses: Record<string, { status: number; message: string }> = {
    bad_token: { status: 400, message: "That QR code didn't parse." },
    not_found: { status: 404, message: "No runner matches that QR code." },
    self: { status: 400, message: "You cannot scan your own QR code!" },
    already_today: {
      status: 409,
      message: "Already connected today - find new rabbits!",
    },
    cap: { status: 429, message: "Daily connection limit reached." },
  };
  const r = responses[result.code];
  return NextResponse.json(
    { message: r.message, code: result.code },
    { status: r.status }
  );
}
