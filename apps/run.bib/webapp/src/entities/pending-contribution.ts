import { Entity, type EntityItem } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * PendingContribution Entity (v1.5, Kurt 2026-07-03 — "live pending view").
 *
 * Stripe payments reconcile the instant the webhook fires, so they never
 * need a pending row — they go straight to the ledger (Bib.paidStatusHistory
 * or GeneralDonation). Venmo / CashApp are different: the user hands off to
 * an external app and an organizer reconciles the receipt LATER (Phase 22-04
 * SES Lambda → BibReconcile → applyPayment). Between "user tapped Venmo" and
 * "organizer confirmed", there was previously NO per-user record — so the
 * runner's transaction history showed nothing for a payment they just made.
 *
 * A PendingContribution is that missing intent record: written when the user
 * lands on the /sponsor/{venmo,cashapp} handoff, surfaced in TransactionHistory
 * as "in progress", and cleared when the matching payment reconciles.
 *
 * Lives on the shared `run-human-electro` table (single-table design) beside
 * Bib + BibReconcile + GeneralDonation.
 *
 * Design contract:
 * - pendingId (PK) — DETERMINISTIC from (ownerSub, kind, provider, amountCents)
 *   via {@link pendingContributionId}. A page refresh re-renders the handoff
 *   and re-records the SAME intent → same PK → upsert touches createdAt rather
 *   than piling up duplicate rows.
 * - ownerSub — always set (handoff pages are session-gated; there is no
 *   anonymous Venmo/CashApp intent).
 * - kind — "bib" (sponsorship handoff) | "donation" (standalone donate handoff).
 * - provider — "venmo" | "cashapp" only. Stripe never writes a pending row.
 * - amountCents — the intended amount (clamped upstream).
 * - runnerCode — the note the payer types so the SES Lambda can match the
 *   receipt back to this bib. Empty for donation-kind intents.
 * - createdAt — ISO8601, refreshed on each upsert (NOT readOnly — a refresh
 *   should bump recency, unlike immutable ledger rows).
 *
 * Cleared (not archived) on reconcile: once the real payment lands in the
 * ledger, the ledger IS the record; a lingering pending row would double-count
 * in the UI. See {@link clearPendingForOwner}.
 */
export const PendingContribution = new Entity(
  {
    model: {
      entity: "PendingContribution",
      version: "1",
      service: "run",
    },
    attributes: {
      pendingId: {
        type: "string",
        required: true,
      },
      ownerSub: {
        type: "string",
        required: true,
      },
      kind: {
        type: ["bib", "donation"] as const,
        required: true,
      },
      provider: {
        type: ["venmo", "cashapp"] as const,
        required: true,
      },
      amountCents: {
        type: "number",
        required: true,
      },
      runnerCode: {
        type: "string",
        // Empty for donation-kind intents (no bib to note).
      },
      createdAt: {
        type: "string",
        required: true,
      },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["pendingId"] },
        sk: { field: "sk", composite: [] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

export type PendingContributionItem = EntityItem<typeof PendingContribution>;

export type PendingKind = "bib" | "donation";
export type PendingProvider = "venmo" | "cashapp";

/**
 * Deterministic PK for a pending intent. Keyed on the tuple that uniquely
 * identifies "this user intends to pay $X via provider P for a K" so a page
 * refresh dedupes instead of accumulating rows. Two genuinely-distinct
 * same-amount intents collide — acceptable: the pending row is a soft hint,
 * and one reconcile clears the whole (owner, kind, provider) bucket anyway.
 */
export function pendingContributionId(
  ownerSub: string,
  kind: PendingKind,
  provider: PendingProvider,
  amountCents: number
): string {
  return `pending:${ownerSub}:${kind}:${provider}:${Math.trunc(amountCents)}`;
}

export interface RecordPendingInput {
  ownerSub: string;
  kind: PendingKind;
  provider: PendingProvider;
  amountCents: number;
  runnerCode?: string;
}

/**
 * Upsert a pending intent. Idempotent by the deterministic PK — a refresh
 * bumps createdAt rather than creating a duplicate. Best-effort by contract:
 * callers (handoff server components) wrap this in try/catch so a DDB hiccup
 * never blocks the payment-instructions page from rendering.
 */
export async function recordPending(
  input: RecordPendingInput
): Promise<PendingContributionItem> {
  const amountCents = Math.max(0, Math.trunc(input.amountCents));
  const pendingId = pendingContributionId(
    input.ownerSub,
    input.kind,
    input.provider,
    amountCents
  );
  const result = await PendingContribution.upsert({
    pendingId,
    ownerSub: input.ownerSub,
    kind: input.kind,
    provider: input.provider,
    amountCents,
    runnerCode: input.runnerCode || "",
    createdAt: new Date().toISOString(),
  }).go();
  return result.data as PendingContributionItem;
}

/**
 * List a runner's open pending intents (scan-filtered on ownerSub — same
 * no-GSI rationale as listDonationsForOwner). Newest-first is applied by the
 * caller when merging into the transaction history.
 */
export async function listPendingForOwner(
  ownerSub: string
): Promise<PendingContributionItem[]> {
  const result = await PendingContribution.scan
    .where(({ ownerSub: attr }, { eq }) => eq(attr, ownerSub))
    .go();
  return result.data;
}

/**
 * Clear a runner's pending intents for a (kind, provider) bucket once a real
 * payment reconciles — the ledger row now represents the contribution, so the
 * pending hint must go or it double-counts in the UI. Best-effort: callers in
 * the reconcile path swallow errors so a cleanup miss never fails the payment
 * application (a stale pending row is cosmetic and self-heals on next scan +
 * TTL policy). Only Venmo/CashApp reconciliations call this; Stripe never does.
 */
export async function clearPendingForOwner(
  ownerSub: string,
  kind: PendingKind,
  provider: PendingProvider
): Promise<void> {
  const rows = await listPendingForOwner(ownerSub);
  const targets = rows.filter(
    (r) => r.kind === kind && r.provider === provider
  );
  await Promise.all(
    targets.map((r) => PendingContribution.delete({ pendingId: r.pendingId }).go())
  );
}

/**
 * Clear a SINGLE pending intent by its deterministic pendingId (WR-01).
 *
 * The admin manual-reconcile route uses this instead of
 * {@link clearPendingForOwner} so reconciling one intent drops ONLY that row,
 * not the whole (owner, kind, provider) bucket — a second same-provider intent
 * for a different amount must survive on the dashboard until it too is
 * reconciled. Best-effort by contract: the reconcile route swallows errors so a
 * cleanup miss never fails the payment application.
 */
export async function clearPendingById(pendingId: string): Promise<void> {
  await PendingContribution.delete({ pendingId }).go();
}
