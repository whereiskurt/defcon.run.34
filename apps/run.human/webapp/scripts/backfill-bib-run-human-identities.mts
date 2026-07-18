/**
 * backfill-bib-run-human-identities.mts — one-off: give every bib-only runner a
 * run.human identity (Auth.js account + RunUser + social-QR hash), so their bib
 * QR resolves to a real profile instead of falling back to the runner code.
 *
 * WHO needs it: a runner who only ever used bib.defcon.run authenticated through
 * run.auth (Bib row + ownerSub exist) but never signed into run.human — so there
 * is NO Auth.js account and NO RunUser for them, hence no QR hash.
 *
 * ── HOW (and WHY this way) ───────────────────────────────────────────────────
 * We do NOT forge DynamoDB records here (schema drift would make a later real
 * SSO sign-in create a DUPLICATE account). Instead we REPLAY a bib name-save
 * against the DEPLOYED run.human endpoint:
 *     PATCH https://run.<domain>/<region>/api/internal/user/<sub>
 * which, for a sub with no account, PROVISIONS one via run.human's OWN Auth.js
 * adapter (ensure-identity.ts) — email pulled from run.auth — then syncs the bib
 * name. Same code path every future bib save uses, so this is provably safe and
 * idempotent (an already-provisioned sub is a no-op / plain name sync).
 *
 * Same raw-@aws-sdk approach as sync-bib-names.mts for the READS (the ElectroDB
 * entities import @auth/dynamodb-adapter, ESM-only, which a standalone run can't
 * require): scan by ElectroDB's `__edb_e__` marker and the authjs ACCOUNT# rows.
 *
 * SAFETY / hygiene:
 *   - DRY-RUN BY DEFAULT: prints every runner that WOULD be provisioned + counts,
 *     and calls nothing. Pass --confirm to actually PATCH.
 *   - --sub <oidcSub> restricts the whole run to ONE runner (test-drive first).
 *   - Only provisions subs with NO existing account link — never touches runners
 *     who already have a run.human identity.
 *   - Standalone operator script: NOT imported by any app/request/build path.
 *
 * Env (same names the webapp/sync-bib-names use — see src/entities/client.ts):
 *   RUN_ELECTRO_DBNAME    (electro table; default run-human-electro)
 *   RUN_DYNAMODB_DBNAME   (authjs table;  default run-human-authjs)
 *   RUN_DYNAMODB_REGION   (region, both tables)
 *   AUTH_INTERNAL_SECRET  (the X-Internal-Secret the endpoint gates on)
 *   RUN_HUMAN_URL         (endpoint base; default https://run.defcon.run/use1)
 *   RUN_ELECTRO_ENDPOINT  (optional; set for LOCAL dynamodb)
 *
 * PROD RUN RECIPE (us-east-1 / shared tables):
 *   cd apps/run.human/webapp
 *   # 1. dry-run the FULL sweep — inspect who would be provisioned (calls nothing):
 *   AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/backfill-bib-run-human-identities.mts
 *   # 2. test-drive ONE runner first:
 *   AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/backfill-bib-run-human-identities.mts --sub <oidcSub> --confirm
 *   # 3. commit the full sweep:
 *   AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/backfill-bib-run-human-identities.mts --confirm
 */
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const CONFIRM = process.argv.includes("--confirm");
const OIDC_PROVIDER = "run.defcon.run";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const ONLY_SUB = argValue("--sub");

const ELECTRO_TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const AUTHJS_TABLE = process.env.RUN_DYNAMODB_DBNAME || "run-human-authjs";
const REGION = process.env.RUN_DYNAMODB_REGION;
const RUN_HUMAN_URL = (process.env.RUN_HUMAN_URL || "https://run.defcon.run/use1").replace(/\/$/, "");
const INTERNAL_SECRET = process.env.AUTH_INTERNAL_SECRET;

