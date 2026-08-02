/**
 * Emit the cluster demo rows as DynamoDB BatchWriteItem payloads on stdout.
 *
 * A companion to `seed-cluster-scenarios.mts` for the case where the Node SDK
 * cannot authenticate (an expired SSO token) but the AWS CLI still holds valid
 * cached credentials. ElectroDB computes the keys via `.params()` — no network
 * — and the marshalled items are chunked into 25-row batches ready for
 * `aws dynamodb batch-write-item --cli-input-json file://<chunk>`.
 *
 * Key generation goes through the SAME entity definitions the seeder uses, so
 * the rows are byte-identical to what the app writes.
 */
import { Entity } from "electrodb";
import { marshall } from "@aws-sdk/util-dynamodb";

import { buildDemoCheckIns, demoRoster } from "../src/lib/cluster-demo-data";

const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";

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
  { table: TABLE }
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
      pinIcon: { type: "string" },
      pinColor: { type: "string" },
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
  { table: TABLE }
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
  { table: TABLE }
);

const items: Record<string, unknown>[] = [];

for (const r of demoRoster()) {
  items.push(
    (RunUser.put({ userId: r.userId, displayName: r.displayName, checkInCount: 0 })
      .params() as { Item: Record<string, unknown> }).Item
  );
  items.push(
    (ClusterDemoUser.put({
      userId: r.userId,
      displayName: r.displayName,
      scenario: r.scenario,
    }).params() as { Item: Record<string, unknown> }).Item
  );
}

for (const c of buildDemoCheckIns()) {
  items.push(
    (CheckIn.put({
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
      pinIcon: "bunny",
      pinColor: c.isPrivate ? "#e6007a" : "#00d4aa",
      pointsCount: 1,
      duration: 0,
    }).params() as { Item: Record<string, unknown> }).Item
  );
}

// BatchWriteItem caps at 25 rows per call.
const batches: unknown[] = [];
for (let i = 0; i < items.length; i += 25) {
  batches.push({
    RequestItems: {
      [TABLE]: items.slice(i, i + 25).map((Item) => ({
        PutRequest: { Item: marshall(Item, { removeUndefinedValues: true }) },
      })),
    },
  });
}

console.log(JSON.stringify(batches));
console.error(`${items.length} items in ${batches.length} batches`);
