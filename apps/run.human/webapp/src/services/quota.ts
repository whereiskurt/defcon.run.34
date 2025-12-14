/**
 * Quota Service
 *
 * Core service layer for quota management with atomic operations.
 * Uses DynamoDB conditional updates to prevent race conditions.
 */

import { UserQuota, type UserQuotaItem } from "@/entities/user-quota";
import { electroClient, ELECTRO_TABLE } from "@/entities/client";
import {
  QUOTA_DEFINITIONS,
  getQuotaDefinition,
  type QuotaId,
  type ResetPolicy,
} from "@/lib/quota-definitions";

// Re-export types for convenience
export type { QuotaId };
export { getQuotaDefinition };

/**
 * Result of a quota check (read-only, no consumption)
 */
export interface QuotaCheckResult {
  allowed: boolean;
  remaining: number;
  requested: number;
  quotaId: QuotaId;
  wouldExceed: boolean;
}

/**
 * Result of a quota consumption attempt
 */
export interface QuotaConsumeResult {
  success: boolean;
  remaining: number;
  consumed: number;
  quotaId: QuotaId;
  error?: "insufficient_quota" | "quota_disabled" | "condition_failed";
}

/**
 * Calculate next reset timestamp based on policy
 */
function calculateNextReset(policy: ResetPolicy): number | undefined {
  if (policy === "none" || policy === "event") {
    return undefined;
  }

  const now = new Date();
  const utcNow = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );

  switch (policy) {
    case "daily":
      utcNow.setUTCDate(utcNow.getUTCDate() + 1);
      break;
    case "weekly":
      // Days until next Monday (1 = Monday in getUTCDay where 0 = Sunday)
      const daysUntilMonday = (8 - utcNow.getUTCDay()) % 7 || 7;
      utcNow.setUTCDate(utcNow.getUTCDate() + daysUntilMonday);
      break;
    case "monthly":
      utcNow.setUTCMonth(utcNow.getUTCMonth() + 1);
      utcNow.setUTCDate(1);
      break;
  }

  return utcNow.getTime();
}

/**
 * Check if quota needs reset based on nextResetAt
 */
function needsReset(quota: UserQuotaItem): boolean {
  if (!quota.nextResetAt) return false;
  return Date.now() >= quota.nextResetAt;
}

/**
 * Get or initialize a user's quota.
 * Auto-creates quota record on first access with default values.
 */
export async function getOrInitQuota(
  userId: string,
  quotaId: QuotaId
): Promise<UserQuotaItem> {
  const definition = getQuotaDefinition(quotaId);

  // Try to get existing quota
  const result = await UserQuota.get({ userId, quotaId }).go();

  if (result.data) {
    // Check if needs automatic reset
    if (needsReset(result.data)) {
      await resetQuota(userId, quotaId);
      const refreshed = await UserQuota.get({ userId, quotaId }).go();
      return refreshed.data!;
    }
    return result.data;
  }

  // Initialize new quota record
  const nextResetAt = calculateNextReset(definition.resetPolicy);

  const newQuota = {
    userId,
    quotaId,
    remaining: definition.initialAmount,
    initialAmount: definition.initialAmount,
    totalConsumed: 0,
    consumptionCount: 0,
    lastResetAt: Date.now(),
    ...(nextResetAt && { nextResetAt }),
  };

  try {
    await UserQuota.create(newQuota).go();
  } catch (error: unknown) {
    // Handle race condition where another request created the record
    if (
      error instanceof Error &&
      error.message.includes("conditional request failed")
    ) {
      const existing = await UserQuota.get({ userId, quotaId }).go();
      if (existing.data) return existing.data;
    }
    throw error;
  }

  // Return the created quota
  const created = await UserQuota.get({ userId, quotaId }).go();
  return created.data!;
}

/**
 * Check if user has sufficient quota without consuming.
 * Use this for read-only checks before showing UI options.
 */
export async function checkQuota(
  userId: string,
  quotaId: QuotaId,
  amount: number = 1
): Promise<QuotaCheckResult> {
  const definition = getQuotaDefinition(quotaId);

  if (!definition.enabled) {
    return {
      allowed: false,
      remaining: 0,
      requested: amount,
      quotaId,
      wouldExceed: true,
    };
  }

  const quota = await getOrInitQuota(userId, quotaId);

  return {
    allowed: quota.remaining >= amount,
    remaining: quota.remaining,
    requested: amount,
    quotaId,
    wouldExceed: quota.remaining < amount,
  };
}

/**
 * Consume quota atomically using DynamoDB conditional update.
 * Returns success only if quota was available and consumed.
 *
 * Uses raw DynamoDB update for atomic conditional decrement.
 */
