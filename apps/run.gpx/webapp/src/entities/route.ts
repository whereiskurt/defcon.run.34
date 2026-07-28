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
 * Route entity (2026-07-28 routes-vs-runs spec) — a shareable, editable,
 * DATELESS route template. Deliberately a separate entity from GpxFile:
 * a "run" is a GpxFile with a conDay; a Route has NO conDay attribute at all,
 * so it can never satisfy the leaderboard's scored-run predicate
 * (lib/gpx-reconcile.ts) — structurally unscoreable.
 *
 * Key layout follows the MeshRadio pattern: globally-addressable pk (routeId)
 * plus an owner GSI. byVisibility's sk is publishedAt, so rows without
 * publishedAt (private routes) never materialize in that index — the
 * community listing is a query over published rows only, no scan, no filter.
 * gsi3 is intentionally unused: the local-dev run-gpx-electro table only
 * provisions gsi1/gsi2.
 */
export const routeSchema = {
  model: {
    entity: "Route",
    version: "1",
    service: "gpx",
  },
  attributes: {
    routeId: {
      type: "string",
      required: true,
    },
    // OIDC sub of the owner. Always taken from the session server-side —
    // never from a request body.
    ownerId: {
      type: "string",
      required: true,
    },
    name: {
      type: "string",
      required: true,
    },
    description: {
      type: "string",
      required: false,
    },
    routeType: {
      type: ["loop", "out-and-back", "point-to-point"] as const,
      required: false,
    },
    bucket: {
      type: "string",
      required: true,
    },
    // uploads/ROUTES/{routeId}.gpx — fully server-derived, and deliberately
    // free of any user identifier (presigned URLs expose the key path).
    key: {
      type: "string",
      required: true,
    },
    fileSize: {
      type: "number",
      required: true,
    },
    trackCount: {
      type: "number",
      required: false,
      default: 0,
    },
    waypointCount: {
      type: "number",
      required: false,
      default: 0,
    },
    totalDistance: {
      type: "number",
      required: false,
      default: 0,
    },
    totalElevation: {
      type: "number",
      required: false,
      default: 0,
    },
    bounds: {
      type: "map",
      properties: {
        minLat: { type: "number" },
        maxLat: { type: "number" },
        minLon: { type: "number" },
        maxLon: { type: "number" },
      },
      required: false,
    },
    // Same presign→confirm lifecycle as GpxFile.
    status: {
      type: ["pending", "active", "failed"] as const,
      required: true,
      default: "pending",
    },
    visibility: {
      type: ["private", "published"] as const,
      required: true,
      default: "private",
    },
    // Set on publish, removed on unpublish. Its absence keeps private rows
    // out of the byVisibility GSI (it is that index's sk).
    publishedAt: {
      type: "number",
      required: false,
    },
    source: {
      type: ["upload", "draw", "converted"] as const,
      required: false,
    },
    // Provenance when converted from a run/file. Informational only.
    sourceGpxFileId: {
      type: "string",
      required: false,
    },
    // Display attribution captured (and sanitized) at create time. The raw
    // ownerId (OIDC sub) is never exposed in community listings.
    createdByName: {
      type: "string",
      required: false,
    },
    copyCount: {
      type: "number",
      required: false,
      default: 0,
    },
    createdAt: {
      type: "number",
      required: true,
      default: () => Date.now(),
      readOnly: true,
    },
    updatedAt: {
      type: "number",
      required: true,
      default: () => Date.now(),
      watch: "*" as const,
      set: () => Date.now(),
    },
  },
  indexes: {
    primary: {
      pk: {
        field: "pk",
        composite: ["routeId"],
      },
      sk: {
        field: "sk",
        composite: [],
      },
    },
    byOwner: {
      index: "gsi1pk-gsi1sk-index",
      pk: {
        field: "gsi1pk",
        composite: ["ownerId"],
      },
      sk: {
        field: "gsi1sk",
        composite: ["createdAt"],
      },
    },
    byVisibility: {
      index: "gsi2pk-gsi2sk-index",
      pk: {
        field: "gsi2pk",
        composite: ["visibility"],
      },
      sk: {
        field: "gsi2sk",
        composite: ["publishedAt"],
      },
    },
  },
} as const;

export const Route = new Entity(routeSchema, { client, table });

// Type exports
export type RouteItem = EntityItem<typeof Route>;
