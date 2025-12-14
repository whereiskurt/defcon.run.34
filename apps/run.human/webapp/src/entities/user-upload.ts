import { Entity } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * UserUpload Entity
 *
 * Tracks user file uploads and their processing status.
 * Records are created when a presigned URL is generated,
 * then updated by Lambda functions as the file is uploaded and processed.
 *
 * Status flow: pending → uploaded → processing → completed | failed
 */
export const UserUpload = new Entity(
  {
    model: {
      entity: "UserUpload",
      version: "1",
      service: "run",
    },
    attributes: {
      // Primary identifiers
      uploadId: {
        type: "string",
        required: true,
      },
      userId: {
        type: "string",
        required: true,
      },
      // Upload type: "gpx" | "photo"
      uploadType: {
        type: "string",
        required: true,
      },

      // S3 Details
      bucket: {
        type: "string",
      },
      key: {
        type: "string", // Full S3 key: uploads/{userId}/{uploadType}/{uploadId}.ext
      },
      originalFilename: {
        type: "string", // Original filename from client (optional)
      },
      contentType: {
        type: "string", // MIME type
      },
      fileSize: {
        type: "number", // Size in bytes
      },

      // Processing Status
      status: {
        type: "string",
        default: "pending",
        // "pending" | "uploaded" | "processing" | "completed" | "failed"
      },
      statusMessage: {
        type: "string", // Error details or processing notes
      },

      // Processed Output
      processedKey: {
        type: "string", // S3 key in processed/ folder
      },
      processedData: {
        type: "map",
        properties: {
          // GPX specific
          trackPoints: { type: "number" },
          distance: { type: "number" }, // meters
          elevation: { type: "number" }, // meters gained
          duration: { type: "number" }, // seconds
          startTime: { type: "string" }, // ISO datetime
          endTime: { type: "string" }, // ISO datetime
          bounds: {
            type: "map",
            properties: {
              minLat: { type: "number" },
              maxLat: { type: "number" },
              minLon: { type: "number" },
              maxLon: { type: "number" },
            },
          },
          // Photo specific
          width: { type: "number" },
          height: { type: "number" },
          thumbnailKey: { type: "string" },
          aiTags: { type: "list", items: { type: "string" } },
          location: {
            type: "map",
            properties: {
              lat: { type: "number" },
              lon: { type: "number" },
            },
          },
          takenAt: { type: "string" }, // ISO datetime from EXIF
        },
      },

      // Multi-region coordination fields
      uploadRegion: {
        type: "string", // Region where upload was received (set by on-upload Lambda)
      },
      processingRegion: {
        type: "string", // Region that claimed and processed (set by processor Lambda)
      },
      processingStartedAt: {
        type: "number", // When processing was claimed
      },

      // Timestamps
      createdAt: {
        type: "number",
        default: () => Date.now(),
        readOnly: true,
      },
      updatedAt: {
        type: "number",
        default: () => Date.now(),
        watch: "*",
        set: () => Date.now(),
      },
      uploadedAt: {
        type: "number", // When S3 upload completes
      },
      processedAt: {
        type: "number", // When processing completes
      },
    },
    indexes: {
      // Primary index: get upload by userId + uploadId
      primary: {
        pk: { field: "pk", composite: ["userId"] },
        sk: { field: "sk", composite: ["uploadId"] },
      },
      // GSI1: Query by status (for listing pending/completed uploads)
      byStatus: {
        index: "gsi1",
        pk: { field: "gsi1pk", composite: ["userId"] },
        sk: { field: "gsi1sk", composite: ["status", "createdAt"] },
      },
      // GSI2: Query by type (for listing GPX or photo uploads)
      byType: {
        index: "gsi2",
        pk: { field: "gsi2pk", composite: ["userId", "uploadType"] },
        sk: { field: "gsi2sk", composite: ["createdAt"] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

// Type definitions
export type UploadStatus = "pending" | "uploaded" | "processing" | "completed" | "failed";
export type UploadTypeValue = "gpx" | "photo";

export interface GpxProcessedData {
  trackPoints?: number;
  distance?: number;
  elevation?: number;
  duration?: number;
  startTime?: string;
  endTime?: string;
  bounds?: {
    minLat?: number;
    maxLat?: number;
    minLon?: number;
    maxLon?: number;
  };
}

export interface PhotoProcessedData {
  width?: number;
  height?: number;
  thumbnailKey?: string;
  aiTags?: string[];
  location?: {
    lat?: number;
    lon?: number;
  };
  takenAt?: string;
}

/**
 * Create a new upload record when presigned URL is generated
 */
export async function createUpload(
  userId: string,
  uploadId: string,
  uploadType: UploadTypeValue,
  bucket: string,
  key: string,
  originalFilename?: string
): Promise<void> {
  await UserUpload.create({
    userId,
    uploadId,
    uploadType,
    bucket,
    key,
    originalFilename,
    status: "pending",
  }).go();
}

/**
 * Get an upload by userId and uploadId
 */
export async function getUpload(userId: string, uploadId: string) {
  const result = await UserUpload.get({ userId, uploadId }).go();
  return result.data;
}

/**
 * Update upload status
 */
export async function updateUploadStatus(
  userId: string,
  uploadId: string,
  status: UploadStatus,
  statusMessage?: string
): Promise<void> {
  const update: Record<string, unknown> = { status };
  if (statusMessage !== undefined) {
    update.statusMessage = statusMessage;
  }
  await UserUpload.patch({ userId, uploadId }).set(update).go();
}

/**
 * Mark upload as completed (called by on-upload Lambda when S3 upload finishes)
 */
export async function markUploaded(
  userId: string,
  uploadId: string,
  fileSize: number,
  contentType: string
): Promise<void> {
  await UserUpload.patch({ userId, uploadId })
    .set({
      status: "uploaded",
      fileSize,
      contentType,
      uploadedAt: Date.now(),
    })
    .go();
}

/**
 * Mark upload as processed (called by processor Lambda)
 */
export async function markProcessed(
  userId: string,
  uploadId: string,
  processedKey: string,
  processedData: GpxProcessedData | PhotoProcessedData
): Promise<void> {
  await UserUpload.patch({ userId, uploadId })
    .set({
      status: "completed",
      processedKey,
      processedData,
      processedAt: Date.now(),
    })
    .go();
}

/**
 * Mark upload as failed
 */
export async function markFailed(
  userId: string,
  uploadId: string,
  errorMessage: string
): Promise<void> {
  await UserUpload.patch({ userId, uploadId })
    .set({
      status: "failed",
      statusMessage: errorMessage,
    })
    .go();
}

/**
 * List all uploads for a user (most recent first)
 */
export async function listUploadsByUser(
  userId: string,
  options?: { limit?: number; cursor?: string }
) {
  const query = UserUpload.query.primary({ userId });

  if (options?.cursor) {
    query.go({ cursor: options.cursor, limit: options.limit || 20 });
  }

  const result = await query.go({ limit: options?.limit || 20 });
  return {
    uploads: result.data,
    cursor: result.cursor,
  };
}

/**
 * List uploads by type (e.g., all GPX uploads)
 */
export async function listUploadsByType(
  userId: string,
  uploadType: UploadTypeValue,
  options?: { limit?: number; cursor?: string }
) {
  const query = UserUpload.query.byType({ userId, uploadType });

  const result = await query.go({
    limit: options?.limit || 20,
    cursor: options?.cursor,
  });

  return {
    uploads: result.data,
    cursor: result.cursor,
  };
}

/**
 * List uploads by status (e.g., all pending uploads)
 */
export async function listUploadsByStatus(
  userId: string,
  status: UploadStatus,
  options?: { limit?: number; cursor?: string }
) {
  const query = UserUpload.query.byStatus({ userId }).begins({ status });

  const result = await query.go({
    limit: options?.limit || 20,
    cursor: options?.cursor,
  });

  return {
    uploads: result.data,
    cursor: result.cursor,
  };
}
