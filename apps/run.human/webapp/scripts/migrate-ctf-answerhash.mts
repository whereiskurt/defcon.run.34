/**
 * migrate-ctf-answerhash.mts (CTF-10, Phase 47) — one-time, idempotent
 * plaintext→answerHash migration for existing `Ctf` rows.
 *
 * For each Ctf row that still carries a non-empty plaintext `answer`, this
 * hashes it into `answerHash` (via the SAME `hashAnswer` seam the judge verifies
 * against — the decision lives in the pure `planCtfMigration` helper, so parity
 * is by construction, not re-implementation) and REMOVES the plaintext `answer`
 * attribute, so the judge has nothing to leak. Rows already hashed (or with no
 * plaintext answer) are skipped — a re-run is a no-op.
 *
 * ── WHY the raw @aws-sdk client and NOT the ElectroDB `Ctf` entity ───────────
 * The `Ctf` entity (src/entities/qr.ts) imports src/entities/client.ts, which
 * imports `@auth/dynamodb-adapter` — an ESM-ONLY package (its package.json
 * exports only an `import` condition). This webapp has no `"type":"module"`, so
 * under a standalone `tsx` run its `.ts` files are transpiled to CommonJS, and a
 * CJS `require()` of that ESM-only adapter fails with ERR_PACKAGE_PATH_NOT_
 * EXPORTED. Next.js bundles around this; a bare operator script cannot. So this
 * script mirrors the repo's existing one-off lineage (run.bib
 * scripts/reset-payment-data.mjs): it talks to DynamoDB via the raw
 * @aws-sdk DynamoDBDocument client, scans the `Ctf` rows by ElectroDB's
 * `__edb_e__` entity marker, and writes each row by its OWN pk/sk (read from the
 * scan) — no key composition, so there is ZERO entity-key drift risk. The
 * hashing decision still flows through `planCtfMigration` → `hashAnswer`, so a
 * migrated `answerHash` is byte-identical to what the judge produces.
 *
 * SAFETY / hygiene:
 *   - DRY-RUN BY DEFAULT: prints per-row actions + counts and writes nothing.
 *     Pass --confirm to actually write.
 *   - Logs the ACTION only — NEVER the answer or answerHash value (Phase-44
 *     no-value hygiene invariant).
 *   - Standalone operator script: NOT imported by any app/request/build path.
 *   - Idempotent: safe to re-run; a second --confirm run reports all `skip`.
 *   - Fails loud (non-zero exit) if required credentials/region env are missing
 *     BEFORE doing any scan.
 *
 * Env (same names the webapp uses — see src/entities/client.ts):
 *   RUN_ELECTRO_ID, RUN_ELECTRO_SECRET   (credentials)
 *   RUN_DYNAMODB_REGION                  (region)
 *   RUN_ELECTRO_DBNAME                   (table; default "run-human-electro")
 *   RUN_ELECTRO_ENDPOINT                 (optional; set for LOCAL dynamodb)
 *   CTF_ANSWER_SALT                      (optional; MUST match the judge's salt)
 *
 * PROD RUN RECIPE (us-east-1 / shared run-human-electro table):
 *   cd apps/run.human/webapp
 *   # 1. dry-run — inspect the plan (writes nothing):
 *   AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/migrate-ctf-answerhash.mts
 *   # 2. commit the migration (hashes + strips plaintext):
 *   AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/migrate-ctf-answerhash.mts --confirm
 *   # 3. (optional) re-run --confirm to prove idempotency — should report all skip.
 * The .env must point RUN_ELECTRO_* at the use1 prod credentials/table.
 * This is a ONE-TIME, idempotent, safe-to-re-run migration.
 */
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

import { planCtfMigration } from "../src/lib/ctf-migration";

const CONFIRM = process.argv.includes("--confirm");
const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const REGION = process.env.RUN_DYNAMODB_REGION;
const ENTITY = "Ctf"; // ElectroDB __edb_e__ marker for the Ctf entity

