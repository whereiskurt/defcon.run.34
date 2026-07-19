/**
 * seed-vanity-f-qr.mts — resolver prep for the f.defcon.run vanity domain.
 *
 * Creates resolver code `f` -> https://flash.defcon.run/ (idempotent, DRY-RUN
 * unless --apply). f.defcon.run's interstitial forwards humans to
 * q.defcon.run/f, so the resolver row MUST exist before the redirect-rules
 * apply lands or the vanity domain 404s. Same shape as the b. seed and the
 * r./h. cutover seeds (see seed-vanity-b-qr.mts / seed-scheduled-qr-domains.mts)
 * so the row is schedulable from /admin/qr. Skips (never clobbers) if the code
 * already exists.
 *
 * flash.defcon.run/ is a region picker that JS-redirects to /use1/ on its own,
 * so the bare host is the right destination — the resolver only splices /use1
 * into run.defcon.run destinations.
 *
 * Run (SSO creds for the run.human / application account):
 *   aws sso login --profile dc34-application
 *   RUN_DYNAMODB_REGION=us-east-1 AWS_PROFILE=dc34-application \
 *     npx tsx scripts/seed-vanity-f-qr.mts            # dry-run
 *   RUN_DYNAMODB_REGION=us-east-1 AWS_PROFILE=dc34-application \
 *     npx tsx scripts/seed-vanity-f-qr.mts --apply    # write
 *
 * ESM/CJS landmine (same as the b. seed): `@/entities/qr` pulls in
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
  `seed-vanity-f-qr: table=${TABLE} region=${REGION} mode=${APPLY ? "APPLY" : "DRY-RUN"}\n`
);

const F_SEED = {
  code: "f",
  destination: "https://flash.defcon.run/",
  notes: "f.defcon.run \u2014 flash.defcon.run (dynamic via redirect-target). Seeded pre-cutover.",
};

const existingF = await Qr.get({ code: F_SEED.code }).go();
if (existingF.data) {
  console.log(
    `SKIP   f: already exists (destination="${existingF.data.destination ?? "?"}", ` +
      `schedule=${existingF.data.schedule?.length ?? 0} entries) \u2014 not clobbering`
  );
} else {
  console.log(`CREATE f -> ${F_SEED.destination}`);
  if (APPLY) {
    await Qr.create({
      code: F_SEED.code,
      type: "redirect",
      destination: F_SEED.destination,
      enabled: true,
      owner: "",
      notes: F_SEED.notes,
      rules: [],
      schedule: [],
      enrich: {},
    }).go();
    console.log(`       created \u2705  (scan test: https://q.defcon.run/f)`);
  }
}

console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN \u2014 re-run with --apply to write"}`);
