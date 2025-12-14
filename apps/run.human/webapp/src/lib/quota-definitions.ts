/**
 * Quota System Definitions
 *
 * Type-safe quota type definitions for the DefCon 34 run tracking app.
 * All quotas use countdown-to-zero semantics (remaining decrements with use).
 */

/**
 * Reset policy for quotas
 * - none: Never resets, countdown to zero permanently
 * - daily: Resets at midnight UTC
 * - weekly: Resets on Monday midnight UTC
 * - monthly: Resets on 1st of month midnight UTC
 * - event: Manual reset by admin (e.g., per DefCon event)
 */
export type ResetPolicy = "none" | "daily" | "weekly" | "monthly" | "event";

/**
 * Quota definition structure
 */
export interface QuotaDefinition {
  /** Unique identifier for the quota type */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description for display */
  description: string;
  /** Initial/default quota amount */
  initialAmount: number;
  /** Maximum amount when restored (can't exceed this) */
  maxAmount: number;
  /** When the quota resets */
  resetPolicy: ResetPolicy;
  /** Whether this quota is currently active */
  enabled: boolean;
}

/**
 * All quota definitions
 *
 * Add new quota types here. Each quota must have a unique id.
 */
export const QUOTA_DEFINITIONS = {
  // General file upload limit (applies to all upload types)
  file_upload: {
    id: "file_upload",
    name: "File Uploads",
    description: "Total file uploads (GPX or photo)",
    initialAmount: 100,
    maxAmount: 100,
    resetPolicy: "none" as const,
    enabled: true,
  },

  // GPX-specific upload limit
  gpx_upload: {
    id: "gpx_upload",
    name: "GPX Uploads",
    description: "GPX track file uploads",
    initialAmount: 50,
    maxAmount: 50,
    resetPolicy: "none" as const,
    enabled: true,
  },

  // Photo-specific upload limit
  photo_upload: {
    id: "photo_upload",
    name: "Photo Uploads",
    description: "Photo file uploads",
    initialAmount: 100,
    maxAmount: 100,
    resetPolicy: "none" as const,
    enabled: true,
  },
} as const;

/**
 * Type-safe quota IDs derived from QUOTA_DEFINITIONS keys
 */
export type QuotaId = keyof typeof QUOTA_DEFINITIONS;

/**
 * Get quota definition by ID
 */
export function getQuotaDefinition(quotaId: QuotaId): QuotaDefinition {
  return QUOTA_DEFINITIONS[quotaId];
}

/**
 * Type guard to check if a string is a valid QuotaId
 */
export function isValidQuotaId(id: string): id is QuotaId {
  return id in QUOTA_DEFINITIONS;
}

/**
 * Get all enabled quota definitions
 */
export function getEnabledQuotas(): QuotaDefinition[] {
  return Object.values(QUOTA_DEFINITIONS).filter((q) => q.enabled);
}

/**
 * Get all quota IDs
 */
export function getAllQuotaIds(): QuotaId[] {
  return Object.keys(QUOTA_DEFINITIONS) as QuotaId[];
}
