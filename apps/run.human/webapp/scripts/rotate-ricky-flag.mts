/**
 * rotate-ricky-flag.mts (Phase 72) — two-stage operator script for retiring the
 * freely-shareable static ricky claim code.
 *
 * WHY: `setup-ricky-flag.mts` (2026-07-30) minted a static code and published it
 * inside a 474-byte S3 interstitial at defcon.run/qr/rick_astley_loves_desert_running.
 * Anyone who ever loaded that page holds a code that awards 100 points daily,
 * forever. Phase 72 replaces it with a single-use minted claim link, so the
 * static code has to die.
 *
 * TWO STAGES, DELIBERATELY SPLIT ACROSS TWO PLANS:
 *
 *   rotate   (default)   — 72-08. Rewrites ONLY the `answerHash` on the live
 *                          `ricky` Ctf row. Non-destructive: no row is created,
 *                          none is deleted. This is what kills the old code.
 *   teardown (--teardown) — 72-10, and NOT before. Deletes the `Qr` row and the
 *                          static S3 interstitial. IRREVERSIBLE. Runs only after
 *                          the new award path is deployed AND verified by 72-09.
 *
 * The seam is load-bearing, not fussiness. The fallback URL this script prints
 * must be a *working* claim URL before it is seeded into SOPS/SSM, and the SSM
 * parameter must exist before the ECS task that references it starts (ECS refuses
 * to start a task whose `valueFrom` parameter is missing). So: rotate → SOPS →
 * secrets apply → ecs-task apply → verify → only then teardown. Tearing down
 * early would kill the old path while the new one is still not live.
 *
 * SAFETY POSTURE (mirrors setup-ricky-flag.mts):
 *   - DRY-RUN by default. `--confirm` is required for ANY mutation.
 *   - The rotate stage uses a conditional UpdateItem, NEVER a Put. This is the
 *     whole safety argument: a Put rewrites the entire item, so a single omitted
 *     attribute would silently reset `solveCount` — the ordinal allocator — back
 *     to zero. An UpdateItem physically cannot touch an attribute it does not
 *     name, so `solveCount`, `createdAt` and `enabled` are preserved by
 *     construction rather than by careful copying.
 *   - The condition requires the item to already exist, so a missing row exits
 *     non-zero instead of quietly creating one.
 *   - The row is read back after the write and the pre/post values are printed
 *     side by side, so preservation is demonstrated rather than asserted.
 *   - The raw code and its hash are NEVER logged in DRY-RUN, never written to a
 *     file, and printed exactly once under `--confirm` — embedded in a
 *     ready-to-paste claim URL for the encrypted SOPS document. Do not paste that
 *     URL into a commit, a plan, a SUMMARY, or a chat log.
 *
 * Run (from apps/run.human/webapp):
 *   source "$HOME/.nvm/nvm.sh" && nvm use 22.12.0
 *   # 1) DRY-RUN — review, confirm solveCount is 0:
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 \
 *     npx tsx scripts/rotate-ricky-flag.mts
 *   # 2) WRITE (72-08 only, after review):
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 \
 *     npx tsx scripts/rotate-ricky-flag.mts --confirm
 *   # 3) TEARDOWN (72-10 ONLY, after the new path is verified live):
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 \
 *     npx tsx scripts/rotate-ricky-flag.mts --teardown [--confirm]
 *
 * Not wired into any automated test run — it talks to production DynamoDB.
 */
import { randomBytes } from "crypto";
import { execFileSync } from "child_process";
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { hashAnswer } from "../src/lib/ctf-hash";

// ---------------------------------------------------------------------------
// Targets (verified against live AWS 2026-07-31)
// ---------------------------------------------------------------------------
const CTF_KEY = { pk: "$run#challenge_ricky", sk: "$ctf_1" };
/** teardown only — 72-10. The row whose `destination` embeds the static code. */
const QR_KEY = { pk: "$run#code_rick_astley_loves_desert_running", sk: "$qr_1" };
/** teardown only — 72-10. The landing bucket, reachable ONLY as sudo-management. */
const S3_BUCKET = "defcon-run-static-20240523-v1";
const S3_KEY = "qr/rick_astley_loves_desert_running";
const S3_PROFILE = "sudo-management";
/** teardown only — the landing distribution fronting that object. */
const CF_DISTRIBUTION = "ETHVMDHQC21EG";

