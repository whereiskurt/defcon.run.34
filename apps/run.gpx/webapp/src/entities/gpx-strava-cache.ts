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
 * Per-user cache of the RAW Strava activity list backing the strip (2026-07-21
 * caching rework). One row per user; `activities` is the JSON-serialized
 * StravaActivity[] exactly as Strava returned it (size-guarded by
 * trimActivitiesForCache before write). Imported/tagged flags are NOT cached —
 * the activities route always re-joins against the live GpxFile index, so
 * import/tag/remove state can never go stale.
 *
 * Written by: an explicit strip refresh, the first-ever strip load, Sync-now,
 * and the twice-daily scheduled sync. Read (for free — no strava_sync quota,
 * no Strava traffic) by every other strip open.
 */
export const GpxStravaCache = new Entity(
  {
    model: {
      entity: "gpxStravaCache",
      version: "1",
      service: "gpx",
    },
    attributes: {
      userId: {
        type: "string",
        required: true,
      },
      // JSON.stringify(StravaActivity[]) — parsed defensively on read.
      activities: {
        type: "string",
        required: true,
      },
      // How many whole weeks the backfill looked back for this snapshot.
      weeks: {
        type: "number",
        required: true,
      },
      // Epoch ms of the Strava fetch this snapshot came from.
      fetchedAt: {
        type: "number",
        required: true,
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
          composite: [],
        },
      },
    },
  },
  { client, table }
);

export type GpxStravaCacheItem = EntityItem<typeof GpxStravaCache>;
