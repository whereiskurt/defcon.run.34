import { Entity } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * RunUser Entity (read-only subset for flash app)
 * Reads user data created by run.human for device configuration.
 * Only includes attributes needed for /api/config endpoint.
 */
export const RunUser = new Entity(
  {
    model: {
      entity: "RunUser",
      version: "1",
      service: "run",
    },
    attributes: {
      userId: { type: "string", required: true },
      displayName: { type: "string" },
      mqttUsername: { type: "string" },
      mqttPassword: { type: "string" },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["userId"] },
        sk: { field: "sk", composite: [] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

/** Get a user by userId (returns null if not found) */
export async function getRunUser(userId: string) {
  const result = await RunUser.get({ userId }).go();
  return result.data;
}

/** Minimal type for flash app's RunUser needs */
export type RunUserItem = {
  userId: string;
  displayName?: string;
  mqttUsername?: string;
  mqttPassword?: string;
};
