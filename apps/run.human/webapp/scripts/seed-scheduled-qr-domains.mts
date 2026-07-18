/**
 * seed-scheduled-qr-domains.mts — behavior-preserving seed for the r./h. cutover.
 *
 * Part B of "dynamic scheduled QR codes": the r./h. vanity domains are being
 * re-pointed at the resolver (redirects.json: r → q.defcon.run/R, h → /H). Before
 * that redirect-rules apply lands, the resolver codes `r` and `h` MUST exist, or
 * q.defcon.run/R|H returns 404 and the vanity domains break. This seeds them with
 * TODAY's destinations so the cutover is a no-op for scanners:
 *   r → https://www.youtube.com/watch?v=dQw4w9WgXcQ   (the rickroll)
 *   h → https://run.defcon.run/                        (resolver splices /use1)
 *
 * Codes are stored LOWERCASE (the admin convention; the resolver uppercases the
 * scanned path then Qr.get, and ElectroDB lowercases the pk composite — so `/R`
 * and `/r` both resolve this row). Idempotent: never clobbers an existing code's
 * destination or schedule (skips if the row already exists), so re-running after
 * a schedule has been authored is safe.
 *
 * ESM/CJS landmine (see repair-emoji-qr-codes.mts / seed-ctf.mts): the shared
 * `@/entities/qr` module pulls in @auth/dynamodb-adapter (ESM-only) via client.ts
 * and can't be require()'d in a standalone tsx run. So we define a SELF-CONTAINED
 * ElectroDB `Qr` entity here (model kept byte-identical to src/entities/qr.ts so
 * pk/sk/GSI encode identically — parity is locked by qr-key-parity.test.ts) over a
 * raw doc client. This yields a proper ElectroDB row (GSI + __edb metadata) that
 * the admin UI can list and schedule, unlike a hand-composed raw put.
 *
 * DRY-RUN BY DEFAULT: reads + prints what it would create, writes nothing.
 * Pass --apply to perform the create.
 *
 * Run (SSO creds for the run.human / application account):
 *   aws sso login --profile dc34-application
 *   RUN_DYNAMODB_REGION=us-east-1 AWS_PROFILE=dc34-application \
 *     npx tsx scripts/seed-scheduled-qr-domains.mts            # dry-run
 *   RUN_DYNAMODB_REGION=us-east-1 AWS_PROFILE=dc34-application \
 *     npx tsx scripts/seed-scheduled-qr-domains.mts --apply    # write
 */
import { Entity } from "electrodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const APPLY = process.argv.includes("--apply");
const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const REGION =
  process.env.RUN_DYNAMODB_REGION || process.env.AWS_REGION || "us-east-1";

// Self-contained mirror of the Qr entity (model byte-identical to
// src/entities/qr.ts — do not diverge; qr-key-parity.test.ts locks the encoding).
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

// Behavior-preserving seeds — exactly today's r./h. targets.
const SEEDS: Array<{ code: string; destination: string; notes: string }> = [
  {
    code: "r",
    destination: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    notes: "r.defcon.run — Run Hacker Run rickroll (dynamic via redirect-target). Seeded pre-cutover.",
  },
  {
    code: "h",
    destination: "https://run.defcon.run/",
    notes: "h.defcon.run — run.defcon.run (dynamic via redirect-target). Seeded pre-cutover.",
  },
];

console.log(
  `seed-scheduled-qr-domains: table=${TABLE} region=${REGION} mode=${APPLY ? "APPLY" : "DRY-RUN"}\n`
);

let created = 0;
let skipped = 0;

for (const seed of SEEDS) {
  const existing = await Qr.get({ code: seed.code }).go();
  if (existing.data) {
    console.log(
      `SKIP   ${seed.code}: already exists (destination="${existing.data.destination ?? "?"}", ` +
        `schedule=${existing.data.schedule?.length ?? 0} entries) — not clobbering`
    );
    skipped++;
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
    console.log(`       created ✅  (scan test: https://q.defcon.run/${seed.code.toUpperCase()})`);
    created++;
  }
}

console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN"} — created=${created} skipped=${skipped}`);
if (!APPLY && created === 0 && skipped < SEEDS.length) {
  console.log("(dry-run: re-run with --apply to create the codes shown above)");
}
