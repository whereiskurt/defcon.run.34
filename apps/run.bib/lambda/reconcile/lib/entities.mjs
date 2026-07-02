/**
 * ElectroDB entities for the bib-reconcile Lambda.
 *
 * The webapp's TypeScript entities live at
 * `apps/run.bib/webapp/src/entities/{bib,bib-reconcile,budget-counter}.ts`.
 * The Lambda cannot import from that path (different tsconfig, different
 * bundling boundary) so this file mirrors the same schemas in plain JS.
 *
 * Load-bearing contract: PK/SK layout must match the webapp entities
 * exactly. ElectroDB encodes PK/SK from `service`, `entity`, `version` and
 * the composite key attributes — the webapp side uses `service: "run"` for
 * all three entities, so we mirror it here.
 *
 * If the webapp schemas change (Bib gains a field; BibReconcile gains a
 * GSI; BudgetCounter caps get renamed), THIS file must change in lockstep.
 * Plan 22-04-04's grep gate will scan for shape drift.
 */

import { Entity } from "electrodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

// ---------------------------------------------------------------------------
// Shared DynamoDB client
// ---------------------------------------------------------------------------

/**
 * Cold-start-cached DynamoDB Document client. The Lambda runtime shares a
 * single client across warm invocations, so we init once at module load.
 * IAM role attached in `bib-reconcile-lambda/v1.0.0/iam.tf` covers the
 * exact operations the entities issue: GetItem, PutItem, UpdateItem, Query.
 */
export const ddbClient = DynamoDBDocument.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION || process.env.REGION_LABEL || "us-east-1",
  }),
  {
    marshallOptions: {
      convertEmptyValues: true,
      removeUndefinedValues: true,
      convertClassInstanceToMap: true,
    },
  }
);

/**
 * Shared electro table name. Populated at deploy time via the Terragrunt
 * module's `environment.RUN_ELECTRO_DBNAME`.
 */
export const ELECTRO_TABLE =
  process.env.RUN_ELECTRO_DBNAME || "run-human-electro";

// ---------------------------------------------------------------------------
// Bib
// ---------------------------------------------------------------------------

/**
 * Bib entity — mirrors `apps/run.bib/webapp/src/entities/bib.ts`. See that
 * file for the full field contract. The Lambda only reads via
 * `byRunnerCode` and updates via `.update().add().append()`; the create /
 * patch surface stays exclusive to the webapp.
 */
export const Bib = new Entity(
  {
    model: {
      entity: "Bib",
      version: "1",
      service: "run",
    },
    attributes: {
      ownerSub: { type: "string", required: true },
      nameOnBib: { type: "string", default: "" },
      runnerCode: { type: "string", required: true, readOnly: true },
      paidAmount: { type: "number", default: 0 },
      paidStatusHistory: {
        type: "list",
        items: {
          type: "map",
          properties: {
            provider: { type: "string" },
            amount: { type: "number" },
            timestamp: { type: "string" },
            reconciled_via: { type: "string" },
          },
        },
        default: () => [],
      },
      nameLocked: { type: "boolean", default: false },
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
        pk: { field: "pk", composite: ["ownerSub"] },
        sk: { field: "sk", composite: [], template: "BIB" },
      },
      byRunnerCode: {
        index: "runnerCode-index",
        pk: { field: "runnerCode", composite: ["runnerCode"] },
      },
    },
  },
  { client: ddbClient, table: ELECTRO_TABLE }
);

// ---------------------------------------------------------------------------
// BibReconcile
// ---------------------------------------------------------------------------

/**
 * BibReconcile entity — mirrors
 * `apps/run.bib/webapp/src/entities/bib-reconcile.ts`. Handler-side create
 * uses `.create()` (which issues a PutItem with an implicit
 * attribute_not_exists on the PK — that's how ElectroDB emulates
 * conditional-on-nonexistence).
 */
export const BibReconcile = new Entity(
  {
    model: {
      entity: "BibReconcile",
      version: "1",
      service: "run",
    },
    attributes: {
      receiptId: { type: "string", required: true },
      receivedAt: { type: "number", required: true },
      provider: {
        type: ["venmo", "cashapp"],
        required: true,
      },
      extractedAmount: { type: "number" },
      extractedComment: { type: "string" },
      extractedSenderName: { type: "string" },
      status: {
        type: ["matched", "unmatched", "ambiguous"],
        default: "unmatched",
      },
      matchedOwnerSub: { type: "string" },
      notes: { type: "string" },
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
  { client: ddbClient, table: ELECTRO_TABLE }
);
