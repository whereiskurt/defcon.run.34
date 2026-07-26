import { Entity, type EntityItem } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * MeshWelcomePending — post-flash welcome DM queue. run.human's internal
 * radio-registration route enqueues one after every successful
 * flash+configure; the meshtk ghosts poller PKI-DMs `message` to the device
 * from "DEF CON 34 MeshMap" (immediate publish + proof-of-life re-flush),
 * then deletes the item.
 *
 * Shares the OTP queue's PHYSICAL partition (ElectroDB pk carries no entity
 * name — same service + same `queue` composite → same pk); the sk prefix is
 * what tells item kinds apart. LOCKED cross-language contract
 * (mesh-welcome-pending-key-parity.test.ts ↔ meshtk otpqueue):
 *   pk = "$run#queue_otp"
 *   sk = "$meshwelcomepending_1#nodeid_<nodeId>"
 *
 * SERVER-ONLY data-layer module — never import into a client component.
 */
export const MeshWelcomePending = new Entity(
  {
    model: { entity: "MeshWelcomePending", version: "1", service: "run" },
    attributes: {
      // Constant partition discriminator — shared with MeshOtpPending.
      queue: { type: ["otp"] as const, required: true, default: "otp" },
      nodeId: { type: "string", required: true },
      nodeNum: { type: "number", required: true },
      // The rendered welcome text the poller sends verbatim.
      message: { type: "string", required: true },
      userId: { type: "string", required: true },
      attempts: { type: "number", default: 0 },
      createdAt: { type: "number", default: () => Date.now() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["queue"] },
        sk: { field: "sk", composite: ["nodeId"] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

export type MeshWelcomePendingItem = EntityItem<typeof MeshWelcomePending>;

/** Queue (or re-queue — upsert by nodeId) a welcome DM for a just-registered
 *  radio. A re-flash simply overwrites any in-flight welcome. */
export async function enqueueWelcome(input: {
  nodeId: string;
  nodeNum: number;
  message: string;
  userId: string;
}): Promise<void> {
  await MeshWelcomePending.upsert({
    queue: "otp",
    nodeId: input.nodeId,
    nodeNum: input.nodeNum,
    message: input.message,
    userId: input.userId,
    attempts: 0,
    createdAt: Date.now(),
  }).go();
}

/** Exact DynamoDB key for a welcome item — exists for the parity test. */
export function meshWelcomePendingKeyFor(nodeId: string): { pk: string; sk: string } {
  const key = MeshWelcomePending.get({ queue: "otp", nodeId }).params().Key as {
    pk: string;
    sk: string;
  };
  return { pk: key.pk, sk: key.sk };
}
