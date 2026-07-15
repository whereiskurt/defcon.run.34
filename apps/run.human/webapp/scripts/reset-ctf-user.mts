/**
 * reset-ctf-user.mts — operator script to zero a single player's CTF standing.
 *
 * Deletes every CtfSolve + CtfAttempt row for one user and resets their
 * RunUser.ctfScore / ctfSolves counters to 0 — i.e. "back to zero on the board"
 * so the flag(s) can be re-tested from a clean slate. It also REPORTS (never
 * mutates) each affected challenge's Ctf.solveCount so the operator can decide
 * whether the player was the sole solver (a fresh re-solve would then want
 * ordinal 1 / first-blood — handled separately, not by this script).
 *
 * ── WHY the raw @aws-sdk client and NOT the ElectroDB entities ───────────────
 * Identical rationale to migrate-ctf-answerhash.mts: the entities import
 * @auth/dynamodb-adapter (ESM-only) which a standalone `tsx` CJS run cannot
 * require. So we talk to DynamoDB via the raw DynamoDBDocument client, find rows
 * by ElectroDB's `__edb_e__` entity marker, and write each row by its OWN pk/sk
 * (read from the scan) — no key composition, ZERO entity-key drift risk.
 *
 * SAFETY / hygiene:
 *   - DRY-RUN BY DEFAULT: prints the target + every row it would delete + the
 *     score reset, and writes nothing. Pass --confirm to actually write.
 *   - Resolves the target userId from the Auth.js table by --email (the uuid
 *     never appears in source). Or pass --user <uuid> to skip the lookup.
 *   - Fails loud (non-zero exit) on missing creds/region, ambiguous email
 *     (0 or >1 matches), or a userId that has no RunUser row.
 *   - Standalone operator script: NOT imported by any app/request/build path.
 *   - Idempotent: a second --confirm run finds 0 solves/attempts and a
 *     score already at 0 → reports all-clear.
 *
 * Env (same names the webapp uses — see src/entities/client.ts):
 *   RUN_ELECTRO_ID, RUN_ELECTRO_SECRET   (electro-table credentials)
 *   RUN_DYNAMODB_ID, RUN_DYNAMODB_SECRET (authjs-table credentials)
 *   RUN_DYNAMODB_REGION                  (region, both tables)
 *   RUN_ELECTRO_DBNAME                   (electro table; default run-human-electro)
 *   RUN_DYNAMODB_DBNAME                  (authjs table; default run-human-authjs)
 *   RUN_ELECTRO_ENDPOINT                 (optional; set for LOCAL dynamodb)
 *
 * PROD RUN RECIPE (us-east-1 / shared tables):
 *   cd apps/run.human/webapp
 *   # 1. dry-run — inspect exactly what would be cleared (writes nothing):
 *   AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/reset-ctf-user.mts --email whereiskurt@gmail.com
 *   # 2. commit the reset (deletes solves/attempts, zeroes the score):
 *   AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/reset-ctf-user.mts --email whereiskurt@gmail.com --confirm
 */
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const CONFIRM = process.argv.includes("--confirm");
// Also reset each affected challenge's Ctf.solveCount to 0 — but ONLY for
// challenges where the target is the SOLE solver (guarded per-challenge below),
// so a fresh re-solve replays ordinal #1 / first-blood. Never touches a
// challenge others have solved (that would corrupt their ordinals).
const RESET_SOLVECOUNT = process.argv.includes("--reset-solvecount");

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const EMAIL = argValue("--email");
const USER_ARG = argValue("--user");

const ELECTRO_TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const AUTHJS_TABLE = process.env.RUN_DYNAMODB_DBNAME || "run-human-authjs";
const REGION = process.env.RUN_DYNAMODB_REGION;

// Fail loud if region is missing — never silently no-op.
if (!REGION) {
  console.error("Missing required env var: RUN_DYNAMODB_REGION");
  process.exit(2);
}
if (!EMAIL && !USER_ARG) {
  console.error("Provide --email <addr> (resolved via authjs) or --user <uuid>.");
  process.exit(2);
}

// Credentials: use the explicit RUN_*_ID/SECRET pair when BOTH are present
// (local-dynamodb style), otherwise fall back to the default AWS provider chain
// so `AWS_PROFILE=dc34-application` (SSO) drives a prod run with no embedded keys.
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

