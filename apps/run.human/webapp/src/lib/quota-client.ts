/**
 * Quota Client for run.human
 *
 * HTTP client for calling the centralized quota service in run.auth.
 * Uses internal URLs and X-Internal-Secret for server-to-server auth.
 */

import { config } from "@/config";

const QUOTA_BASE_URL = config.urls.privateAuthServer;
const INTERNAL_SECRET = config.auth.internalSecret;

/**
 * Types matching the quota service API responses
 */
export type QuotaTier = "zero" | "upload" | "admin";

export type QuotaId =
  | "file_upload"
  | "gpx_upload"
  | "photo_upload"
  | "strava_sync"
  | "checkin"
  | "meshtastic_radio"
  | "qr_scan"
  | "displayname_change"
  | "qr_sheet";

export interface QuotaCheckResult {
  allowed: boolean;
  remaining: number;
  requested: number;
  quotaId: QuotaId;
  wouldExceed: boolean;
}

export interface QuotaConsumeResult {
  success: boolean;
  remaining: number;
  consumed: number;
  quotaId: QuotaId;
  error?: string;
}

export interface QuotaRestoreResult {
  success: boolean;
  remaining: number;
  restored: number;
  quotaId: QuotaId;
}

export interface QuotaInfo {
  quotaId: string;
  remaining: number;
  initialAmount: number;
  totalConsumed: number;
  consumptionCount: number;
  lastResetAt?: number;
  nextResetAt?: number;
}

export interface UserQuotasResponse {
  userId: string;
  quotaTier: QuotaTier;
  quotas: QuotaInfo[];
}

export interface QuotaDefinition {
  id: QuotaId;
  name: string;
  description: string;
  tierLimits: Record<QuotaTier, number>;
  resetPolicy: "none" | "daily" | "weekly" | "monthly" | "event";
  enabled?: boolean;
}

/**
 * Make a request to the quota service with internal auth
 */
async function quotaRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${QUOTA_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": INTERNAL_SECRET,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    const err = new Error(error.error || `HTTP ${response.status}`) as Error & {
      status: number;
      code?: string;
      details?: unknown;
    };
    err.status = response.status;
    err.code = error.code;
    err.details = error.details;
    throw err;
  }

  return response.json();
}

/**
 * Get all quotas for a user
 */
export async function getUserQuotas(userId: string): Promise<UserQuotasResponse> {
  return quotaRequest<UserQuotasResponse>(`/api/internal/quota/${userId}`);
}

/**
 * Get quota definitions (public endpoint, no auth required)
 */
export async function getQuotaDefinitions(): Promise<QuotaDefinition[]> {
  const url = `${QUOTA_BASE_URL}/api/quota/definitions`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch quota definitions: ${response.status}`);
  }

  const data = await response.json();
  return data.definitions || [];
}

/**
 * Check if user has sufficient quota (read-only)
 */
export async function checkQuota(
  userId: string,
  quotaId: QuotaId,
  amount: number = 1,
  tier?: QuotaTier
): Promise<QuotaCheckResult> {
  // For check, we need to use the user endpoint since it auto-initializes
  const quotas = await getUserQuotas(userId);
  const quota = quotas.quotas.find((q) => q.quotaId === quotaId);

  if (!quota) {
    // Quota not initialized yet - it will be auto-initialized on consume
    // For now, we can simulate the check based on tier limits
    return {
      allowed: true, // Will be properly checked on consume
      remaining: -1, // Unknown
      requested: amount,
      quotaId,
      wouldExceed: false,
    };
  }

  return {
    allowed: quota.remaining >= amount,
    remaining: quota.remaining,
    requested: amount,
    quotaId,
    wouldExceed: quota.remaining < amount,
  };
}

/**
 * Consume quota atomically
 */
export async function consumeQuota(
  userId: string,
  quotaId: QuotaId,
  amount: number = 1,
  tier?: QuotaTier
): Promise<QuotaConsumeResult> {
  try {
    const result = await quotaRequest<{
      success: boolean;
      userId: string;
      quotaId: string;
      consumed: number;
      remaining: number;
    }>(`/api/internal/quota/${userId}/${quotaId}/consume`, {
      method: "POST",
      body: JSON.stringify({ amount, tier }),
    });

    return {
      success: result.success,
      remaining: result.remaining,
      consumed: result.consumed,
      quotaId: result.quotaId as QuotaId,
    };
  } catch (error) {
    const err = error as Error & { status?: number; details?: { remaining?: number } };
    if (err.status === 429) {
      return {
        success: false,
        remaining: err.details?.remaining ?? 0,
        consumed: 0,
        quotaId,
        error: "insufficient_quota",
      };
    }
    throw error;
  }
}

/**
 * Restore quota (refund/rollback)
 */
export async function restoreQuota(
  userId: string,
  quotaId: QuotaId,
  amount: number = 1
): Promise<QuotaRestoreResult> {
  const result = await quotaRequest<{
    success: boolean;
    userId: string;
    quotaId: string;
    restored: number;
    remaining: number;
  }>(`/api/internal/quota/${userId}/${quotaId}/restore`, {
    method: "POST",
    body: JSON.stringify({ amount }),
  });

  return {
    success: result.success,
    remaining: result.remaining,
    restored: result.restored,
    quotaId: result.quotaId as QuotaId,
  };
}

/**
 * Custom error class for quota exceeded scenarios
 */
export class QuotaExceededError extends Error {
  public readonly quotaId: QuotaId;
  public readonly remaining: number;
  public readonly requested: number;

  constructor(quotaId: QuotaId, remaining: number, requested: number) {
    super(
      `Quota exceeded for ${quotaId}: ${remaining} remaining, ${requested} requested`
    );
    this.name = "QuotaExceededError";
    this.quotaId = quotaId;
    this.remaining = remaining;
    this.requested = requested;
  }
}

/**
 * Consume quota and throw if failed
 * Recommended pattern for most use cases
 */
export async function requireAndConsumeQuota(
  userId: string,
  quotaId: QuotaId,
  amount: number = 1,
  tier?: QuotaTier
): Promise<void> {
  const result = await consumeQuota(userId, quotaId, amount, tier);

  if (!result.success) {
    throw new QuotaExceededError(quotaId, result.remaining, amount);
  }
}

/**
 * Check if error is a QuotaExceededError
 */
export function isQuotaExceededError(
  error: unknown
): error is QuotaExceededError {
  return error instanceof QuotaExceededError;
}
