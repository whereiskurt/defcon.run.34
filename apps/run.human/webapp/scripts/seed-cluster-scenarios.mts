/**
 * Seed (or clear) the cluster check-in demo scenarios.
 *
 * The same data the /admin/clusters "Load demo clusters" button writes, but
 * runnable from a terminal — useful against LOCAL DynamoDB where there is no
 * admin session to click with.
 *
 * Standalone on purpose: it clones the entity key structure instead of
 * importing src/entities (whose ./client pulls the ESM-only
 * @auth/dynamodb-adapter, which tsx cannot load through this CJS package). The
 * SCENARIOS themselves are imported from the pure module, so the terminal
 * seeder and the admin button can never drift apart.
 *
 * Local DynamoDB (:8888):
 *   cd apps/run.human/webapp
 *   npx tsx --env-file=.env scripts/seed-cluster-scenarios.mts
 *   npx tsx --env-file=.env scripts/seed-cluster-scenarios.mts --clear
 *
 * Against a real table, set RUN_ELECTRO_ENDPOINT="" and export AWS creds, then
 * pass --confirm. Without --confirm a non-local endpoint refuses to run.
 */
import { Entity } from "electrodb";
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

import {
  buildDemoCheckIns,
  demoRoster,
  DEMO_SCENARIOS,
} from "../src/lib/cluster-demo-data";

const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const ENDPOINT = process.env.RUN_ELECTRO_ENDPOINT ?? "http://localhost:8888";
const isLocal = ENDPOINT.includes("localhost") || ENDPOINT.includes("127.0.0.1");

const args = new Set(process.argv.slice(2));
const clear = args.has("--clear");

if (!isLocal && !args.has("--confirm")) {
  console.error(
    `Refusing to touch a NON-LOCAL table (${TABLE} @ ${ENDPOINT || "aws"}).\n` +
      `Re-run with --confirm if that is really what you want.`,
  );
  process.exit(1);
}

const client = DynamoDBDocument.from(
  new DynamoDB({
    ...(isLocal
      ? {
          credentials: {
            accessKeyId: process.env.RUN_ELECTRO_ID || "local",
            secretAccessKey: process.env.RUN_ELECTRO_SECRET || "local",
          },
          endpoint: ENDPOINT,
        }
      : {}),
    region: process.env.RUN_DYNAMODB_REGION || "us-east-1",
  }),
  { marshallOptions: { convertEmptyValues: true, removeUndefinedValues: true } },
);

// Minimal clones — model + indexes MUST match src/entities/{run-user,checkin,
// cluster}.ts so the app reads what we write.
const RunUser = new Entity(
  {
    model: { entity: "RunUser", version: "1", service: "run" },
    attributes: {
      userId: { type: "string", required: true },
      displayName: { type: "string" },
      checkInCount: { type: "number" },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["userId"] },
        sk: { field: "sk", composite: [] },
      },
    },
  },
  { client, table: TABLE },
);

const CheckIn = new Entity(
  {
    model: { entity: "CheckIn", version: "1", service: "run" },
    attributes: {
      userId: { type: "string", required: true },
      checkInId: { type: "string", required: true },
      timestamp: { type: "number", required: true },
      source: { type: "string", required: true },
      samples: { type: "any", required: true },
      averageCoordinates: {
        type: "map",
        properties: {
          latitude: { type: "number" },
          longitude: { type: "number" },
        },
        required: true,
      },
      bestAccuracy: { type: "number", required: true },
      isPrivate: { type: "boolean" },
      checkInType: { type: ["Basic", "OTP", "With Flag", "Manual"] as const },
      pointsCount: { type: "number" },
      duration: { type: "number" },
      createdAt: { type: "number", default: () => Date.now(), readOnly: true },
      updatedAt: { type: "number", watch: "*", set: () => Date.now(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["userId"] },
        sk: { field: "sk", composite: ["timestamp", "checkInId"] },
      },
      byGlobalRecent: {
        index: "gsi2pk-gsi2sk-index",
        pk: { field: "gsi2pk", composite: [], template: "TYPE#CHECKIN" },
        sk: { field: "gsi2sk", composite: ["timestamp"] },
      },
      byUserRecent: {
        index: "gsi3pk-gsi3sk-index",
        pk: { field: "gsi3pk", composite: ["userId"] },
        sk: { field: "gsi3sk", composite: ["timestamp"] },
      },
    },
  },
  { client, table: TABLE },
);

