/**
 * backfill-runner-tokens.mts — one-off RunnerToken backfill for existing users.
 *
 * Every RunUser row with a `hash` gets a RunnerToken mapping row
 * (token = hash.slice(0,16) → userId), the lookup behind the short social QR
 * `q.defcon.run/r/<token16>`. New signups mint it inline (run-user.ts) and
 * the internal user endpoint lazily ensures it, so this backfill only covers
 * users created before the feature shipped.
 *
 * Idempotent + safe to re-run: conditional create; an existing row owned by
 * the SAME user is counted as ok, a row owned by a DIFFERENT user is a
 * 16-hex prefix collision and is reported loudly (exit 2) without writing.
 * DRY-RUN by default; write with --apply.
 *
 * Run (SSO creds for the run.human / application account):
 *   aws sso login --profile dc34-application
 *   RUN_DYNAMODB_REGION=us-east-1 AWS_PROFILE=dc34-application \
 *     npx tsx scripts/backfill-runner-tokens.mts            # dry-run
 *   RUN_DYNAMODB_REGION=us-east-1 AWS_PROFILE=dc34-application \
 *     npx tsx scripts/backfill-runner-tokens.mts --apply    # write
 *
 * ESM/CJS landmine (same as seed-vanity-b-qr.mts): entities import the ESM-only
 * @auth adapter chain, so RunnerToken is mirrored here byte-identically
 * (parity locked by src/entities/__tests__/runner-token.test.ts).
 */
import { Entity } from "electrodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const APPLY = process.argv.includes("--apply");
const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const REGION =
  process.env.RUN_DYNAMODB_REGION || process.env.AWS_REGION || "us-east-1";

const client = DynamoDBDocument.from(new DynamoDBClient({ region: REGION }));

const RunnerToken = new Entity(
  {
    model: { entity: "RunnerToken", version: "1", service: "run" },
    attributes: {
      token: { type: "string", required: true },
      userId: { type: "string", required: true },
      hash: { type: "string", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: { pk: { field: "pk", composite: ["token"] }, sk: { field: "sk", composite: [] } },
    },
  },
  { client, table: TABLE }
);

console.log(
  `backfill-runner-tokens: table=${TABLE} region=${REGION} mode=${APPLY ? "APPLY" : "DRY-RUN"}\n`
);

// Scan for RunUser rows (sk is exactly "$runuser_1"). Full-table scan is fine
// at con scale; only pk/sk/hash/userId cross the wire.
const HASH_RE = /^[0-9a-f]{64}$/;
let scanned = 0;
let eligible = 0;
let created = 0;
let already = 0;
let collisions = 0;
let skippedNoHash = 0;

let lastKey: Record<string, unknown> | undefined;
do {
  const page = await client.scan({
    TableName: TABLE,
    FilterExpression: "sk = :sk",
    ExpressionAttributeValues: { ":sk": "$runuser_1" },
    ProjectionExpression: "userId, #h",
    ExpressionAttributeNames: { "#h": "hash" },
    ExclusiveStartKey: lastKey,
  });
  for (const item of page.Items ?? []) {
    scanned++;
    const userId = item.userId as string | undefined;
    const hash = item.hash as string | undefined;
    if (!userId || !hash || !HASH_RE.test(hash)) {
      skippedNoHash++;
      continue;
    }
    eligible++;
    const token = hash.slice(0, 16);
    if (!APPLY) continue;
    try {
      await RunnerToken.create({ token, userId, hash }).go();
      created++;
    } catch {
      const existing = await RunnerToken.get({ token }).go();
      if (existing.data?.userId === userId) {
        already++;
      } else {
        collisions++;
        console.error(
          `💥 COLLISION token=${token} wanted user=${userId} held by=${existing.data?.userId ?? "?"}`
        );
      }
    }
  }
  lastKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
} while (lastKey);

console.log(
  `\nscanned=${scanned} eligible=${eligible} skipped(no/invalid hash)=${skippedNoHash}` +
    (APPLY
      ? ` created=${created} already-ok=${already} collisions=${collisions}`
      : ` (dry-run: would ensure ${eligible} tokens)`)
);
if (collisions > 0) process.exitCode = 2;