if (!REGION) {
  console.error("Missing required env var: RUN_DYNAMODB_REGION");
  process.exit(2);
}
if (CONFIRM && !INTERNAL_SECRET) {
  console.error("Missing AUTH_INTERNAL_SECRET (required to PATCH with --confirm).");
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
    ...(process.env.RUN_ELECTRO_ENDPOINT ? { endpoint: process.env.RUN_ELECTRO_ENDPOINT } : {}),
  }),
  { marshallOptions: { removeUndefinedValues: true } }
);
const authjs = DynamoDBDocument.from(
  new DynamoDB({
    region: REGION,
    ...creds("RUN_DYNAMODB_ID", "RUN_DYNAMODB_SECRET"),
    ...(process.env.RUN_DYNAMODB_ENDPOINT ? { endpoint: process.env.RUN_DYNAMODB_ENDPOINT } : {}),
  }),
  { marshallOptions: { removeUndefinedValues: true } }
);

type Row = Record<string, any>;

async function scanAll(doc: DynamoDBDocument, table: string, params: Record<string, unknown>): Promise<Row[]> {
  const items: Row[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await doc.scan({ TableName: table, ExclusiveStartKey, ...params });
    items.push(...((r.Items as Row[]) || []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function provision(sub: string, bibName: string): Promise<string> {
  const res = await fetch(`${RUN_HUMAN_URL}/api/internal/user/${encodeURIComponent(sub)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": INTERNAL_SECRET as string,
    },
    body: JSON.stringify({ displayName: bibName }),
  });
  const text = await res.text();
  return `${res.status} ${text}`;
}

async function main() {
  console.log(
    `Electro: ${ELECTRO_TABLE}  Authjs: ${AUTHJS_TABLE}  Region: ${REGION}\n` +
      `Endpoint: ${RUN_HUMAN_URL}/api/internal/user/<sub>  ` +
      `Mode: ${CONFIRM ? "WRITE (PATCH)" : "DRY-RUN"}` +
      (ONLY_SUB ? `  Scope: sub=${ONLY_SUB} only` : "  Scope: ALL bibs")
  );

  // Subs that ALREADY have a run.human account (authjs ACCOUNT# rows).
  const accounts = await scanAll(authjs, AUTHJS_TABLE, {
    FilterExpression: "begins_with(sk, :acct)",
    ExpressionAttributeValues: { ":acct": `ACCOUNT#${OIDC_PROVIDER}#` },
    ProjectionExpression: "providerAccountId",
  });
  const haveIdentity = new Set<string>();
  for (const a of accounts) if (a.providerAccountId) haveIdentity.add(a.providerAccountId as string);
  console.log(`Existing run.human accounts: ${haveIdentity.size}`);

  // All bibs → ownerSub + nameOnBib.
  const bibs = await scanAll(electro, ELECTRO_TABLE, {
    FilterExpression: "#e = :b",
    ExpressionAttributeNames: { "#e": "__edb_e__" },
    ExpressionAttributeValues: { ":b": "Bib" },
  });
  console.log(`Bib rows: ${bibs.length}`);

  // Candidates: a bib whose ownerSub has NO run.human account yet.
  const candidates = bibs
    .filter((b) => typeof b.ownerSub === "string" && b.ownerSub.length > 0)
    .filter((b) => !haveIdentity.has(b.ownerSub))
    .filter((b) => !ONLY_SUB || b.ownerSub === ONLY_SUB)
    .map((b) => ({ sub: b.ownerSub as string, name: (b.nameOnBib as string) ?? "", runnerCode: b.runnerCode as string }));

  console.log(`\nRunners to provision (bib-only, no run.human identity): ${candidates.length}`);
  for (const c of candidates) {
    console.log(`  ${c.runnerCode}  sub=${c.sub}  name="${c.name}"`);
  }

  if (!CONFIRM) {
    console.log(`\nDRY-RUN: would PATCH ${candidates.length} runner(s) to provision a run.human identity. Re-run with --confirm.`);
    return;
  }
  if (candidates.length === 0) {
    console.log(`\nNothing to provision.`);
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const c of candidates) {
    try {
      const result = await provision(c.sub, c.name);
      const good = result.startsWith("200");
      good ? ok++ : fail++;
      console.log(`  ${good ? "✅" : "⚠️ "} ${c.runnerCode}  ${result}`);
    } catch (e) {
      fail++;
      console.log(`  ⚠️  ${c.runnerCode}  ERROR ${(e as Error).message}`);
    }
  }
  console.log(`\nDone: ${ok} provisioned, ${fail} failed (of ${candidates.length}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
