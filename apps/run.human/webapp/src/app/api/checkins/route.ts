import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import {
  createCheckIn,
  getCheckInsByUser,
  deleteCheckIn,
  updateCheckInPrivacy,
  type CheckInItem,
} from "@/entities/checkin";
import { getRunUser } from "@/entities/run-user";
import {
  requireAndConsumeQuota,
  handleQuotaError,
  getUserTier,
} from "@/lib/quota-middleware";
import { checkQuota } from "@/lib/quota-client";

/**
 * Resolve a check-in by checkinId for the given user.
 * Queries user's check-ins and finds the matching item.
 * Returns the CheckInItem or null if not found.
 */
async function resolveCheckIn(
  userId: string,
  checkinId: string
): Promise<CheckInItem | null> {
  const { data } = await getCheckInsByUser(userId, 100);
  return data.find((item) => item.checkInId === checkinId) ?? null;
}

/**
 * POST /api/checkins - Create a new check-in
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { samples, source = "Web GPS", isPrivate } = body;

    // Validate GPS samples
    if (!samples || !Array.isArray(samples) || samples.length === 0) {
      return NextResponse.json(
        { error: "samples must be a non-empty array of GPS samples" },
        { status: 400 }
      );
    }

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (typeof s.latitude !== "number" || s.latitude < -90 || s.latitude > 90) {
        return NextResponse.json(
          { error: `samples[${i}].latitude must be a number between -90 and 90` },
          { status: 400 }
        );
      }
      if (typeof s.longitude !== "number" || s.longitude < -180 || s.longitude > 180) {
        return NextResponse.json(
          { error: `samples[${i}].longitude must be a number between -180 and 180` },
          { status: 400 }
        );
      }
      if (typeof s.accuracy !== "number") {
        return NextResponse.json(
          { error: `samples[${i}].accuracy must be a number` },
          { status: 400 }
        );
      }
      if (typeof s.timestamp !== "number") {
        return NextResponse.json(
          { error: `samples[${i}].timestamp must be a number` },
          { status: 400 }
        );
      }
    }

    // Quota enforcement
    const services = session.user.services || ["run"];
    const tier = getUserTier(services);
    await requireAndConsumeQuota(session.user.id, "checkin", 1, tier);

    // Resolve privacy default from user preference if not explicitly provided
    let resolvedIsPrivate = isPrivate;
    if (resolvedIsPrivate === undefined) {
      const user = await getRunUser(session.user.id);
      resolvedIsPrivate = user?.preferences?.checkinPreference === "private";
    }

    // Create the check-in
    const checkInItem = await createCheckIn(session.user.id, {
      source,
      samples,
      userAgent: req.headers.get("user-agent") || undefined,
      isPrivate: resolvedIsPrivate,
    });

    // Get remaining quota for response
    const quotaCheck = await checkQuota(session.user.id, "checkin", 1, tier);

    return NextResponse.json(
      { data: checkInItem, quota: { remaining: quotaCheck.remaining } },
      { status: 201 }
    );
  } catch (error) {
    const quotaError = handleQuotaError(error);
    if (quotaError) return quotaError;
    console.error("Error creating check-in:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/checkins - List user's check-ins with pagination
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const cursor = searchParams.get("cursor") || undefined;
    const limitParam = searchParams.get("limit");
    let limit = 20;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        limit = Math.min(parsed, 100);
      }
    }

    const result = await getCheckInsByUser(session.user.id, limit, cursor);

    return NextResponse.json({
      data: result.data,
      cursor: result.cursor,
    });
  } catch (error) {
    console.error("Error fetching check-ins:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/checkins - Toggle privacy on a check-in
 */
export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { checkinId, isPrivate } = body;

    if (!checkinId || typeof checkinId !== "string") {
      return NextResponse.json(
        { error: "checkinId is required and must be a string" },
        { status: 400 }
      );
    }
    if (typeof isPrivate !== "boolean") {
      return NextResponse.json(
        { error: "isPrivate is required and must be a boolean" },
        { status: 400 }
      );
    }

    const item = await resolveCheckIn(session.user.id, checkinId);
    if (!item) {
      return NextResponse.json(
        { error: "Check-in not found" },
        { status: 404 }
      );
    }

    const updatedCheckIn = await updateCheckInPrivacy(
      session.user.id,
      item.timestamp,
      checkinId,
      isPrivate
    );

    return NextResponse.json({ data: updatedCheckIn });
  } catch (error) {
    console.error("Error updating check-in:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/checkins - Remove a check-in
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const checkinId = searchParams.get("checkinId");

    if (!checkinId) {
      return NextResponse.json(
        { error: "checkinId query parameter is required" },
        { status: 400 }
      );
    }

    const item = await resolveCheckIn(session.user.id, checkinId);
    if (!item) {
      return NextResponse.json(
        { error: "Check-in not found" },
        { status: 404 }
      );
    }

    await deleteCheckIn(session.user.id, item.timestamp, checkinId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting check-in:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
