/**
 * reset-social-user.mts — operator script to zero a single runner's social-QR
 * standing so scan flows can be re-tested from a clean slate.
 *
 * For ONE user it deletes/resets:
 *   - SocialPair rows whose pairKey contains the user (BOTH directions — this
 *     also unblocks the counterparties from re-scanning the target today)
 *   - SocialQuota rows (the user's daily scan counters)
 *   - SocialEgg row (once-ever DC-jack egg claim → re-claimable)
 *   - CtfScoreEvent ledger rows for challenges social-scan + jack-egg where
 *     the user is the subject (counterparties' ledger rows are UNTOUCHED —
 *     their points stay honest)
 *   - RunUser.socialScore → 0; RunUser.ctfScore -= the points on the deleted
 *     ledger rows (NEVER zeroed wholesale — real CTF solves are preserved)
 *   - SocialBoard: ADD -1 on the user's current score bucket (score 0 has no
 *     bucket, matching lib/social-rank applyScoreDelta semantics)
 *
 * Raw @aws-sdk client, NOT the ElectroDB entities — identical rationale to
 * reset-ctf-user.mts (ESM-only @auth adapter breaks standalone tsx runs).
 * Rows are found by the `__edb_e__` entity marker and written by their OWN
 * pk/sk read from the scan — no key composition, zero entity-key drift risk.
 *
 * SAFETY: DRY-RUN BY DEFAULT (prints everything, writes nothing); --confirm
 * to apply. Fails loud on missing region, ambiguous email, missing RunUser.
 * Idempotent: a second --confirm run finds nothing to delete and a score
 * already at 0.
 *
 * PROD RUN RECIPE (us-east-1 / shared tables):
 *   cd apps/run.human/webapp
 *   # ⚠️ Do NOT use --env-file=.env for a prod run: the dev .env sets
 *   # RUN_ELECTRO_ID/SECRET/ENDPOINT, silently pointing the electro client at
 *   # LOCAL DynamoDB (reads come back empty; a --confirm would wipe the wrong
 *   # store). Pass the region explicitly and let AWS_PROFILE drive creds:
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 npx tsx scripts/reset-social-user.mts --email whereiskurt@gmail.com
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 npx tsx scripts/reset-social-user.mts --email whereiskurt@gmail.com --confirm
 */
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const CONFIRM = process.argv.includes("--confirm");

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const EMAIL = argValue("--email");
const USER_ARG = argValue("--user");

const ELECTRO_TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const AUTHJS_TABLE = process.env.RUN_DYNAMODB_DBNAME || "run-human-authjs";
const REGION = process.env.RUN_DYNAMODB_REGION;

if (!REGION) {
  console.error("Missing required env var: RUN_DYNAMODB_REGION");
  process.exit(2);
}
if (!EMAIL && !USER_ARG) {
  console.error("Provide --email <addr> (resolved via authjs) or --user <uuid>.");
  process.exit(2);
}

function creds(idVar: string, secretVar: string) {
  const id = process.env[idVar];
  const secret = process.env[secretVar];
  return id && secret
    ? { credentials: { accessKeyId: id, secretAccessKey: secret } }
    : {};
}

const electro = DynamoDBDocument.from(
  new DynamoDB({
    region: REGION,
    ...creds("RUN_ELECTRO_ID", "RUN_ELECTRO_SECRET"),
    ...(process.env.RUN_ELECTRO_ENDPOINT
      ? { endpoint: process.env.RUN_ELECTRO_ENDPOINT }
      : {}),
  }),
  { marshallOptions: { removeUndefinedValues: true } }
);

const authjs = DynamoDBDocument.from(
  new DynamoDB({
    region: REGION,
    ...creds("RUN_DYNAMODB_ID", "RUN_DYNAMODB_SECRET"),
    ...(process.env.RUN_DYNAMODB_ENDPOINT
      ? { endpoint: process.env.RUN_DYNAMODB_ENDPOINT }
      : {}),
  }),
  { marshallOptions: { removeUndefinedValues: true } }
);

