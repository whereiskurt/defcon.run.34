#!/usr/bin/env node
/**
 * reset-payment-data.mjs (⑥ 2026-07-08) — one-off RELEASE reset.
 *
 * Deletes ALL rows of the four bib payment entities from the shared
 * `run-human-electro` DynamoDB table:
 *   Bib · GeneralDonation · PendingContribution · BibReconcile
 * (entity-scoped via ElectroDB's `__edb_e__` marker, so nothing else on the
 * shared table — BudgetCounter, run.human data — is touched). Bibs regenerate
 * fresh (new runner code) on the owner's next visit.
 *
 * DRY-RUN BY DEFAULT: prints per-entity counts and deletes nothing.
 * Pass --confirm to actually delete.
 *
 * Env (same names the webapp uses — see src/entities/client.ts):
 *   RUN_ELECTRO_ID, RUN_ELECTRO_SECRET   (credentials)
 *   RUN_DYNAMODB_REGION                  (region)
 *   RUN_ELECTRO_DBNAME                   (table; default "run-human-electro")
 *   RUN_ELECTRO_ENDPOINT                 (optional; set for LOCAL dynamodb)
 *
 * Usage:
 *   node scripts/reset-payment-data.mjs              # dry-run (counts only)
 *   node scripts/reset-payment-data.mjs --confirm    # perform deletes
 */
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const CONFIRM = process.argv.includes("--confirm");
const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const REGION = process.env.RUN_DYNAMODB_REGION;
const ENTITIES = ["Bib", "GeneralDonation", "PendingContribution", "BibReconcile"];

// Fail loud if creds/region are missing — never silently no-op a reset.
for (const [name, val] of [
  ["RUN_ELECTRO_ID", process.env.RUN_ELECTRO_ID],
  ["RUN_ELECTRO_SECRET", process.env.RUN_ELECTRO_SECRET],
  ["RUN_DYNAMODB_REGION", REGION],
]) {
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(2);
  }
}

const doc = DynamoDBDocument.from(
  new DynamoDB({
    region: REGION,
    credentials: {
      accessKeyId: process.env.RUN_ELECTRO_ID,
      secretAccessKey: process.env.RUN_ELECTRO_SECRET,
    },
    ...(process.env.RUN_ELECTRO_ENDPOINT
      ? { endpoint: process.env.RUN_ELECTRO_ENDPOINT }
      : {}),
  })
);

/** Scan the table for every row of one ElectroDB entity (paginated). */
async function scanEntity(entity) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const r = await doc.scan({
      TableName: TABLE,
      FilterExpression: "#e = :e",
      ExpressionAttributeNames: { "#e": "__edb_e__" },
      ExpressionAttributeValues: { ":e": entity },
      ExclusiveStartKey,
    });
    items.push(...(r.Items || []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

const chunk = (a, n) =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) =>
    a.slice(i * n, i * n + n)
  );

/** BatchWrite deletes, retrying UnprocessedItems so throttling never leaves rows. */
async function deleteAll(items) {
  for (const batch of chunk(items, 25)) {
    let req = {
      [TABLE]: batch.map((it) => ({
        DeleteRequest: { Key: { pk: it.pk, sk: it.sk } },
      })),
    };
    for (let attempt = 0; attempt < 8 && Object.keys(req).length; attempt++) {
      const res = await doc.batchWrite({ RequestItems: req });
      req = res.UnprocessedItems || {};
      if (Object.keys(req).length) {
        await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
      }
    }
    if (Object.keys(req).length) {
      throw new Error("UnprocessedItems remained after retries — rerun the script.");
    }
  }
}

(async () => {
  console.log(
    `Table: ${TABLE}  Region: ${REGION}  Endpoint: ${process.env.RUN_ELECTRO_ENDPOINT || "(aws)"}  Mode: ${CONFIRM ? "DELETE" : "DRY-RUN"}`
  );
  let grand = 0;
  for (const entity of ENTITIES) {
    const items = await scanEntity(entity);
    console.log(`  ${entity}: ${items.length} rows`);
    grand += items.length;
    if (CONFIRM && items.length) {
      await deleteAll(items);
      console.log(`    deleted ${items.length}`);
    }
  }
  console.log(`\n${CONFIRM ? "Deleted" : "Would delete"} ${grand} rows total.`);
  if (!CONFIRM) console.log("Re-run with --confirm to delete.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