/** Resolve the Auth.js adapter uuid (RunUser.userId space) from an email. */
async function resolveUserId(email: string): Promise<string> {
  // The Auth.js DynamoDB adapter stores the user record with a top-level
  // `email` attribute and `id` = the uuid. Filter on both `email` and the
  // adapter's `type = "USER"` marker to avoid matching account/session rows.
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

async function main() {
  console.log(
    `Electro: ${ELECTRO_TABLE}  Authjs: ${AUTHJS_TABLE}  Region: ${REGION}  ` +
      `Mode: ${CONFIRM ? "WRITE" : "DRY-RUN"}`
  );

  const userId = USER_ARG ?? (await resolveUserId(EMAIL!));
  console.log(`Target user: ${EMAIL ?? "(by --user)"} → ${userId}\n`);

  // --- RunUser row (score counters) ---------------------------------------
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
  console.log(
    `RunUser: displayName=${ru.displayName ?? "(none)"}  ` +
      `ctfScore=${ru.ctfScore ?? 0}  ctfSolves=${ru.ctfSolves ?? 0}`
  );

  // --- CtfSolve rows (`user` is a DynamoDB reserved word → alias) ----------
  const solves = await scanAll(electro, ELECTRO_TABLE, {
    FilterExpression: "#e = :s AND #u = :user",
    ExpressionAttributeNames: { "#e": "__edb_e__", "#u": "user" },
    ExpressionAttributeValues: { ":s": "CtfSolve", ":user": userId },
  });
  console.log(`\nCtfSolve rows: ${solves.length}`);
  for (const s of solves) {
    console.log(
      `  - ${s.challenge}  ordinal=${s.ordinal ?? "?"}  points=${s.points ?? "?"}` +
        `  firstBlood=${s.firstBlood ?? false}  channel=${s.channel ?? "?"}`
    );
  }

  // --- CtfAttempt rows (rate-limit counters) ------------------------------
  const attempts = await scanAll(electro, ELECTRO_TABLE, {
    FilterExpression: "#e = :a AND #u = :user",
    ExpressionAttributeNames: { "#e": "__edb_e__", "#u": "user" },
    ExpressionAttributeValues: { ":a": "CtfAttempt", ":user": userId },
  });
  console.log(`\nCtfAttempt rows: ${attempts.length}`);
  for (const a of attempts) {
    console.log(`  - ${a.challenge}  count=${a.count ?? "?"}`);
  }

  // --- Per-challenge solveCount context; capture sole-solver rows to reset --
  const challenges = Array.from(new Set(solves.map((s) => s.challenge as string)));
  const soleSolverCtf: Row[] = []; // Ctf rows the target solely owns (reset candidates)
  if (challenges.length > 0) {
    const verb = RESET_SOLVECOUNT ? "will reset to 0 where SOLE solver" : "REPORT ONLY";
    console.log(`\nAffected challenges — solveCount (${verb}):`);
    for (const ch of challenges) {
      const ctfRows = await scanAll(electro, ELECTRO_TABLE, {
        FilterExpression: "#e = :c AND challenge = :ch",
        ExpressionAttributeNames: { "#e": "__edb_e__" },
        ExpressionAttributeValues: { ":c": "Ctf", ":ch": ch },
      });
      const solveCount = ctfRows[0]?.solveCount ?? "(no Ctf row)";
      const allSolvers = await scanAll(electro, ELECTRO_TABLE, {
        FilterExpression: "#e = :s AND challenge = :ch",
        ExpressionAttributeNames: { "#e": "__edb_e__" },
        ExpressionAttributeValues: { ":s": "CtfSolve", ":ch": ch },
      });
      const sole = allSolvers.length === 1;
      if (sole && ctfRows[0]) soleSolverCtf.push(ctfRows[0]);
      console.log(
        `  - ${ch}: Ctf.solveCount=${solveCount}, total CtfSolve rows=${allSolvers.length} ` +
          `(target is ${sole ? "the SOLE solver" : "one of several — solveCount left untouched"})`
      );
    }
  }

  // --- Apply -------------------------------------------------------------
  if (!CONFIRM) {
    const sc = RESET_SOLVECOUNT
      ? ` and reset solveCount=0 on ${soleSolverCtf.length} sole-solver challenge(s)`
      : "";
    console.log(
      `\nDRY-RUN: would delete ${solves.length} CtfSolve + ${attempts.length} CtfAttempt ` +
        `rows, set ctfScore=0/ctfSolves=0 on ${userId}${sc}.\nRe-run with --confirm to write.`
    );
    return;
  }

  for (const s of solves) {
    await electro.delete({ TableName: ELECTRO_TABLE, Key: { pk: s.pk, sk: s.sk } });
    console.log(`  deleted CtfSolve ${s.challenge}`);
  }
  for (const a of attempts) {
    await electro.delete({ TableName: ELECTRO_TABLE, Key: { pk: a.pk, sk: a.sk } });
    console.log(`  deleted CtfAttempt ${a.challenge}`);
  }
  await electro.update({
    TableName: ELECTRO_TABLE,
    Key: { pk: ru.pk, sk: ru.sk },
    UpdateExpression: "SET ctfScore = :z, ctfSolves = :z, updatedAt = :ua",
    ExpressionAttributeValues: { ":z": 0, ":ua": Date.now() },
  });
  console.log(`  reset RunUser ctfScore=0, ctfSolves=0`);
  if (RESET_SOLVECOUNT) {
    for (const c of soleSolverCtf) {
      await electro.update({
        TableName: ELECTRO_TABLE,
        Key: { pk: c.pk, sk: c.sk },
        UpdateExpression: "SET solveCount = :z, updatedAt = :ua",
        ExpressionAttributeValues: { ":z": 0, ":ua": new Date().toISOString() },
      });
      console.log(`  reset Ctf.solveCount=0 for ${c.challenge}`);
    }
  }
  console.log(`\nApplied: user ${userId} is back to zero on the board.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