const CLAIM_BASE = "https://run.defcon.run/use1/ctf/claim";

// ---------------------------------------------------------------------------
// Environment guards — a misdirected run must be obvious BEFORE anything happens
// ---------------------------------------------------------------------------
const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const REGION = process.env.RUN_DYNAMODB_REGION;
const PROFILE = process.env.AWS_PROFILE;
const EXPECT_REGION = "us-east-1";
const EXPECT_PROFILE = "dc34-application";

const CONFIRM = process.argv.includes("--confirm");
const TEARDOWN = process.argv.includes("--teardown");
const STAGE = TEARDOWN ? "teardown" : "rotate";

if (!REGION) {
  console.error("Missing required env var: RUN_DYNAMODB_REGION (no default — set it explicitly)");
  process.exit(2);
}
if (REGION !== EXPECT_REGION) {
  console.error(`Refusing to run: RUN_DYNAMODB_REGION is "${REGION}", expected "${EXPECT_REGION}" (prod).`);
  process.exit(2);
}
if (PROFILE !== EXPECT_PROFILE) {
  console.error(`Refusing to run: AWS_PROFILE is "${PROFILE ?? "(unset)"}", expected "${EXPECT_PROFILE}" (prod).`);
  process.exit(2);
}

const doc = DynamoDBDocument.from(new DynamoDB({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

async function getRow(Key: { pk: string; sk: string }): Promise<Row | null> {
  const r = await doc.get({ TableName: TABLE, Key, ConsistentRead: true });
  return (r?.Item as Row) ?? null;
}

/** The three attributes whose preservation IS the acceptance test. */
function preserved(row: Row) {
  return {
    solveCount: row.solveCount,
    createdAt: row.createdAt,
    enabled: row.enabled,
  };
}

function printState(label: string, row: Row) {
  console.log(
    `  ${label}: challenge=${row.challenge} answerType=${row.answerType} ` +
      `enabled=${row.enabled} solveCount=${row.solveCount} createdAt=${row.createdAt} updatedAt=${row.updatedAt}`,
  );
}

// ---------------------------------------------------------------------------
// Stage: rotate (72-08) — rewrite the answer hash, touch nothing else
// ---------------------------------------------------------------------------
async function rotate(): Promise<number> {
  const before = await getRow(CTF_KEY);
  if (!before) {
    console.error(
      `ABORT: no row at pk=${CTF_KEY.pk} sk=${CTF_KEY.sk} in ${TABLE}. ` +
        `This script rotates an EXISTING flag; it never creates one.`,
    );
    return 2;
  }

  console.log("Pre-state (read from the LIVE row):");
  printState("before", before);
  console.log(
    "  These three are what the UpdateItem must preserve: " +
      `solveCount=${before.solveCount} createdAt=${before.createdAt} enabled=${before.enabled}`,
  );
  if (before.solveCount !== 0) {
    console.log(
      `  ⚠️  solveCount is ${before.solveCount}, NOT 0 — the zero-blast-radius premise ` +
        `behind this rotation no longer holds. The owner must re-decide before writing.`,
    );
  }

  // Same prefix-plus-random-hex shape setup-ricky-flag.mts used, so an operator
  // eyeballing the SSM parameter recognises what it is. 96 bits of entropy.
  const code = `nggyu-${randomBytes(12).toString("hex")}`;
  const url = `${CLAIM_BASE}?c=ricky&v=${code}`;

  console.log("");
  console.log("Planned change (exactly one row, exactly two attributes):");
  console.log(`  ${TABLE}  pk=${CTF_KEY.pk}  sk=${CTF_KEY.sk}`);
  console.log("  SET answerHash = <fresh salted hash>, updatedAt = <now>   (code + hash withheld)");
  console.log("  UNTOUCHED by construction: solveCount, createdAt, enabled, and every other attribute.");
  console.log("  Mechanism: conditional UpdateItem (NOT a put — a put rewrites the whole item).");

  if (!CONFIRM) {
    console.log("");
    console.log("DRY-RUN: wrote NOTHING. No claim URL is printed in this mode. Re-run with --confirm to write.");
    return 0;
  }

  await doc.update({
    TableName: TABLE,
    Key: CTF_KEY,
    // Only these two attributes are named, so nothing else can be affected —
    // an UpdateItem cannot clobber an attribute it does not mention. A put
    // WOULD, and a single omission there would reset the ordinal allocator.
    UpdateExpression: "SET #a = :a, #u = :u",
    // Requires the item to already exist: never degrade into a create.
    ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
    ExpressionAttributeNames: { "#a": "answerHash", "#u": "updatedAt" },
    ExpressionAttributeValues: {
      ":a": hashAnswer(code),
      ":u": new Date().toISOString(),
    },
  });

  const after = await getRow(CTF_KEY);
  if (!after) {
    console.error("ABORT: row vanished immediately after the update — investigate before doing anything else.");
    return 1;
  }

  console.log("");
  console.log("Post-state (read back from the LIVE row):");
  printState("before", before);
  printState("after ", after);

  const a = preserved(before);
  const b = preserved(after);
  const ok =
    a.solveCount === b.solveCount && a.createdAt === b.createdAt && a.enabled === b.enabled;
  const hashChanged = before.answerHash !== after.answerHash;
  console.log("");
  console.log(`  PRESERVED solveCount/createdAt/enabled: ${ok ? "YES — identical" : "NO — MISMATCH"}`);
  console.log(`  answerHash changed: ${hashChanged ? "YES" : "NO"}   (values withheld)`);

  // Printed EXACTLY ONCE, and only here.
  console.log("");
  console.log("=== NEW CLAIM URL — copy straight into SOPS, then clear your scrollback ===");
  console.log(url);
  console.log("=== Do NOT paste it into a commit, a plan, a SUMMARY, a chat log, or a file ===");
  console.log(`  Destination: .secrets.sops.json  ->  mqtt.ricky-fallback-url`);

  if (!ok || !hashChanged) {
    console.error("");
    console.error("FAILED: preservation and/or rotation did not hold. See the pre/post lines above.");
    return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Stage: teardown (72-10 ONLY) — unreachable without --teardown. IRREVERSIBLE.
// ---------------------------------------------------------------------------
async function teardown(): Promise<number> {
  console.log("TEARDOWN stage — this is 72-10's job. It must NOT run until 72-09 has");
  console.log("deployed AND verified the new award path. Two targets, no more:");
  console.log(`  1) DynamoDB  ${TABLE}  pk=${QR_KEY.pk}  sk=${QR_KEY.sk}   (profile ${EXPECT_PROFILE}, ${REGION})`);
  console.log(`  2) S3        s3://${S3_BUCKET}/${S3_KEY}                  (profile ${S3_PROFILE})`);

  const qr = await getRow(QR_KEY);
  console.log(`  Qr row present: ${qr ? "yes" : "no (already gone)"}`);

  if (!CONFIRM) {
    console.log("");
    console.log("DRY-RUN: deleted NOTHING. Re-run with --teardown --confirm to delete.");
    return 0;
  }

  if (qr) {
    await doc.delete({
      TableName: TABLE,
      Key: QR_KEY,
      ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
    });
    console.log(`  ✓ deleted Qr row ${QR_KEY.pk}`);
  }

  // The landing bucket is NOT readable by the application profile, so this half
  // shells out with the sudo-management profile rather than reusing the client.
  execFileSync(
    "aws",
    ["s3api", "delete-object", "--bucket", S3_BUCKET, "--key", S3_KEY],
    { env: { ...process.env, AWS_PROFILE: S3_PROFILE }, stdio: "inherit" },
  );
  console.log(`  ✓ deleted s3://${S3_BUCKET}/${S3_KEY}`);

  console.log("");
  console.log("NOT DONE YET — the object is still served from the edge. Invalidate and wait:");
  console.log(
    `  AWS_PROFILE=${S3_PROFILE} aws cloudfront create-invalidation ` +
      `--distribution-id ${CF_DISTRIBUTION} --paths "/${S3_KEY}"`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
async function main() {
  console.log(
    `Stage: ${STAGE}  Mode: ${CONFIRM ? "WRITE" : "DRY-RUN"}  Table: ${TABLE}  Region: ${REGION}  Profile: ${PROFILE}`,
  );
  console.log("");
  process.exitCode = TEARDOWN ? await teardown() : await rotate();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
