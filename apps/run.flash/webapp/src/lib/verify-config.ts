/**
 * Post-commit MQTT config read-back verification.
 *
 * The orphaned-cred failure mode (AgentX, 2026-07-21): a config push stages but
 * never commits, the radio keeps creds from an earlier provisioning, and the
 * broker AUTH_REJECTs a username that matches no RunUser. setModuleConfig()
 * resolving only proves the admin packet was ACKed into staging — this module
 * reads the MQTT module config back after commit and compares what the device
 * actually holds.
 *
 * Kept OUT of lib/meshtastic.ts (a "use client" module that imports the
 * web-serial transport) so this stays pure + unit-testable in Node.
 */
import { Protobuf } from "@meshtastic/core";

/** Fields we assert on the device after commit. */
export interface MqttVerifyExpectation {
  username: string;
  address: string;
  root: string;
  enabled: boolean;
}

/** Structural subset of ModuleConfig_MQTTConfig we compare. */
export interface MqttModuleConfigLike {
  enabled?: boolean;
  address?: string;
  username?: string;
  root?: string;
}

/** Structural subset of a ModuleConfig packet. */
export interface ModuleConfigPacketLike {
  payloadVariant: { case: string | undefined; value: unknown };
}

/** Structural subset of MeshDevice needed for the read-back (fakeable in tests). */
export interface MqttReadbackDevice {
  events: {
    onModuleConfigPacket: {
      subscribe(cb: (pkt: ModuleConfigPacketLike) => void): () => void;
    };
  };
  getModuleConfig(moduleConfigType: number): Promise<number>;
}

export type MqttVerifyResult =
  | { status: "verified" }
  | { status: "mismatch"; mismatches: string[] }
  | { status: "inconclusive" };

/**
 * Compare the pushed MQTT expectation against what the device reports.
 * Returns one human-readable line per differing field; empty = match.
 *
 * The password is deliberately NOT compared: username+password are minted as a
 * deterministic pair on the RunUser, so a stale cred always shows as a username
 * mismatch — and skipping the secret keeps this safe if firmware ever redacts
 * secrets in config read-backs.
 */
export function compareMqttConfig(
  expected: MqttVerifyExpectation,
  actual: MqttModuleConfigLike
): string[] {
  const mismatches: string[] = [];
  if ((actual.username ?? "") !== expected.username) {
    mismatches.push(
      `username: device has "${actual.username ?? ""}", expected "${expected.username}"`
    );
  }
  if ((actual.address ?? "") !== expected.address) {
    mismatches.push(
      `address: device has "${actual.address ?? ""}", expected "${expected.address}"`
    );
  }
  if ((actual.root ?? "") !== expected.root) {
    mismatches.push(
      `root topic: device has "${actual.root ?? ""}", expected "${expected.root}"`
    );
  }
  if ((actual.enabled ?? false) !== expected.enabled) {
    mismatches.push(
      `enabled: device has ${actual.enabled ?? false}, expected ${expected.enabled}`
    );
  }
  return mismatches;
}

/**
 * Read the device's MQTT module config back and compare it to what we pushed.
 *
 * Mirrors verifyRegion(): subscribe to onModuleConfigPacket, actively request
 * MQTT_CONFIG, and wait for the reply. Best-effort — a timeout or a failed
 * request resolves "inconclusive" (callers warn but never block on an unread
 * value). Only a positively read, non-matching config resolves "mismatch".
 */
export function verifyMqttConfig(
  device: MqttReadbackDevice,
  expected: MqttVerifyExpectation,
  timeoutMs = 10000
): Promise<MqttVerifyResult> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (result: MqttVerifyResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      unsub();
      resolve(result);
    };

    const timeout = setTimeout(() => finish({ status: "inconclusive" }), timeoutMs);

    const unsub = device.events.onModuleConfigPacket.subscribe((pkt) => {
      if (pkt.payloadVariant.case !== "mqtt") return;
      const actual = pkt.payloadVariant.value as MqttModuleConfigLike;
      const mismatches = compareMqttConfig(expected, actual);
      finish(
        mismatches.length === 0
          ? { status: "verified" }
          : { status: "mismatch", mismatches }
      );
    });

    device
      .getModuleConfig(Protobuf.Admin.AdminMessage_ModuleConfigType.MQTT_CONFIG)
      .catch(() => finish({ status: "inconclusive" }));
  });
}
