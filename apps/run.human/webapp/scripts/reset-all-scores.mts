/**
 * reset-all-scores.mts — zero the ENTIRE leaderboard for EVERY runner.
 *
 * Kurt, 2026-08-03: "reset all of the awards thus far and zero the whole board
 * out for everyone" ahead of DC34, then grant one showcase account every award
 * (see showcase-user.mts).
 *
 * ── WHAT IT DELETES (allow-list, see WIPE) ──────────────────────────────────
 *   CtfSolve · CtfScoreEvent · CtfAttempt · CtfOtpClaim   the CTF ledger
 *   ClusterAward                                          cluster bonus ledger
 *   Accomplishment                                        run-streak con-days
 *   CheckIn                                               check-in history
 *   SocialPair · SocialQuota · SocialEgg · SocialBoard    social-scan standing
 *
 * ── WHAT IT REWRITES (never deletes) ────────────────────────────────────────
 *   RunUser   score fields zeroed; the ROW SURVIVES (it carries MQTT creds,
 *             RSA hashes, QR hash/eqr, mesh usertype — deleting it would
 *             destroy the runner's identity, not their score).
 *   Ctf       solveCount -> 0 only. The DEFINITION (answerHash, OTP secrets,
 *             effects, knobs) is untouched.
 *
 * ── WHAT IT MUST NEVER TOUCH ────────────────────────────────────────────────
 * run.bib shares this PHYSICAL TABLE. Bib / GeneralDonation /
 * PendingContribution / BibReconcile / BudgetCounter are REAL MONEY (228 bibs,
 * 6 donations, 2 Stripe receipts at time of writing). Also off-limits:
 * RunnerToken, MeshRadio, MeshOtpPending, MeshWelcomePending, UserUpload, Qr,
 * Qrstat, ClusterConfig, ClusterDemoUser, CtfPending, and the entire
 * run-human-authjs identity table.
 *
 * This is enforced STRUCTURALLY: the script deletes ONLY rows whose
 * `__edb_e__` is in WIPE. Anything else is counted and skipped. A deny-list
 * would fail open on an entity nobody thought of; an allow-list fails closed.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 *   - DRY-RUN BY DEFAULT. Prints every key it would touch. `--confirm` writes.
 *   - ABORTS if RUN_ELECTRO_ENDPOINT is set. That env var means LOCAL
 *     DynamoDB, and it is exactly how a prod run silently wipes the wrong
 *     store (see the warning in reset-social-user.mts).
 *   - Never invents keys: every delete/update reuses the row's OWN pk/sk as
 *     read back from the scan.
 *
 * ── WHY IT HAND-WRITES THE ZEROED SCORE INSTEAD OF CALLING rescoreUser ──────
 * The entity layer imports @auth/dynamodb-adapter (ESM-only), which a
 * standalone `tsx` CJS run cannot require — the same reason every sibling
 * script talks raw SDK. With the ENTIRE ledger deleted, rescoreUser's output is
 * deterministic and is exactly the ZEROED constant below: every input array is
 * empty, so every term is 0. Shapes mirror run-user.ts:153-176 and the patch in
 * rescore.ts:59-74. Re-running `POST /api/admin/rescore-all` afterwards is a
 * no-op and is the recommended belt-and-braces check.
 *
 * ── USAGE (prod) ────────────────────────────────────────────────────────────
 *   ⚠️ NEVER pass --env-file=.env — the dev .env sets RUN_ELECTRO_ENDPOINT and
 *   points this at LOCAL DynamoDB.
 *
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 \
 *     npx tsx scripts/reset-all-scores.mts            # dry run
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 \
 *     npx tsx scripts/reset-all-scores.mts --confirm  # apply
 */
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const CONFIRM = process.argv.includes("--confirm");
const MODE = CONFIRM ? "WRITE" : "DRY-RUN";

const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const REGION = process.env.RUN_DYNAMODB_REGION;

if (!REGION) {
  console.error("Missing required env var: RUN_DYNAMODB_REGION");
  process.exit(2);
}

