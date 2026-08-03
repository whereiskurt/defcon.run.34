/**
 * showcase-user.mts — grant ONE runner every award the board can display.
 *
 * Kurt, 2026-08-03: "zero me out but then award me every single award possible.
 * Kinda a fake first place - but when you look at me, you get the idea of all
 * of the types of flags you can get."
 *
 * Run AFTER reset-all-scores.mts. This does not clear anything first — the
 * reset already did, and re-running this over itself is idempotent anyway
 * (every write is a put on a deterministic key).
 *
 * ── WHAT IT WRITES ──────────────────────────────────────────────────────────
 *   CtfSolve       one per live Ctf row, ordinal 1 (first blood = top value),
 *                  solvedAt spread across con days so ctfStreak lights up.
 *   Accomplishment one per con day, rotating source checkin/gpx/strava, so
 *                  runStreak lights up. Accomplishments carry NO points — they
 *                  only light con-days (see bib-pickup.ts:11-15).
 *   CtfScoreEvent  challenge "social-scan", one per con day, points 0 — the
 *                  only thing that lights socialStreak (scoring-engine.ts:148).
 *   ClusterAward   `cap` awards per con day at the top tier, so clusterBonus
 *                  hits its ceiling (the engine takes best-N per day).
 *   RunUser        score fields, computed by the REAL computeUserScore.
 *
 * ── WHY IT MIRRORS THE ENTITIES INSTEAD OF HAND-COMPOSING KEYS ──────────────
 * The entity modules import @auth/dynamodb-adapter (ESM-only) which a tsx CJS
 * run cannot require — the reason every sibling script talks raw SDK. But
 * hand-composing ElectroDB keys is THE landmine here (a mis-composed key writes
 * a row nothing can ever read). So instead of composing by hand, this defines
 * local Entity mirrors with configs copied verbatim from the real ones and lets
 * ELECTRODB compose every key — the same trick src/entities/__tests__/
 * bib-key-parity.test.ts uses. `scoring-engine.ts` and `con-days.ts` ARE pure
 * (they import only each other + cluster-config), so the real scoring logic is
 * imported directly rather than reimplemented.
 *
 * ⚠️ If the real entity configs change, these mirrors must change with them.
 * The `--verify` pass reads every written row back through the same access
 * patterns the app uses, which is what catches drift.
 *
 * ── FABRICATED DATES ────────────────────────────────────────────────────────
 * Con days (2026-08-05..10) are in the FUTURE as of writing. Streak and cluster
 * rows are dated inside that window deliberately — Kurt's explicit call — so the
 * showcase row demonstrates every scoring MECHANISM, not just flag types. These
 * rows sit in the same tables the live cluster sweep reads.
 *
 * ── USAGE ───────────────────────────────────────────────────────────────────
 *   ⚠️ NEVER pass --env-file=.env (points at LOCAL DynamoDB).
 *
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 \
 *     npx tsx scripts/showcase-user.mts --email whereiskurt@gmail.com
 *   …same + --confirm   to write
 *   …same + --verify    to read back and re-check the score
 */
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { Entity } from "electrodb";
import { computeUserScore } from "../src/lib/scoring-engine";
import { CON_DAYS } from "../src/lib/con-days";
import { DEFAULT_CLUSTER_CONFIG } from "../src/lib/cluster-config";

const argv = process.argv;
const CONFIRM = argv.includes("--confirm");
const VERIFY = argv.includes("--verify");
const emailIdx = argv.indexOf("--email");
const EMAIL = emailIdx > -1 ? argv[emailIdx + 1] : undefined;

const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const AUTH_TABLE = process.env.RUN_DYNAMODB_DBNAME || "run-human-authjs";
const REGION = process.env.RUN_DYNAMODB_REGION;

if (!REGION) {
  console.error("Missing required env var: RUN_DYNAMODB_REGION");
  process.exit(2);
}
if (!EMAIL) {
  console.error("Missing --email <address>");
  process.exit(2);
}
if (process.env.RUN_ELECTRO_ENDPOINT) {
  console.error("REFUSING: RUN_ELECTRO_ENDPOINT is set — that is LOCAL DynamoDB.");
  process.exit(2);
}

