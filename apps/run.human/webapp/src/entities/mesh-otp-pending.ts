import { Entity, type EntityItem } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * MeshOtpPending — delivery queue for manual-add radio verification codes.
 *
 * run.human enqueues on radio add/resend; the meshtk ghosts poller
 * (internal/otpqueue) Queries the single constant partition, PKI-DMs the code
 * to the device from the "DEF CON 34 MeshMap" node, then deletes the item.
 *
 * Key strings are a LOCKED cross-language contract
 * (mesh-otp-pending-key-parity.test.ts ↔ meshtk otpqueue key_parity_test.go):
 *   pk = "$run#queue_otp"
 *   sk = "$meshotppending_1#nodeid_<nodeId>"   (nodeId already lowercase pad-8)
 *
 * The live table has DDB TTL DISABLED; the poller reaps items older than 24 h
 * and gives up after 10 failed publish attempts — nothing here lives forever.
 *
 * SERVER-ONLY data-layer module — never import into a client component.
 */
export const MeshOtpPending = new Entity(
  {
    model: { entity: "MeshOtpPending", version: "1", service: "run" },
    attributes: {
      // Constant partition discriminator — the only value is "otp".
      queue: { type: ["otp"] as const, required: true, default: "otp" },
      // Canonical "!hex" id, lowercase pad-8 (same invariant as MeshRadio L2).
      nodeId: { type: "string", required: true },
      nodeNum: { type: "number", required: true },
      // The 6-digit verification code to deliver. Mirrors (never replaces) the
      // authoritative MeshRadio.verificationCode at enqueue time.
      code: { type: "string", required: true },
      // 0x-hex X25519 pubkey when the user supplied one at add time.
      publicKey: { type: "string" },
      userId: { type: "string", required: true },
      // Failed-publish counter, bumped by the Go poller.
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

export type MeshOtpPendingItem = EntityItem<typeof MeshOtpPending>;

/**
 * Queue (or re-queue) delivery of the current verification code. Upsert by
 * nodeId: a resend simply overwrites the in-flight item so only the current
 * code is ever sent.
 */
export async function enqueueOtp(input: {
  nodeId: string;
  nodeNum: number;
  code: string;
  publicKey?: string;
  userId: string;
}): Promise<void> {
  await MeshOtpPending.upsert({
    queue: "otp",
    nodeId: input.nodeId,
    nodeNum: input.nodeNum,
    code: input.code,
    ...(input.publicKey ? { publicKey: input.publicKey } : {}),
    userId: input.userId,
    attempts: 0,
    createdAt: Date.now(),
  }).go();
}

/** Exact DynamoDB key for a queue item — exists for the parity test. */
export function meshOtpPendingKeyFor(nodeId: string): { pk: string; sk: string } {
  const key = MeshOtpPending.get({ queue: "otp", nodeId }).params().Key as {
    pk: string;
    sk: string;
  };
  return { pk: key.pk, sk: key.sk };
}
