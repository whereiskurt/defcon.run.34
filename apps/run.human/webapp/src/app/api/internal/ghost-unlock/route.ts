import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { config } from "@/config";
import { revealGhostOtp } from "@/lib/mesh-ghosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal API: reveal a ghost's DM-unlock TOTP seed + authenticator QR.
 *
 * Protected by AUTH_INTERNAL_SECRET (server-to-server only; the run.gpx ghosts
 * feed is the sole caller — it publishes goldstein's seed in his map popup as
 * a CTF clue). Exposes the UNLOCK seed only (meshtk-otp-seed HKDF label) —
 * never the chain/daily-claim seed, which stays private per the 07-25 split.
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== config.auth.internalSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ghostId = req.nextUrl.searchParams.get("ghost");
  if (!ghostId) {
    return NextResponse.json({ error: "Missing ghost" }, { status: 400 });
  }

  const reveal = revealGhostOtp(ghostId);
  if (!reveal?.configured || !reveal.otpauth || !reveal.secret) {
    // Unknown ghost, no OTP config, or MESHTK_GHOST_KEY_SECRET unset.
    return NextResponse.json({ error: "Unavailable" }, { status: 422 });
  }

  const qr = await QRCode.toDataURL(reveal.otpauth, { margin: 1, width: 220 });
  return NextResponse.json({ ghostId, secret: reveal.secret, otpauth: reveal.otpauth, qr });
}
