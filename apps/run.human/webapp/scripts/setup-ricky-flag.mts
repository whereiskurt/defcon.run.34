/**
 * One-off operator script: create the `ricky` Ctf flag + its lyrics QR row.
 *
 * Mechanic (Kurt, 2026-07-30): ricky's lyric stream ends at
 * /qr/rick_astley_loves_desert_running; that QR redirects to the claim page
 * with an embedded random code — players never type anything ("none flag").
 * Flag: 100 points, daily-repeatable (perPlayerIntervalHours: 24).
 *
 * Safety: both writes are conditional puts (attribute_not_exists) — NEVER
 * clobbers an existing row. Raw code/hash are never printed (judge hygiene);
 * the code lives only in the Qr row's destination URL.
 *
 * Run (from apps/run.human/webapp):
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 \
 *     npx tsx <this file> [--confirm]
 */
import { randomBytes } from "crypto";
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { hashAnswer } from "../src/lib/ctf-hash";

const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const REGION = process.env.RUN_DYNAMODB_REGION;
if (!REGION) {
  console.error("Missing RUN_DYNAMODB_REGION");
  process.exit(2);
}
const CONFIRM = process.argv.includes("--confirm");
const doc = DynamoDBDocument.from(new DynamoDB({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

const now = new Date().toISOString();
const code = `nggyu-${randomBytes(12).toString("hex")}`; // unguessable; lives in the QR URL only

const ctfItem = {
  pk: "$run#challenge_ricky",
  sk: "$ctf_1",
  __edb_e__: "Ctf",
  __edb_v__: "1",
  challenge: "ricky",
  answerType: "static",
  answerHash: hashAnswer(code),
  pointMax: 100,
  pointFloor: 100,
  maxSolves: 100000,
  firstBloodBonus: 0,
  perPlayerIntervalHours: 24,
  enabled: true,
  maxAttempts: 5,
  rateLimitWindow: 60,
  solveCount: 0,
  createdAt: now,
  updatedAt: now,
};

const qrItem = {
  pk: "$run#code_rick_astley_loves_desert_running",
  sk: "$qr_1",
  __edb_e__: "Qr",
  __edb_v__: "1",
  code: "rick_astley_loves_desert_running",
  type: "redirect",
  destination: `https://run.defcon.run/use1/ctf/claim?c=ricky&v=${code}`,
  createdAt: now,
  updatedAt: now,
};

console.log(`Mode: ${CONFIRM ? "WRITE" : "DRY-RUN"}  Table: ${TABLE}  Region: ${REGION}`);
console.log(`Ctf:  pk=${ctfItem.pk} sk=${ctfItem.sk} points=100/daily enabled=true (hash+code withheld)`);
console.log(`Qr:   pk=${qrItem.pk} sk=${qrItem.sk} type=redirect -> /use1/ctf/claim?c=ricky&v=nggyu-…`);

if (CONFIRM) {
  for (const Item of [ctfItem, qrItem]) {
    try {
      await doc.put({
        TableName: TABLE,
        Item,
        ConditionExpression: "attribute_not_exists(pk)",
      });
      console.log(`  wrote ${Item.pk}`);
    } catch (e: unknown) {
      const name = (e as { name?: string }).name;
      if (name === "ConditionalCheckFailedException") {
        console.error(`  SKIPPED ${Item.pk} — row already exists (never clobbered)`);
      } else {
        throw e;
      }
    }
  }
} else {
  console.log("DRY-RUN: wrote nothing. Re-run with --confirm.");
}
