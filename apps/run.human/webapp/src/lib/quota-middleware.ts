/**
 * Quota Middleware Helpers
 *
 * Provides convenient patterns for integrating quota checks into API routes.
 * Uses the centralized quota service in run.auth via quota-client.
 */

import { NextResponse } from "next/server";
import {
  checkQuota as clientCheckQuota,
  consumeQuota as clientConsumeQuota,
  QuotaExceededError,
  type QuotaId,
  type QuotaTier,
  type QuotaConsumeResult,
} from "@/lib/quota-client";

// Re-export types for convenience
export type { QuotaId, QuotaTier, QuotaConsumeResult };
export { QuotaExceededError };

/**
 * Quota exceeded error response structure
 */
export interface QuotaErrorResponse {
  error: string;
  code: string;
  details: {
    quotaId: QuotaId;
    remaining: number;
    requested: number;
    message: string;
  };
}

/**
 * Standard quota exceeded response (HTTP 429).
 * Use this for consistent error responses across all endpoints.
 */
export function quotaExceededResponse(
  quotaId: QuotaId,
  remaining: number,
  requested: number
): NextResponse<QuotaErrorResponse> {
  return NextResponse.json(
    {
      error: "Quota exceeded",
      code: "QUOTA_EXCEEDED",
      details: {
        quotaId,
        remaining,
        requested,
        message: `You have ${remaining} ${quotaId.replace(/_/g, " ")} remaining, but ${requested} was requested.`,
      },
    },
    { status: 429 }
  );
}

/**
 * Imperative quota check - throws QuotaExceededError if insufficient.
 * Use inside route handlers for simple read-only checks.
 *
 * @example
 * ```ts
 * export async function GET(request: NextRequest) {
 *   const session = await auth();
 *   if (!session?.user?.id) return NextResponse.json({...}, {status: 401});
 *
 *   // This throws QuotaExceededError if insufficient
 *   await requireQuota(session.user.id, "file_upload", 1, "human");
 *
 *   // Continue with logic...
 * }
 * ```
 */
export async function requireQuota(
  userId: string,
  quotaId: QuotaId,
  amount: number = 1,
  tier?: QuotaTier
): Promise<void> {
  const result = await clientCheckQuota(userId, quotaId, amount, tier);

  if (!result.allowed) {
    throw new QuotaExceededError(quotaId, result.remaining, result.requested);
  }
}

/**
 * Check and consume quota in one operation.
 * Returns result object for manual handling.
 *
 * @example
 * ```ts
 * const quotaResult = await tryConsumeQuota(userId, "file_upload", 1, "human");
 * if (!quotaResult.success) {
 *   return quotaExceededResponse(quotaResult.quotaId, quotaResult.remaining, 1);
 * }
 * // Proceed with upload...
 * ```
 */
export async function tryConsumeQuota(
  userId: string,
  quotaId: QuotaId,
  amount: number = 1,
  tier?: QuotaTier
): Promise<QuotaConsumeResult> {
  return clientConsumeQuota(userId, quotaId, amount, tier);
}

/**
 * Consume quota and throw if failed.
 * Recommended for most use cases - consume first, then perform action.
 *
 * @example
 * ```ts
 * try {
 *   await requireAndConsumeQuota(userId, "file_upload", 1, "human");
 *   // Quota consumed, proceed with action
 * } catch (error) {
 *   const quotaError = handleQuotaError(error);
 *   if (quotaError) return quotaError;
 *   throw error;
 * }
 * ```
 */
export async function requireAndConsumeQuota(
  userId: string,
  quotaId: QuotaId,
  amount: number = 1,
  tier?: QuotaTier
): Promise<void> {
  const result = await clientConsumeQuota(userId, quotaId, amount, tier);

  if (!result.success) {
    throw new QuotaExceededError(quotaId, result.remaining, amount);
  }
}

/**
 * Error handler helper for catch blocks.
 * Returns a NextResponse if the error is a QuotaExceededError, null otherwise.
 *
 * @example
 * ```ts
 * catch (error) {
 *   const quotaError = handleQuotaError(error);
 *   if (quotaError) return quotaError;
 *   // Handle other errors...
 * }
 * ```
 */
export function handleQuotaError(
  error: unknown
): NextResponse<QuotaErrorResponse> | null {
  if (error instanceof QuotaExceededError) {
    return quotaExceededResponse(
      error.quotaId,
      error.remaining,
      error.requested
    );
  }
  return null;
}

/**
 * Type guard to check if an error is a QuotaExceededError
 */
export function isQuotaExceededError(
  error: unknown
): error is QuotaExceededError {
  return error instanceof QuotaExceededError;
}

/**
 * Helper to get user tier from services array
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