const ClusterDemoUser = new Entity(
  {
    model: { entity: "ClusterDemoUser", version: "1", service: "run" },
    attributes: {
      userId: { type: "string", required: true },
      scenario: { type: "string" },
      displayName: { type: "string" },
      createdAt: { type: "number", default: () => Date.now(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: [], template: "TYPE#CLUSTERDEMO" },
        sk: { field: "sk", composite: ["userId"] },
      },
    },
  },
  { client, table: TABLE },
);

const ClusterAward = new Entity(
  {
    model: { entity: "ClusterAward", version: "1", service: "run" },
    attributes: {
      userId: { type: "string", required: true },
      anchorCheckInId: { type: "string", required: true },
      startAt: { type: "number", required: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["userId"] },
        sk: { field: "sk", composite: ["anchorCheckInId"] },
      },
      byRecent: {
        index: "gsi2pk-gsi2sk-index",
        pk: { field: "gsi2pk", composite: [], template: "TYPE#CLUSTERAWARD" },
        sk: { field: "gsi2sk", composite: ["startAt"] },
      },
    },
  },
  { client, table: TABLE },
);

async function seed() {
  const roster = demoRoster();
  const checkIns = buildDemoCheckIns();

  for (const r of roster) {
    await RunUser.put({
      userId: r.userId,
      displayName: r.displayName,
      checkInCount: 0,
    }).go();
    await ClusterDemoUser.put({
      userId: r.userId,
      displayName: r.displayName,
      scenario: r.scenario,
    }).go();
  }

  for (const c of checkIns) {
    await CheckIn.put({
      userId: c.userId,
      checkInId: c.checkInId,
      timestamp: c.timestamp,
      source: "Demo",
      samples: [
        {
          latitude: c.lat,
          longitude: c.lng,
          accuracy: 12,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          timestamp: c.timestamp,
        },
      ],
      averageCoordinates: { latitude: c.lat, longitude: c.lng },
      bestAccuracy: 12,
      isPrivate: c.isPrivate,
      checkInType: "Manual",
      pointsCount: 1,
      duration: 0,
    }).go();
  }

  console.log(`Seeded ${roster.length} runners and ${checkIns.length} check-ins.`);
  console.log("\nScenarios:");
  for (const s of DEMO_SCENARIOS) console.log(`  ${s.label} — ${s.expectation}`);
  console.log(
    "\nNOTE: this seeder does NOT write accomplishments or run the sweep.\n" +
      "Use /admin/clusters → 'Sweep + award' (or 'Load demo clusters') for the full path.",
  );
}

async function clearAll() {
  // Walk the MANIFEST, never a userId prefix — the manifest is the authority on
  // what the seeder created.
  const manifest = await ClusterDemoUser.query.primary({}).go({ pages: "all" });
  let checkIns = 0;
  let awards = 0;

  for (const row of manifest.data) {
    const userId = row.userId as string;

    const mine = await ClusterAward.query.primary({ userId }).go({ pages: "all" });
    for (const a of mine.data) {
      await ClusterAward.delete({
        userId,
        anchorCheckInId: a.anchorCheckInId as string,
      }).go();
    }
    awards += mine.data.length;

    const cis = await CheckIn.query.byUserRecent({ userId }).go({ pages: "all" });
    for (const c of cis.data) {
      await CheckIn.delete({
        userId,
        timestamp: c.timestamp as number,
        checkInId: c.checkInId as string,
      }).go();
    }
    checkIns += cis.data.length;

    await RunUser.delete({ userId }).go();
    await ClusterDemoUser.delete({ userId }).go();
  }

  console.log(
    `Cleared ${manifest.data.length} runners, ${checkIns} check-ins, ${awards} awards.`,
  );
}

await (clear ? clearAll() : seed());
