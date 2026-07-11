/**
 * Quota Service
 *
 * Core service layer for centralized quota management with atomic operations.
 * Uses DynamoDB conditional updates to prevent race conditions.
 */

import { UserQuota, type UserQuotaItem } from "@/entities/user-quota";
import { quotaClient, QUOTA_TABLE } from "@/entities/client";
import {
  getQuotaDefinition,
  getInitialAmountForTier,
  getAllQuotaIds,
  type QuotaId,
  type QuotaTier,
  type ResetPolicy,
} from "@/lib/quota-definitions";

// Re-export types for convenience
export type { QuotaId, QuotaTier, UserQuotaItem };
export { getQuotaDefinition, getInitialAmountForTier };

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
 * Auto-creates quota record on first access with tier-based limits.
 *
 * @param userId - The user's ID
 * @param quotaId - The quota type to get/initialize
 * @param tier - The user's tier (required for initialization, defaults to "zero")
 */
export async function getOrInitQuota(
  userId: string,
  quotaId: QuotaId,
  tier: QuotaTier = "zero"
): Promise<UserQuotaItem> {
  const definition = getQuotaDefinition(quotaId);

  // Try to get existing quota
  const result = await UserQuota.get({ userId, quotaId }).go();

  if (result.data) {
    // Check if needs automatic reset
    if (needsReset(result.data)) {
      await resetQuotaToTier(userId, quotaId, tier);
      const refreshed = await UserQuota.get({ userId, quotaId }).go();
      return refreshed.data!;
    }
    return result.data;
  }

  // Initialize new quota record with tier-based limits
  const initialAmount = getInitialAmountForTier(quotaId, tier);
  const nextResetAt = calculateNextReset(definition.resetPolicy);

  const newQuota = {
    userId,
    quotaId,
    remaining: initialAmount,
    initialAmount: initialAmount,
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
 *
 * @param userId - The user's ID
 * @param quotaId - The quota type to check
 * @param amount - Amount to check for (default 1)
 * @param tier - The user's tier (for initialization if needed)
 */
export async function checkQuota(
  userId: string,
  quotaId: QuotaId,
  amount: number = 1,
  tier: QuotaTier = "zero"
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

  const quota = await getOrInitQuota(userId, quotaId, tier);

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
 *
 * @param userId - The user's ID
 * @param quotaId - The quota type to consume
 * @param amount - Amount to consume (default 1)
 * @param tier - The user's tier (for initialization if needed)
 */
export async function consumeQuota(
  userId: string,
  quotaId: QuotaId,
  amount: number = 1,
  tier: QuotaTier = "zero"
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
  await getOrInitQuota(userId, quotaId, tier);

  // Build ElectroDB-compatible keys
  // ElectroDB key format: $service#attribute_value
  const pk = `$quota#userid_${userId}`;
  const sk = `$userquota_1#quotaid_${quotaId}`;

  try {
    // Atomic conditional update using raw DynamoDB
    const params = {
      TableName: QUOTA_TABLE,
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

    const result = await quotaClient.update(params);

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
      const quota = await getOrInitQuota(userId, quotaId, tier);
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
 * Won't exceed the user's initialAmount (stored in their quota record).
 */
export async function restoreQuota(
  userId: string,
  quotaId: QuotaId,
  amount: number = 1
): Promise<{ success: boolean; remaining: number }> {
  const quota = await getOrInitQuota(userId, quotaId);

  // Calculate new remaining (capped at user's initialAmount)
  const maxAmount = quota.initialAmount;
  const newRemaining = Math.min(quota.remaining + amount, maxAmount);

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
 * Reset quota to the user's stored initial amount.
 * Called automatically when nextResetAt is reached, or manually by admin.
 * Uses the initialAmount stored in the user's quota record.
 */
export async function resetQuota(
  userId: string,
  quotaId: QuotaId
): Promise<{ success: boolean; remaining: number }> {
  const definition = getQuotaDefinition(quotaId);
  const quota = await getOrInitQuota(userId, quotaId);
  const nextResetAt = calculateNextReset(definition.resetPolicy);

  await UserQuota.patch({ userId, quotaId })
    .set({
      remaining: quota.initialAmount,
      lastResetAt: Date.now(),
      ...(nextResetAt ? { nextResetAt } : {}),
    })
    .go();

  return {
    success: true,
    remaining: quota.initialAmount,
  };
}

/**
 * Reset quota to tier-based amount.
 * Used when user's tier changes or for tier-aware resets.
 */
export async function resetQuotaToTier(
  userId: string,
  quotaId: QuotaId,
  tier: QuotaTier
): Promise<{ success: boolean; remaining: number }> {
  const definition = getQuotaDefinition(quotaId);
  const initialAmount = getInitialAmountForTier(quotaId, tier);
  const nextResetAt = calculateNextReset(definition.resetPolicy);

  await UserQuota.patch({ userId, quotaId })
    .set({
      remaining: initialAmount,
      initialAmount: initialAmount,
      lastResetAt: Date.now(),
      ...(nextResetAt ? { nextResetAt } : {}),
    })
    .go();

  return {
    success: true,
    remaining: initialAmount,
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
 * List every user's consumption for a single quota type in ONE GSI query.
 *
 * Reads the existing `byQuotaRemaining` GSI (pk = quotaId) with `pages: "all"`
 * and maps each row to the bulk shape consumed by run.human. This is a read-only
 * admin/analytics query (ADMN-04) — no per-user fan-out, no schema change.
 *
 * @param quotaId - The quota type to report on (e.g. "gpx_upload")
 * @returns One row per user holding that quota: { userId, consumptionCount, remaining, updatedAt }
 */
export async function listQuotaByType(
  quotaId: string
): Promise<
  Array<{
    userId: string;
    consumptionCount: number;
    remaining: number;
    updatedAt: number | undefined;
  }>
> {
  const result = await UserQuota.query
    .byQuotaRemaining({ quotaId })
    .go({ pages: "all" });

  return result.data.map((q) => ({
    userId: q.userId,
    consumptionCount: q.consumptionCount ?? 0,
    remaining: q.remaining,
    updatedAt: q.updatedAt,
  }));
}

/**
 * Batch check multiple quotas at once.
 * Useful for checking if a user can perform an action that requires multiple quotas.
 */
export async function checkMultipleQuotas(
  userId: string,
  quotas: Array<{ quotaId: QuotaId; amount: number }>,
  tier: QuotaTier = "zero"
): Promise<{
  allAllowed: boolean;
  results: QuotaCheckResult[];
}> {
  const results = await Promise.all(
    quotas.map(({ quotaId, amount }) => checkQuota(userId, quotaId, amount, tier))
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
  // Ensure quota exists first
  await getOrInitQuota(userId, quotaId);
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

/**
 * Upgrade a user's quotas to a new tier.
 * Updates all quotas to the new tier's limits.
 */
export async function upgradeUserToTier(
  userId: string,
  newTier: QuotaTier,
  quotaIds?: QuotaId[]
): Promise<void> {
  const idsToUpgrade = quotaIds ?? getAllQuotaIds();

  await Promise.all(
    idsToUpgrade.map((quotaId) => resetQuotaToTier(userId, quotaId, newTier))
  );
}
