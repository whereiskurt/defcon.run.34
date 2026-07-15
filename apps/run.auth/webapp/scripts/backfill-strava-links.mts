/**
 * backfill-strava-links.mts — heal Strava links that recorded the OAuth account
 * but never wrote the AuthProfile.strava map.
 *
 * BACKGROUND: for a long window, linking Strava succeeded at the OAuth-account
 * layer (a `provider=strava` row in run-auth-authjs) but the follow-up
 * AuthProfile.strava write threw an ElectroValidationError — Strava returns
 * null city/state/country for athletes with no location, and the non-nullable
 * string schema rejected the whole upsert (fixed forward in run.auth v0.0.42 +
 * buildStravaLink). run.human reads ONLY AuthProfile.strava.id (→ linked_providers
 * claim → hasStrava), so those users show "not connected" despite a real link.
 *
 * This script re-derives the minimum-viable link — just the athlete id, which
 * IS the providerAccountId already stored on the account row — and writes
 * AuthProfile.strava = { id, linkedAt } for any linked user missing it. Nothing
 * else is touched (services/name/displayName/quota all preserved).
 *
 * ── WHY the raw @aws-sdk client and NOT the ElectroDB entities ───────────────
 * The entities import @auth/dynamodb-adapter (ESM-only) which a standalone tsx
 * run cannot require. So we talk to DynamoDB via the raw DynamoDBDocument client,
 * find AuthProfile rows by ElectroDB's `__edb_e__` marker, and write each row by
 * its OWN pk/sk (read from the scan) — no key composition, zero entity-key drift.
 *
 * SAFETY / hygiene:
 *   - DRY-RUN BY DEFAULT: prints every user it would heal (and every skip), and
 *     writes NOTHING. Pass --confirm to actually write.
 *   - Idempotent: skips any user whose AuthProfile already has strava.id, and
 *     the write is guarded by ConditionExpression attribute_not_exists(strava.id).
 *   - Only SETs strava + updatedAt; never removes or overwrites other fields.
 *   - Fails loud (non-zero exit) on a malformed athlete id or a linked user with
 *     no AuthProfile row (reports them; writes nothing for them).
 *   - Standalone operator script: NOT imported by any app/request/build path.
 *
 * Env (default AWS credential chain — use AWS_PROFILE; tables default to prod):
 *   AWS_REGION | AUTH_DYNAMODB_REGION   (default us-east-1)
 *   AUTH_ELECTRO_DBNAME                  (AuthProfile table; default run-auth-electro)
 *   AUTH_DYNAMODB_DBNAME                 (accounts table;   default run-auth-authjs)
 *   AUTH_ELECTRO_ENDPOINT                (optional; set for LOCAL dynamodb)
 *
 * PROD RUN RECIPE (us-east-1). NOTE: do NOT pass --env-file=.env — the app .env
 * points at localhost:8888 and would redirect the script off prod.
 *   cd apps/run.auth/webapp
 *   # 1. dry-run — inspect exactly who would be healed (writes nothing):
 *   AWS_PROFILE=dc34-application AWS_REGION=us-east-1 npx tsx scripts/backfill-strava-links.mts
 *   # 2. commit the backfill:
 *   AWS_PROFILE=dc34-application AWS_REGION=us-east-1 npx tsx scripts/backfill-strava-links.mts --confirm
 */
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const CONFIRM = process.argv.includes("--confirm");

const ELECTRO_TABLE = process.env.AUTH_ELECTRO_DBNAME || "run-auth-electro";
const AUTHJS_TABLE = process.env.AUTH_DYNAMODB_DBNAME || "run-auth-authjs";
const REGION =
  process.env.AWS_REGION || process.env.AUTH_DYNAMODB_REGION || "us-east-1";
const ENDPOINT = process.env.AUTH_ELECTRO_ENDPOINT; // set only for local

const client = DynamoDBDocument.from(
  new DynamoDB({ region: REGION, ...(ENDPOINT ? { endpoint: ENDPOINT } : {}) }),
  { marshallOptions: { removeUndefinedValues: true } }
);