// Fail loud if creds/region are missing — never silently no-op a migration.
for (const [name, val] of [
  ["RUN_ELECTRO_ID", process.env.RUN_ELECTRO_ID],
  ["RUN_ELECTRO_SECRET", process.env.RUN_ELECTRO_SECRET],
  ["RUN_DYNAMODB_REGION", REGION],
] as const) {
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(2);
  }
}

const doc = DynamoDBDocument.from(
  new DynamoDB({
    region: REGION,
    credentials: {
      accessKeyId: process.env.RUN_ELECTRO_ID!,
      secretAccessKey: process.env.RUN_ELECTRO_SECRET!,
    },
    ...(process.env.RUN_ELECTRO_ENDPOINT
      ? { endpoint: process.env.RUN_ELECTRO_ENDPOINT }
      : {}),
  }),
  { marshallOptions: { removeUndefinedValues: true } }
);

interface CtfItem {
  pk: string;
  sk: string;
  challenge: string;
  answer?: string;
  answerHash?: string;
}

/** Scan every Ctf row (paginated), filtered to the ElectroDB entity marker. */
async function scanCtf(): Promise<CtfItem[]> {
  const items: CtfItem[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await doc.scan({
      TableName: TABLE,
      FilterExpression: "#e = :e",
      ExpressionAttributeNames: { "#e": "__edb_e__" },
      ExpressionAttributeValues: { ":e": ENTITY },
      ExclusiveStartKey,
    });
    items.push(...((r.Items as CtfItem[]) || []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function main() {
  console.log(
    `Table: ${TABLE}  Region: ${REGION}  Endpoint: ${
      process.env.RUN_ELECTRO_ENDPOINT || "(aws)"
    }  Mode: ${CONFIRM ? "WRITE" : "DRY-RUN"}`
  );

  const rows = await scanCtf();
  console.log(`Scanned ${rows.length} Ctf rows.\n`);

  const counts = { "hash-and-clear": 0, "clear-only": 0, skip: 0 };

  for (const row of rows) {
    const plan = planCtfMigration({
      challenge: row.challenge,
      answer: row.answer,
      answerHash: row.answerHash,
    });
    counts[plan.action] += 1;

    // Log the ACTION only — never the answer or answerHash value.
    console.log(`  ${row.challenge} → ${plan.action}`);

    if (!CONFIRM || plan.action === "skip") continue;

    const now = new Date().toISOString();
    if (plan.action === "hash-and-clear") {
      // SET answerHash + updatedAt, REMOVE the plaintext answer. Mirrors the
      // entity's Ctf.patch().set({answerHash}).remove(['answer']) (which also
      // bumps updatedAt via its watch:* rule).
      await doc.update({
        TableName: TABLE,
        Key: { pk: row.pk, sk: row.sk },
        UpdateExpression: "SET #ah = :ah, #ua = :ua REMOVE #a",
        ExpressionAttributeNames: {
          "#ah": "answerHash",
          "#ua": "updatedAt",
          "#a": "answer",
        },
        ExpressionAttributeValues: { ":ah": plan.answerHash, ":ua": now },
      });
    } else {
      // clear-only: answerHash already set — just strip leftover plaintext.
      await doc.update({
        TableName: TABLE,
        Key: { pk: row.pk, sk: row.sk },
        UpdateExpression: "SET #ua = :ua REMOVE #a",
        ExpressionAttributeNames: { "#ua": "updatedAt", "#a": "answer" },
        ExpressionAttributeValues: { ":ua": now },
      });
    }
  }

  const verb = CONFIRM ? "Applied" : "Would apply";
  console.log(
    `\n${verb}: hash-and-clear ${counts["hash-and-clear"]}, clear-only ${counts["clear-only"]}, skip ${counts.skip}.`
  );
  if (!CONFIRM) {
    console.log("Re-run with --confirm to write.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
