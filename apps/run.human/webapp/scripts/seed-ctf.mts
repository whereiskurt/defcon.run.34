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
 *     Pass --confirm to `put` them, or --remove to preview a delete (add
 *     --confirm to actually delete — WR-02).
 *   - Idempotent by challenge NAME, live-data-preserving (WR-01): --confirm
 *     rewrites the same six keys and never duplicates, BUT a re-run over an
 *     already-existing row PRESERVES that row's live `solveCount`, `createdAt`,
 *     and `enabled` — it only refreshes the DEFINITION (answerHash, scoring
 *     knobs, effect, otp, …). This is deliberate: the atomic ordinal allocator
 *     (`ADD solveCount 1`) and any admin enable/first-blood history on a live
 *     row must survive a definition re-seed. A brand-new row inserts with
 *     solveCount:0, a fresh createdAt, and enabled:false.
 *   - Every seeded row starts enabled:false — an admin must enable before it
 *     scores (and a subsequent re-seed will NOT flip it back off — WR-01).
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
 *   # 3. (optional) preview a removal of the seeded set (DRY-RUN — WR-02):
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 \
 *     npx tsx scripts/seed-ctf.mts --remove
 *   #    then actually delete the same keys:
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 \
 *     npx tsx scripts/seed-ctf.mts --remove --confirm
 */
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

// Import the PURE builder by RELATIVE path (same style as
// migrate-ctf-answerhash.mts importing ../src/lib/ctf-migration) so a tsx CJS
// run resolves it without the ESM entity chain. Do NOT import the entities.
import { buildSeedRows, type CtfSeedRow } from "../src/lib/ctf-seed-rows";

const CONFIRM = process.argv.includes("--confirm");
const REMOVE = process.argv.includes("--remove");
// WR-02: --remove honors the same DRY-RUN-by-default contract as the writer —
// it only deletes when --confirm is ALSO passed; otherwise it previews.
const MODE = REMOVE ? (CONFIRM ? "REMOVE" : "REMOVE (DRY-RUN)") : CONFIRM ? "WRITE" : "DRY-RUN";

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
  // IN-02: capture the timer id so we can clear it when the scan wins — an
  // un-cleared setTimeout keeps the Node event loop alive and delays an
  // offline DRY-RUN exit by up to ~5s.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), 5000);
  });
  try {
    const r = (await Promise.race([scan, timeout])) as { Items?: Row[] } | null;
    return r?.Items?.[0] ?? null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Fetch the existing item at a composed key, or null if absent / unreachable.
 *  Used by the WRITE path to preserve live counters on re-seed (WR-01). */
async function getExistingRow(Key: { pk: string; sk: string }): Promise<Row | null> {
  try {
    const r = await doc.get({ TableName: TABLE, Key });
    return (r?.Item as Row) ?? null;
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
      `Re-run with --confirm to write, or --remove to preview a delete ` +
      `(--remove --confirm to delete).`);
    return;
  }

  // 3) REMOVE: delete the six by composed key — but DRY-RUN by default (WR-02).
  //    Without --confirm this only PREVIEWS the exact seeded names it would
  //    delete; pass --remove --confirm to actually delete. Only the six seeded
  //    challenge keys are ever targeted.
  if (REMOVE) {
    for (const row of rows) {
      const Key = keyOf(row);
      if (CONFIRM) {
        await doc.delete({ TableName: TABLE, Key });
        console.log(`  deleted ${row.challenge} (pk=${Key.pk})`);
      } else {
        console.log(`  would delete ${row.challenge} (pk=${Key.pk})`);
      }
    }
    console.log(
      CONFIRM
        ? `\nRemoved ${rows.length} seeded Ctf rows.`
        : `\nDRY-RUN: would remove ${rows.length} seeded Ctf rows, deleted nothing. ` +
            `Re-run with --remove --confirm to delete.`
    );
    return;
  }

  // 4) WRITE: put each composed row. Idempotent by key AND live-data-preserving
  //    (WR-01): if a row already exists, keep its `solveCount`, `createdAt`, and
  //    `enabled` so a definition re-seed never resets the ordinal allocator or
  //    flips off a starter an admin has enabled. Only the definition attributes
  //    are refreshed.
  for (const it of items) {
    const existing = await getExistingRow({ pk: it.pk, sk: it.sk });
    const Item: Row = { ...it };
    if (existing) {
      Item.solveCount = existing.solveCount ?? it.solveCount;
      Item.createdAt = existing.createdAt ?? it.createdAt;
      // Preserve a live enable flip — never clobber it back to false.
      if (existing.enabled !== undefined) Item.enabled = existing.enabled;
    }
    await doc.put({ TableName: TABLE, Item });
    console.log(
      existing
        ? `  updated ${it.challenge} (pk=${it.pk}) — preserved solveCount=${Item.solveCount}, enabled=${Item.enabled}`
        : `  inserted ${it.challenge} (pk=${it.pk}) — new row, enabled:false`
    );
  }
  console.log(`\nSeeded ${items.length} Ctf starter rows (new rows enabled:false; existing counters preserved).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
