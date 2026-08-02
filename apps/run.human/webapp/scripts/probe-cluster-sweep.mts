/**
 * READ-ONLY probe: run the real cluster detector over the real check-in table
 * and print what a sweep WOULD award. Writes nothing.
 *
 * Exists because the sweep's DynamoDB read path (the byGlobalRecent key
 * condition + the attribute projection) cannot be exercised by the unit tests,
 * which are deliberately offline. This closes that gap without needing an
 * admin session to click the button with.
 *
 *   RUN_ELECTRO_ENDPOINT="" AWS_PROFILE=... npx tsx scripts/probe-cluster-sweep.mts
 */
import { Entity } from "electrodb";
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

import { detectClusters, type ClusterPoint } from "../src/lib/cluster-detect";
import { DEFAULT_CLUSTER_CONFIG } from "../src/lib/cluster-config";
import { CON_DAYS, CON_TZ_OFFSET_HOURS, conLocalDate } from "../src/lib/con-days";

const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const ENDPOINT = process.env.RUN_ELECTRO_ENDPOINT ?? "http://localhost:8888";
const isLocal = ENDPOINT.includes("localhost") || ENDPOINT.includes("127.0.0.1");

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

// Key structure MUST match src/entities/checkin.ts.
const CheckIn = new Entity(
  {
    model: { entity: "CheckIn", version: "1", service: "run" },
    attributes: {
      userId: { type: "string", required: true },
      checkInId: { type: "string", required: true },
      timestamp: { type: "number", required: true },
      source: { type: "string" },
      samples: { type: "any" },
      averageCoordinates: {
        type: "map",
        properties: {
          latitude: { type: "number" },
          longitude: { type: "number" },
        },
      },
      bestAccuracy: { type: "number" },
      isPrivate: { type: "boolean" },
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

const shift = CON_TZ_OFFSET_HOURS * 3_600_000;
const since = Date.parse(`${CON_DAYS[0]}T00:00:00Z`) - shift;
const until = Date.parse(`${CON_DAYS[CON_DAYS.length - 1]}T23:59:59.999Z`) - shift;

// The EXACT read the sweep performs: key condition + attribute projection.
const result = await CheckIn.query
  .byGlobalRecent({})
  .between({ timestamp: since }, { timestamp: until })
  .go({
    pages: "all",
    attributes: ["userId", "checkInId", "timestamp", "averageCoordinates"],
  });

const points: ClusterPoint[] = [];
for (const row of result.data) {
  const lat = row.averageCoordinates?.latitude;
  const lng = row.averageCoordinates?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") continue;
  points.push({
    userId: row.userId,
    checkInId: row.checkInId,
    lat,
    lng,
    t: row.timestamp,
  });
}

console.log(`Table: ${TABLE}`);
console.log(`Range: ${conLocalDate(since)} .. ${conLocalDate(until)} (con-local)`);
console.log(`Read ${result.data.length} check-ins, ${points.length} with coordinates.\n`);

const clusters = detectClusters(points, DEFAULT_CLUSTER_CONFIG);
console.log(`Detected ${clusters.length} clusters:\n`);

let total = 0;
for (const c of clusters) {
  const t = new Date(c.startAt + shift).toISOString().slice(11, 16);
  total += c.points * c.size;
  console.log(
    `  ${c.day} ${t}  ${String(c.size).padStart(3)} runners  ` +
      `${String(c.points).padStart(4)} pts each  ` +
      `(${c.centroidLat.toFixed(4)}, ${c.centroidLng.toFixed(4)})`,
  );
}
console.log(`\nTotal points a sweep would award: ${total}`);
console.log(`Award rows a sweep would write: ${clusters.reduce((s, c) => s + c.size, 0)}`);
