import { Entity, type EntityItem } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * BudgetCounter Entity
 *
 * Daily rollup for the Haiku reconciliation Lambda's $20/day cost cap.
 * Each UTC date gets a single row; the Lambda calls `checkBudget()` before
 * every Anthropic API call and short-circuits to
 * `BibReconcile.status="ambiguous"` + admin email when the cap is hit.
 *
 * Lives on the shared `run-human-electro` table alongside `Bib` +
 * `BibReconcile` (same PK/SK pattern; single-table design).
 *
 * Design contract (Phase 22 AI-SPEC §"Budget-Cap Strategy"):
 * - `date` (PK, ISO date `YYYY-MM-DD`, UTC): stable across regions since
 *   the Lambda pins UTC via `new Date().toISOString().slice(0, 10)`.
 * - `costUsdCents`: accumulated cost in cents. Initialized to 0 at first
 *   write; incremented atomically via ElectroDB `.update().add({costUsdCents: N})`.
 * - `invocationCount`: number of Haiku calls made today. Same
 *   `.add({invocationCount: 1})` idempotent-safe increment.
 * - Cap: 2000 cents = $20/day (matches AI-SPEC §"Budget-Cap Strategy").
 *   Change requires PLAN.md update + a redeploy of the Lambda code.
 * - No reset job needed — each new UTC day gets a fresh row.
 *
 * IAM: The reconcile Lambda module already grants
 *   dynamodb:GetItem + dynamodb:UpdateItem on the electro-table ARN
 *   (infra/terraform/modules/bib-reconcile-lambda/v1.0.0/iam.tf
 *   sid=ElectroTableAccess).
 */
export const BudgetCounter = new Entity(
  {
    model: {
      entity: "BudgetCounter",
      version: "1",
      service: "run",
    },
    attributes: {
      // UTC ISO date `YYYY-MM-DD` — never use a locale-formatted date.
      date: {
        type: "string",
        required: true,
      },
      costUsdCents: {
        type: "number",
        default: 0,
      },
      invocationCount: {
        type: "number",
        default: 0,
      },
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
  { client: electroClient, table: ELECTRO_TABLE }
);

export type BudgetCounterItem = EntityItem<typeof BudgetCounter>;

/**
 * Hard daily cap in cents. AI-SPEC §"Budget-Cap Strategy" pins this at
 * $20/day ($0.001/invocation at Haiku 4.5 pricing ≈ 20,000 invocations,
 * well above Kurt/Jesse's expected 10-100/day forwarding volume).
 *
 * Exported so tests can pin their assertions against the same constant.
 */
export const DAILY_BUDGET_CAP_CENTS = 2000;

/**
 * Return today's UTC date key (`YYYY-MM-DD`). Always UTC so a Lambda
 * bouncing between regions shares a single row per calendar day.
 *
 * Exposed for tests that need to pin `today` deterministically.
 */
export function todayUtcKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Result shape returned by {@link checkBudget}.
 */
export interface BudgetCheckResult {
  /**
   * `true` when the daily cap has NOT yet been exceeded and the Lambda
   * may proceed with a Haiku call. `false` when the cap has been hit —
   * caller MUST short-circuit, mark the BibReconcile row as `ambiguous`
   * with `notes: "daily_budget_exhausted"`, and email admin (Plan
   * 22-04-3).
   */
  allowed: boolean;
  /** Current cumulative spend for `dateKey`, in cents. */
  spentCents: number;
  /** The cap being enforced, in cents. Constant across calls (see
   * {@link DAILY_BUDGET_CAP_CENTS}) but returned so callers don't
   * hard-code it separately. */
  capCents: number;
}

/**
 * Read the daily budget counter for `dateKey` and decide whether the
 * caller may proceed with a Haiku invocation.
 *
 * A missing row (first invocation of the day) counts as spentCents=0
 * and returns allowed=true. Callers should NOT create the row here —
 * increment the counter AFTER a successful Haiku call via
 * {@link incrementBudget} so a failed API call doesn't burn budget.
 *
 * @param dateKey UTC date key from {@link todayUtcKey}.
 */
export async function checkBudget(
  dateKey: string
): Promise<BudgetCheckResult> {
  const result = await BudgetCounter.get({ date: dateKey }).go();
  const spentCents = result.data?.costUsdCents ?? 0;
  return {
    allowed: spentCents < DAILY_BUDGET_CAP_CENTS,
    spentCents,
    capCents: DAILY_BUDGET_CAP_CENTS,
  };
}

/**
 * Atomically increment today's counter by `costCentsDelta` (Phase
 * 22-04-3 uses 100 = $0.001/invocation conservative estimate).
 *
 * Uses ElectroDB `upsert().add({...})` shape so the row is created on
 * first write of the day and incremented on subsequent writes. Both
 * paths are single UpdateItem calls under the hood (idempotent on
 * retry via ADD's monotonic-increment semantics).
 *
 * @param dateKey UTC date key from {@link todayUtcKey}.
 * @param costCentsDelta Positive integer number of cents to add.
 */
export async function incrementBudget(
  dateKey: string,
  costCentsDelta: number
): Promise<BudgetCounterItem> {
  const delta = Math.max(0, Math.trunc(costCentsDelta));
  const result = await BudgetCounter.upsert({ date: dateKey })
    .add({
      costUsdCents: delta,
      invocationCount: 1,
    })
    .go({ response: "all_new" });
  return result.data as BudgetCounterItem;
}
