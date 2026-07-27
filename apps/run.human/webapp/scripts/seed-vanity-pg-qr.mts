/**
 * seed-vanity-pg-qr.mts — resolver prep for the p. and g. vanity domains.
 *
 * Creates resolver codes `p` and `g` -> the rickroll (idempotent, DRY-RUN
 * unless --apply). p.defcon.run / g.defcon.run interstitials forward humans to
 * q.defcon.run/p and /g, so the resolver rows MUST exist before the
 * redirect-rules apply lands or the vanity domains 404. Same shape as the
 * b./f. seeds (see seed-vanity-f-qr.mts) so the rows are schedulable from
 * /admin/qr — retarget them there when p./g. get real destinations. Skips
 * (never clobbers) if a code already exists.
 *
 * Run (SSO creds for the run.human / application account):
 *   aws sso login --profile dc34-application
 *   RUN_DYNAMODB_REGION=us-east-1 AWS_PROFILE=dc34-application \
 *     npx tsx scripts/seed-vanity-pg-qr.mts            # dry-run
 *   RUN_DYNAMODB_REGION=us-east-1 AWS_PROFILE=dc34-application \
 *     npx tsx scripts/seed-vanity-pg-qr.mts --apply    # write
 *
 * ESM/CJS landmine (same as the b./f. seeds): `@/entities/qr` pulls in
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
  `seed-vanity-pg-qr: table=${TABLE} region=${REGION} mode=${APPLY ? "APPLY" : "DRY-RUN"}\n`
);

const SEEDS = [
  {
    code: "p",
    destination: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    notes:
      "p.defcon.run — phreak/make-a-call vanity (dynamic via redirect-target). Rickroll placeholder; retarget from /admin/qr.",
  },
  {
    code: "g",
    destination: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    notes:
      "g.defcon.run — ghosts vanity (dynamic via redirect-target). Rickroll placeholder; retarget from /admin/qr.",
  },
];

for (const seed of SEEDS) {
  const existing = await Qr.get({ code: seed.code }).go();
  if (existing.data) {
    console.log(
      `SKIP   ${seed.code}: already exists (destination="${existing.data.destination ?? "?"}", ` +
        `schedule=${existing.data.schedule?.length ?? 0} entries) — not clobbering`
    );
    continue;
  }
  console.log(`CREATE ${seed.code} -> ${seed.destination}`);
  if (APPLY) {
    await Qr.create({
      code: seed.code,
      type: "redirect",
      destination: seed.destination,
      enabled: true,
      owner: "",
      notes: seed.notes,
      rules: [],
      schedule: [],
      enrich: {},
    }).go();
    console.log(`       created ✅  (scan test: https://q.defcon.run/${seed.code})`);
  }
}

console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN — re-run with --apply to write"}`);
