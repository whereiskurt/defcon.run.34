/**
 * Quota Service (Local)
 *
 * This module contains run.human-specific quota operations that need
 * access to local entities (like UserUpload). All other quota operations
 * are handled by the centralized quota service in run.auth via quota-client.
 */

import {
  UserUpload,
  updateUploadStatus,
  type UploadTypeValue,
} from "@/entities/user-upload";
import { restoreQuota, type QuotaId } from "@/lib/quota-client";

/**
 * Result of stale upload cleanup
 */
export interface StaleUploadCleanupResult {
  processed: number;
  restored: number;
  errors: number;
  details: Array<{
    userId: string;
    uploadId: string;
    uploadType: string;
    restored: boolean;
    error?: string;
  }>;
}

/**
 * Clean up stale uploads and restore quotas.
 *
 * Finds uploads that have been in "pending" status for longer than the
 * specified threshold and marks them as "expired", restoring the consumed
 * quotas back to the user via the central quota service.
 *
 * This should be run periodically (e.g., every hour) via a cron job or Lambda.
 *
 * @param maxAgeMs - Maximum age in milliseconds for pending uploads (default: 2 hours)
 * @param limit - Maximum number of uploads to process per run (default: 100)
 */
export async function cleanupStaleUploads(
  maxAgeMs: number = 2 * 60 * 60 * 1000, // 2 hours default
  limit: number = 100
): Promise<StaleUploadCleanupResult> {
  const result: StaleUploadCleanupResult = {
    processed: 0,
    restored: 0,
    errors: 0,
    details: [],
  };

  const cutoffTime = Date.now() - maxAgeMs;

  // Scan for pending uploads older than cutoff
  // Note: This is a scan operation - in production, consider using a GSI
  // or a scheduled process that queries by time ranges
  try {
    const scanResult = await UserUpload.scan
      .where(({ status, createdAt }, { eq, lt }) =>
        `${eq(status, "pending")} AND ${lt(createdAt, cutoffTime)}`
      )
      .go({ limit });

    const staleUploads = scanResult.data;

    for (const upload of staleUploads) {
      result.processed++;

      try {
        // Determine which quotas to restore based on upload type
        const uploadType = upload.uploadType as UploadTypeValue;
        const typeQuotaId: QuotaId =
          uploadType === "gpx" ? "gpx_upload" : "photo_upload";

        // Restore both quotas via the central quota service
        await restoreQuota(upload.userId, "file_upload", 1);
        await restoreQuota(upload.userId, typeQuotaId, 1);

        // Mark the upload as expired
        await updateUploadStatus(
          upload.userId,
          upload.uploadId,
          "failed",
          "Expired: presigned URL was not used within the allowed time"
        );

        result.restored++;
        result.details.push({
          userId: upload.userId,
          uploadId: upload.uploadId,
          uploadType: uploadType,
          restored: true,
        });
      } catch (error) {
        result.errors++;
        result.details.push({
          userId: upload.userId,
          uploadId: upload.uploadId,
          uploadType: upload.uploadType,
          restored: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  } catch (error) {
    console.error("[cleanupStaleUploads] Scan error:", error);
    throw error;
  }

  return result;
}
