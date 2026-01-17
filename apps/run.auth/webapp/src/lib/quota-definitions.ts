/**
 * Quota System Definitions
 *
 * Type-safe quota type definitions for the DefCon 34 centralized quota service.
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
 * User tiers for quota limits
 * - zero: Users who haven't been granted upload access (zero uploads)
 * - upload: Regular authenticated users with standard upload limits
 * - admin: Administrators with elevated limits
 */
export type QuotaTier = "zero" | "upload" | "admin";

/**
 * Quota limits per tier
 */
export interface TierLimits {
  zero: number;
  upload: number;
  admin: number;
}

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
  /** Quota limits per tier */
  tierLimits: TierLimits;
  /** When the quota resets */
  resetPolicy: ResetPolicy;
  /** Whether this quota is currently active */
  enabled: boolean;
}

/**
 * All quota definitions
 *
 * Add new quota types here. Each quota must have a unique id.
 * Tier limits: zero=0 (blocked), upload=standard, admin=elevated
 */
export const QUOTA_DEFINITIONS = {
  // General file upload limit (applies to all upload types)
  file_upload: {
    id: "file_upload",
    name: "File Uploads",
    description: "Total file uploads (GPX or photo)",
    tierLimits: {
      zero: 0,
      upload: 100,
      admin: 1000,
    },
    resetPolicy: "none" as const,
    enabled: true,
  },

  // GPX-specific upload limit
  gpx_upload: {
    id: "gpx_upload",
    name: "GPX Uploads",
    description: "GPX track file uploads",
    tierLimits: {
      zero: 0,
      upload: 50,
      admin: 500,
    },
    resetPolicy: "none" as const,
    enabled: true,
  },

  // Photo-specific upload limit
  photo_upload: {
    id: "photo_upload",
    name: "Photo Uploads",
    description: "Photo file uploads",
    tierLimits: {
      zero: 0,
      upload: 100,
      admin: 1000,
    },
    resetPolicy: "none" as const,
    enabled: true,
  },

  // Strava sync limit
  strava_sync: {
    id: "strava_sync",
    name: "Strava Syncs",
    description: "Number of Strava activity syncs",
    tierLimits: {
      zero: 0,
      upload: 16,
      admin: 100,
    },
    resetPolicy: "none" as const,
    enabled: true,
  },

  // GPS check-in limit
  checkin: {
    id: "checkin",
    name: "GPS Check-ins",
    description: "GPS location check-ins",
    tierLimits: {
      zero: 0,
      upload: 50,
      admin: 500,
    },
    resetPolicy: "none" as const,
    enabled: true,
  },

  // Meshtastic radio registration limit
  meshtastic_radio: {
    id: "meshtastic_radio",
    name: "Meshtastic Radios",
    description: "Meshtastic radio registrations",
    tierLimits: {
      zero: 0,
      upload: 5,
      admin: 20,
    },
    resetPolicy: "none" as const,
    enabled: true,
  },

  // QR scan limit (for scanning other users)
  qr_scan: {
    id: "qr_scan",
    name: "QR Scans",
    description: "QR code scans for social connections",
    tierLimits: {
      zero: 0,
      upload: 100,
      admin: 1000,
    },
    resetPolicy: "none" as const,
    enabled: true,
  },

  // Display name change limit
  displayname_change: {
    id: "displayname_change",
    name: "Display Name Changes",
    description: "Display name changes per event",
    tierLimits: {
      zero: 0,
      upload: 3,
      admin: 10,
    },
    resetPolicy: "event" as const,
    enabled: true,
  },

  // QR sheet generation limit
  qr_sheet: {
    id: "qr_sheet",
    name: "QR Sheet Downloads",
    description: "QR code sheet PDF downloads",
    tierLimits: {
      zero: 0,
      upload: 10,
      admin: 100,
    },
    resetPolicy: "none" as const,
    enabled: true,
  },
} as const;

/**
 * Determine user's quota tier from their services array
 * Priority: admin > upload > zero
 */
export function getUserTier(services: string[]): QuotaTier {
  if (services.includes("admin")) {
    return "admin";
  }
  if (services.includes("run") || services.includes("human")) {
    return "upload";
  }
  return "zero";
}

/**
 * Get the initial amount for a quota based on user's tier
 */
export function getInitialAmountForTier(
  quotaId: QuotaId,
  tier: QuotaTier
): number {
  const definition = QUOTA_DEFINITIONS[quotaId];
  return definition.tierLimits[tier];
}

/**
 * Get the max amount for a quota based on user's tier
 */
export function getMaxAmountForTier(quotaId: QuotaId, tier: QuotaTier): number {
  // Max amount equals initial amount for the tier
  return getInitialAmountForTier(quotaId, tier);
}

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
