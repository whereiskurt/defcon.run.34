/**
 * sync-bib-names.mts — one-off data munge: backfill run.human rabbit names
 * (RunUser.displayName) from the name each runner put on their bib
 * (Bib.nameOnBib), for people who set their bib name BEFORE the live bib→rabbit
 * sync shipped (PR #513).
 *
 * It REPLAYS exactly what the live sync would have done, using the SAME pure lock
 * policy the app ships (imported from src/lib/rabbit-name-sync.ts) — so a name is
 * overwritten ONLY when it is still the unclaimed auto-default `rabbit_XXXX`
 * (i.e. the runner never picked a name themselves). Anyone who already set a name
 * from something else — the profile pencil (displayNameManual=true), a prior
 * sync (displayNameManual=false → also left alone here, already synced), or a
 * deliberate non-default name on a pre-feature account — is NEVER touched.
 *
 * ── WHY the raw @aws-sdk client and NOT the ElectroDB entities ───────────────
 * Same rationale as reset-ctf-user.mts: the entities import
 * @auth/dynamodb-adapter (ESM-only) which a standalone `tsx` CJS run cannot
 * require. So we talk to DynamoDB via the raw DynamoDBDocument client, find rows
 * by ElectroDB's `__edb_e__` entity marker, and write each row by its OWN pk/sk
 * (read from the scan) — no key composition, ZERO entity-key drift risk. The
 * lock/normalize helpers are dependency-free, so we DO import those (single
 * source of truth with the live PATCH route).
 *
 * NAMESPACE bridge (see entities/bib.ts / entities/auth-user.ts headers):
 *   - RunUser is keyed by the Auth.js adapter uuid (RunUser.userId).
 *   - Bib is keyed by the raw OIDC sub (Bib.ownerSub).
 *   The authjs ACCOUNT# rows carry both: userId (adapter uuid) +
 *   providerAccountId (OIDC sub). We scan those once to bridge sub → userId.
 *
 * SAFETY / hygiene:
 *   - DRY-RUN BY DEFAULT: prints every planned change + why each candidate was
 *     skipped, and writes nothing. Pass --confirm to actually write.
 *   - Optional --email <addr> restricts the whole run to ONE user (resolved via
 *     authjs), so you can test-drive on yourself before the full sweep.
 *   - Reads three tables with plain scans; writes only RunUser.displayName +
 *     displayNameManual=false + updatedAt, by each row's own pk/sk.
 *   - Standalone operator script: NOT imported by any app/request/build path.
 *   - Idempotent: a second run finds every synced name already in place → 0
 *     changes (the new displayName is no longer the auto-default, and
 *     displayNameManual=false keeps it eligible but equal, so it's skipped).
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
 *   # 1. dry-run the FULL sweep — inspect exactly what would change (writes nothing):
 *   AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/sync-bib-names.mts
 *   # 2. (optional) test-drive on one account first:
 *   AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/sync-bib-names.mts --email whereiskurt@gmail.com --confirm
 *   # 3. commit the full sweep:
 *   AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/sync-bib-names.mts --confirm
 */
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import {
  isDisplayNameLocked,
  normalizeSyncedName,
} from "../src/lib/rabbit-name-sync";

const CONFIRM = process.argv.includes("--confirm");
const OIDC_PROVIDER = "run.defcon.run";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const EMAIL = argValue("--email");

const ELECTRO_TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const AUTHJS_TABLE = process.env.RUN_DYNAMODB_DBNAME || "run-human-authjs";
const REGION = process.env.RUN_DYNAMODB_REGION;

