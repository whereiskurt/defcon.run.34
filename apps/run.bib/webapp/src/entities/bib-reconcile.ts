import { Entity, type EntityItem } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * BibReconcile Entity
 *
 * Ledger row for a single inbound payment-notification email (Venmo / CashApp)
 * received via SES. Phase 22's parsing Lambda uses this entity to correlate
 * an extracted runnerCode against a Bib.
 *
 * Phase 21 defines only the shape; Phase 22 wires create/update helpers +
 * SES Lambda.
 *
 * Design contract (Kurt 2026-07-02):
 * - receiptId (PK) = hash of the email Message-ID header (idempotent replay).
 * - receivedAt (number epoch ms).
 * - provider: "venmo" | "cashapp".
 * - extractedAmount: number of cents parsed from the email.
 * - extractedComment: raw comment/note field (contains runnerCode).
 * - extractedSenderName: parsed sender name (for admin reconciliation UI).
 * - status: "matched" | "unmatched" | "ambiguous" (default "unmatched").
 * - matchedOwnerSub: on match, the ownerSub of the matched Bib.
 *
 * NOTE: NO SECONDARY GSI wired in Phase 21.
 *
 * The Phase 20 electro-schema exposes three shared GSIs (gsi1/gsi2/gsi3), all
 * already claimed by other entities:
 *   - gsi1pk-gsi1sk-index -> RunUser.byHash
 *   - gsi2pk-gsi2sk-index -> CheckIn.byGlobalRecent (+ UserUpload.byStatus)
 *   - gsi3pk-gsi3sk-index -> CheckIn.byUserRecent
 * The only extra GSI is runnerCode-index (hash_key=runnerCode, claimed by
 * Bib.byRunnerCode). PLAN.md 21-02-03 blocker note explicitly authorizes
 * shipping without byOwner: "Phase 22's Lambda queries by primary key from
 * receiptId lookup — still functional."
 *
 * If Phase 22 needs byOwner or byStatus scans, add a new GSI at
 * infra/terraform/live/site/services/run.human/service.hcl and wire the
 * secondary here.
 */
export const BibReconcile = new Entity(
  {
    model: {
      entity: "BibReconcile",
      version: "1",
      service: "run",
    },
    attributes: {
      receiptId: {
        type: "string",
        required: true,
      },
      receivedAt: {
        type: "number",
        required: true,
      },
      provider: {
        type: ["venmo", "cashapp"] as const,
        required: true,
      },
      extractedAmount: {
        type: "number",
      },
      extractedComment: {
        type: "string",
      },
      extractedSenderName: {
        type: "string",
      },
      status: {
        type: ["matched", "unmatched", "ambiguous"] as const,
        default: "unmatched",
      },
      matchedOwnerSub: {
        type: "string",
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
        pk: { field: "pk", composite: ["receiptId"] },
        sk: { field: "sk", composite: [] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

export type BibReconcileItem = EntityItem<typeof BibReconcile>;

/**
 * Input for a new reconciliation-ledger row (Phase 22 SES Lambda populates).
 */
export interface BibReconcileInput {
  receiptId: string;
  receivedAt: number;
  provider: "venmo" | "cashapp";
  extractedAmount?: number;
  extractedComment?: string;
  extractedSenderName?: string;
  status?: "matched" | "unmatched" | "ambiguous";
  matchedOwnerSub?: string;
}

/**
 * Stub for Phase 22 — SES Lambda hasn't landed yet. Present so route
 * handlers / admin tooling that call it in Phase 22 don't need entity-file
 * changes.
 *
 * Idempotent-on-replay is caller's responsibility (receiptId is a stable
 * hash of Message-ID, so double-delivery of the same SES email will
 * conditional-check-fail here and Phase 22 handler will treat that as
 * "already processed").
 */
export async function createReconcile(
  input: BibReconcileInput
): Promise<BibReconcileItem> {
  const result = await BibReconcile.create(input).go();
  return result.data;
}

/**
 * Fetch a reconciliation-ledger row by receiptId.
 */
export async function getReconcile(
  receiptId: string
): Promise<BibReconcileItem | null> {
  const result = await BibReconcile.get({ receiptId }).go();
  return result.data ?? null;
}
