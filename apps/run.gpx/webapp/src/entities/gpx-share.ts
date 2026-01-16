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
 * GPX Share entity - stores share links for GPX files
 * Supports public and private (email-restricted) sharing
 */
export const GpxShare = new Entity(
  {
    model: {
      entity: "GpxShare",
      version: "1",
      service: "gpx",
    },
    attributes: {
      shareId: {
        type: "string",
        required: true,
      },
      ownerId: {
        type: "string",
        required: true,
      },
      fileId: {
        type: "string",
        required: true,
      },
      version: {
        type: "number",
        required: true,
      },
      accessMode: {
        type: ["public", "private"] as const,
        required: true,
      },
      allowedEmails: {
        type: "list",
        items: {
          type: "string",
        },
        required: false,
      },
      createdAt: {
        type: "number",
        required: true,
        default: () => Date.now(),
        readOnly: true,
      },
      expiresAt: {
        type: "number",
        required: false,
      },
    },
    indexes: {
      primary: {
        pk: {
          field: "pk",
          composite: ["shareId"],
        },
        sk: {
          field: "sk",
          composite: [],
        },
      },
      byFile: {
        index: "gsi1pk-gsi1sk-index",
        pk: {
          field: "gsi1pk",
          composite: ["ownerId", "fileId"],
        },
        sk: {
          field: "gsi1sk",
          composite: ["createdAt"],
        },
      },
    },
  },
  { client, table }
);

// Type exports
export type GpxShareItem = EntityItem<typeof GpxShare>;
export type CreateGpxShareInput = Omit<GpxShareItem, "createdAt">;