/** Scan an entire table with a filter, following pagination. */
async function scanAll(params: Record<string, unknown>): Promise<any[]> {
  const items: any[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await client.scan({ ...params, ExclusiveStartKey } as any);
    items.push(...(res.Items ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return items;
}

async function main() {
  console.log(`backfill-strava-links — ${CONFIRM ? "CONFIRM (writing)" : "DRY-RUN (no writes)"}`);
  console.log(`  region=${REGION} accounts=${AUTHJS_TABLE} profiles=${ELECTRO_TABLE}${ENDPOINT ? ` endpoint=${ENDPOINT}` : ""}\n`);

  // 1. Every Strava OAuth account = a completed link. providerAccountId = athlete id.
  const accounts = await scanAll({
    TableName: AUTHJS_TABLE,
    FilterExpression: "provider = :p",
    ExpressionAttributeValues: { ":p": "strava" },
    ProjectionExpression: "userId, providerAccountId",
  });

  // 2. All AuthProfile rows, keyed by userId, with their real pk/sk + strava.id.
  const profiles = await scanAll({
    TableName: ELECTRO_TABLE,
    FilterExpression: "#e = :e",
    ExpressionAttributeNames: { "#e": "__edb_e__" },
    ExpressionAttributeValues: { ":e": "AuthProfile" },
    ProjectionExpression: "pk, sk, userId, strava",
  });
  const profileByUser = new Map<string, any>();
  for (const p of profiles) if (p.userId) profileByUser.set(p.userId, p);

  const toHeal: { userId: string; athleteId: number; pk: string; sk: string }[] = [];
  const skipped: string[] = [];
  const problems: string[] = [];

  for (const acc of accounts) {
    const userId = acc.userId as string;
    const athleteId = Number(acc.providerAccountId);
    if (!Number.isFinite(athleteId) || athleteId <= 0) {
      problems.push(`${userId}: unusable athlete id ${JSON.stringify(acc.providerAccountId)}`);
      continue;
    }
    const prof = profileByUser.get(userId);
    if (!prof) {
      problems.push(`${userId}: Strava account but NO AuthProfile row (athlete ${athleteId})`);
      continue;
    }
    if (prof.strava?.id) {
      skipped.push(`${userId}: already linked (strava.id=${prof.strava.id})`);
      continue;
    }
    toHeal.push({ userId, athleteId, pk: prof.pk, sk: prof.sk });
  }

  console.log(`Strava accounts: ${accounts.length} | already-linked: ${skipped.length} | to heal: ${toHeal.length} | problems: ${problems.length}\n`);
  for (const s of skipped) console.log(`  skip  ${s}`);
  for (const p of problems) console.log(`  WARN  ${p}`);
  if (toHeal.length) console.log("");
  for (const h of toHeal) console.log(`  heal  ${h.userId} → strava.id=${h.athleteId}`);

  if (!toHeal.length) {
    console.log("\nNothing to heal. Done.");
    return;
  }
  if (!CONFIRM) {
    console.log(`\nDRY-RUN — would heal ${toHeal.length} user(s). Re-run with --confirm to write.`);
    return;
  }

  // 3. Write the minimal link for each — guarded so a concurrent/real link wins.
  const now = Date.now();
  let ok = 0;
  for (const h of toHeal) {
    try {
      await client.update({
        TableName: ELECTRO_TABLE,
        Key: { pk: h.pk, sk: h.sk },
        UpdateExpression: "SET strava = :s, updatedAt = :now",
        ConditionExpression: "attribute_not_exists(strava.id)",
        ExpressionAttributeValues: {
          ":s": { id: h.athleteId, linkedAt: now },
          ":now": now,
        },
      });
      ok++;
      console.log(`  wrote ${h.userId} → strava.id=${h.athleteId}`);
    } catch (err: any) {
      if (err?.name === "ConditionalCheckFailedException") {
        console.log(`  skip  ${h.userId}: strava.id appeared concurrently`);
      } else {
        problems.push(`${h.userId}: write failed — ${err?.name || err}`);
        console.error(`  ERROR ${h.userId}:`, err?.message || err);
      }
    }
  }

  console.log(`\nHealed ${ok}/${toHeal.length}. Problems: ${problems.length}.`);
  if (problems.length) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