// THE .env TRAP. A set endpoint means local DynamoDB; a --confirm here would
// "succeed" against an empty local store and report a clean wipe that never
// happened in prod.
if (process.env.RUN_ELECTRO_ENDPOINT) {
  console.error(
    "REFUSING TO RUN: RUN_ELECTRO_ENDPOINT is set (" +
      process.env.RUN_ELECTRO_ENDPOINT +
      ").\nThat points at LOCAL DynamoDB. Did you pass --env-file=.env? Drop it."
  );
  process.exit(2);
}

/** Entities whose rows are DELETED outright. Nothing else is ever deleted. */
const WIPE = new Set([
  "CtfSolve",
  "CtfScoreEvent",
  "CtfAttempt",
  "CtfOtpClaim",
  "ClusterAward",
  "Accomplishment",
  "CheckIn",
  "SocialPair",
  "SocialQuota",
  "SocialEgg",
  "SocialBoard",
]);

/**
 * Money + identity. Never deleted — but listed explicitly so that if one ever
 * shows up in the delete set (e.g. someone adds it to WIPE by accident) the
 * script aborts instead of shrugging.
 */
const PROTECTED = new Set([
  "Bib",
  "GeneralDonation",
  "PendingContribution",
  "BibReconcile",
  "BudgetCounter",
  "RunUser",
  "RunnerToken",
  "MeshRadio",
  "MeshOtpPending",
  "MeshWelcomePending",
  "UserUpload",
  "Qr",
  "Qrstat",
  "Ctf",
  "ClusterConfig",
  "ClusterDemoUser",
  "CtfPending",
]);

for (const e of WIPE) {
  if (PROTECTED.has(e)) {
    console.error(`FATAL: "${e}" is in BOTH WIPE and PROTECTED. Refusing to run.`);
    process.exit(2);
  }
}

/** rescoreUser's output over a completely empty ledger. See header. */
const ZEROED = {
  score: 0,
  scoreBreakdown: {
    runStreak: 0,
    socialStreak: 0,
    ctfStreak: 0,
    flagPoints: 0,
    clusterBonus: 0,
  },
  streakDays: { run: 0, social: 0, ctf: 0 },
  activityCounts: { checkin: 0, gpx: 0, strava: 0 },
  ctfSolves: 0,
  // Legacy cosmetic meters. Outside the rescore invariant, so zero them here or
  // the profile keeps showing a stale social/activity number next to a 0 score.
  socialScore: 0,
  activityScore: 0,
  ctfScore: 0,
};

function creds(idVar: string, secretVar: string) {
  const accessKeyId = process.env[idVar];
  const secretAccessKey = process.env[secretVar];
  return accessKeyId && secretAccessKey
    ? { credentials: { accessKeyId, secretAccessKey } }
    : {};
}

const ddb = DynamoDBDocument.from(
  new DynamoDB({ region: REGION, ...creds("RUN_ELECTRO_ID", "RUN_ELECTRO_SECRET") }),
  { marshallOptions: { removeUndefinedValues: true } }
);

type Row = Record<string, unknown> & { pk: string; sk: string; __edb_e__?: string };

