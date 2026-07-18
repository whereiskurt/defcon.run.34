/**
 * repair-emoji-qr-codes.mts — one-off data repair.
 *
 * The ☎ / ☎️ Qr rows (both redirect to the didhtp1 CTF claim) are inconsistent:
 * their DynamoDB partition key was composed from the DECODED emoji
 * (`$run#code_☎️`) but their `code` ATTRIBUTE holds the percent-encoded string
 * (`%e2%98%8e%ef%b8%8f`). They were written out-of-band; the app can't create
 * them. This makes /admin/qr display the percent string and (before the
 * codeKeyCandidates fix) 404 on click.
 *
 * This repair sets the `code` ATTRIBUTE to the decoded emoji so it agrees with
 * the pk. It does NOT touch the pk/sk/GSI — so the live q.defcon.run scan keeps
 * resolving exactly as before; only the stored attribute (and the admin display)
 * become consistent.
 *
 * ESM/CJS landmine (see seed-ctf.mts): the ElectroDB entities import
 * @auth/dynamodb-adapter (ESM-only) and can't be require()'d by a standalone
 * tsx run — so we talk to DynamoDB via the raw doc client with a MANUALLY
 * composed key. Key shape (from the entity + entities.test.mjs):
 *   pk = "$run#code_<code.toLowerCase()>",  sk = "$qr_1"
 *
 * DRY-RUN BY DEFAULT: reads + prints what it would change, writes nothing.
 * Pass --apply to perform the UpdateItem.
 *
 * Run (SSO creds for the run.human / application account):
 *   AWS_PROFILE=<app-account-profile> aws sso login
 *   RUN_DYNAMODB_REGION=us-east-1 AWS_PROFILE=<app-account-profile> \
 *     npx tsx scripts/repair-emoji-qr-codes.mts            # dry-run
 *   RUN_DYNAMODB_REGION=us-east-1 AWS_PROFILE=<app-account-profile> \
 *     npx tsx scripts/repair-emoji-qr-codes.mts --apply    # write
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const APPLY = process.argv.includes("--apply");
const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const REGION =
  process.env.RUN_DYNAMODB_REGION || process.env.AWS_REGION || "us-east-1";

const SK = "$qr_1";
const pkFor = (code: string) => `$run#code_${code.toLowerCase()}`;

// The two live CTF codes: ☎ (U+260E) and ☎️ (U+260E + VS16 U+FE0F). Their pk
// was composed from these decoded forms.
const EMOJIS = ["☎", "☎️"];

const doc = DynamoDBDocument.from(new DynamoDBClient({ region: REGION }));

console.log(
  `repair-emoji-qr-codes: table=${TABLE} region=${REGION} mode=${APPLY ? "APPLY" : "DRY-RUN"}\n`
);

let repaired = 0;
let skipped = 0;

for (const emoji of EMOJIS) {
  const pk = pkFor(emoji);
  const label = JSON.stringify(emoji); // prints the \uXXXX escapes unambiguously
  const got = await doc.get({ TableName: TABLE, Key: { pk, sk: SK } });
  const row = got.Item;

  if (!row) {
    console.log(`SKIP   ${label}: no row at pk=${pk}`);
    skipped++;
    continue;
  }
  if (row.code === emoji) {
    console.log(`OK     ${label}: already consistent (code="${row.code}")`);
    skipped++;
    continue;
  }

  console.log(
    `REPAIR ${label}: pk=${pk}  code "${row.code}" -> "${emoji}"  dest=${row.destination ?? "?"}`
  );

  if (APPLY) {
    await doc.update({
      TableName: TABLE,
      Key: { pk, sk: SK },
      UpdateExpression: "SET #code = :code",
      ConditionExpression: "attribute_exists(pk)", // never create — only fix existing
      ExpressionAttributeNames: { "#code": "code" },
      ExpressionAttributeValues: { ":code": emoji },
    });
    console.log(`       applied ✅`);
    repaired++;
  }
}

console.log(
  `\n${APPLY ? "APPLIED" : "DRY-RUN"} — repaired=${repaired} skipped=${skipped}`
);
if (!APPLY && repaired === 0) {
  console.log("(dry-run: re-run with --apply to write the repairs shown above)");
}
