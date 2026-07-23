/**
 * mint-r-qr.mts — resolver prep for the runner social QR.
 *
 * CREATE resolver code `r` → https://run.defcon.run/r with enrich.appendParam
 * so `q.defcon.run/r/<token16>` 302s to `run.defcon.run/use1/r?p=<token16>`
 * (the resolver splices the region; appendParam surfaces the second path
 * segment as `?p=`). Every printed bib and on-screen runner QR depends on
 * this single row — `r` is on qr-admin's RESERVED_CODES so the admin surface
 * can never edit or delete it; this script is its only writer.
 *
 * Idempotent: skips (never clobbers) when the code already exists.
 * DRY-RUN by default; write with --apply.
 *
 * Run (SSO creds for the run.human / application account):
 *   aws sso login --profile dc34-application
 *   RUN_DYNAMODB_REGION=us-east-1 AWS_PROFILE=dc34-application \
 *     npx tsx scripts/mint-r-qr.mts            # dry-run
 *   RUN_DYNAMODB_REGION=us-east-1 AWS_PROFILE=dc34-application \
 *     npx tsx scripts/mint-r-qr.mts --apply    # write
 *
 * ESM/CJS landmine (same as seed-vanity-b-qr.mts): `@/entities/qr` pulls in
 * @auth/dynamodb-adapter (ESM-only), so the Qr entity is mirrored here
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
  `mint-r-qr: table=${TABLE} region=${REGION} mode=${APPLY ? "APPLY" : "DRY-RUN"}\n`
);

const R_SEED = {
  code: "r",
  destination: "https://run.defcon.run/r",
  notes:
    "runner social QR — q.defcon.run/r/<token16> → run/<region>/r?p=<token16>. " +
    "DO NOT DELETE OR DISABLE: every printed bib + on-screen runner QR routes " +
    "through this row. Admin-reserved; managed by scripts/mint-r-qr.mts only.",
};

const existing = await Qr.get({ code: R_SEED.code }).go();
if (existing.data) {
  console.log(
    `SKIP   r: already exists (destination="${existing.data.destination ?? "?"}", ` +
      `appendParam=${existing.data.enrich?.appendParam ?? false}) — not clobbering`
  );
  if (existing.data.enrich?.appendParam !== true) {
    console.log(
      `⚠️  WARNING: enrich.appendParam is not true — scans will DROP the runner token. Fix via a manual update.`
    );
    process.exitCode = 2;
  }
} else {
  console.log(`CREATE r -> ${R_SEED.destination} (enrich.appendParam=true)`);
  if (APPLY) {
    await Qr.create({
      code: R_SEED.code,
      type: "redirect",
      destination: R_SEED.destination,
      enabled: true,
      owner: "",
      notes: R_SEED.notes,
      rules: [],
      schedule: [],
      enrich: { appendParam: true },
    }).go();
    console.log(
      `       created ✅  (scan test: https://q.defcon.run/r/0123456789abcdef → 302 …/use1/r?p=0123456789abcdef)`
    );
  }
}