export async function consumeQuota(
  userId: string,
  quotaId: QuotaId,
  amount: number = 1
): Promise<QuotaConsumeResult> {
  const definition = getQuotaDefinition(quotaId);

  if (!definition.enabled) {
    return {
      success: false,
      remaining: 0,
      consumed: 0,
      quotaId,
      error: "quota_disabled",
    };
  }

  // Ensure quota exists (auto-init if needed)
  await getOrInitQuota(userId, quotaId);

  // Build ElectroDB-compatible keys
  // ElectroDB key format: $service#attribute_value
  const pk = `$run#userid_${userId}`;
  const sk = `$userquota_1#quotaid_${quotaId}`;

  try {
    // Atomic conditional update using raw DynamoDB
    const params = {
      TableName: ELECTRO_TABLE,
      Key: { pk, sk },
      UpdateExpression: `
        SET #remaining = #remaining - :amount,
            #totalConsumed = #totalConsumed + :amount,
            #consumptionCount = #consumptionCount + :one,
            #updatedAt = :now
      `,
      ConditionExpression: "#remaining >= :amount",
      ExpressionAttributeNames: {
        "#remaining": "remaining",
        "#totalConsumed": "totalConsumed",
        "#consumptionCount": "consumptionCount",
        "#updatedAt": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":amount": amount,
        ":one": 1,
        ":now": Date.now(),
      },
      ReturnValues: "ALL_NEW" as const,
    };

    const result = await electroClient.update(params);

    return {
      success: true,
      remaining: result.Attributes?.remaining ?? 0,
      consumed: amount,
      quotaId,
    };
  } catch (error: unknown) {
    // Check for conditional check failure (insufficient quota)
    if (
      error instanceof Error &&
      error.name === "ConditionalCheckFailedException"
    ) {
      const quota = await getOrInitQuota(userId, quotaId);
      return {
        success: false,
        remaining: quota.remaining,
        consumed: 0,
        quotaId,
        error: "insufficient_quota",
      };
    }
    throw error;
  }
}

/**
 * Restore quota (for refunds/rollbacks).
 * Won't exceed maxAmount from definition.
 */
export async function restoreQuota(
  userId: string,
  quotaId: QuotaId,
  amount: number = 1
): Promise<{ success: boolean; remaining: number }> {
  const definition = getQuotaDefinition(quotaId);
  const quota = await getOrInitQuota(userId, quotaId);

  // Calculate new remaining (capped at maxAmount)
  const newRemaining = Math.min(quota.remaining + amount, definition.maxAmount);

  await UserQuota.patch({ userId, quotaId })
    .set({
      remaining: newRemaining,
      totalConsumed: Math.max(0, (quota.totalConsumed ?? 0) - amount),
    })
    .go();

  return {
    success: true,
    remaining: newRemaining,
  };
}

/**
 * Reset quota to initial amount.
 * Called automatically when nextResetAt is reached, or manually by admin.
 */
export async function resetQuota(
  userId: string,
  quotaId: QuotaId
): Promise<{ success: boolean; remaining: number }> {
  const definition = getQuotaDefinition(quotaId);
  const nextResetAt = calculateNextReset(definition.resetPolicy);

  await UserQuota.patch({ userId, quotaId })
    .set({
      remaining: definition.initialAmount,
      lastResetAt: Date.now(),
      ...(nextResetAt ? { nextResetAt } : {}),
    })
    .go();

  return {
    success: true,
    remaining: definition.initialAmount,
  };
}

/**
 * Get all quotas for a user.
 * Returns only quotas that have been initialized (used at least once).
 */
export async function getUserQuotas(userId: string): Promise<UserQuotaItem[]> {
  const result = await UserQuota.query.primary({ userId }).go();
  return result.data;
}

/**
 * Batch check multiple quotas at once.
 * Useful for checking if a user can perform an action that requires multiple quotas.
 */
export async function checkMultipleQuotas(
  userId: string,
  quotas: Array<{ quotaId: QuotaId; amount: number }>
): Promise<{
  allAllowed: boolean;
  results: QuotaCheckResult[];
}> {
  const results = await Promise.all(
    quotas.map(({ quotaId, amount }) => checkQuota(userId, quotaId, amount))
  );

  return {
    allAllowed: results.every((r) => r.allowed),
    results,
  };
}

/**
 * Set a custom quota limit for a specific user.
 * Use for VIP users, sponsors, or admin adjustments.
 */
export async function setUserQuotaLimit(
  userId: string,
  quotaId: QuotaId,
  newLimit: number,
  resetToNewLimit: boolean = true
): Promise<void> {
  const quota = await getOrInitQuota(userId, quotaId);
  const definition = getQuotaDefinition(quotaId);

  const updateData: Record<string, number> = {
    initialAmount: newLimit,
  };

  if (resetToNewLimit) {
    updateData.remaining = newLimit;
    updateData.lastResetAt = Date.now();
    const nextResetAt = calculateNextReset(definition.resetPolicy);
    if (nextResetAt) {
      updateData.nextResetAt = nextResetAt;
    }
  }

  await UserQuota.patch({ userId, quotaId }).set(updateData).go();
}
