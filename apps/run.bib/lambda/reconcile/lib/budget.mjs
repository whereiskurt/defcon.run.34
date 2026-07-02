/**
 * Daily-budget cap for the Haiku reconciliation Lambda.
 *
 * Mirrors the webapp entity at
 * `apps/run.bib/webapp/src/entities/budget-counter.ts`. The Lambda can't
 * import from the webapp path (different tsconfig + no bundling boundary),
 * so this file re-declares the same ElectroDB entity + `checkBudget` /
 * `incrementBudget` / `todayUtcKey` helpers with an identical semantic
 * contract.
 *
 * Cap: 2000 cents = $20/day (AI-SPEC §"Budget-Cap Strategy"). When
 * `checkBudget(today).allowed === false`, callers MUST skip the Haiku
 * invocation, mark the BibReconcile row as `ambiguous` with
 * `notes: "daily_budget_exhausted"`, and email admin (see notifier.mjs).
 *
 * Contract is IDENTICAL to the webapp entity so tests can pin against
 * both without divergence:
 *   - checkBudget(dateKey) → { allowed, spentCents, capCents }
 *   - incrementBudget(dateKey, deltaCents) → BudgetCounterItem
 *   - todayUtcKey(now?) → "YYYY-MM-DD" (UTC)
 *   - DAILY_BUDGET_CAP_CENTS = 2000
 *
 * IAM is already scoped in `bib-reconcile-lambda/v1.0.0/iam.tf`
 * (sid=ElectroTableAccess) — dynamodb:GetItem + dynamodb:UpdateItem on the
 * shared electro table cover both operations.
 */

import { Entity } from "electrodb";
import { ddbClient, ELECTRO_TABLE } from "./entities.mjs";

/** AI-SPEC §"Budget-Cap Strategy": $20/day. Match webapp entity constant. */
export const DAILY_BUDGET_CAP_CENTS = 2000;

/** Return today's UTC date key (`YYYY-MM-DD`). Deterministic across regions. */
export function todayUtcKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * BudgetCounter entity — mirror of the webapp entity. PK/SK layout must
 * exactly match the webapp declaration (service="run", entity="BudgetCounter",
 * version="1", primary key composite=["date"]).
 */
export const BudgetCounter = new Entity(
  {
    model: {
      entity: "BudgetCounter",
      version: "1",
      service: "run",
    },
    attributes: {
      date: { type: "string", required: true },
      costUsdCents: { type: "number", default: 0 },
      invocationCount: { type: "number", default: 0 },
      createdAt: {
        type: "string",
        default: () => new Date().toISOString(),
        readOnly: true,
      },
      updatedAt: {
        type: "string",
        default: () => new Date().toISOString(),
        watch: "*",
        set: () => new Date().toISOString(),
      },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["date"] },
        sk: { field: "sk", composite: [] },
      },
    },
  },
  { client: ddbClient, table: ELECTRO_TABLE }
);

/**
 * Check whether today's Haiku budget has been exhausted.
 *
 * Reads `BudgetCounter[date=dateKey]`; a missing row (first invocation of
 * the day) is treated as `spentCents=0` — the caller does NOT create the
 * row here. `incrementBudget` handles first-write on the AFTER-success
 * path so a failed Anthropic call does not burn cap headroom.
 *
 * @param {string} dateKey UTC date key from {@link todayUtcKey}.
 * @returns {Promise<{allowed: boolean, spentCents: number, capCents: number}>}
 */
export async function checkBudget(dateKey) {
  const result = await BudgetCounter.get({ date: dateKey }).go();
  const spentCents = result.data?.costUsdCents ?? 0;
  return {
    allowed: spentCents < DAILY_BUDGET_CAP_CENTS,
    spentCents,
    capCents: DAILY_BUDGET_CAP_CENTS,
  };
}

/**
 * Atomically increment today's counter by `costCentsDelta`. Task 22-04-03
 * calls this AFTER a successful Haiku invocation with a fixed 100¢
 * ($0.001) conservative estimate per AI-SPEC §"Pricing/Budget".
 *
 * Uses `.upsert().add({...})` which is a single DDB UpdateItem — creates
 * the row on first-write-of-the-day and increments on subsequent writes.
 * ADD is monotonic-safe so concurrent Lambdas can race without losing
 * counter increments.
 *
 * @param {string} dateKey UTC date key from {@link todayUtcKey}.
 * @param {number} costCentsDelta Positive integer cents to add. Negative /
 *   NaN / non-integer values are clamped to 0 (never reduces the counter).
 */
export async function incrementBudget(dateKey, costCentsDelta) {
  const delta = Math.max(0, Math.trunc(costCentsDelta));
  const result = await BudgetCounter.upsert({ date: dateKey })
    .add({
      costUsdCents: delta,
      invocationCount: 1,
    })
    .go({ response: "all_new" });
  return result.data;
}