// Fail loud if region is missing — never silently no-op.
if (!REGION) {
  console.error("Missing required env var: RUN_DYNAMODB_REGION");
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
  const rows = await scanAll(authjs, AUTHJS_TABLE, {
    FilterExpression: "email = :e",
    ExpressionAttributeValues: { ":e": email },
  });
  const ids = Array.from(
    new Set(
      rows
        .filter((r) => typeof r.id === "string" && r.id.length > 0)
        .map((u) => u.id as string)
    )
  );
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

type Change = {
  userId: string;
  from: string;
  to: string;
  bibName: string;
  pk: string;
  sk: string;
};

async function main() {
  console.log(
    `Electro: ${ELECTRO_TABLE}  Authjs: ${AUTHJS_TABLE}  Region: ${REGION}  ` +
      `Mode: ${CONFIRM ? "WRITE" : "DRY-RUN"}` +
      (EMAIL ? `  Scope: ${EMAIL} only` : "  Scope: ALL users")
  );

  const onlyUserId = EMAIL ? await resolveUserId(EMAIL) : undefined;
  if (onlyUserId) console.log(`Restricting to user: ${EMAIL} → ${onlyUserId}\n`);

  // --- Bridge: OIDC sub → adapter userId (authjs ACCOUNT# rows) -------------
  const accounts = await scanAll(authjs, AUTHJS_TABLE, {
    FilterExpression: "begins_with(sk, :acct)",
    ExpressionAttributeValues: { ":acct": `ACCOUNT#${OIDC_PROVIDER}#` },
    ProjectionExpression: "userId, providerAccountId",
  });
  const subToUserId = new Map<string, string>();
  for (const a of accounts) {
    if (a.userId && a.providerAccountId) subToUserId.set(a.providerAccountId, a.userId);
  }
  console.log(`Account links (sub → userId): ${subToUserId.size}`);

  // --- Bib rows: ownerSub → nameOnBib (non-empty only) ---------------------
  const bibs = await scanAll(electro, ELECTRO_TABLE, {
    FilterExpression: "#e = :b",
    ExpressionAttributeNames: { "#e": "__edb_e__" },
    ExpressionAttributeValues: { ":b": "Bib" },
  });
  const namedBibs = bibs.filter(
    (b) => typeof b.nameOnBib === "string" && b.nameOnBib.trim().length > 0
  );
  console.log(`Bib rows: ${bibs.length} (with a nameOnBib: ${namedBibs.length})`);

  // --- RunUser rows: userId → row ------------------------------------------
  const runUsers = await scanAll(electro, ELECTRO_TABLE, {
    FilterExpression: "#e = :ru",
    ExpressionAttributeNames: { "#e": "__edb_e__" },
    ExpressionAttributeValues: { ":ru": "RunUser" },
  });
  const runUserById = new Map<string, Row>();
  for (const ru of runUsers) if (ru.userId) runUserById.set(ru.userId, ru);
  console.log(`RunUser rows: ${runUsers.length}\n`);

  // --- Classify every named bib -------------------------------------------
  const changes: Change[] = [];
  const skips = {
    noAccountLink: 0,
    noRunUser: 0,
    nameLocked: 0,
    tooShort: 0,
    alreadyEqual: 0,
    outOfScope: 0,
  };

  for (const bib of namedBibs) {
    const sub = bib.ownerSub as string;
    const userId = subToUserId.get(sub);
    if (!userId) {
      skips.noAccountLink++;
      continue;
    }
    if (onlyUserId && userId !== onlyUserId) {
      skips.outOfScope++;
      continue;
    }
    const ru = runUserById.get(userId);
    if (!ru) {
      skips.noRunUser++;
      continue;
    }
    // The exact production lock policy — leave anything already claimed alone.
    if (isDisplayNameLocked(ru.displayName, ru.displayNameManual, userId)) {
      skips.nameLocked++;
      continue;
    }
    const next = normalizeSyncedName(bib.nameOnBib as string);
    if (next === null) {
      skips.tooShort++;
      continue;
    }
    if (next === (ru.displayName ?? "")) {
      skips.alreadyEqual++;
      continue;
    }
    changes.push({
      userId,
      from: ru.displayName ?? "(none)",
      to: next,
      bibName: (bib.nameOnBib as string).trim(),
      pk: ru.pk,
      sk: ru.sk,
    });
  }

  // --- Report --------------------------------------------------------------
  console.log(`Planned displayName updates: ${changes.length}`);
  for (const c of changes) {
    console.log(
      `  ${c.userId}  "${c.from}" → "${c.to}"` +
        (c.to !== c.bibName ? `  (bib="${c.bibName}", reconciled)` : "")
    );
  }
  console.log(
    `\nSkipped: nameLocked=${skips.nameLocked} (runner already chose a name), ` +
      `alreadyEqual=${skips.alreadyEqual}, tooShort=${skips.tooShort}, ` +
      `noRunUser=${skips.noRunUser}, noAccountLink=${skips.noAccountLink}` +
      (EMAIL ? `, outOfScope=${skips.outOfScope}` : "")
  );

  // --- Apply ---------------------------------------------------------------
  if (!CONFIRM) {
    console.log(
      `\nDRY-RUN: would update ${changes.length} RunUser.displayName value(s) ` +
        `(displayNameManual=false). Re-run with --confirm to write.`
    );
    return;
  }
  if (changes.length === 0) {
    console.log(`\nNothing to write.`);
    return;
  }
  for (const c of changes) {
    await electro.update({
      TableName: ELECTRO_TABLE,
      Key: { pk: c.pk, sk: c.sk },
      UpdateExpression:
        "SET displayName = :dn, displayNameManual = :m, updatedAt = :ua",
      ExpressionAttributeValues: {
        ":dn": c.to,
        ":m": false,
        ":ua": Date.now(),
      },
    });
    console.log(`  updated ${c.userId} → "${c.to}"`);
  }
  console.log(`\nApplied: ${changes.length} rabbit name(s) backfilled from bibs.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
