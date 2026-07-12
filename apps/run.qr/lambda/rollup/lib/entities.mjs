/**
 * ElectroDB entity for the QR analytics rollup Lambda.
 *
 * This file mirrors ONLY the `Qrstat` entity from the resolver's
 * `apps/run.qr/lambda/resolver/lib/entities.mjs`. The rollup and the resolver
 * BOTH write Qrstat rows, so the schema here must stay byte-consistent with the
 * resolver's copy: same `service`/`entity`/`version` and the same composite key
 * layout, or the two would compute different pk/sk strings for the same
 * `(code,bucket)` and split a counter across two rows.
 *
 * Load-bearing contract (spec §5.3):
 *   - service "run", entity "Qrstat", version "1"
 *   - primary index: pk = ["code"], sk = ["bucket"]
 *   - attributes: code, bucket, count (number, default 0), lastSeen
 *   - field names `pk`/`sk` match the run-human-electro table's hash/range keys
 *     (see infra/terraform/modules/dynamodb/v1.0.0/main.tf).
 *   - The watermark lives in a meta row: code="_meta", bucket="watermark",
 *     lastSeen=<ISO>.
 *
 * Style mirrors `apps/run.bib/lambda/reconcile/lib/entities.mjs`: cold-start
 * cached Document client, table name from the deploy-time env var.
 */

import { Entity } from "electrodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

// ---------------------------------------------------------------------------
// Shared DynamoDB client
// ---------------------------------------------------------------------------

/**
 * Cold-start-cached DynamoDB Document client, shared across warm invocations.
 * The rollup only issues GetItem (watermark read) and UpdateItem (counter +
 * watermark upserts) against the Qrstat rows.
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
// Qrstat
// ---------------------------------------------------------------------------

/**
 * Qrstat entity — per-(code,bucket) redirect/ctf counters plus the `_meta`
 * watermark row. Upserted via `.update().add({count}).set({lastSeen})`.
 */
export const Qrstat = new Entity(
  {
    model: {
      entity: "Qrstat",
      version: "1",
      service: "run",
    },
    attributes: {
      code: { type: "string", required: true },
      bucket: { type: "string", required: true },
      count: { type: "number", default: 0 },
      lastSeen: { type: "string" },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["code"] },
        sk: { field: "sk", composite: ["bucket"] },
      },
    },
  },
  { client: ddbClient, table: ELECTRO_TABLE }
);
