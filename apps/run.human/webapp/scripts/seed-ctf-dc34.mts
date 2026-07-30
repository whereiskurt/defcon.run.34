/**
 * seed-ctf-dc34.mts — operator script for the DC34 value retune, per the
 * approved spec (docs/superpowers/specs/2026-07-30-points-consistency-design.md).
 * Rows are built by the PURE `buildDc34SeedRows()`
 * (src/lib/ctf-seed-rows-dc34.ts), and come in two shapes:
 *
 *   knobsOnly rows   — retune ONLY the scoring knobs (pointMax/pointFloor/
 *                       maxSolves/firstBloodBonus/floorAfterMax/
 *                       perPlayerIntervalHours) on an EXISTING Ctf row. If no
 *                       row with that challenge name exists yet, the row is
 *                       SKIPPED (warn) — this script never fabricates a
 *                       challenge definition; answer/effect/otp/enabled on
 *                       the existing row are left untouched.
 *   full insert rows — grant-only bot unlocks, jack-egg, exceptional-run.
 *                       These don't exist yet; inserted whole with an
 *                       unguessable `answerHash: ZERO_HASH` — claimable ONLY
 *                       via `grant: true` paths, never a player guess. Same
 *                       WR-01 semantics as seed-ctf.mts: a re-run over an
 *                       already-existing row preserves its live
 *                       `solveCount`/`createdAt`/`enabled`.
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
 * NO CTF_ANSWER_SALT is needed for this seed: knobsOnly rows never touch
 * answer fields, and the grant-only inserts hardcode ZERO_HASH rather than
 * hashing anything — there is no salted preimage to compute.
 *
 * SAFETY / hygiene:
 *   - DRY-RUN BY DEFAULT: composes + prints every row and writes nothing.
 *     Pass --confirm to `put` them, or --remove to preview a delete (add
 *     --confirm to actually delete — WR-02). --remove ONLY ever targets the
 *     grant-only full-insert rows this script itself creates (jack-egg,
 *     exceptional-run, unlock-*) — the 20 knobsOnly rows are pre-existing,
 *     hand-authored live challenge definitions (answer hashes, OTP secrets,
 *     effects, unlock chains) and are NEVER deletable by this script.
 *   - knobsOnly rows: SKIPPED (with a warning) if no matching existing row is
 *     found — never inserted, never fabricated.
 *   - Full-insert rows are idempotent by challenge NAME, live-data-preserving
 *     (WR-01): --confirm rewrites the same keys and never duplicates, BUT a
 *     re-run over an already-existing row PRESERVES that row's live
 *     `solveCount`, `createdAt`, and `enabled` — it only refreshes the
 *     DEFINITION (answerHash, scoring knobs, effect, otp, …). This is
 *     deliberate: the atomic ordinal allocator (`ADD solveCount 1`) and any
 *     admin enable/first-blood history on a live row must survive a
 *     definition re-seed. A brand-new row inserts with solveCount:0, a fresh
 *     createdAt, and enabled:true (grant-only rows are deliberately live on
 *     insert — see the value table in the design spec).
 *   - Standalone operator script: NOT imported by any app/request/build path.
 *   - Fails loud (non-zero exit) if the region env is missing BEFORE any scan.
 *
 * Env (same names the webapp uses — see src/entities/client.ts):
 *   RUN_ELECTRO_ID, RUN_ELECTRO_SECRET   (credentials; optional — SSO fallback)
 *   RUN_DYNAMODB_REGION                  (region — REQUIRED)
 *   RUN_ELECTRO_DBNAME                   (table; default "run-human-electro")
 *   RUN_ELECTRO_ENDPOINT                 (optional; set for LOCAL dynamodb)
 *   (NO CTF_ANSWER_SALT needed — see above)
 *
 * ⚠️ PROD RUN RECIPE (us-east-1 / shared run-human-electro table):
 *   cd apps/run.human/webapp
 *   # Use the default SSO provider chain for a prod run — do NOT --env-file
 *   # the localhost .env (it points RUN_ELECTRO_ENDPOINT at localhost:8888).
 *   # 1. DRY-RUN — confirm each composed pk/sk + __edb_e__/__edb_v__ matches a
 *   #    real Ctf row (the script prints a real row next to a composed sample),
 *   #    and review the knobsOnly SKIP warnings (e.g. `ricky` if not yet
 *   #    created under that slug):
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 \
 *     npx tsx scripts/seed-ctf-dc34.mts
 *   # 2. write the rows (idempotent):
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 \
 *     npx tsx scripts/seed-ctf-dc34.mts --confirm
 *   # 3. (optional) preview removing ONLY the 7 grant-only rows this script
 *   #    inserted (jack-egg, exceptional-run, unlock-*) — the 20 knobsOnly
 *   #    rows are NEVER touched by --remove (DRY-RUN — WR-02):
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 \
 *     npx tsx scripts/seed-ctf-dc34.mts --remove
 *   #    then actually delete those same 7 keys:
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 \
 *     npx tsx scripts/seed-ctf-dc34.mts --remove --confirm
 */
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

