import { Entity, EntityItem } from "electrodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({
  region: process.env.DYNAMODB_REGION || "us-east-1",
  ...(process.env.DYNAMODB_ENDPOINT
    ? { endpoint: process.env.DYNAMODB_ENDPOINT }
    : {}),
  credentials: {
    accessKeyId: process.env.DYNAMODB_ACCESS_KEY!,
    secretAccessKey: process.env.DYNAMODB_SECRET_KEY!,
  },
});

const table = process.env.DYNAMODB_TABLE || "dc34-gpx";

/**
 * Sync-now daily counter (Task 2, scheduled-Strava-sync milestone).
 *
 * Backs the per-user "Sync now" button's 2/day cap (SYNC_NOW_PER_DAY in
 * @/lib/sync-now-limit): one row per (userId, con-local date), incremented
 * BEFORE each untagged sync attempt. No GSIs, no TTL (table TTL is off) — the
 * row set is small and self-limiting (one row per user per con day).
 */
export const GpxSyncNow = new Entity(
  {
    model: {
      entity: "gpxSyncNow",
      version: "1",
      service: "gpx",
    },
    attributes: {
      userId: {
        type: "string",
        required: true,
      },
      // Con-local calendar date (YYYY-MM-DD) — see conLocalDate in @/lib/con-days.
      date: {
        type: "string",
        required: true,
      },
      count: {
        type: "number",
        required: true,
        default: 0,
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
          composite: ["date"],
        },
      },
    },
  },
  { client, table }
);

export type GpxSyncNowItem = EntityItem<typeof GpxSyncNow>;
