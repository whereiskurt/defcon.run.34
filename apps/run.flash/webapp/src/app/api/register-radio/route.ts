import { auth } from "@/config/auth";
import { NextRequest, NextResponse } from "next/server";
import { assertNotLockedLive } from "@/lib/live-lockout";

const isDev = process.env.NODE_ENV !== "production";
const RUN_HUMAN_INTERNAL_URL = process.env.RUN_HUMAN_INTERNAL_URL || (isDev ? "http://localhost:3001" : "");
const AUTH_INTERNAL_SECRET = process.env.AUTH_INTERNAL_SECRET;

/**
 * Proxy route: Register a flashed radio with run.human.
 *
 * Called by the configure hook after successful flash+configure.
 * Authenticates the user via session, then forwards the registration
 * request to run.human's internal API with the OIDC subject.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Live lock-out check at the write boundary: a locked identity is blocked
    // from mutating immediately, not after the ~5-min session re-validation.
    if (await assertNotLockedLive(session.user.id)) {
      return NextResponse.json({ error: "Account locked out" }, { status: 403 });
    }

    if (!RUN_HUMAN_INTERNAL_URL || !AUTH_INTERNAL_SECRET) {
      if (isDev) {
        console.warn("[run.flash] RUN_HUMAN_INTERNAL_URL not configured, skipping radio registration in dev");
        return NextResponse.json({ registered: false, reason: "run.human not available in dev" });
      }
      console.error("[run.flash] RUN_HUMAN_INTERNAL_URL or AUTH_INTERNAL_SECRET not configured");
      return NextResponse.json({ error: "Registration service not configured" }, { status: 500 });
    }

    const { nodeId, privateKey, publicKey } = await req.json();

    console.log(`[run.flash] register-radio: url=${RUN_HUMAN_INTERNAL_URL}/api/internal/meshtastic-radios secret=${AUTH_INTERNAL_SECRET ? AUTH_INTERNAL_SECRET.slice(0, 4) + '...' : 'UNSET'} oidcSub=${session.user.id} nodeId=${nodeId}`);

    const response = await fetch(
      `${RUN_HUMAN_INTERNAL_URL}/api/internal/meshtastic-radios`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": AUTH_INTERNAL_SECRET,
        },
        body: JSON.stringify({
          oidcSub: session.user.id,
          nodeId,
          privateKey,
          publicKey,
        }),
      }
    );

    const data = await response.json();
    // Log the OUTCOME only. The `radio` echo carries privateKey/publicKey, so
    // JSON.stringify(data) here would spill device key material into the app logs.
    console.log(
      `[run.flash] register-radio: status=${response.status} nodeId=${nodeId} ` +
        `updated=${data?.updated === true} transferred=${data?.transferred === true}` +
        (data?.error ? ` error=${data.error}` : "")
    );

    // `previousUserId` is an internal audit id for the server-to-server hop only —
    // never hand another account's identifier to the browser. The UI needs just the
    // boolean to render "reassigned to your profile".
    const { previousUserId: _previousUserId, ...clientSafe } = data ?? {};
    return NextResponse.json(clientSafe, { status: response.status });
  } catch (error) {
    console.error("[run.flash] /api/register-radio error:", error);
    return NextResponse.json(
      { error: "Radio registration failed" },
      { status: 500 }
    );
  }
}
