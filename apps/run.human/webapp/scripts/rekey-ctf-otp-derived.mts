/**
 * rekey-ctf-otp-derived.mts (Phase 67, updated for the seed SPLIT) — point the
 * five DC33 CTF OTP CHAINS at the server-derived CHAIN seeds.
 *
 * WHY (split): the CTF reward enrollment must NOT disclose the ghost's DM
 * unlock seed (a gifted claim-link would hand out bot access). So the chains
 * use a SECOND derivation (`meshtk-chain-seed:` HKDF label, deriveChainOtpauthUrl)
 * distinct from the bot's unlock seed (`meshtk-otp-seed:`). This script
 * rewrites, per persona:
 *   - static row `<name>`      : effect.otpauth  → CHAIN otpauth (secret swapped)
 *   - chained  `<name>-otp`    : otp.secret      → CHAIN base32 secret
 * so the reward QR and the -otp judge agree on a seed the BOT NEVER ACCEPTS.
 * The bot's unlock seed stays only on the /admin/ghosts QR sheets + in meshtk.
 *
 * NO reimplementation: committed values come from the pure `buildSeedRows()`;
 * the derivation is the tested `deriveChainOtpauthUrl()` (Node-only — the Go
 * fleet neither derives nor validates chain seeds). Only `effect.otpauth` and
 * `otp.secret` change — answerHash / scoring / unlockAfter / solveCount /
 * createdAt / enabled are all read from the LIVE row and preserved. No salt is
 * touched (no answer hashing here).
 *
 * Raw DynamoDBDocument (not the ElectroDB entity) for the same reason as
 * seed-ctf.mts: a tsx CJS run can't require the ESM entity chain. Keys match the
 * Ctf entity (pk=`$run#challenge_<name>`, sk=`$ctf_1`, __edb_e__=Ctf __edb_v__=1).
 *
 * SAFETY: DRY-RUN by default — prints every planned old→new change and writes
 * nothing. Pass --confirm to write. A persona/row that is ABSENT in prod is
 * skipped with a warning (never inserted — this only re-keys existing rows).
 *
 * Env:
 *   MESHTK_GHOST_KEY_SECRET   (REQUIRED — same SSM value the fleet uses)
 *   RUN_DYNAMODB_REGION       (REQUIRED — us-east-1 for prod)
 *   RUN_ELECTRO_DBNAME        (table; default "run-human-electro")
 *   RUN_ELECTRO_ENDPOINT      (optional; set for LOCAL dynamodb)
 *   RUN_ELECTRO_ID / _SECRET  (optional; else default AWS provider chain / SSO)
 *
 * ⚠️ PROD RECIPE (us-east-1):
 *   cd apps/run.human/webapp
 *   SECRET=$(AWS_PROFILE=dc34-application aws ssm get-parameter --with-decryption \
 *     --name /dc34/secrets/use1/mqtt/ghost-key-secret --region us-east-1 \
 *     --query Parameter.Value --output text)
 *   # 1) DRY-RUN — review every old→new:
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 \
 *     MESHTK_GHOST_KEY_SECRET="$SECRET" npx tsx scripts/rekey-ctf-otp-derived.mts
 *   # 2) WRITE:
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 \
 *     MESHTK_GHOST_KEY_SECRET="$SECRET" npx tsx scripts/rekey-ctf-otp-derived.mts --confirm
 */
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

import { buildSeedRows } from "../src/lib/ctf-seed-rows";
import {
  deriveChainOtpauthUrl,
  deriveOtpauthUrl,
  deriveFlagCode,
} from "../src/lib/mesh-otp-derive";
import { loadMeshGhosts } from "../src/lib/mesh-ghosts";
import { hashAnswer } from "../src/lib/ctf-hash";

