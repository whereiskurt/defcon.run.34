import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { claimEgg, defaultScanStore } from "@/lib/social-scan";

/**
 * POST /api/social-egg — once-ever DC-jack egg claim for the session user.
 * Body: { via?: "hold" | "tap" }.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Sign in first" }, { status: 401 });
  }
  if (await assertNotLockedLive(session.user.authUserId)) {
    return NextResponse.json({ message: "Account locked out" }, { status: 403 });
  }

  let via = "hold";
  try {
    const body = await req.json();
    if (body?.via === "tap") via = "tap";
  } catch {
    // default via
  }

  const result = await claimEgg(session.user.id, via, defaultScanStore);
  if (result.ok) {
    return NextResponse.json(result);
  }
  return NextResponse.json(
    { message: "COVERT CHANNEL ALREADY DRAINED", code: "already" },
    { status: 409 }
  );
}
