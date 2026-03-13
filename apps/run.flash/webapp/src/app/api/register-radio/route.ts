import { auth } from "@/config/auth";
import { NextRequest, NextResponse } from "next/server";

const isDev = process.env.NODE_ENV !== "production";
const RUN_HUMAN_INTERNAL_URL = process.env.RUN_HUMAN_INTERNAL_URL;
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

    if (!RUN_HUMAN_INTERNAL_URL || !AUTH_INTERNAL_SECRET) {
      if (isDev) {
        console.warn("[run.flash] RUN_HUMAN_INTERNAL_URL not configured, skipping radio registration in dev");
        return NextResponse.json({ registered: false, reason: "run.human not available in dev" });
      }
      console.error("[run.flash] RUN_HUMAN_INTERNAL_URL or AUTH_INTERNAL_SECRET not configured");
      return NextResponse.json({ error: "Registration service not configured" }, { status: 500 });
    }

    const { nodeId, privateKey } = await req.json();

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
        }),
      }
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("[run.flash] /api/register-radio error:", error);
    return NextResponse.json(
      { error: "Radio registration failed" },
      { status: 500 }
    );
  }
}