const CONFIRM = process.argv.includes("--confirm");
// --enable: flip enabled=true on all 10 chain rows (5 static + 5 otp). Independent
// of the re-key path — does NOT need the server secret (no derivation). Makes the
// chains score; DRY-RUN by default like everything else.
const ENABLE = process.argv.includes("--enable");
// --flags: sync CTF static-flag answer hashes to the DERIVED covert flag codes
// (meshtk#11). Matches by answer-hash across the whole table, so it catches every
// row using any ghost's committed flag code regardless of challenge name.
const FLAGS = process.argv.includes("--flags");
const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const REGION = process.env.RUN_DYNAMODB_REGION;
const SERVER_SECRET = process.env.MESHTK_GHOST_KEY_SECRET;
const VERSION = "1";
const NOW = new Date().toISOString();

/**
 * CTF persona name → meshtk fleet Id. VERIFIED against meshtk.dc34.yaml: each
 * persona's committed secret equals that ghost's OtpUrl secret, and the fleet Id
 * is the HKDF domain-separation key the bot derives with — they MUST agree or
 * the derived secret won't match the bot.
 */
const PERSONA_FLEET: Record<string, string> = {
  goldstein: "ghost.goldstein",
  mudge: "ghost.mudge",
  condor: "ghost.condor",
  "grace-hopper": "ghost.hopper",
  turing: "ghost.turing",
};

if (!REGION) {
  console.error("Missing required env var: RUN_DYNAMODB_REGION");
  process.exit(2);
}
// The server secret is only needed for the re-key (derivation) path, not --enable.
if (!ENABLE && !SERVER_SECRET) {
  console.error("Missing required env var: MESHTK_GHOST_KEY_SECRET");
  process.exit(2);
}

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
  { marshallOptions: { removeUndefinedValues: true } },
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function keyOf(challenge: string): { pk: string; sk: string } {
  return { pk: `$run#challenge_${challenge.toLowerCase()}`, sk: `$ctf_${VERSION}` };
}

async function getRow(challenge: string): Promise<Row | null> {
  try {
    const r = await doc.get({ TableName: TABLE, Key: keyOf(challenge) });
    return (r?.Item as Row) ?? null;
  } catch {
    return null;
  }
}

/**
 * Compute the CHAIN-derived {otpauth, secret} for one persona from its
 * committed enroll URL — what the CTF rows get. Also returns the bot's UNLOCK
 * secret so the log can prove the two differ (the whole point of the split).
 */
function derivedFor(name: string, committedOtpauth: string) {
  const fleetId = PERSONA_FLEET[name];
  if (!fleetId) throw new Error(`no fleet mapping for persona ${name}`);
  const chain = deriveChainOtpauthUrl(SERVER_SECRET!, fleetId, committedOtpauth);
  const unlockSecret = deriveOtpauthUrl(SERVER_SECRET!, fleetId, committedOtpauth).secret;
  if (chain.secret === unlockSecret) {
    throw new Error(`chain seed equals unlock seed for ${name} — derivation labels collided`);
  }
  return { ...chain, unlockSecret };
}

/** The 10 chain rows: each persona's static flag + its chained `-otp` flag. */
function chainRowNames(): string[] {
  return Object.keys(PERSONA_FLEET).flatMap((name) => [name, `${name}-otp`]);
}