async function scanAll(): Promise<Row[]> {
  const out: Row[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.scan({ TableName: TABLE, ExclusiveStartKey: ExclusiveStartKey as never });
    out.push(...((res.Items ?? []) as Row[]));
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return out;
}

async function main() {
  console.log(`\n=== reset-all-scores [${MODE}] ===`);
  console.log(`table:  ${TABLE}`);
  console.log(`region: ${REGION}\n`);

  const rows = await scanAll();
  console.log(`scanned ${rows.length} rows\n`);

  const byEntity = new Map<string, Row[]>();
  for (const r of rows) {
    const e = r.__edb_e__ ?? "(no-marker)";
    if (!byEntity.has(e)) byEntity.set(e, []);
    byEntity.get(e)!.push(r);
  }

  const toDelete: Row[] = [];
  const kept: [string, number][] = [];
  for (const [entity, list] of byEntity) {
    if (WIPE.has(entity)) toDelete.push(...list);
    else kept.push([entity, list.length]);
  }

  // Structural guarantee, re-checked against real data.
  const violation = toDelete.find((r) => PROTECTED.has(r.__edb_e__ ?? ""));
  if (violation) {
    console.error(`FATAL: delete set contains protected entity ${violation.__edb_e__}. Aborting.`);
    process.exit(2);
  }

  console.log("DELETE:");
  for (const [entity, list] of [...byEntity].filter(([e]) => WIPE.has(e))) {
    console.log(`  ${entity.padEnd(20)} ${String(list.length).padStart(4)}`);
  }
  console.log(`  ${"TOTAL".padEnd(20)} ${String(toDelete.length).padStart(4)}\n`);

  console.log("KEEP (untouched):");
  for (const [entity, n] of kept.sort((a, b) => b[1] - a[1])) {
    console.log(`  ${entity.padEnd(20)} ${String(n).padStart(4)}`);
  }
  console.log();

  const runUsers = byEntity.get("RunUser") ?? [];
  const ctfDefs = byEntity.get("Ctf") ?? [];
  console.log(`REWRITE: ${runUsers.length} RunUser score fields -> 0`);
  console.log(`REWRITE: ${ctfDefs.length} Ctf.solveCount -> 0\n`);

  if (!CONFIRM) {
    console.log("DRY RUN — nothing written. Sample of keys that would be deleted:");
    for (const r of toDelete.slice(0, 10)) console.log(`  ${r.pk}  |  ${r.sk}`);
    if (toDelete.length > 10) console.log(`  … and ${toDelete.length - 10} more`);
    console.log("\nRe-run with --confirm to apply.\n");
    return;
  }

  let deleted = 0;
  for (const r of toDelete) {
    await ddb.delete({ TableName: TABLE, Key: { pk: r.pk, sk: r.sk } });
    deleted++;
    if (deleted % 25 === 0) console.log(`  deleted ${deleted}/${toDelete.length}`);
  }
  console.log(`deleted ${deleted} ledger rows`);

  let zeroed = 0;
  for (const r of runUsers) {
    await ddb.update({
      TableName: TABLE,
      Key: { pk: r.pk, sk: r.sk },
      UpdateExpression:
        "SET #sc = :z, #sb = :sb, #sd = :sd, #ac = :ac, #cs = :zero, " +
        "#soc = :zero, #act = :zero, #ctf = :zero, #ra = :now",
      ExpressionAttributeNames: {
        "#sc": "score",
        "#sb": "scoreBreakdown",
        "#sd": "streakDays",
        "#ac": "activityCounts",
        "#cs": "ctfSolves",
        "#soc": "socialScore",
        "#act": "activityScore",
        "#ctf": "ctfScore",
        "#ra": "rescoredAt",
      },
      ExpressionAttributeValues: {
        ":z": ZEROED.score,
        ":sb": ZEROED.scoreBreakdown,
        ":sd": ZEROED.streakDays,
        ":ac": ZEROED.activityCounts,
        ":zero": 0,
        ":now": Date.now(),
      },
    });
    zeroed++;
    if (zeroed % 50 === 0) console.log(`  zeroed ${zeroed}/${runUsers.length}`);
  }
  console.log(`zeroed ${zeroed} RunUser rows`);

  let reset = 0;
  for (const r of ctfDefs) {
    await ddb.update({
      TableName: TABLE,
      Key: { pk: r.pk, sk: r.sk },
      UpdateExpression: "SET #n = :zero",
      ExpressionAttributeNames: { "#n": "solveCount" },
      ExpressionAttributeValues: { ":zero": 0 },
    });
    reset++;
  }
  console.log(`reset ${reset} Ctf.solveCount\n`);
  console.log("DONE. Recommended: POST /api/admin/rescore-all (should be a no-op).\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
