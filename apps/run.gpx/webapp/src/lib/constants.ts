/**
 * GPX Upload Security Constants
 */

import type { QuotaTier } from "./quota-client";

/**
 * Tier-specific upload limits
 */
export const UPLOAD_LIMITS: Record<QuotaTier, { maxFileSize: number; maxFiles: number }> = {
  zero: { maxFileSize: 0, maxFiles: 0 },
  upload: { maxFileSize: 20 * 1024 * 1024, maxFiles: 10 },  // 20 MB, 10 files
  admin: { maxFileSize: 100 * 1024 * 1024, maxFiles: 100 }, // 100 MB, 100 files
};

/** Default max file size for backwards compatibility */
export const MAX_GPX_FILE_SIZE = UPLOAD_LIMITS.upload.maxFileSize;

/** Presigned URL expiration time in seconds: 1 hour */
export const PRESIGN_EXPIRY_SECONDS = 3600;

/** Maximum age for pending uploads before cleanup: 2 hours */
export const PENDING_UPLOAD_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/** File statuses */
export type GpxFileStatus = "pending" | "active" | "failed";

/**
 * Get the max file size for a given tier
 */
export function getMaxFileSize(tier: QuotaTier): number {
  return UPLOAD_LIMITS[tier]?.maxFileSize ?? UPLOAD_LIMITS.upload.maxFileSize;
}
