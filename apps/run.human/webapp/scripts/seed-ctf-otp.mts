/**
 * seed-ctf-otp.mts — operator script to configure ONE standalone rotating-OTP
 * CTF flag whose shared TOTP secret is sourced from SSM (NOT hardcoded like the
 * DC33 starters in src/lib/ctf-seed-rows.ts). See
 * docs/superpowers/specs/2026-07-17-ctf-otp-didhtp1-ssm-flag-design.md.
 *
 * The flag (slug `didhtp1`): a 6-digit TOTP code generated EXTERNALLY from the
 * secret at SSM `/kmv/secrets/use1/ctf/otp_secret` is pasted into the standard
 * claim URL and judged by the EXISTING `answerType:"otp"` path (verifyTotp) —
 * this script adds NO judging logic, only the configured row.
 *
 * ── CROSS-ACCOUNT (deliberate) ───────────────────────────────────────────────
 *   READ secret : `klanker-application` account — shelled `aws` CLI (the exact
 *                 command the operator uses), reusing that account's SSO. No
 *                 @aws-sdk/client-ssm dependency is added.
 *   WRITE row   : `dc34-application` account — @aws-sdk DynamoDBDocument via the
 *                 default provider chain (AWS_PROFILE=dc34-application), same as
 *                 seed-ctf.mts. The `Ctf` entity pulls the ESM-only
 *                 @auth/dynamodb-adapter a standalone `tsx` CJS run cannot
 *                 require, so we hand-compose the ElectroDB key + markers.
 *
 * ── MODES (DRY-RUN by default — mirrors seed-ctf.mts) ────────────────────────
 *   (default)  read secret, validate base32, compose the row, print it with the
 *              SECRET REDACTED, parity-check one real Ctf row. Writes nothing.
 *   --verify   compute the current TOTP with the repo's own totpAt and assert
 *              verifyTotp accepts it (pure, no DB); print the ready submission
 *              URL with the live code. Proves secret+params are self-consistent.
 *   --confirm  put the row. Idempotent by key AND live-data-preserving: an
 *              existing row keeps its solveCount, createdAt, and enabled (never
 *              reset the ordinal allocator or flip off an admin-enabled flag).
 *
 * SECURITY / hygiene (D-08 discipline, same as ctf-otp.ts):
 *   - The secret is read into memory ONLY: never hardcoded, never logged, never
 *     printed (DRY-RUN masks otp.secret; --verify prints the ephemeral CODE, not
 *     the secret). On any error we never echo the secret.
 *   - Only the single `didhtp1` key is ever written — no scan-and-mutate.
 *   - Standalone operator script: NOT imported by any app/request/build path.
 *
 * Env (write-side — same names the webapp/seed-ctf.mts use):
 *   RUN_DYNAMODB_REGION   region (REQUIRED)
 *   RUN_ELECTRO_DBNAME    table (default "run-human-electro")
 *   RUN_ELECTRO_ENDPOINT  optional — set for LOCAL dynamodb
 *   RUN_ELECTRO_ID/SECRET optional explicit creds (else SSO default chain)
 * Env (read-side — SSM; defaults shown):
 *   CTF_OTP_SSM_PROFILE   default "klanker-application"
 *   CTF_OTP_SSM_PARAM     default "/kmv/secrets/use1/ctf/otp_secret"
 *   CTF_OTP_SSM_REGION    default "us-east-1"
 *   CTF_CLAIM_BASE        default "https://run.defcon.run/use1" (for --verify URL)
 *
 * ⚠️ PROD RUN RECIPE:
 *   cd apps/run.human/webapp
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 npx tsx scripts/seed-ctf-otp.mts
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 npx tsx scripts/seed-ctf-otp.mts --verify
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 npx tsx scripts/seed-ctf-otp.mts --confirm
 *   # then an admin enables `didhtp1` before it scores.
 */
import { execFileSync } from "node:child_process";

import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

// Import the pure core (base32 validation) + the node-backed TOTP surface by
// RELATIVE path — same style as seed-ctf.mts / migrate-ctf-answerhash.mts — so a
// tsx CJS run resolves them without the ESM entity chain. ctf-otp-core imports
// nothing; ctf-otp.ts imports only node:crypto + ctf-otp-core.
import { base32Decode } from "../src/lib/ctf-otp-core";
import { totpAt, verifyTotp } from "../src/lib/ctf-otp";

const CONFIRM = process.argv.includes("--confirm");
const VERIFY = process.argv.includes("--verify");
const MODE = CONFIRM ? "WRITE" : VERIFY ? "VERIFY (DRY-RUN)" : "DRY-RUN";

