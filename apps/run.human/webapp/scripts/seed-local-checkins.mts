/**
 * LOCAL-ONLY seeder (dev): populate run-human-electro with a few users and
 * public/private check-ins around LVCC, so /api/checkins/public returns data
 * for the "User Check-ins" map overlay (v1.8 Phase 3) — no prod access needed.
 *
 * Standalone on purpose: it clones the CheckIn/RunUser key structure instead of
 * importing src/entities (whose ./client pulls the ESM-only @auth/dynamodb-adapter,
 * which tsx cannot load through this CJS package).
 *
 * Run against local DynamoDB (:8888):
 *   cd apps/run.human/webapp && npx tsx --env-file=.env scripts/seed-local-checkins.mts
 */
import { Entity } from "electrodb";
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import * as crypto from "crypto";

const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const client = DynamoDBDocument.from(
  new DynamoDB({
    credentials: {
      accessKeyId: process.env.RUN_ELECTRO_ID || "local",
      secretAccessKey: process.env.RUN_ELECTRO_SECRET || "local",
    },
    region: process.env.RUN_DYNAMODB_REGION || "us-east-1",
    endpoint: process.env.RUN_ELECTRO_ENDPOINT || "http://localhost:8888",
  }),
  { marshallOptions: { convertEmptyValues: true, removeUndefinedValues: true } }
);

// Minimal clones — model + indexes MUST match src/entities/{run-user,checkin}.ts
// so the app reads what we write. Attributes are the subset we seed.
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
  { client, table: TABLE }
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
        properties: { latitude: { type: "number" }, longitude: { type: "number" } },
        required: true,
      },
      bestAccuracy: { type: "number", required: true },
      isPrivate: { type: "boolean", default: true },
      checkInType: { type: ["Basic", "OTP", "With Flag", "Manual"] as const, default: "Basic" },
      pointsCount: { type: "number" },
      duration: { type: "number" },
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
  { client, table: TABLE }
);

const USERS = [
  { userId: "local-rabbit-0001", displayName: "NeonRabbit" },
  { userId: "local-rabbit-0002", displayName: "DoctorWhen" },
  { userId: "local-rabbit-0003", displayName: "sub7_pacer" },
];

// LVCC cluster + a few Strip points so clustering has something to chew on.
const SPOTS: Array<[number, number, "Basic" | "OTP" | "With Flag" | "Manual", number]> = [
  [36.1359, -115.1585, "Basic", 1],
  [36.1356, -115.1587, "OTP", 2],
  [36.1354, -115.1583, "Basic", 3],
  [36.1352, -115.1589, "With Flag", 4],
  [36.1361, -115.1581, "Basic", 5],
  [36.1349, -115.1592, "Manual", 6],
  [36.1174, -115.1722, "Basic", 7], // the Strip
  [36.1147, -115.1728, "Basic", 8],
  [36.1029, -115.1732, "OTP", 9],
];

async function put(
  userId: string,
  lat: number,
  lon: number,
  checkInType: "Basic" | "OTP" | "With Flag" | "Manual",
  hoursAgo: number,
  isPrivate: boolean
) {
  const ts = Date.now() - hoursAgo * 3600_000;
  await CheckIn.put({
    userId,
    checkInId: crypto.randomUUID(),
    timestamp: ts,
    source: "Web GPS",
    samples: [{ latitude: lat, longitude: lon, accuracy: 5, timestamp: ts }],
    averageCoordinates: { latitude: lat, longitude: lon },
    bestAccuracy: 5,
    isPrivate,
    checkInType,
    pointsCount: 1,
    duration: 0,
  }).go();
}

async function main() {
  for (const u of USERS) {
    await RunUser.put({ ...u, checkInCount: 0 }).go();
    console.log(`＋ user ${u.userId} -> ${u.displayName}`);
  }

  let i = 0;
  for (const [lat, lon, type, hoursAgo] of SPOTS) {
    const u = USERS[i++ % USERS.length];
    await put(u.userId, lat, lon, type, hoursAgo, false);
    console.log(`＋ public check-in ${u.displayName} @ ${lat},${lon} (${type})`);
  }

  // Private check-ins — must NOT appear on the public map.
  await put(USERS[0].userId, 36.13, -115.16, "Basic", 0.5, true);
  await put(USERS[1].userId, 36.14, -115.15, "Basic", 0.25, true);
  console.log("＋ 2 private check-ins (should stay hidden)");

  console.log("Done seeding local check-ins.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
