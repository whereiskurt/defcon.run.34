/**
 * seed-ctf.mts (CTFP-04, 57-03) — operator script to seed a curated set of six
 * REAL DC33 CTF starter flags, one per flag type, ALL `enabled:false`. The rows
 * are deletable via the existing admin Delete button (`ctf_delete`); `--remove`
 * is a convenience bulk-delete of the same set.
 *
 * The seeded starters (57-CONTEXT.md D3), built by the PURE `buildSeedRows()`:
 *   goldstein      static reward, chains → goldstein-otp (effect.otp-enroll)
 *   goldstein-otp  rotating TOTP (unlockAfter goldstein, 24h cadence)
 *   mudge          first-blood race (declining curve + firstBloodBonus)
 *   condor         flat award
 *   grace-hopper   timed drop (DEF CON 34 tier ceiling)
 *   turing         easter egg (confetti effect)
 *
 * ── WHY the raw @aws-sdk client and NOT the ElectroDB `Ctf` entity ───────────
 * Identical rationale to reset-ctf-user.mts / migrate-ctf-answerhash.mts: the
 * entity imports @auth/dynamodb-adapter (ESM-only) which a standalone `tsx` CJS
 * run cannot require. So we talk to DynamoDB via the raw DynamoDBDocument client
 * and compose each row's `Ctf` pk/sk + ElectroDB markers by hand. Because a
 * mis-composed key is the primary landmine (57-CONTEXT.md D4), DRY-RUN prints
 * every composed key unconditionally AND best-effort scans one real Ctf row for
 * a side-by-side parity check before you ever pass --confirm.
 *
 * The answer HASHING flows through the SAME `hashAnswer` seam the judge verifies
 * against (via the pure `buildSeedRows()` builder) — parity is by construction,
 * not re-implementation. NO logic is duplicated here.
 *
 * SAFETY / hygiene:
 *   - DRY-RUN BY DEFAULT: composes + prints all six rows and writes nothing.
 *     Pass --confirm to `put` them, or --remove to `delete` them.
 *   - Idempotent by challenge NAME: --confirm rewrites the same six keys, never
 *     duplicates. --remove reverses the seeded set by the same keys.
 *   - Every seeded row is enabled:false — an admin must enable before it scores.
 *   - Standalone operator script: NOT imported by any app/request/build path.
 *   - Fails loud (non-zero exit) if the region env is missing BEFORE any scan.
 *
 * Env (same names the webapp uses — see src/entities/client.ts):
 *   RUN_ELECTRO_ID, RUN_ELECTRO_SECRET   (credentials; optional — SSO fallback)
 *   RUN_DYNAMODB_REGION                  (region — REQUIRED)
 *   RUN_ELECTRO_DBNAME                   (table; default "run-human-electro")
 *   RUN_ELECTRO_ENDPOINT                 (optional; set for LOCAL dynamodb)
 *   CTF_ANSWER_SALT                      (MUST match the judge's/prod salt)
 *
 * ⚠️ PROD RUN RECIPE (us-east-1 / shared run-human-electro table):
 *   cd apps/run.human/webapp
 *   # CTF_ANSWER_SALT MUST be prod's salt — hashes computed under any other salt
 *   # will NEVER verify against player guesses (57-CONTEXT.md D4). Do NOT
 *   # --env-file the localhost .env (it points RUN_ELECTRO_ENDPOINT at
 *   # localhost:8888) — use the default SSO provider chain for a prod run:
 *   # 1. DRY-RUN — confirm each composed pk/sk + __edb_e__/__edb_v__ matches a
 *   #    real Ctf row (the script prints a real row next to a composed sample):
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 CTF_ANSWER_SALT=<prod> \
 *     npx tsx scripts/seed-ctf.mts
 *   # 2. write the six rows (idempotent):
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 CTF_ANSWER_SALT=<prod> \
 *     npx tsx scripts/seed-ctf.mts --confirm
 *   # 3. (optional) remove the seeded set by the same keys:
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 \
 *     npx tsx scripts/seed-ctf.mts --remove
 */
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

// Import the PURE builder by RELATIVE path (same style as
// migrate-ctf-answerhash.mts importing ../src/lib/ctf-migration) so a tsx CJS
// run resolves it without the ESM entity chain. Do NOT import the entities.
import { buildSeedRows, type CtfSeedRow } from "../src/lib/ctf-seed-rows";

const CONFIRM = process.argv.includes("--confirm");
const REMOVE = process.argv.includes("--remove");
const MODE = REMOVE ? "REMOVE" : CONFIRM ? "WRITE" : "DRY-RUN";

const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const REGION = process.env.RUN_DYNAMODB_REGION;
const ENTITY = "Ctf"; // ElectroDB __edb_e__ marker
const VERSION = "1"; // ElectroDB __edb_v__ marker

// Fail loud if region is missing — never silently no-op.
if (!REGION) {
  console.error("Missing required env var: RUN_DYNAMODB_REGION");
  process.exit(2);
}

// Credentials: use the explicit RUN_ELECTRO_ID/SECRET pair when BOTH are present
// (local-dynamodb style), otherwise fall back to the default AWS provider chain
// so `AWS_PROFILE=dc34-application` (SSO) drives a prod run with no embedded keys.
function creds(idVar: string, secretVar: string) {
  const id = process.env[idVar];
  const secret = process.env[secretVar];
  return id && secret
    ? { credentials: { accessKeyId: id, secretAccessKey: secret } }
    : {};
}

