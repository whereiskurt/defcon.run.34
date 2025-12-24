import { auth } from "@auth";
import { getRunUser } from "@/entities/run-user";
import { getUserQuotas, getOrInitQuota, getUserTier } from "@/services/quota";
import type { QuotaId } from "@/lib/quota-definitions";
import { NextRequest, NextResponse } from "next/server";

// Quota IDs we want to fetch for the user profile
const PROFILE_QUOTA_IDS: QuotaId[] = [
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

  // Determine user tier from services (default to 'upload' for authenticated users)
  const services = session.user.services || ["run"];
  const tier = getUserTier(services);

  // Get or initialize all profile quotas
  const quotaPromises = PROFILE_QUOTA_IDS.map((quotaId) =>
    getOrInitQuota(session.user.id, quotaId, tier)
  );
  const quotaResults = await Promise.all(quotaPromises);

  // Build quota object for response
  const quotas: Record<string, { remaining: number; initial: number }> = {};
  for (let i = 0; i < PROFILE_QUOTA_IDS.length; i++) {
    const quotaId = PROFILE_QUOTA_IDS[i];
    const quota = quotaResults[i];
    quotas[quotaId] = {
      remaining: quota.remaining,
      initial: quota.initialAmount,
    };
  }

  // Strip out sensitive fields
  const {
    rsaprivSHA,
    seed,
    mqttPassword,
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
    // Include quotas
    quotas,
  };

  return NextResponse.json(
    { message: "User Fetched.", user: responseUser },
    { status: 200 }
  );
}
