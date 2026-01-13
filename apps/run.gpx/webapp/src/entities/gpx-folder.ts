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

// Limits from folders-spec.md
export const FOLDER_LIMITS = {
  MAX_DEPTH: 4, // 0-4 = 5 levels
  MAX_NAME_LENGTH: 50,
  MAX_FOLDERS_PER_USER: 100,
  MAX_GLOBAL_FOLDERS: 10,
} as const;

/**
 * GPX Folder entity - virtual folders for organizing GPX files
 * Folders are metadata-only - S3 keys remain flat
 */
export const GpxFolder = new Entity(
  {
    model: {
      entity: "GpxFolder",
      version: "1",
      service: "gpx",
    },
    attributes: {
      userId: {
        type: "string",
        required: true,
      },
      folderId: {
        type: "string",
        required: true,
      },
      folderName: {
        type: "string",
        required: true,
        validate: (val: string) => val.length <= FOLDER_LIMITS.MAX_NAME_LENGTH,
      },
      parentFolderId: {
        type: "string",
        required: false,
        default: undefined, // undefined = root level
      },
      depth: {
        type: "number",
        required: true,
        default: 0, // 0 = root level, max 4 (5 levels: 0,1,2,3,4)
        validate: (val: number) => val >= 0 && val <= FOLDER_LIMITS.MAX_DEPTH,
      },
      isGlobal: {
        type: "boolean",
        required: true,
        default: false, // true = shared folder accessible by all gpxstudio users
      },
      createdBy: {
        type: "string",
        required: false, // userId of creator (for global folders)
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
        watch: "*",
        set: () => Date.now(),
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
          composite: ["folderId"],
        },
      },
      byParent: {
        index: "gsi1pk-gsi1sk-index",
        pk: {
          field: "gsi1pk",
          composite: ["userId"],
        },
        sk: {
          field: "gsi1sk",
          composite: ["parentFolderId", "folderName"],
        },
      },
      // For listing all folders by user (to count, check depth, etc.)
      byUser: {
        index: "gsi2pk-gsi2sk-index",
        pk: {
          field: "gsi2pk",
          composite: ["userId"],
        },
        sk: {
          field: "gsi2sk",
          composite: ["createdAt"],
        },
      },
    },
  },
  { client, table }
);

// Type exports
export type GpxFolderItem = EntityItem<typeof GpxFolder>;
export type CreateGpxFolderInput = Omit<GpxFolderItem, "createdAt" | "updatedAt">;
