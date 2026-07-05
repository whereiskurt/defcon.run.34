import { NextResponse } from "next/server";
import { auth } from "@auth";
import { getRunUser } from "@/entities/run-user";
import {
  allowedPinIcons,
  DEFAULT_PIN_ICON,
  DEFAULT_PIN_COLOR,
} from "@/lib/pin-icons";

/**
 * GET /api/checkins/pin-options - The pin choices THIS session may use.
 *
 * Secret icons are filtered server-side by session services, so the client
 * never learns about pins it can't pick. Also returns the runner's saved
 * profile pin so pickers can pre-select it.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const services = session.user.services || ["run"];
    const user = await getRunUser(session.user.id);

    return NextResponse.json({
      icons: allowedPinIcons(services).map(({ id, label, fixedColor }) => ({
        id,
        label,
        fixedColor,
      })),
      pinIcon: user?.preferences?.pinIcon || DEFAULT_PIN_ICON,
      pinColor: user?.preferences?.pinColor || DEFAULT_PIN_COLOR,
    });
  } catch (error) {
    console.error("Error fetching pin options:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
