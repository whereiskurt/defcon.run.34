import { auth } from "@auth";
import { getRunUser, updateRunUserProfile } from "@/entities/run-user";
import { getRunnerCode } from "@/entities/bib";
import { pinIconById, canUsePinIcon, isValidPinColor } from "@/lib/pin-icons";
import {
  getUserQuotas,
  getQuotaDefinitions,
  requireAndConsumeQuota,
  isQuotaExceededError,
  type QuotaId,
} from "@/lib/quota-client";
import { NextRequest, NextResponse } from "next/server";

// displayName edit rules (kept simple — matches the dc33 behavior).
const DISPLAYNAME_MIN = 3;
const DISPLAYNAME_MAX = 20;

// Quota IDs we want to fetch for the user profile
const PROFILE_QUOTA_IDS: QuotaId[] = [
  "file_upload",
  "gpx_upload",
  "gpx_save",
  "gpx_share",
  "photo_upload",
  "strava_sync",
  "checkin",
  "meshtastic_radio",
  "qr_scan",
  "displayname_change",
  "qr_sheet",
];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session || !session.user?.id) {
    return NextResponse.json({ message: "401 Unauthorized" }, { status: 401 });
  }

  const user = await getRunUser(session.user.id);

  if (!user) {
    return NextResponse.json({ message: "User not found" }, { status: 404 });
  }

  // Get all quotas from the central quota service (+ the runner's bib code, if
  // they've claimed one over on the bib service — read-only, same shared table).
  const [userQuotasResponse, definitions, runnerCode] = await Promise.all([
    getUserQuotas(session.user.id),
    getQuotaDefinitions(),
    getRunnerCode(session.user.id).catch(() => null),
  ]);

  // Determine user's tier from the quota response (default to "upload")
  const userTier = userQuotasResponse.quotaTier || "upload";

  // Build quota object for response (filter to profile quotas)
  // Include defaults for quotas that haven't been initialized yet
  const quotas: Record<string, { remaining: number; initial: number }> = {};
  for (const quotaId of PROFILE_QUOTA_IDS) {
    const quota = userQuotasResponse.quotas.find((q) => q.quotaId === quotaId);
    if (quota) {
      quotas[quotaId] = {
        remaining: quota.remaining,
        initial: quota.initialAmount,
      };
    } else {
      // Quota not initialized yet - return the tier default
      const def = definitions.find((d) => d.id === quotaId);
      if (def) {
        const tierLimit = def.tierLimits[userTier] ?? def.tierLimits["upload"] ?? 0;
        quotas[quotaId] = {
          remaining: tierLimit,
          initial: tierLimit,
        };
      }
    }
  }

  // Strip out sensitive fields
  const {
    rsaprivSHA,
    seed,
    // Add other sensitive fields here if needed
    ...safeUserData
  } = user;

  // Transform to match dropdown-user.tsx expected format
  const responseUser = {
    ...safeUserData,
    // Map displayName to displayname for compatibility with dc33 dropdown-user.tsx
    displayname: safeUserData.displayName,
    // Map preferences.checkinPreference to checkin_preference for compatibility
    checkin_preference: safeUserData.preferences?.checkinPreference || "public",
    // Runner's bib code (BIB-XXXX) if they've claimed one; null otherwise
    runnerCode,
    // Include quotas
    quotas,
  };

  return NextResponse.json(
    { message: "User Fetched.", user: responseUser },
    { status: 200 }
  );
}

/**
 * PATCH /api/user - Update user preferences (check-in privacy, pin icon/color).
 * Merges into the existing preferences map rather than replacing it.
 */
export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { message: "401 Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { checkinPreference, pinIcon, pinColor, displayName } = body;

    const response: Record<string, unknown> = { success: true };

    // displayName is a top-level, quota-gated field (not a preference). Handle
    // it first so a name-only change is a valid request.
    if (displayName !== undefined) {
      const trimmed = typeof displayName === "string" ? displayName.trim() : "";
      if (trimmed.length < DISPLAYNAME_MIN || trimmed.length > DISPLAYNAME_MAX) {
        return NextResponse.json(
          {
            error: `displayName must be ${DISPLAYNAME_MIN}–${DISPLAYNAME_MAX} characters`,
          },
          { status: 400 }
        );
      }
      try {
        await requireAndConsumeQuota(session.user.id, "displayname_change");
      } catch (err) {
        if (isQuotaExceededError(err)) {
          return NextResponse.json(
            { error: "You've used all your name changes" },
            { status: 429 }
          );
        }
        throw err;
      }
      await updateRunUserProfile(session.user.id, { displayName: trimmed });
      response.displayName = trimmed;
    }

    const updates: Record<string, string> = {};

    if (checkinPreference !== undefined) {
      if (checkinPreference !== "public" && checkinPreference !== "private") {
        return NextResponse.json(
          { error: 'checkinPreference must be "public" or "private"' },
          { status: 400 }
        );
      }
      updates.checkinPreference = checkinPreference;
    }

    if (pinIcon !== undefined) {
      const icon = pinIconById(typeof pinIcon === "string" ? pinIcon : undefined);
      const services = session.user.services || ["run"];
      if (!icon || !canUsePinIcon(icon, services)) {
        return NextResponse.json(
          { error: "pinIcon is not a valid or permitted icon" },
          { status: 400 }
        );
      }
      updates.pinIcon = icon.id;
    }

    if (pinColor !== undefined) {
      if (!isValidPinColor(pinColor)) {
        return NextResponse.json(
          { error: "pinColor must be a #rrggbb hex color" },
          { status: 400 }
        );
      }
      updates.pinColor = pinColor;
    }

    if (Object.keys(updates).length > 0) {
      // ElectroDB set() replaces map attributes wholesale — merge with the
      // current preferences so an update to one field doesn't drop the others.
      const user = await getRunUser(session.user.id);
      await updateRunUserProfile(session.user.id, {
        preferences: { ...user?.preferences, ...updates },
      });
      Object.assign(response, updates);
    } else if (displayName === undefined) {
      return NextResponse.json(
        { error: "No valid fields provided" },
        { status: 400 }
      );
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error updating user preference:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