const doc = DynamoDBDocument.from(
  new DynamoDB({
    region: REGION,
    ...creds("RUN_ELECTRO_ID", "RUN_ELECTRO_SECRET"),
    ...(process.env.RUN_ELECTRO_ENDPOINT
      ? { endpoint: process.env.RUN_ELECTRO_ENDPOINT }
      : {}),
  }),
  { marshallOptions: { removeUndefinedValues: true } }
);

type Row = Record<string, any>;

/**
 * Compose the raw DynamoDB item for a seed row, matching the `Ctf` entity index
 * (pk composite [challenge], sk composite [], entity "Ctf" version "1" service
 * "run"). ElectroDB lowercases key composites, and every starter name is already
 * lowercase. The composed key + markers are the D4 landmine — confirm them
 * against a real row (printed below) before --confirm.
 */
function composeItem(row: CtfSeedRow): Row {
  const now = new Date().toISOString();
  const pk = `$run#challenge_${row.challenge.toLowerCase()}`;
  const sk = `$ctf_${VERSION}`;
  return {
    // raw key + ElectroDB entity markers
    pk,
    sk,
    __edb_e__: ENTITY,
    __edb_v__: VERSION,
    // entity defaults not carried by the pure builder
    solveCount: 0,
    createdAt: now,
    updatedAt: now,
    // builder attributes (answerHash/otp/effect/enabled:false/...)
    ...row,
  };
}

function keyOf(row: CtfSeedRow): { pk: string; sk: string } {
  return { pk: `$run#challenge_${row.challenge.toLowerCase()}`, sk: `$ctf_${VERSION}` };
}

/** Best-effort: fetch ONE existing Ctf row for a pk/sk parity check. Never
 *  throws and never hangs the DRY-RUN — bounded by a short timeout so an
 *  offline / no-creds run still prints the composed rows and exits. */
async function fetchOneCtfRow(): Promise<Row | null> {
  const scan = doc.scan({
    TableName: TABLE,
    FilterExpression: "#e = :e",
    ExpressionAttributeNames: { "#e": "__edb_e__" },
    ExpressionAttributeValues: { ":e": ENTITY },
    Limit: 1,
  });
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));
  try {
    const r = (await Promise.race([scan, timeout])) as { Items?: Row[] } | null;
    return r?.Items?.[0] ?? null;
  } catch {
    return null;
  }
}

async function main() {
  console.log(
    `Table: ${TABLE}  Region: ${REGION}  Endpoint: ${
      process.env.RUN_ELECTRO_ENDPOINT || "(aws)"
    }  Mode: ${MODE}`
  );

  const rows = buildSeedRows();
  const items = rows.map(composeItem);

  // 1) UNCONDITIONALLY compose + print every row first — this is the D4
  //    key-parity artifact and must work fully offline.
  console.log(`\nComposed ${items.length} Ctf seed rows (all enabled:false):`);
  for (const it of items) {
    console.log(
      `  - ${it.challenge}: pk=${it.pk}  sk=${it.sk}  ` +
        `__edb_e__=${it.__edb_e__}  __edb_v__=${it.__edb_v__}`
    );
    console.log(`      attrs: ${JSON.stringify(it)}`);
  }

  // 2) DRY-RUN parity: best-effort fetch a real Ctf row to eyeball key shape.
  //    On any error / unreachable table, print a note — NEVER abort DRY-RUN.
  if (!CONFIRM && !REMOVE) {
    const real = await fetchOneCtfRow();
    if (real) {
      console.log(
        `\nParity — a REAL Ctf row for key-shape comparison:\n` +
          `  real:     pk=${real.pk}  sk=${real.sk}  __edb_e__=${real.__edb_e__}  __edb_v__=${real.__edb_v__}\n` +
          `  composed: pk=${items[0].pk}  sk=${items[0].sk}  __edb_e__=${items[0].__edb_e__}  __edb_v__=${items[0].__edb_v__}`
      );
    } else {
      console.log(
        `\nParity: no existing Ctf row reachable (offline / empty / no creds). ` +
          `Confirm the composed pk/sk shape against a real row before --confirm (D4).`
      );
    }
    console.log(`\nDRY-RUN: composed ${items.length} rows, wrote nothing. ` +
      `Re-run with --confirm to write, or --remove to delete the seeded set.`);
    return;
  }

  // 3) REMOVE: delete the six by composed key.
  if (REMOVE) {
    for (const row of rows) {
      const Key = keyOf(row);
      await doc.delete({ TableName: TABLE, Key });
      console.log(`  deleted ${row.challenge} (pk=${Key.pk})`);
    }
    console.log(`\nRemoved ${rows.length} seeded Ctf rows.`);
    return;
  }

  // 4) WRITE: put each composed row (idempotent — same key overwrites).
  for (const it of items) {
    await doc.put({ TableName: TABLE, Item: it });
    console.log(`  put ${it.challenge} (pk=${it.pk})`);
  }
  console.log(`\nSeeded ${items.length} Ctf starter rows (all enabled:false).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