// ── Flag definition (the ONLY row this script ever touches) ──────────────────
// CTF_CHALLENGE override (2026-07-27): the per-DID phone games (didhtp3234 /
// didhtp3283 / didhtp8283, each with its own SSM seed via CTF_OTP_SSM_PARAM)
// reuse this script one slug at a time. Default stays didhtp1.
const CHALLENGE = process.env.CTF_CHALLENGE || "didhtp1";
const OTP_PARAMS = { digits: 6, period: 120, algorithm: "SHA1", skew: 1 } as const;
const CLAIM_BASE = process.env.CTF_CLAIM_BASE || "https://run.defcon.run/use1";

// ── Write-side (dc34-application) config ─────────────────────────────────────
const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const REGION = process.env.RUN_DYNAMODB_REGION;
const ENTITY = "Ctf"; // ElectroDB __edb_e__ marker
const VERSION = "1"; // ElectroDB __edb_v__ marker

// ── Read-side (klanker-application) SSM config ───────────────────────────────
const SSM_PROFILE = process.env.CTF_OTP_SSM_PROFILE || "klanker-application";
const SSM_PARAM = process.env.CTF_OTP_SSM_PARAM || "/kmv/secrets/use1/ctf/otp_secret";
const SSM_REGION = process.env.CTF_OTP_SSM_REGION || "us-east-1";

// Fail loud if region is missing — never silently no-op.
if (!REGION) {
  console.error("Missing required env var: RUN_DYNAMODB_REGION");
  process.exit(2);
}

// Credentials: explicit RUN_ELECTRO_ID/SECRET when BOTH are present (local
// dynamodb), otherwise the default AWS provider chain so AWS_PROFILE=dc34-
// application (SSO) drives a prod run with no embedded keys.
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
 * Read the shared TOTP secret from SSM by shelling the `aws` CLI with the EXACT
 * command the operator uses (args passed as an array — no shell, no
 * interpolation). Fails loud on any error WITHOUT echoing the secret. Trims the
 * trailing newline `--output text` appends.
 */