type Row = Record<string, any>;

async function scanAll(
  doc: DynamoDBDocument,
  table: string,
  params: Record<string, unknown>
): Promise<Row[]> {
  const items: Row[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await doc.scan({ TableName: table, ExclusiveStartKey, ...params });
    items.push(...((r.Items as Row[]) || []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function resolveUserId(email: string): Promise<string> {
  const rows = await scanAll(authjs, AUTHJS_TABLE, {
    FilterExpression: "email = :e",
    ExpressionAttributeValues: { ":e": email },
  });
  const users = rows.filter((r) => typeof r.id === "string" && r.id.length > 0);
  const ids = Array.from(new Set(users.map((u) => u.id as string)));
  if (ids.length === 0) {
    console.error(`No Auth.js user found for email ${email}.`);
    process.exit(3);
  }
  if (ids.length > 1) {
    console.error(`Ambiguous: ${ids.length} distinct user ids for ${email}: ${ids.join(", ")}`);
    process.exit(3);
  }
  return ids[0];
}

// Mirrors lib/social-rank.ts scoreBucket (PAD=6).
const scoreBucket = (score: number) => `score_${String(score).padStart(6, "0")}`;

async function main() {
  console.log(
    `Electro: ${ELECTRO_TABLE}  Authjs: ${AUTHJS_TABLE}  Region: ${REGION}  ` +
      `Mode: ${CONFIRM ? "WRITE" : "DRY-RUN"}`
  );

  const userId = USER_ARG ?? (await resolveUserId(EMAIL!));
  console.log(`Target user: ${EMAIL ?? "(by --user)"} → ${userId}\n`);

  // --- RunUser row ---------------------------------------------------------
  const runUsers = await scanAll(electro, ELECTRO_TABLE, {
    FilterExpression: "#e = :ru AND userId = :u",
    ExpressionAttributeNames: { "#e": "__edb_e__" },
    ExpressionAttributeValues: { ":ru": "RunUser", ":u": userId },
  });
  if (runUsers.length !== 1) {
    console.error(`Expected exactly 1 RunUser row for ${userId}, found ${runUsers.length}. Aborting.`);
    process.exit(3);
  }
  const ru = runUsers[0];
  const socialScore = ru.socialScore ?? 0;
  console.log(
    `RunUser: displayName=${ru.displayName ?? "(none)"}  ` +
      `socialScore=${socialScore}  ctfScore=${ru.ctfScore ?? 0}`
  );

  // --- SocialPair rows (either direction: pairKey contains the uuid) -------
  const pairs = await scanAll(electro, ELECTRO_TABLE, {
    FilterExpression: "#e = :p AND contains(pairKey, :u)",
    ExpressionAttributeNames: { "#e": "__edb_e__" },
    ExpressionAttributeValues: { ":p": "SocialPair", ":u": userId },
  });
  console.log(`\nSocialPair rows: ${pairs.length}`);
  for (const p of pairs) {
    console.log(`  - day=${p.day}  scanner=${p.scannerId ?? "?"}  owner=${p.ownerId ?? "?"}`);
  }

  // --- SocialQuota rows ----------------------------------------------------
  const quotas = await scanAll(electro, ELECTRO_TABLE, {
    FilterExpression: "#e = :q AND userId = :u",
    ExpressionAttributeNames: { "#e": "__edb_e__" },
    ExpressionAttributeValues: { ":q": "SocialQuota", ":u": userId },
  });
  console.log(`\nSocialQuota rows: ${quotas.length}`);
  for (const q of quotas) console.log(`  - day=${q.day}  count=${q.count ?? 0}`);

  // --- SocialEgg row -------------------------------------------------------
  const eggs = await scanAll(electro, ELECTRO_TABLE, {
    FilterExpression: "#e = :g AND userId = :u",
    ExpressionAttributeNames: { "#e": "__edb_e__" },
    ExpressionAttributeValues: { ":g": "SocialEgg", ":u": userId },
  });
  console.log(`\nSocialEgg rows: ${eggs.length}`);
  for (const g of eggs) console.log(`  - claimedAt=${g.claimedAt}  via=${g.via ?? "?"}`);

  // --- CtfScoreEvent ledger rows (social-scan + jack-egg, this user only) --
  const ledgers = await scanAll(electro, ELECTRO_TABLE, {
    FilterExpression:
      "#e = :l AND #u = :u AND (challenge = :cs OR challenge = :cj)",
    ExpressionAttributeNames: { "#e": "__edb_e__", "#u": "user" },
    ExpressionAttributeValues: {
      ":l": "CtfScoreEvent",
      ":u": userId,
      ":cs": "social-scan",
      ":cj": "jack-egg",
    },
  });
  const ledgerPoints = ledgers.reduce((sum, l) => sum + (l.points ?? 0), 0);
  console.log(`\nCtfScoreEvent rows (social-scan/jack-egg): ${ledgers.length} (${ledgerPoints} ctf pts)`);
  for (const l of ledgers) {
    console.log(`  - ${l.challenge}  bucket=${l.bucket}  points=${l.points ?? "?"}`);
  }

  console.log(
    `\nPlan: delete ${pairs.length} pairs + ${quotas.length} quotas + ` +
      `${eggs.length} eggs + ${ledgers.length} ledger rows; socialScore ` +
      `${socialScore}→0; ctfScore ${ru.ctfScore ?? 0}→${(ru.ctfScore ?? 0) - ledgerPoints}; ` +
      `SocialBoard ${socialScore > 0 ? `${scoreBucket(socialScore)} -1` : "(no bucket at score 0)"}`
  );

  if (!CONFIRM) {
    console.log(`\nDRY-RUN: nothing written. Re-run with --confirm to apply.`);
    return;
  }

  for (const rows of [pairs, quotas, eggs, ledgers]) {
    for (const r of rows) {
      await electro.delete({ TableName: ELECTRO_TABLE, Key: { pk: r.pk, sk: r.sk } });
      console.log(`  deleted ${r.__edb_e__} ${r.sk}`);
    }
  }
  await electro.update({
    TableName: ELECTRO_TABLE,
    Key: { pk: ru.pk, sk: ru.sk },
    UpdateExpression: "SET socialScore = :z, updatedAt = :ua ADD ctfScore :neg",
    ExpressionAttributeValues: { ":z": 0, ":ua": Date.now(), ":neg": -ledgerPoints },
  });
  console.log(`  reset RunUser socialScore=0, ctfScore -= ${ledgerPoints}`);
  if (socialScore > 0) {
    // Find the board row by entity marker + bucket and write via its OWN keys
    // (never hand-compose ElectroDB pk/sk). Missing row → warn; the board is
    // best-effort and counts clamp ≥0 on read, so this can't corrupt ranks.
    // NB: `bucket` is a DynamoDB reserved word — alias it or the scan 400s.
    const boardRows = await scanAll(electro, ELECTRO_TABLE, {
      FilterExpression: "#e = :b AND #bk = :bk",
      ExpressionAttributeNames: { "#e": "__edb_e__", "#bk": "bucket" },
      ExpressionAttributeValues: { ":b": "SocialBoard", ":bk": scoreBucket(socialScore) },
    });
    if (boardRows.length === 1) {
      await electro.update({
        TableName: ELECTRO_TABLE,
        Key: { pk: boardRows[0].pk, sk: boardRows[0].sk },
        UpdateExpression: "ADD #c :neg1",
        ExpressionAttributeNames: { "#c": "count" },
        ExpressionAttributeValues: { ":neg1": -1 },
      });
      console.log(`  SocialBoard ${scoreBucket(socialScore)} -1`);
    } else {
      console.warn(
        `  WARN: expected 1 SocialBoard row for ${scoreBucket(socialScore)}, ` +
          `found ${boardRows.length} — board left untouched (self-clamping).`
      );
    }
  }
  console.log(`\nApplied: ${userId} social state is zeroed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
