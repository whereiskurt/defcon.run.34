/**
 * purge-user.mts — completely remove a runner across all three tables.
 *
 * Built for test-account cleanup (Kurt, 2026-08-03: "delete their user records
 * and assume 100% test data I want gone"). It is NOT a GDPR/erasure tool and it
 * makes no attempt to preserve referential integrity for a REAL runner — it
 * deletes identity, which is exactly what you do not want for someone with a
 * paid bib.
 *
 * ── THE MONEY GUARD (this is the important part) ────────────────────────────
 * run.bib's Bib / GeneralDonation / PendingContribution / BibReconcile rows live
 * on the SAME physical table as run.human's data. A test account can still own a
 * real, PAID bib. So the script REFUSES to run if it finds any money row with a
 * non-zero paidAmount, any BibReconcile (a Stripe receipt), or any donation —
 * unless you pass --force-money and mean it. An unpaid placeholder Bib
 * (paidAmount 0, no receipt) is treated as test data and removed.
 *
 * ── IDENTIFIERS ─────────────────────────────────────────────────────────────
 * Two, and they are NOT interchangeable:
 *   adapter uuid (session.user.id) — keys everything in run-human-electro
 *   OIDC sub                       — keys Bib (ownerSub) and run-auth-electro
 * Both are resolved from the email and BOTH are matched. A purge scoped to one
 * silently leaves the other's rows behind, which reads as success.
 *
 * ── MATCHING ────────────────────────────────────────────────────────────────
 * A row is in scope when either identifier appears ANYWHERE in it, not just in
 * the pk — OIDC grants/tokens carry the sub in a nested field. Deletes always
 * use the row's OWN pk/sk as read back, never a composed key.
 *
 * ── USAGE ───────────────────────────────────────────────────────────────────
 *   ⚠️ NEVER pass --env-file=.env (points at LOCAL DynamoDB).
 *   AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 \
 *     npx tsx scripts/purge-user.mts --email a@b.com [--email c@d.com]
 *   …+ --confirm to apply.
 */
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const argv = process.argv.slice(2);
const CONFIRM = argv.includes("--confirm");
const FORCE_MONEY = argv.includes("--force-money");
const EMAILS = argv.reduce<string[]>((acc, a, i) => {
  if (a === "--email" && argv[i + 1]) acc.push(argv[i + 1]);
  return acc;
}, []);

const ELECTRO = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const AUTHJS = process.env.RUN_DYNAMODB_DBNAME || "run-human-authjs";
const AUTH_ELECTRO = process.env.RUN_AUTH_ELECTRO_DBNAME || "run-auth-electro";
const REGION = process.env.RUN_DYNAMODB_REGION;

if (!REGION) {
  console.error("Missing RUN_DYNAMODB_REGION");
  process.exit(2);
}
if (!EMAILS.length) {
  console.error("Missing --email <address> (repeatable)");
  process.exit(2);
}
if (process.env.RUN_ELECTRO_ENDPOINT) {
  console.error("REFUSING: RUN_ELECTRO_ENDPOINT is set — that is LOCAL DynamoDB.");
  process.exit(2);
}