function readSecretFromSsm(): string {
  try {
    const out = execFileSync(
      "aws",
      [
        "--profile", SSM_PROFILE,
        "--region", SSM_REGION,
        "ssm", "get-parameter",
        "--name", SSM_PARAM,
        "--with-decryption",
        "--query", "Parameter.Value",
        "--output", "text",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return out.trim();
  } catch (e: any) {
    // Never print the secret. Surface stderr (aws error text) only.
    const stderr = e?.stderr ? String(e.stderr).trim() : "";
    console.error(
      `Failed to read SSM parameter ${SSM_PARAM} (profile ${SSM_PROFILE}, ` +
        `region ${SSM_REGION}).${stderr ? `\n  aws: ${stderr}` : ""}`
    );
    process.exit(2);
  }
}

/** Validate the secret decodes as base32 (the judge runs base32Decode on it).
 *  Never logs the secret — only its decoded byte length on success. */
function assertBase32(secret: string): number {
  if (!secret) {
    console.error("SSM parameter value is empty — refusing to seed a flag with no secret.");
    process.exit(2);
  }
  try {
    const bytes = base32Decode(secret);
    if (!bytes || bytes.length === 0) throw new Error("empty decode");
    return bytes.length;
  } catch {
    console.error(
      "SSM secret is not valid base32 (base32Decode failed) — the judge would " +
        "never verify a code against it. Aborting."
    );
    process.exit(2);
  }
}

/** Compose the raw DynamoDB item, matching the `Ctf` entity index exactly
 *  (pk composite [challenge], sk composite []). Entity defaults do NOT apply to
 *  a raw put, so enabled/solveCount/timestamps are set explicitly. */
function composeItem(secret: string): Row {
  const now = new Date().toISOString();
  return {
    pk: `$run#challenge_${CHALLENGE.toLowerCase()}`,
    sk: `$ctf_${VERSION}`,
    __edb_e__: ENTITY,
    __edb_v__: VERSION,
    challenge: CHALLENGE,
    answerType: "otp",
    otp: { secret, ...OTP_PARAMS },
    // Flat 100 (no decline; never caps): the scorer reads these four knobs.
    pointMax: 100,
    pointFloor: 100,
    maxSolves: 100000,
    firstBloodBonus: 0,
    // Repeatable at most once per 24h.
    perPlayerIntervalHours: 24,
    // Anti-spam (matches every starter).
    maxAttempts: 5,
    rateLimitWindow: 60,
    // Explicit — raw put bypasses entity defaults (enabled default is TRUE).
    enabled: false,
    solveCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** A copy of the item safe to print — the secret is masked. */
function redactItem(item: Row): Row {
  const secret = item.otp?.secret ?? "";
  return {
    ...item,
    otp: { ...item.otp, secret: `<redacted len=${String(secret).length}>` },
  };
}

const KEY = { pk: `$run#challenge_${CHALLENGE.toLowerCase()}`, sk: `$ctf_${VERSION}` };

/** Best-effort: fetch ONE existing Ctf row for a pk/sk parity check. Never
 *  throws and never hangs — bounded by a short timeout so an offline / no-creds
 *  DRY-RUN still prints the composed row and exits. */
async function fetchOneCtfRow(): Promise<Row | null> {
  const scan = doc.scan({
    TableName: TABLE,
    FilterExpression: "#e = :e",
    ExpressionAttributeNames: { "#e": "__edb_e__" },
    ExpressionAttributeValues: { ":e": ENTITY },
    Limit: 1,
  });
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

/** Fetch the existing item at the composed key, or null. Used by WRITE to
 *  preserve live counters on re-seed. */
async function getExistingRow(): Promise<Row | null> {
  try {
    const r = await doc.get({ TableName: TABLE, Key: KEY });
    return (r?.Item as Row) ?? null;
  } catch {
    return null;
  }
}

async function main() {
  console.log(
    `Challenge: ${CHALLENGE}  Table: ${TABLE}  Region: ${REGION}  ` +
      `Endpoint: ${process.env.RUN_ELECTRO_ENDPOINT || "(aws)"}  Mode: ${MODE}`
  );
  console.log(`SSM: ${SSM_PARAM}  (profile ${SSM_PROFILE}, region ${SSM_REGION})`);

  // 1) Read + validate the secret (memory only; never logged).
  const secret = readSecretFromSsm();
  const byteLen = assertBase32(secret);
  const item = composeItem(secret);
  console.log(
    `\nSecret read OK (base32 → ${byteLen} bytes). Composed row (secret redacted):`
  );
  console.log(`  pk=${item.pk}  sk=${item.sk}  __edb_e__=${item.__edb_e__}  __edb_v__=${item.__edb_v__}`);
  console.log(`  ${JSON.stringify(redactItem(item))}`);

  // 2) --verify: pure self-consistency + ready submission URL.
  if (VERIFY) {
    const nowSec = Math.floor(Date.now() / 1000);
    const code = totpAt(secret, nowSec, { digits: OTP_PARAMS.digits, period: OTP_PARAMS.period });
    const ok = verifyTotp(secret, code, nowSec, {
      digits: OTP_PARAMS.digits,
      period: OTP_PARAMS.period,
      skew: OTP_PARAMS.skew,
    });
    const remaining = OTP_PARAMS.period - (nowSec % OTP_PARAMS.period);
    const url = `${CLAIM_BASE}/ctf/claim?c=${CHALLENGE}&v=${code}`;
    console.log(
      `\n--verify: totpAt → verifyTotp round-trip = ${ok ? "PASS ✅" : "FAIL ❌"}`
    );
    console.log(`  current code: ${code}  (valid ~${remaining}s more, period ${OTP_PARAMS.period}s)`);
    console.log(`  submission URL: ${url}`);
    if (!ok) {
      console.error("verifyTotp REJECTED a freshly generated code — params are inconsistent.");
      process.exit(1);
    }
    console.log(
      `\nVERIFY DRY-RUN: wrote nothing. Re-run with --confirm to write the ${CHALLENGE} row.`
    );
    return;
  }

  // 3) DRY-RUN parity: best-effort compare against a real Ctf row.
  if (!CONFIRM) {
    const real = await fetchOneCtfRow();
    if (real) {
      console.log(
        `\nParity — a REAL Ctf row for key-shape comparison:\n` +
          `  real:     pk=${real.pk}  sk=${real.sk}  __edb_e__=${real.__edb_e__}  __edb_v__=${real.__edb_v__}\n` +
          `  composed: pk=${item.pk}  sk=${item.sk}  __edb_e__=${item.__edb_e__}  __edb_v__=${item.__edb_v__}`
      );
    } else {
      console.log(
        `\nParity: no existing Ctf row reachable (offline / empty / no creds). ` +
          `Confirm the composed pk/sk shape before --confirm.`
      );
    }
    console.log(
      `\nDRY-RUN: composed the ${CHALLENGE} row, wrote nothing. ` +
        `Re-run with --verify to round-trip a live code, or --confirm to write.`
    );
    return;
  }

  // 4) WRITE: idempotent + live-data-preserving.
  const existing = await getExistingRow();
  const Item: Row = { ...item };
  if (existing) {
    Item.solveCount = existing.solveCount ?? item.solveCount;
    Item.createdAt = existing.createdAt ?? item.createdAt;
    if (existing.enabled !== undefined) Item.enabled = existing.enabled;
  }
  await doc.put({ TableName: TABLE, Item });
  console.log(
    existing
      ? `\nUpdated ${CHALLENGE} (pk=${item.pk}) — preserved solveCount=${Item.solveCount}, enabled=${Item.enabled}. ` +
          `Definition (otp secret/params, scoring) refreshed.`
      : `\nInserted ${CHALLENGE} (pk=${item.pk}) — new row, enabled:false. ` +
          `An admin must enable it before it scores.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
