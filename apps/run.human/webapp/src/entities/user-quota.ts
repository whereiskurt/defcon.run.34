import { Entity } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * UserQuota Entity
 *
 * Tracks per-user quota consumption with countdown-to-zero semantics.
 * Each user gets a record per quota type on first use (auto-initialized).
 *
 * The `remaining` field is the source of truth for available quota.
 * All consumption modifications use DynamoDB conditional expressions for atomicity.
 *
 * Indexes:
 * - primary: Get a user's specific quota by userId + quotaId
 * - byQuotaRemaining: Find users by quota type and remaining amount (admin queries)
 */
export const UserQuota = new Entity(
  {
    model: {
      entity: "UserQuota",
      version: "1",
      service: "run",
    },
    attributes: {
      // Composite key components
      userId: {
        type: "string",
        required: true,
      },
      quotaId: {
        type: "string",
        required: true,
      },

      // Quota state - the core countdown value
      remaining: {
        type: "number",
        required: true,
      },
      // The initial limit this user was given (may differ for VIP users)
      initialAmount: {
        type: "number",
        required: true,
      },

      // Consumption tracking for analytics
      totalConsumed: {
        type: "number",
        default: 0,
      },
      consumptionCount: {
        type: "number",
        default: 0,
      },

      // Reset tracking
      lastResetAt: {
        type: "number",
      },
      nextResetAt: {
        type: "number", // Computed based on reset policy, undefined if policy is "none"
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
    },
    indexes: {
      // Primary: Get user's quota for specific type
      primary: {
        pk: { field: "pk", composite: ["userId"] },
        sk: { field: "sk", composite: ["quotaId"] },
      },
      // GSI1: Find users by quota type and remaining (for admin/analytics)
      byQuotaRemaining: {
        index: "gsi1pk-gsi1sk-index",
        pk: { field: "gsi1pk", composite: ["quotaId"] },
        sk: { field: "gsi1sk", composite: ["remaining"] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

/**
 * Type for UserQuota item
 * Note: Optional fields may be undefined when returned from queries
 */
export type UserQuotaItem = {
  userId: string;
  quotaId: string;
  remaining: number;
  initialAmount: number;
  totalConsumed?: number;
  consumptionCount?: number;
  lastResetAt?: number;
  nextResetAt?: number;
  createdAt?: number;
  updatedAt?: number;
};
