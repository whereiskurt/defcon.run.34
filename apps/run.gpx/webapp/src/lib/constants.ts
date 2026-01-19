/**
 * GPX Upload Security Constants
 */

/** Maximum file size for GPX uploads: 10 MB */
export const MAX_GPX_FILE_SIZE = 10 * 1024 * 1024;

/** Presigned URL expiration time in seconds: 1 hour */
export const PRESIGN_EXPIRY_SECONDS = 3600;

/** Maximum age for pending uploads before cleanup: 2 hours */
export const PENDING_UPLOAD_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/** File statuses */
export type GpxFileStatus = "pending" | "active" | "failed";
