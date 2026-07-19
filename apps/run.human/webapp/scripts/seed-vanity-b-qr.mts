/**
 * seed-vanity-b-qr.mts — resolver prep for the b.defcon.run vanity domain.
 *
 * Two independent, idempotent operations (both DRY-RUN unless --apply):
 *
 * 1. CREATE resolver code `b` → https://bib.defcon.run/
 *    b.defcon.run's interstitial forwards humans to q.defcon.run/b, so the
 *    resolver row MUST exist before the redirect-rules apply lands or the
 *    vanity domain 404s. Same shape as the r./h. cutover seeds (see
 *    seed-scheduled-qr-domains.mts) so the row is schedulable from /admin/qr.
 *    Skips (never clobbers) if the code already exists.
 *
 * 2. LOWERCASE the display `code` attribute on the didhtp1 short link, "C" → "c".
 *    Every other code in the table is stored lowercase (the admin convention);
 *    `C` was seeded uppercase. This is COSMETIC ONLY: ElectroDB lowercases the
 *    key composite, so the pk is already `$run#code_c` and stays untouched — we
 *    rewrite just the mirrored attribute on the Qr row and its Qrstat rollups so
 *    the admin list, links and stats read consistently. Raw UpdateItem (not an
 *    ElectroDB patch) because `code` is a key composite and ElectroDB refuses to
 *    patch those even when the composite value is unchanged.
 *
 * Run (SSO creds for the run.human / application account):
 *   aws sso login --profile dc34-application
 *   RUN_DYNAMODB_REGION=us-east-1 AWS_PROFILE=dc34-application \
 *     npx tsx scripts/seed-vanity-b-qr.mts            # dry-run
 *   RUN_DYNAMODB_REGION=us-east-1 AWS_PROFILE=dc34-application \
 *     npx tsx scripts/seed-vanity-b-qr.mts --apply    # write
 *
 * ESM/CJS landmine (same as seed-scheduled-qr-domains.mts): `@/entities/qr`
 * pulls in @auth/dynamodb-adapter (ESM-only), so the Qr entity is mirrored here
 * byte-identically (parity locked by qr-key-parity.test.ts).
 */
import { Entity } from "electrodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const APPLY = process.argv.includes("--apply");
const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const REGION =
  process.env.RUN_DYNAMODB_REGION || process.env.AWS_REGION || "us-east-1";

const client = DynamoDBDocument.from(new DynamoDBClient({ region: REGION }));
const Qr = new Entity(
  {
    model: { entity: "Qr", version: "1", service: "run" },
    attributes: {
      code: { type: "string", required: true },
      type: { type: "string", default: "redirect" },
      destination: { type: "string" },
      rules: { type: "list", items: { type: "map", properties: {
        kind: { type: "string" }, from: { type: "string" }, to: { type: "string" },
        match: { type: "string" }, dest: { type: "string" },
      } } },
      schedule: { type: "list", items: { type: "map", properties: {
        startsAt: { type: "string" }, dest: { type: "string" }, label: { type: "string" },
      } } },
      enrich: { type: "map", properties: {
        preserveQuery: { type: "boolean" }, appendParam: { type: "boolean" },
        utm: { type: "map", properties: {
          source: { type: "string" }, medium: { type: "string" }, campaign: { type: "string" },
        } },
      } },
      enabled: { type: "boolean", default: true },
      owner: { type: "string" },
      notes: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: { pk: { field: "pk", composite: ["code"] }, sk: { field: "sk", composite: [] } },
      byOwner: {
        index: "gsi1pk-gsi1sk-index",
        pk: { field: "gsi1pk", composite: ["owner"] },
        sk: { field: "gsi1sk", composite: ["updatedAt"] },
      },
    },
  },
  { client, table: TABLE }
);

console.log(
  `seed-vanity-b-qr: table=${TABLE} region=${REGION} mode=${APPLY ? "APPLY" : "DRY-RUN"}\n`
);

// ── 1. resolver code `b` ────────────────────────────────────────────────────
const B_SEED = {
  code: "b",
  destination: "https://bib.defcon.run/",
  notes: "b.defcon.run — bib.defcon.run (dynamic via redirect-target). Seeded pre-cutover.",
};

const existingB = await Qr.get({ code: B_SEED.code }).go();
if (existingB.data) {
  console.log(
    `SKIP   b: already exists (destination="${existingB.data.destination ?? "?"}", ` +
      `schedule=${existingB.data.schedule?.length ?? 0} entries) — not clobbering`
  );
} else {
  console.log(`CREATE b -> ${B_SEED.destination}`);
  if (APPLY) {
    await Qr.create({
      code: B_SEED.code,
      type: "redirect",
      destination: B_SEED.destination,
      enabled: true,
      owner: "",
      notes: B_SEED.notes,
      rules: [],
      schedule: [],
      enrich: {},
    }).go();
    console.log(`       created ✅  (scan test: https://q.defcon.run/b)`);
  }
}

// ── 2. lowercase the `C` display code ───────────────────────────────────────
// pk is already lowercase; we only rewrite the mirrored `code` attribute on
// every row under that pk (the Qr row + its Qrstat day/total rollups).
const C_PK = "$run#code_c";
const rows = await client.query({
  TableName: TABLE,
  KeyConditionExpression: "pk = :pk",
  ExpressionAttributeValues: { ":pk": C_PK },
});

const stale = (rows.Items ?? []).filter((i) => i.code === "C");
if (stale.length === 0) {
  console.log(`\nSKIP   c: no rows under ${C_PK} carry code="C" (already lowercase)`);
} else {
  console.log(`\nRENAME ${stale.length} row(s) under ${C_PK}: code "C" -> "c"`);
  for (const item of stale) {
    console.log(`       ${item.sk} (${item.__edb_e__ ?? "?"})`);
    if (APPLY) {
      await client.update({
        TableName: TABLE,
        Key: { pk: C_PK, sk: item.sk },
        UpdateExpression: "SET #c = :lower",
        ConditionExpression: "#c = :upper",
        ExpressionAttributeNames: { "#c": "code" },
        ExpressionAttributeValues: { ":lower": "c", ":upper": "C" },
      });
    }
  }
  if (APPLY) console.log(`       renamed ✅`);
}

console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN — re-run with --apply to write"}`);