/** Full-table Ctf scan (raw rows). */
async function scanCtf(): Promise<Row[]> {
  const rows: Row[] = [];
  let ExclusiveStartKey: Row | undefined;
  do {
    const r: { Items?: Row[]; LastEvaluatedKey?: Row } = await doc.scan({
      TableName: TABLE,
      FilterExpression: "#e = :e",
      ExpressionAttributeNames: { "#e": "__edb_e__" },
      ExpressionAttributeValues: { ":e": "Ctf" },
      ExclusiveStartKey,
    });
    rows.push(...(r.Items ?? []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return rows;
}

/**
 * --flags: for every ghost with a committed flag code, compute committed→derived
 * (DEFAULT_SALT, matching the prod judge). Then scan the Ctf table and update ANY
 * static row whose stored answerHash equals a committed code's hash, setting it to
 * the derived code's hash. Hash-matching (not name-matching) catches every row
 * that uses a ghost flag code regardless of its challenge name.
 */
async function syncFlagCodes() {
  // committedHash → { fleetId, committed, derived, derivedHash }
  const byHash = new Map<
    string,
    { fleetId: string; committed: string; derived: string; derivedHash: string }
  >();
  for (const g of loadMeshGhosts()) {
    if (!g.flagCode) continue;
    const derived = deriveFlagCode(SERVER_SECRET!, g.id, g.flagCode);
    byHash.set(hashAnswer(g.flagCode), {
      fleetId: g.id,
      committed: g.flagCode,
      derived,
      derivedHash: hashAnswer(derived),
    });
    console.log(`● ${g.id}  flag "${g.flagCode}" → derived "${derived}"`);
  }

  const rows = await scanCtf();
  let planned = 0;
  for (const row of rows) {
    const hit = typeof row.answerHash === "string" ? byHash.get(row.answerHash) : undefined;
    if (!hit) continue;
    console.log(
      `   ${row.challenge}: answerHash matches ${hit.fleetId} committed "${hit.committed}" → derived "${hit.derived}"`,
    );
    planned++;
    if (CONFIRM) {
      await doc.update({
        TableName: TABLE,
        Key: keyOf(row.challenge),
        UpdateExpression: "SET #a = :a, #u = :u",
        ExpressionAttributeNames: { "#a": "answerHash", "#u": "updatedAt" },
        ExpressionAttributeValues: { ":a": hit.derivedHash, ":u": NOW },
      });
      console.log(`      ✓ answerHash updated`);
    }
  }
  console.log(
    CONFIRM
      ? `\nFlag-code sync: updated ${planned} row(s) to derived answer hashes.`
      : `\nDRY-RUN: ${planned} row(s) would update to derived answer hashes, wrote nothing. Re-run with --flags --confirm.`,
  );
}

/** --enable: set enabled=true on all 10 chain rows (preserving everything else). */
async function enableChains() {
  let planned = 0;
  let skipped = 0;
  for (const name of chainRowNames()) {
    const live = await getRow(name);
    if (!live) {
      console.log(`   ⚠️  "${name}" ABSENT in prod — skipped`);
      skipped++;
      continue;
    }
    const already = live.enabled === true;
    console.log(`● ${name}  enabled ${live.enabled} → true${already ? "  (already on)" : ""}  solveCount=${live.solveCount}`);
    if (already) continue;
    planned++;
    if (CONFIRM) {
      await doc.update({
        TableName: TABLE,
        Key: keyOf(name),
        UpdateExpression: "SET #en = :t, #u = :u",
        ExpressionAttributeNames: { "#en": "enabled", "#u": "updatedAt" },
        ExpressionAttributeValues: { ":t": true, ":u": NOW },
      });
      console.log(`   ✓ enabled`);
    }
  }
  console.log(
    CONFIRM
      ? `\nEnabled ${planned} row(s)${skipped ? `; ${skipped} absent skipped` : ""} (already-on rows untouched).`
      : `\nDRY-RUN: would enable ${planned} row(s)${skipped ? `, ${skipped} absent skipped` : ""}, wrote nothing. Re-run with --enable --confirm to write.`,
  );
}

async function main() {
  console.log(
    `Table: ${TABLE}  Region: ${REGION}  Endpoint: ${process.env.RUN_ELECTRO_ENDPOINT || "(aws)"}  Mode: ${ENABLE ? "ENABLE" : FLAGS ? "FLAGS" : "REKEY"}/${CONFIRM ? "WRITE" : "DRY-RUN"}\n`,
  );

  if (ENABLE) {
    await enableChains();
    return;
  }

  if (FLAGS) {
    await syncFlagCodes();
    return;
  }

  // Static rows from the pure builder carry the COMMITTED effect.otpauth per persona.
  const staticRows = buildSeedRows().filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r: any) => r.effect?.kind === "otp-enroll" && typeof r.effect?.otpauth === "string",
  );

  let planned = 0;
  let skipped = 0;

  for (const seed of staticRows) {
    const name = seed.challenge;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const committedOtpauth = (seed as any).effect.otpauth as string;
    const { otpauth: derivedOtpauth, secret: derivedSecret, committedSecret, unlockSecret } =
      derivedFor(name, committedOtpauth);
    const fleetId = PERSONA_FLEET[name];

    console.log(`● ${name}  (${fleetId})  committed ${committedSecret} → CHAIN ${derivedSecret}  (unlock ${unlockSecret} stays bot/sheets-only)`);

    // 1) static row: effect.otpauth → derived
    const staticLive = await getRow(name);
    if (!staticLive) {
      console.log(`   ⚠️  static row "${name}" ABSENT in prod — skipped (not inserting)`);
      skipped++;
    } else {
      const before = staticLive.effect?.otpauth as string | undefined;
      const nextEffect = { ...(staticLive.effect ?? {}), otpauth: derivedOtpauth };
      console.log(`   static "${name}".effect.otpauth`);
      console.log(`      old: ${before ?? "(none)"}`);
      console.log(`      new: ${derivedOtpauth}`);
      console.log(`      preserve: enabled=${staticLive.enabled} solveCount=${staticLive.solveCount} nextFlag=${staticLive.effect?.nextFlag}`);
      planned++;
      if (CONFIRM) {
        await doc.update({
          TableName: TABLE,
          Key: keyOf(name),
          UpdateExpression: "SET #effect = :effect, #u = :u",
          ExpressionAttributeNames: { "#effect": "effect", "#u": "updatedAt" },
          ExpressionAttributeValues: { ":effect": nextEffect, ":u": NOW },
        });
        console.log(`      ✓ written`);
      }
    }

    // 2) chained otp row: otp.secret → derived
    const otpName = `${name}-otp`;
    const otpLive = await getRow(otpName);
    if (!otpLive) {
      console.log(`   ⚠️  otp row "${otpName}" ABSENT in prod — skipped (not inserting)`);
      skipped++;
    } else {
      const before = otpLive.otp?.secret as string | undefined;
      // period comes from the derived otpauth (sourced from the committed OtpUrl,
      // now period=30) so the judge validates at the same window the bot does.
      const derivedPeriod = Number(new URL(derivedOtpauth).searchParams.get("period")) || undefined;
      const nextOtp = { ...(otpLive.otp ?? {}), secret: derivedSecret, ...(derivedPeriod ? { period: derivedPeriod } : {}) };
      console.log(`   otp "${otpName}".otp.secret`);
      console.log(`      secret old: ${before ?? "(none)"}  →  new: ${derivedSecret}`);
      console.log(`      period old: ${otpLive.otp?.period ?? "(none)"}  →  new: ${derivedPeriod ?? "(unchanged)"}`);
      console.log(`      preserve: enabled=${otpLive.enabled} solveCount=${otpLive.solveCount} unlockAfter=${otpLive.unlockAfter} digits=${otpLive.otp?.digits} period=${otpLive.otp?.period} algo=${otpLive.otp?.algorithm} skew=${otpLive.otp?.skew}`);
      planned++;
      if (CONFIRM) {
        await doc.update({
          TableName: TABLE,
          Key: keyOf(otpName),
          UpdateExpression: "SET #otp = :otp, #u = :u",
          ExpressionAttributeNames: { "#otp": "otp", "#u": "updatedAt" },
          ExpressionAttributeValues: { ":otp": nextOtp, ":u": NOW },
        });
        console.log(`      ✓ written`);
      }
    }
    console.log("");
  }

  if (CONFIRM) {
    console.log(`Done. Re-keyed ${planned} rows to derived seeds${skipped ? `; ${skipped} absent row(s) skipped` : ""}.`);
  } else {
    console.log(`DRY-RUN: ${planned} row change(s) planned${skipped ? `, ${skipped} absent row(s) would be skipped` : ""}, wrote nothing. Re-run with --confirm to write.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
