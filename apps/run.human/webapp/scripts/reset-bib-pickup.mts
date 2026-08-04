/**
 * reset-bib-pickup.mts — unaward every bib pickup granted before the pass gate.
 *
 * Until 2026-08-04 the 200-point bib pickup fired on a runner's FIRST self-scan
 * with no other gate, so several runners awarded themselves by scanning their
 * own QR out of curiosity. The pass gate (lib/bib-pickup.ts) now requires an
 * operator to have primed the bib first; this script reverses the awards that
 * were handed out under the old rule.
 *
 * WHAT IT DOES
 *   1. Query the `$run#challenge_bib-pickup` partition (a QUERY, never a scan —
 *      the blast radius is exactly one partition).
 *   2. Capture the KEEP row (--keep <userId>) VERBATIM before deleting.
 *   3. Delete every CtfSolve row on that partition, by its OWN pk/sk as read.
 *   4. Put the KEEP row back byte-for-byte and set Ctf.solveCount = 1.
 *      (Omit --keep to wipe everything and set solveCount = 0.)
 *   5. Rescore every affected user with the REAL pure computeUserScore.
 *
 * ── WHY the raw @aws-sdk client and NOT the ElectroDB entities ───────────────
 * Same rationale as reset-ctf-user.mts / showcase-user.mts: the entity modules
 * import @auth/dynamodb-adapter (ESM-only), which a standalone `tsx` CJS run
 * cannot require. Every row is deleted or written by the pk/sk READ BACK from
 * DynamoDB — no key composition anywhere, so there is ZERO entity-key drift
 * risk. `scoring-engine.ts` IS pure and importable, so the real engine does the
 * maths rather than a hand-rolled "subtract 200".
 *
 * ⚠️ Ordinals are COSMETIC on this challenge: pointMax == pointFloor == 200 and
 * firstBloodBonus == 0, so restoring the KEEP row at ordinal 1 costs the next
 * real picker-upper nothing but a number.
 *
 * SAFETY
 *   - DRY-RUN BY DEFAULT. Prints every row it would delete, the KEEP row it
 *     would restore, and each user's before/after score. Writes NOTHING without
 *     --confirm.
 *   - REFUSES to run when RUN_ELECTRO_ENDPOINT is set (that is LOCAL DynamoDB —
 *     the documented way a prod --confirm silently wipes the wrong store).
 *   - Touches ONLY the bib-pickup partition and the affected users' RunUser
 *     score fields. run.bib's MONEY rows (Bib / GeneralDonation /
 *     PendingContribution / BibReconcile) share this physical table and are
 *     never read, never written, never scanned.
 *   - Idempotent: a second --confirm run finds only the KEEP row and no-ops.
 *
 * PROD RUN RECIPE
 *   cd apps/run.human/webapp
 *   # 1. dry run — inspect exactly what would change:
 *   AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/reset-bib-pickup.mts \
 *     --keep 041287e3-a0a4-4ffc-9a38-b38f83fb9057
 *   # 2. commit it:
 *   AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/reset-bib-pickup.mts \
 *     --keep 041287e3-a0a4-4ffc-9a38-b38f83fb9057 --confirm
 */
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { computeUserScore } from "../src/lib/scoring-engine";
import { DEFAULT_CLUSTER_CONFIG } from "../src/lib/cluster-config";

const CHALLENGE = "bib-pickup";
const PARTITION = `$run#challenge_${CHALLENGE}`;

const CONFIRM = process.argv.includes("--confirm");
function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const KEEP = argValue("--keep");

const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const REGION = process.env.RUN_DYNAMODB_REGION;

if (!REGION) {
  console.error("Missing required env var: RUN_DYNAMODB_REGION");
  process.exit(2);
}
// The one guard that matters: a local endpoint means this is NOT prod data.
if (process.env.RUN_ELECTRO_ENDPOINT) {
  console.error(
    "RUN_ELECTRO_ENDPOINT is set — refusing to run against local DynamoDB.\n" +
      "Do NOT pass --env-file=.env.local. Unset it and re-run."
  );
  process.exit(2);
}

