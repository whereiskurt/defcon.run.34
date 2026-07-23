/**
 * rekey-ctf-otp-derived.mts (Phase 67) — re-point the five DC33 CTF OTP CHAINS
 * at the SERVER-DERIVED ghost seeds so they match what the redeployed meshtk
 * fleet now validates (whereiskurt/meshtk#10).
 *
 * WHY: the committed OtpUrl secrets in meshtk.dc34.yaml became decoys once the
 * fleet runs derivation. The DC33 CTF chains (ctf-seed-rows.ts) were seeded with
 * those committed secrets, so a player who enrolls the CTF reward QR now gets
 * codes the bot rejects. This script rewrites, per persona:
 *   - static row `<name>`      : effect.otpauth  → DERIVED otpauth (secret swapped)
 *   - chained  `<name>-otp`    : otp.secret      → DERIVED base32 secret
 * so both the bot AND run.human's judge accept the same enrolled codes.
 *
 * NO reimplementation: committed values come from the pure `buildSeedRows()`;
 * the derivation is the SAME tested `deriveOtpauthUrl()` the /admin/ghosts page
 * and (bit-for-bit, shared vectors) the Go fleet use. Only `effect.otpauth` and
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
import { deriveOtpauthUrl } from "../src/lib/mesh-otp-derive";

const CONFIRM = process.argv.includes("--confirm");
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
if (!SERVER_SECRET) {
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

/** Compute the derived {otpauth, secret} for one persona from its committed enroll URL. */
function derivedFor(name: string, committedOtpauth: string) {
  const fleetId = PERSONA_FLEET[name];
  if (!fleetId) throw new Error(`no fleet mapping for persona ${name}`);
  return deriveOtpauthUrl(SERVER_SECRET!, fleetId, committedOtpauth);
}

async function main() {
  console.log(
    `Table: ${TABLE}  Region: ${REGION}  Endpoint: ${process.env.RUN_ELECTRO_ENDPOINT || "(aws)"}  Mode: ${CONFIRM ? "WRITE" : "DRY-RUN"}\n`,
  );

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
    const { otpauth: derivedOtpauth, secret: derivedSecret, committedSecret } =
      derivedFor(name, committedOtpauth);
    const fleetId = PERSONA_FLEET[name];

    console.log(`● ${name}  (${fleetId})  committed ${committedSecret} → derived ${derivedSecret}`);

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
      const nextOtp = { ...(otpLive.otp ?? {}), secret: derivedSecret };
      console.log(`   otp "${otpName}".otp.secret`);
      console.log(`      old: ${before ?? "(none)"}  →  new: ${derivedSecret}`);
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
