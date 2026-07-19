/**
 * repoint-donate-qr.mts — fix the donate short links' logged-out spin.
 *
 * The `donate` and `d` resolver codes both point at BARE
 *   https://run.defcon.run/use1/whoami?open=donate
 * which is the exact URL PR #728 moved donate.defcon.run OFF of: whoami is a
 * client component whose `loading` init=true only clears via fetchUserData(),
 * which runs only WITH a session; the (protected) layout does not redirect
 * logged-out visitors to login; and the ?open=donate modal is hasSession-gated.
 * So a logged-out scanner spins forever.
 *
 * The fix, already proven live on the vanity domain, is to route through the
 * auth auto-signin endpoint with an encoded callbackUrl — works logged-out
 * (login, then land on whoami with a session so the modal fires) AND logged-in
 * (SSO returns immediately).
 *
 * This matters more now that donate.defcon.run points at q.defcon.run/donate
 * (so Kurt can re-target it from /admin/qr without a terraform apply): the
 * vanity domain inherits whatever the code says, so the code has to be right.
 *
 * `destination` is a plain attribute, not a key composite, so a normal
 * ElectroDB patch works here (unlike the C->c rename in seed-vanity-b-qr.mts).
 * Idempotent: skips any code already on the target URL, and refuses to touch a
 * code whose destination is neither the old nor the new value (someone edited
 * it in the admin UI — leave it alone and say so).
 *
 * Run (SSO creds for the run.human / application account):
 *   aws sso login --profile dc34-application
 *   RUN_DYNAMODB_REGION=us-east-1 AWS_PROFILE=dc34-application \
 *     npx tsx scripts/repoint-donate-qr.mts            # dry-run
 *   RUN_DYNAMODB_REGION=us-east-1 AWS_PROFILE=dc34-application \
 *     npx tsx scripts/repoint-donate-qr.mts --apply    # write
 */
import { Entity } from "electrodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const APPLY = process.argv.includes("--apply");
const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const REGION =
  process.env.RUN_DYNAMODB_REGION || process.env.AWS_REGION || "us-east-1";

const OLD_DEST = "https://run.defcon.run/use1/whoami?open=donate";
const NEW_DEST =
  "https://run.defcon.run/use1/api/auth/auto-signin?callbackUrl=%2Fuse1%2Fwhoami%3Fopen%3Ddonate";
const CODES = ["donate", "d"];

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
  `repoint-donate-qr: table=${TABLE} region=${REGION} mode=${APPLY ? "APPLY" : "DRY-RUN"}\n`
);

let changed = 0;
for (const code of CODES) {
  const existing = await Qr.get({ code }).go();
  const dest = existing.data?.destination;

  if (!existing.data) {
    console.log(`MISSING ${code}: no such code — skipping`);
  } else if (dest === NEW_DEST) {
    console.log(`SKIP    ${code}: already on the auto-signin URL`);
  } else if (dest !== OLD_DEST) {
    console.log(
      `REFUSE  ${code}: destination is neither the old nor the new value ` +
        `(found "${dest}") — someone edited it; leaving alone`
    );
  } else {
    console.log(`REPOINT ${code}:\n        ${OLD_DEST}\n     -> ${NEW_DEST}`);
    if (APPLY) {
      await Qr.patch({ code }).set({ destination: NEW_DEST }).go();
      console.log(`        done ✅`);
    }
    changed++;
  }
}

console.log(
  `\n${APPLY ? "APPLIED" : "DRY-RUN — re-run with --apply to write"} — ${changed} to change`
);
