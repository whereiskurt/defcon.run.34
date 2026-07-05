import { Entity, type EntityItem } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";
import { RunUser } from "./run-user";
import * as crypto from "crypto";

/**
 * GPS sample from the browser's Geolocation API
 */
export interface GPSSample {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

/**
 * Runtime list of GPSSample fields (for validation/testing)
 */
export const GPSSampleFields = [
  "latitude",
  "longitude",
  "accuracy",
  "altitude",
  "altitudeAccuracy",
  "heading",
  "speed",
  "timestamp",
] as const;

/**
 * Data required to create a new check-in
 */
export interface CheckInData {
  source: string;
  samples: GPSSample[];
  userAgent?: string;
  isPrivate?: boolean;
  checkInType?: "Basic" | "OTP" | "With Flag" | "Manual";
  otpCode?: string;
  flagText?: string;
  // Pin personalization (v1.8 Phase 4) — denormalized at creation so a
  // check-in keeps its look even if the runner changes their profile pin.
  pinIcon?: string;
  pinColor?: string;
}

/**
 * CheckIn ElectroDB Entity
 *
 * Stores individual GPS check-in records for users.
 * Ported from DCR33's checkin.ts with adaptations:
 * - service: 'run' (matches RunUser, shared table)
 * - userId-based lookups (not email)
 * - GSI indexes on gsi2/gsi3 (gsi1 is used by RunUser.byHash)
 * - No quota logic (centralized in run.auth quota-middleware)
 * - No cache invalidation (DCR34 different cache pattern)
 */
export const CheckIn = new Entity(
  {
    model: {
      entity: "CheckIn",
      version: "1",
      service: "run",
    },
    attributes: {
      userId: {
        type: "string",
        required: true,
      },
      checkInId: {
        type: "string",
        required: true,
      },
      timestamp: {
        type: "number",
        required: true,
      },
      source: {
        type: "string",
        required: true,
      },
      samples: {
        type: "any", // Store as any to handle null values in GPS samples
        required: true,
      },
      averageCoordinates: {
        type: "map",
        properties: {
          latitude: { type: "number" },
          longitude: { type: "number" },
        },
        required: true,
      },
      bestAccuracy: {
        type: "number",
        required: true,
      },
      userAgent: {
        type: "string",
      },
      isPrivate: {
        type: "boolean",
        default: true,
      },
      checkInType: {
        type: ["Basic", "OTP", "With Flag", "Manual"] as const,
        default: "Basic",
      },
      otpCode: {
        type: "string",
      },
      flagText: {
        type: "string",
      },
      // Pin personalization (v1.8 Phase 4) — catalog id + #rrggbb, immutable
      // per check-in; absent on older rows (renders as the default pin).
      pinIcon: {
        type: "string",
      },
      pinColor: {
        type: "string",
      },
      // Geospatial fields for future geo queries
      geoHash: {
        type: "string",
      },
      // S3 reference for large GPS sample data (future use)
      s3Key: {
        type: "string",
      },
      // Summary stats
      pointsCount: {
        type: "number",
      },
      duration: {
        type: "number", // Duration in seconds between first and last sample
      },
      distance: {
        type: "number", // Total distance traveled in meters
      },
      createdAt: {
        type: "number",
        default: () => Date.now(),
        readOnly: true,
      },
      updatedAt: {
        type: "number",
        watch: "*",
        set: () => Date.now(),
        readOnly: true,
      },
    },
    indexes: {
      primary: {
        pk: {
          field: "pk",
          composite: ["userId"],
        },
        sk: {
          field: "sk",
          composite: ["timestamp", "checkInId"],
        },
      },
      byGlobalRecent: {
        index: "gsi2pk-gsi2sk-index",
        pk: {
          field: "gsi2pk",
          composite: [],
          template: "TYPE#CHECKIN",
        },
        sk: {
          field: "gsi2sk",
          composite: ["timestamp"],
        },
      },
      byUserRecent: {
        index: "gsi3pk-gsi3sk-index",
        pk: {
          field: "gsi3pk",
          composite: ["userId"],
        },
        sk: {
          field: "gsi3sk",
          composite: ["timestamp"],
        },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

/**
 * Inferred CheckIn item type from the ElectroDB entity
 */
export type CheckInItem = EntityItem<typeof CheckIn>;

/**
 * Create a new check-in for a user.
 * Computes average coordinates, best accuracy, duration, and point count from samples.
 * Updates RunUser's checkInCount (atomic increment) and lastCheckInAt as side effects.
 *
 * Note: Quota enforcement is NOT done here -- it's handled by quota-middleware in API routes (Phase 11).
 */
export async function createCheckIn(userId: string, data: CheckInData) {
  const { samples, source, userAgent, isPrivate, checkInType, otpCode, flagText, pinIcon, pinColor } = data;

  if (!samples || !Array.isArray(samples) || samples.length === 0) {
    throw new Error("Invalid samples data");
  }

  // Calculate average coordinates
  const avgLat = samples.reduce((sum, s) => sum + s.latitude, 0) / samples.length;
  const avgLng = samples.reduce((sum, s) => sum + s.longitude, 0) / samples.length;

  // Best accuracy is the minimum (lower = better)
  const bestAccuracy = Math.min(...samples.map((s) => s.accuracy));

  // Duration: time between first and last sample in seconds
  let duration = 0;
  if (samples.length > 1) {
    const firstTimestamp = samples[0].timestamp;
    const lastTimestamp = samples[samples.length - 1].timestamp;
    duration = (lastTimestamp - firstTimestamp) / 1000;
  }

  const checkInId = crypto.randomUUID();
  const timestamp = Date.now();

  const result = await CheckIn.create({
    userId,
    checkInId,
    timestamp,
    source: source || "Web GPS",
    samples,
    averageCoordinates: {
      latitude: avgLat,
      longitude: avgLng,
    },
    bestAccuracy,
    userAgent,
    isPrivate: isPrivate ?? true,
    checkInType: checkInType || "Basic",
    otpCode,
    flagText,
    pinIcon,
    pinColor,
    pointsCount: samples.length,
    duration,
  }).go();

  // Side effect: update RunUser denormalized fields
  await RunUser.patch({ userId })
    .set({ lastCheckInAt: timestamp })
    .add({ checkInCount: 1 } as any)
    .go();

  return result.data;
}

/**
 * Get check-ins for a user, ordered most-recent-first with cursor pagination.
 */
export async function getCheckInsByUser(
  userId: string,
  limit: number = 20,
  cursor?: string
) {
  const result = await CheckIn.query
    .byUserRecent({ userId })
    .go({
      limit,
      cursor,
      order: "desc",
    });

  return {
    data: result.data,
    cursor: result.cursor,
  };
}

/**
 * Get recent check-ins globally (all users), ordered most-recent-first with cursor pagination.
 * Pass `since` (epoch ms) to bound the window to timestamp >= since — the
 * byGlobalRecent sort key is the timestamp, so this is a key condition, not a filter.
 */
export async function getRecentCheckIns(
  limit: number = 20,
  cursor?: string,
  since?: number
) {
  const query = CheckIn.query.byGlobalRecent({});
  const result = await (since != null ? query.gte({ timestamp: since }) : query)
    .go({
      limit,
      cursor,
      order: "desc",
    });

  return {
    data: result.data,
    cursor: result.cursor,
  };
}

/**
 * Get a single check-in by primary key composite.
 */
export async function getCheckIn(
  userId: string,
  timestamp: number,
  checkInId: string
) {
  const result = await CheckIn.get({
    userId,
    timestamp,
    checkInId,
  }).go();

  return result.data;
}

/**
 * Delete a check-in by primary key.
 * Side effect: atomically decrements RunUser's checkInCount.
 *
 * Note: Ownership verification is NOT done here -- it's handled by the API layer (Phase 11).
 */
export async function deleteCheckIn(
  userId: string,
  timestamp: number,
  checkInId: string
) {
  await CheckIn.delete({
    userId,
    timestamp,
    checkInId,
  }).go();

  // Side effect: decrement RunUser checkInCount
  await RunUser.patch({ userId })
    .subtract({ checkInCount: 1 } as any)
    .go();
}

/**
 * Update the privacy setting on an existing check-in.
 *
 * Note: Ownership verification is NOT done here -- it's handled by the API layer (Phase 11).
 */
export async function updateCheckInPrivacy(
  userId: string,
  timestamp: number,
  checkInId: string,
  isPrivate: boolean
) {
  const result = await CheckIn.patch({
    userId,
    timestamp,
    checkInId,
  })
    .set({ isPrivate })
    .go();

  return result.data;
}