function creds(idVar: string, secretVar: string) {
  const id = process.env[idVar];
  const secret = process.env[secretVar];
  return id && secret
    ? { credentials: { accessKeyId: id, secretAccessKey: secret } }
    : {};
}

const ddb = DynamoDBDocument.from(
  new DynamoDB({ region: REGION, ...creds("RUN_ELECTRO_ID", "RUN_ELECTRO_SECRET") }),
  { marshallOptions: { removeUndefinedValues: true } }
);

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

async function queryAll(pk: string): Promise<Row[]> {
  const items: Row[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.query({
      TableName: TABLE,
      KeyConditionExpression: "pk = :p",
      ExpressionAttributeValues: { ":p": pk },
      ExclusiveStartKey,
    });
    items.push(...((r.Items as Row[]) || []));
    ExclusiveStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return items;
}

/**
 * One paginated pass over the table, grouped in memory. DynamoDB caps a Scan at
 * ~1MB of SCANNED bytes per page, so the LastEvaluatedKey loop is mandatory — a
 * single un-paginated scan on this table is silently truncated and would make
 * every rescore wrong in a way that looks like a successful run.
 */
async function scanAll(): Promise<Row[]> {
  const items: Row[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.scan({ TableName: TABLE, ExclusiveStartKey });
    items.push(...((r.Items as Row[]) || []));
    ExclusiveStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return items;
}

async function main() {
  console.log(
    `Table: ${TABLE}  Region: ${REGION}  Mode: ${CONFIRM ? "WRITE" : "DRY-RUN"}`
  );
  console.log(`Partition: ${PARTITION}`);
  console.log(`Keep row for: ${KEEP ?? "(none — full wipe)"}\n`);

  const partition = await queryAll(PARTITION);
  const solves = partition.filter((r) => r.__edb_e__ === "CtfSolve");
  const ctfRow = partition.find((r) => r.__edb_e__ === "Ctf");
  const others = partition.filter(
    (r) => r.__edb_e__ !== "CtfSolve" && r.__edb_e__ !== "Ctf"
  );

  if (!ctfRow) {
    console.error(`No Ctf definition row on ${PARTITION}. Aborting.`);
    process.exit(3);
  }

  console.log(`Ctf row: solveCount=${ctfRow.solveCount} enabled=${ctfRow.enabled}`);
  console.log(`CtfSolve rows: ${solves.length}`);
  for (const s of solves) {
    const tag = s.user === KEEP ? "  ← KEEP (restored verbatim)" : "  → DELETE";
    console.log(
      `  ${String(s.user).slice(0, 8)}  ordinal=${s.ordinal ?? "?"}  ` +
        `points=${s.points ?? "?"}  firstBlood=${s.firstBlood ?? false}  ` +
        `${s.solvedAt}${tag}`
    );
  }
  if (others.length) {
    console.log(`\nOther rows on this partition (LEFT ALONE): ${others.length}`);
    for (const o of others) console.log(`  ${o.__edb_e__}  sk=${o.sk}`);
  }

  const keepRow = KEEP ? solves.find((s) => s.user === KEEP) : undefined;
  if (KEEP && !keepRow) {
    console.error(`\n--keep ${KEEP} given but that user has no solve row. Aborting.`);
    process.exit(3);
  }
  const nextSolveCount = keepRow ? 1 : 0;
  const affected = solves.map((s) => s.user as string);

  // ── Rescore preview ───────────────────────────────────────────────────────
  // The engine is the ONLY thing allowed to decide a score (points-consistency:
  // rescoreUser is the sole writer in the app). Here we mirror it exactly rather
  // than subtracting 200 by hand.
  console.log(`\nLoading ledger for ${affected.length} affected users…`);
  const all = await scanAll();
  const byEntity = (e: string) => all.filter((r) => r.__edb_e__ === e);

  const configs = new Map<string, any>(
    byEntity("Ctf").map((c) => [c.challenge as string, c])
  );
  const clusterCfg = byEntity("ClusterConfig")[0];
  const clusterCap =
    clusterCfg?.maxPerUserPerDay ?? DEFAULT_CLUSTER_CONFIG.maxPerUserPerDay;

  // The post-delete world: every bib-pickup solve is gone except the KEEP row.
  const survivingSolve = (r: Row) =>
    !(r.challenge === CHALLENGE && r.user !== KEEP);

  const plans: Array<{ userId: string; before: number; after: number }> = [];
  for (const userId of affected) {
    const runUser = byEntity("RunUser").find((u) => u.userId === userId);
    const result = computeUserScore({
      accomplishments: byEntity("Accomplishment")
        .filter((a) => a.userId === userId)
        .map((a) => ({ source: a.source, completedAt: a.completedAt })) as never,
      solves: byEntity("CtfSolve")
        .filter((s) => s.user === userId && survivingSolve(s))
        .map((s) => ({
          challenge: s.challenge,
          ordinal: s.ordinal,
          solvedAt: s.solvedAt,
        })) as never,
      events: byEntity("CtfScoreEvent")
        .filter((e) => e.user === userId && survivingSolve(e))
        .map((e) => ({
          challenge: e.challenge,
          bucket: e.bucket,
          ordinal: e.ordinal,
          points: e.points,
          scoredAt: e.scoredAt,
        })) as never,
      configs: configs as never,
      clusterAwards: byEntity("ClusterAward")
        .filter((c) => c.userId === userId)
        .map((c) => ({ points: c.points ?? 0, startAt: c.startAt })) as never,
      clusterCap,
    });
    plans.push({
      userId,
      before: (runUser?.score as number) ?? 0,
      after: result.score,
    });
    console.log(
      `  ${userId.slice(0, 8)}  ${String(runUser?.displayName ?? "?").padEnd(16)}` +
        `  ${String((runUser?.score as number) ?? 0).padStart(6)} → ${String(result.score).padStart(6)}` +
        `  ${JSON.stringify(result.breakdown)}`
    );
    (plans[plans.length - 1] as any).result = result;
    (plans[plans.length - 1] as any).runUser = runUser;
  }

  console.log(`\nPLAN`);
  console.log(`  delete CtfSolve rows   ${solves.length - (keepRow ? 1 : 0)}`);
  console.log(`  restore KEEP row       ${keepRow ? 1 : 0}`);
  console.log(`  Ctf.solveCount         ${ctfRow.solveCount} → ${nextSolveCount}`);
  console.log(`  rescore users          ${plans.length}`);

  if (!CONFIRM) {
    console.log(`\nDRY-RUN — nothing written. Re-run with --confirm to apply.\n`);
    return;
  }

  // ── Writes ────────────────────────────────────────────────────────────────
  for (const s of solves) {
    await ddb.delete({ TableName: TABLE, Key: { pk: s.pk, sk: s.sk } });
    console.log(`deleted CtfSolve ${String(s.user).slice(0, 8)} (sk=${s.sk})`);
  }
  if (keepRow) {
    // Verbatim put of the row exactly as it was read — no key composition, no
    // attribute reconstruction, so the restored row cannot drift from the original.
    await ddb.put({ TableName: TABLE, Item: keepRow });
    console.log(`restored KEEP row for ${String(keepRow.user).slice(0, 8)}`);
  }
  await ddb.update({
    TableName: TABLE,
    Key: { pk: ctfRow.pk, sk: ctfRow.sk },
    UpdateExpression: "SET solveCount = :c, updatedAt = :u",
    ExpressionAttributeValues: {
      ":c": nextSolveCount,
      ":u": new Date().toISOString(),
    },
  });
  console.log(`set Ctf.solveCount = ${nextSolveCount}`);

  for (const p of plans as any[]) {
    if (!p.runUser) {
      console.log(`  (no RunUser row for ${p.userId.slice(0, 8)} — skipped)`);
      continue;
    }
    await ddb.update({
      TableName: TABLE,
      Key: { pk: p.runUser.pk, sk: p.runUser.sk },
      UpdateExpression:
        "SET score = :s, scoreBreakdown = :b, streakDays = :d, ctfSolves = :n, rescoredAt = :r",
      ExpressionAttributeValues: {
        ":s": p.result.score,
        ":b": p.result.breakdown,
        ":d": p.result.days,
        ":n": p.result.counts.solves,
        ":r": Date.now(),
      },
    });
    console.log(`rescored ${p.userId.slice(0, 8)}  ${p.before} → ${p.after}`);
  }

  console.log(`\nDone.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