const ddb = DynamoDBDocument.from(new DynamoDB({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

type Row = Record<string, unknown> & { pk: string; sk: string; __edb_e__?: string };

async function scanAll(table: string): Promise<Row[]> {
  const out: Row[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.scan({ TableName: table, ExclusiveStartKey: ExclusiveStartKey as never });
    out.push(...((res.Items ?? []) as Row[]));
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return out;
}

const MONEY = new Set([
  "Bib",
  "GeneralDonation",
  "PendingContribution",
  "BibReconcile",
  "BudgetCounter",
]);

function tally(rows: Row[]) {
  const c = new Map<string, number>();
  for (const r of rows) {
    const k = r.__edb_e__ ?? String(r.sk ?? "").split("#")[0] ?? "(unknown)";
    c.set(k, (c.get(k) ?? 0) + 1);
  }
  return [...c].sort((a, b) => b[1] - a[1]);
}

async function main() {
  console.log(`\n=== purge-user [${CONFIRM ? "WRITE" : "DRY-RUN"}] ===`);
  console.log(`emails: ${EMAILS.join(", ")}\nregion: ${REGION}\n`);

  const [electro, authjs, authElectro] = await Promise.all([
    scanAll(ELECTRO),
    scanAll(AUTHJS),
    scanAll(AUTH_ELECTRO),
  ]);

  // email -> adapter uuid (authjs USER row), then uuid -> OIDC sub (ACCOUNT row)
  const ids = new Set<string>();
  for (const e of EMAILS) {
    const users = authjs.filter((r) => r.email === e && typeof r.id === "string");
    if (users.length !== 1) {
      console.error(`Expected exactly 1 authjs USER for ${e}, found ${users.length}. Aborting.`);
      process.exit(3);
    }
    const uuid = users[0].id as string;
    ids.add(uuid);
    for (const r of authjs) {
      if (r.pk === `USER#${uuid}` && String(r.sk).startsWith("ACCOUNT#") && r.providerAccountId) {
        ids.add(r.providerAccountId as string);
      }
    }
    console.log(`${e} -> adapter uuid ${uuid}`);
  }
  console.log(`\nidentifiers in scope: ${[...ids].join(", ")}\n`);

  const inScope = (r: Row) => {
    const blob = JSON.stringify(r);
    return [...ids].some((t) => blob.includes(t));
  };

  const hitElectro = electro.filter(inScope);
  const hitAuthjs = authjs.filter(inScope);
  const hitAuthEl = authElectro.filter(inScope);

  // ── money guard ──────────────────────────────────────────────────────────
  const moneyRows = hitElectro.filter((r) => MONEY.has(r.__edb_e__ ?? ""));
  const dangerous = moneyRows.filter(
    (r) =>
      (r.__edb_e__ === "Bib" && Number(r.paidAmount ?? 0) > 0) ||
      r.__edb_e__ === "BibReconcile" ||
      r.__edb_e__ === "GeneralDonation" ||
      r.__edb_e__ === "PendingContribution"
  );
  console.log(`money rows found: ${moneyRows.length} (of which REAL: ${dangerous.length})`);
  for (const m of moneyRows) {
    console.log(
      `  ${m.__edb_e__}  paidAmount=${m.paidAmount ?? "-"}  runnerCode=${m.runnerCode ?? "-"}`
    );
  }
  if (dangerous.length && !FORCE_MONEY) {
    console.error(
      `\nREFUSING: ${dangerous.length} row(s) represent real money (paid bib, Stripe receipt,` +
        ` or donation). Re-run with --force-money only if you are certain.\n`
    );
    process.exit(4);
  }

  const plan: [string, Row[]][] = [
    [ELECTRO, hitElectro],
    [AUTHJS, hitAuthjs],
    [AUTH_ELECTRO, hitAuthEl],
  ];
  console.log();
  let total = 0;
  for (const [table, rows] of plan) {
    console.log(`${table}: ${rows.length} rows`);
    for (const [k, n] of tally(rows)) console.log(`   ${k.padEnd(24)} ${n}`);
    total += rows.length;
  }
  console.log(`\nTOTAL ${total} rows\n`);

  if (!CONFIRM) {
    console.log("DRY RUN — nothing deleted. Re-run with --confirm.\n");
    return;
  }

  for (const [table, rows] of plan) {
    let n = 0;
    for (const r of rows) {
      await ddb.delete({ TableName: table, Key: { pk: r.pk, sk: r.sk } });
      n++;
      if (n % 50 === 0) console.log(`  ${table}: ${n}/${rows.length}`);
    }
    console.log(`${table}: deleted ${n}`);
  }
  console.log("\nDONE.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