const ddb = DynamoDBDocument.from(new DynamoDB({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

// ── Entity mirrors. Configs copied verbatim from src/entities/*. ────────────
const opts = { client: ddb as never, table: TABLE };

const CtfSolve = new Entity(
  {
    model: { entity: "CtfSolve", version: "1", service: "run" },
    attributes: {
      challenge: { type: "string", required: true },
      user: { type: "string", required: true },
      ordinal: { type: "number" },
      points: { type: "number" },
      firstBlood: { type: "boolean" },
      tierCeiling: { type: "number" },
      channel: { type: ["qr", "covert"] as const },
      solvedAt: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: {
        type: "string",
        default: () => new Date().toISOString(),
        watch: "*" as const,
        set: () => new Date().toISOString(),
      },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["challenge"] },
        sk: { field: "sk", composite: ["user"] },
      },
      byUser: {
        index: "gsi1pk-gsi1sk-index",
        pk: { field: "gsi1pk", composite: ["user"] },
        sk: { field: "gsi1sk", composite: ["challenge"] },
      },
    },
  },
  opts
);

const CtfScoreEvent = new Entity(
  {
    model: { entity: "CtfScoreEvent", version: "1", service: "run" },
    attributes: {
      challenge: { type: "string", required: true },
      user: { type: "string", required: true },
      bucket: { type: "string", required: true },
      points: { type: "number" },
      ordinal: { type: "number" },
      channel: { type: ["qr", "covert"] as const },
      scoredAt: { type: "string" },
      tierCeiling: { type: "number" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: {
        type: "string",
        default: () => new Date().toISOString(),
        watch: "*" as const,
        set: () => new Date().toISOString(),
      },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["challenge"] },
        sk: { field: "sk", composite: ["user", "bucket"] },
      },
      byUser: {
        index: "gsi1pk-gsi1sk-index",
        pk: { field: "gsi1pk", composite: ["user"] },
        sk: { field: "gsi1sk", composite: ["challenge", "bucket"] },
      },
    },
  },
  opts
);

const Accomplishment = new Entity(
  {
    model: { entity: "Accomplishment", version: "1", service: "run" },
    attributes: {
      userId: { type: "string", required: true },
      accomplishmentId: { type: "string", required: true },
      type: { type: ["activity"] as const, required: true, default: "activity" },
      source: { type: ["checkin", "gpx", "strava"] as const, required: true },
      name: { type: "string", required: true },
      description: { type: "string" },
      completedAt: { type: "number", required: true },
      year: { type: "number", required: true },
      isPrivate: { type: "boolean", default: false },
      metadata: {
        type: "map",
        properties: {
          points: { type: "number" },
          distance: { type: "number" },
          elevation: { type: "number" },
          gpxFileId: { type: "string" },
          checkInId: { type: "string" },
          stravaActivityId: { type: "string" },
        },
      },
      createdAt: { type: "number", default: () => Date.now(), readOnly: true },
      updatedAt: { type: "number", watch: "*" as const, set: () => Date.now(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["userId"] },
        sk: { field: "sk", composite: ["accomplishmentId"] },
      },
      byType: {
        index: "gsi1pk-gsi1sk-index",
        pk: { field: "gsi1pk", composite: ["userId", "type"] },
        sk: { field: "gsi1sk", composite: ["completedAt"] },
      },
      byYear: {
        index: "gsi2pk-gsi2sk-index",
        pk: { field: "gsi2pk", composite: ["userId", "year"] },
        sk: { field: "gsi2sk", composite: ["completedAt"] },
      },
    },
  },
  opts
);

const ClusterAward = new Entity(
  {
    model: { entity: "ClusterAward", version: "1", service: "run" },
    attributes: {
      userId: { type: "string", required: true },
      anchorCheckInId: { type: "string", required: true },
      clusterId: { type: "string" },
      day: { type: "string" },
      size: { type: "number" },
      points: { type: "number" },
      centroidLat: { type: "number" },
      centroidLng: { type: "number" },
      startAt: { type: "number", required: true },
      endAt: { type: "number" },
      awardedAt: { type: "number", default: () => Date.now() },
      createdAt: { type: "number", default: () => Date.now(), readOnly: true },
      updatedAt: { type: "number", watch: "*" as const, set: () => Date.now(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["userId"] },
        sk: { field: "sk", composite: ["anchorCheckInId"] },
      },
      byRecent: {
        index: "gsi2pk-gsi2sk-index",
        pk: { field: "gsi2pk", composite: [], template: "TYPE#CLUSTERAWARD" },
        sk: { field: "gsi2sk", composite: ["startAt"] },
      },
    },
  },
  opts
);

// ── helpers ────────────────────────────────────────────────────────────────
async function scanAll(table: string, extra: Record<string, unknown> = {}) {
  const out: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.scan({
      TableName: table,
      ExclusiveStartKey: ExclusiveStartKey as never,
      ...extra,
    });
    out.push(...((res.Items ?? []) as Record<string, unknown>[]));
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return out;
}