// Import the PURE builder by RELATIVE path (same style as seed-ctf.mts
// importing ../src/lib/ctf-seed-rows) so a tsx CJS run resolves it without
// the ESM entity chain. Do NOT import the entities.
import { buildDc34SeedRows, type Dc34SeedRow } from "../src/lib/ctf-seed-rows-dc34";

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
function composeItem(row: Dc34SeedRow): Row {
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

function keyOf(row: Dc34SeedRow): { pk: string; sk: string } {
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

  const rows = buildDc34SeedRows();
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

  // 3) REMOVE: delete ONLY the 7 grant-only full-insert rows this script
  //    itself creates (jack-egg, exceptional-run, unlock-*) — DRY-RUN by
  //    default (WR-02). knobsOnly rows are pre-existing, hand-authored live
  //    challenge definitions (answer hashes, OTP secrets, effects, unlock
  //    chains) and are NEVER eligible for removal by this script, confirm or
  //    not. Without --confirm this only PREVIEWS the exact grant-only names
  //    it would delete; pass --remove --confirm to actually delete.
  if (REMOVE) {
    const removable = rows.filter((row) => !row.knobsOnly);
    for (const row of removable) {
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
        ? `\nRemoved ${removable.length} grant-only Ctf rows (knobsOnly rows untouched).`
        : `\nDRY-RUN: would remove ${removable.length} grant-only Ctf rows, deleted nothing ` +
            `(knobsOnly rows are never removable). Re-run with --remove --confirm to delete.`
    );
    return;
  }

  // 4) WRITE: two paths per row.
  //    knobsOnly  — retune ONLY the scoring knobs on an EXISTING row; SKIPPED
  //                 (with a warning) if no matching row is found. Never
  //                 touches answer/effect/otp/enabled on the existing row.
  //    full insert — identical WR-01 semantics to seed-ctf.mts: if the row
  //                 already exists, preserve its live `solveCount`,
  //                 `createdAt`, and `enabled`; only the definition is
  //                 refreshed. A brand-new row inserts as composed
  //                 (enabled:true — grant-only rows are deliberately live).
  const KNOB_FIELDS = [
    "pointMax", "pointFloor", "maxSolves", "firstBloodBonus",
    "floorAfterMax", "perPlayerIntervalHours",
  ] as const;

  for (const row of rows) {
    const Key = keyOf(row);
    const existing = await getExistingRow(Key);
    if (row.knobsOnly) {
      if (!existing) {
        console.warn(`  SKIPPED ${row.challenge} — knobsOnly but no existing row (create it via the admin UI first)`);
        continue;
      }
      const Item: Row = { ...existing };
      for (const k of KNOB_FIELDS) {
        if ((row as Row)[k] !== undefined) Item[k] = (row as Row)[k];
        else delete Item[k];
      }
      Item.updatedAt = new Date().toISOString();
      await doc.put({ TableName: TABLE, Item });
      console.log(`  retuned ${row.challenge} — knobs only, definition preserved`);
      continue;
    }
    // full insert path: identical WR-01 semantics to seed-ctf.mts
    const { knobsOnly, ...attrs } = row;
    const it = composeItem(attrs);
    const Item: Row = { ...it };
    if (existing) {
      Item.solveCount = existing.solveCount ?? it.solveCount;
      Item.createdAt = existing.createdAt ?? it.createdAt;
      if (existing.enabled !== undefined) Item.enabled = existing.enabled;
    }
    await doc.put({ TableName: TABLE, Item });
    console.log(existing ? `  updated ${it.challenge}` : `  inserted ${it.challenge} (enabled:${Item.enabled})`);
  }
  console.log(`\nSeeded ${rows.length} DC34 Ctf rows (knobsOnly rows retuned in place; grant-only rows inserted/updated).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
