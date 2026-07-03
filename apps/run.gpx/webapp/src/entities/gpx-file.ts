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
 * GPX File entity - stores metadata for user's GPX files
 */
export const GpxFile = new Entity(
  {
    model: {
      entity: "GpxFile",
      version: "1",
      service: "gpx",
    },
    attributes: {
      userId: {
        type: "string",
        required: true,
      },
      fileId: {
        type: "string",
        required: true,
      },
      fileName: {
        type: "string",
        required: true,
      },
      compositionId: {
        type: "string",
        required: false,
      },
      bucket: {
        type: "string",
        required: true,
      },
      key: {
        type: "string",
        required: true,
      },
      fileSize: {
        type: "number",
        required: true,
      },
      // GPX metadata (extracted on save)
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
      // Timestamps
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
        watch: "*",
        set: () => Date.now(),
      },
      lastOpenedAt: {
        type: "number",
        required: false,
      },
      // Folder organization
      folderId: {
        type: "string",
        required: true,
        default: "ROOT", // "ROOT" = root level (sentinel value for GSI)
      },
      // Tags for flexible categorization (no default - DynamoDB doesn't allow empty sets)
      tags: {
        type: "set",
        items: "string",
        required: false,
      },
      // For global folders - tracks who uploaded the file
      uploadedBy: {
        type: "string",
        required: false,
      },
      // Versioning support
      version: {
        type: "number",
        required: true,
        default: 1,
      },
      versionCount: {
        type: "number",
        required: true,
        default: 1,
      },
      // Upload status for security validation flow
      // pending = uploaded but not yet validated
      // active = validated and ready for use
      // failed = validation failed or expired
      status: {
        type: ["pending", "active", "failed"] as const,
        required: true,
        default: "active", // Default to active for backwards compatibility
      },
      // Community sharing: owner flags a private route as "wants to be shared";
      // an admin curates flagged routes into a GLOBAL folder ("Rabbit Routes").
      // Schema-on-write boolean; queried by an admin-only filtered scan (no GSI).
      shareRequested: {
        type: "boolean",
        required: false,
        default: false,
      },
      // Provenance of the route. "upload"/"draw" = user-authored (publicly shareable);
      // "strava" = raw Strava import (NOT publicly shareable until converted);
      // "converted" = an explicit "Convert to public" copy of a Strava import.
      source: {
        type: "string",
        required: false,
      },
      // Compliance gate (Strava API terms): raw Strava imports are false and cannot
      // enter the public groups until the user runs "Convert to public", which mints a
      // converted copy with this true. Defaults true so upload/draw stay shareable.
      publicShareEligible: {
        type: "boolean",
        required: false,
        default: true,
      },
      // Strava activity id, for idempotent ingestion dedupe (source:strava only).
      stravaActivityId: {
        type: "string",
        required: false,
      },
      // Opt-in to the public non-attributable "All Runners" aggregate overlay (Phase 32).
      // Owner-controlled; unlike individual sharing this blends the route with no name/id.
      includeInAggregate: {
        type: "boolean",
        required: false,
        default: false,
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
          composite: ["fileId"],
        },
      },
      byCreatedAt: {
        index: "gsi1pk-gsi1sk-index",
        pk: {
          field: "gsi1pk",
          composite: ["userId"],
        },
        sk: {
          field: "gsi1sk",
          composite: ["createdAt"],
        },
      },
      // Query files by folder
      byFolder: {
        index: "gsi2pk-gsi2sk-index",
        pk: {
          field: "gsi2pk",
          composite: ["userId"],
        },
        sk: {
          field: "gsi2sk",
          composite: ["folderId", "createdAt"],
        },
      },
      // Query files by status (for cleanup of pending uploads)
      byStatus: {
        index: "gsi3pk-gsi3sk-index",
        pk: {
          field: "gsi3pk",
          composite: ["status"],
        },
        sk: {
          field: "gsi3sk",
          composite: ["createdAt"],
        },
      },
    },
  },
  { client, table }
);

// Type exports
export type GpxFileItem = EntityItem<typeof GpxFile>;
export type CreateGpxFileInput = Omit<
  GpxFileItem,
  "createdAt" | "updatedAt"
>;