/** Con-local noon on a con day, as epoch ms. Safely inside the day in PDT. */
function conNoon(day: string): number {
  return Date.parse(`${day}T19:00:00.000Z`); // 12:00 PDT
}

async function main() {
  console.log(`\n=== showcase-user [${CONFIRM ? "WRITE" : VERIFY ? "VERIFY" : "DRY-RUN"}] ===`);
  console.log(`table: ${TABLE}   region: ${REGION}   email: ${EMAIL}\n`);

  // 1. email -> adapter uuid (the id EVERYTHING in run-human-electro is keyed by)
  const users = await scanAll(AUTH_TABLE, {
    FilterExpression: "email = :e",
    ExpressionAttributeValues: { ":e": EMAIL },
  });
  const ids = Array.from(
    new Set(users.filter((r) => typeof r.id === "string" && r.id).map((r) => r.id as string))
  );
  if (ids.length !== 1) {
    console.error(`Expected exactly 1 user for ${EMAIL}, found ${ids.length}: ${ids.join(", ")}`);
    process.exit(3);
  }
  const userId = ids[0];
  console.log(`resolved ${EMAIL} -> ${userId}\n`);

  // 2. live flag definitions
  const all = await scanAll(TABLE);
  const ctfRows = all.filter((r) => r.__edb_e__ === "Ctf");
  const configs = new Map<string, Record<string, unknown>>();
  for (const c of ctfRows) configs.set(c.challenge as string, c);
  console.log(`live Ctf definitions: ${ctfRows.length}`);

  const clusterCfgRow = all.find((r) => r.__edb_e__ === "ClusterConfig");
  // NOTE the field is `minRunners`, NOT `minSize` (cluster-config.ts:58-63). Getting
  // that wrong writes `size: undefined` onto every award, which removeUndefinedValues
  // then silently drops — an award row with no size, and no error anywhere.
  const tiers =
    (clusterCfgRow?.tiers as { minRunners: number; points: number }[] | undefined) ??
    DEFAULT_CLUSTER_CONFIG.tiers;
  const cap =
    (clusterCfgRow?.maxPerUserPerDay as number | undefined) ??
    DEFAULT_CLUSTER_CONFIG.maxPerUserPerDay;
  const topTier = [...tiers].sort((a, b) => b.points - a.points)[0];
  console.log(`live tiers: ${JSON.stringify(tiers)}`);
  console.log(
    `cluster cap/day: ${cap}   top tier: minRunners>=${topTier.minRunners} = ${topTier.points}pts\n`
  );
  if (typeof topTier.minRunners !== "number" || typeof topTier.points !== "number") {
    console.error("FATAL: cluster tier shape unrecognised — refusing to write bad award rows.");
    process.exit(3);
  }

  // 3. compose the ledger
  const days = CON_DAYS.slice(0, 4); // 4 distinct days = the 500-point streak cap
  const challenges = [...configs.keys()].sort();

  const solves = challenges.map((challenge, i) => ({
    challenge,
    user: userId,
    ordinal: 1, // first blood -> top of the decay curve
    firstBlood: true,
    channel: "covert" as const,
    solvedAt: new Date(conNoon(days[i % days.length])).toISOString(),
  }));

  const accomplishments = days.map((day, i) => ({
    userId,
    accomplishmentId: `showcase-${day}`,
    type: "activity" as const,
    source: (["checkin", "gpx", "strava"] as const)[i % 3],
    name: `DEF CON 34 showcase run — ${day}`,
    description: "Seeded showcase activity (scripts/showcase-user.mts)",
    completedAt: conNoon(day),
    year: 2026,
    isPrivate: false,
    metadata: { distance: 5000, elevation: 30 },
  }));

  const socialEvents = days.map((day) => ({
    challenge: "social-scan",
    user: userId,
    bucket: `${day}#showcase`,
    points: 0,
    scoredAt: new Date(conNoon(day)).toISOString(),
  }));

  const clusterAwards: {
    userId: string;
    anchorCheckInId: string;
    clusterId: string;
    day: string;
    size: number;
    points: number;
    startAt: number;
    endAt: number;
  }[] = [];
  for (const day of days) {
    for (let n = 0; n < cap; n++) {
      clusterAwards.push({
        userId,
        anchorCheckInId: `showcase-${day}-${n}`,
        clusterId: `showcase-cluster-${day}-${n}`,
        day,
        size: topTier.minRunners,
        points: topTier.points,
        startAt: conNoon(day) + n * 3_600_000,
        endAt: conNoon(day) + n * 3_600_000 + 1_800_000,
      });
    }
  }

  // 4. score it with the REAL engine
  const result = computeUserScore({
    accomplishments: accomplishments.map((a) => ({
      source: a.source,
      completedAt: a.completedAt,
    })) as never,
    solves: solves.map((s) => ({
      challenge: s.challenge,
      ordinal: s.ordinal,
      solvedAt: s.solvedAt,
    })) as never,
    events: socialEvents.map((e) => ({
      challenge: e.challenge,
      bucket: e.bucket,
      points: e.points,
      scoredAt: e.scoredAt,
    })) as never,
    configs: configs as never,
    clusterAwards: clusterAwards.map((c) => ({ points: c.points, startAt: c.startAt })) as never,
    clusterCap: cap,
  });

  console.log("PLAN");
  console.log(`  CtfSolve        ${String(solves.length).padStart(3)}  (every live flag, ordinal 1)`);
  console.log(`  Accomplishment  ${String(accomplishments.length).padStart(3)}  (${days.join(", ")})`);
  console.log(`  CtfScoreEvent   ${String(socialEvents.length).padStart(3)}  (social-scan, 0 pts)`);
  console.log(`  ClusterAward    ${String(clusterAwards.length).padStart(3)}  (${cap}/day x ${days.length} days)`);
  console.log();
  console.log("COMPUTED SCORE (real computeUserScore)");
  console.log(`  runStreak     ${String(result.breakdown.runStreak).padStart(5)}`);
  console.log(`  socialStreak  ${String(result.breakdown.socialStreak).padStart(5)}`);
  console.log(`  ctfStreak     ${String(result.breakdown.ctfStreak).padStart(5)}`);
  console.log(`  flagPoints    ${String(result.breakdown.flagPoints).padStart(5)}`);
  console.log(`  clusterBonus  ${String(result.breakdown.clusterBonus).padStart(5)}`);
  console.log(`  ${"TOTAL".padEnd(13)} ${String(result.score).padStart(5)}\n`);

  if (VERIFY) {
    const mine = await ddb.get({ TableName: TABLE, Key: { pk: `$run#userid_${userId}`, sk: "$runuser_1" } });
    const u = mine.Item as Record<string, unknown> | undefined;
    console.log("LIVE RunUser row:");
    console.log(`  score          ${u?.score}`);
    console.log(`  scoreBreakdown ${JSON.stringify(u?.scoreBreakdown)}`);
    console.log(`  streakDays     ${JSON.stringify(u?.streakDays)}`);
    console.log(`  ctfSolves      ${u?.ctfSolves}`);
    const back = await CtfSolve.query.byUser({ user: userId }).go();
    console.log(`  CtfSolve rows readable via byUser: ${back.data.length}`);
    return;
  }

  if (!CONFIRM) {
    console.log("DRY RUN — nothing written. Sample composed keys:");
    console.log(`  ${JSON.stringify(CtfSolve.put(solves[0] as never).params<{ Item: { pk: string; sk: string } }>().Item)}`.slice(0, 220));
    console.log("\nRe-run with --confirm to apply.\n");
    return;
  }

  await CtfSolve.put(solves as never).go();
  console.log(`wrote ${solves.length} CtfSolve`);
  await Accomplishment.put(accomplishments as never).go();
  console.log(`wrote ${accomplishments.length} Accomplishment`);
  await CtfScoreEvent.put(socialEvents as never).go();
  console.log(`wrote ${socialEvents.length} CtfScoreEvent`);
  await ClusterAward.put(clusterAwards as never).go();
  console.log(`wrote ${clusterAwards.length} ClusterAward`);

  await ddb.update({
    TableName: TABLE,
    Key: { pk: `$run#userid_${userId}`, sk: "$runuser_1" },
    UpdateExpression:
      "SET #sc = :s, #sb = :sb, #sd = :sd, #ac = :ac, #cs = :cs, #ra = :now",
    ExpressionAttributeNames: {
      "#sc": "score",
      "#sb": "scoreBreakdown",
      "#sd": "streakDays",
      "#ac": "activityCounts",
      "#cs": "ctfSolves",
      "#ra": "rescoredAt",
    },
    ExpressionAttributeValues: {
      ":s": result.score,
      ":sb": result.breakdown,
      ":sd": result.days,
      ":ac": {
        checkin: result.counts.checkin,
        gpx: result.counts.gpx,
        strava: result.counts.strava,
      },
      ":cs": result.counts.solves,
      ":now": Date.now(),
    },
  });
  console.log(`\nRunUser score -> ${result.score}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
