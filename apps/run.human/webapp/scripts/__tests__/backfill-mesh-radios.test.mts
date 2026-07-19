import { describe, it, expect } from "vitest";

import { toMeshRadioItem, type EmbeddedRadio } from "../backfill-mesh-radios.mjs";
import { MeshRadio, meshRadioKeyFor } from "../../src/entities/mesh-radio";

/**
 * Backfill transform + idempotency-parity tests (Phase 66, MRAD-03).
 *
 * The backfill runs in a bare `tsx` process where the ElectroDB entity is
 * unavailable (ESM-only @auth/dynamodb-adapter, L9), so `toMeshRadioItem`
 * HAND-COMPOSES the MeshRadio item. These tests are the L1 LOCK that keeps that
 * hand-composed item byte-identical to what the entity would write — if the two
 * ever drift (entity/version/service rename, composite-key change) every meshtk
 * GetItem 404s silently. vitest CAN import the entity (adapter loads under ESM),
 * so we assert `toMeshRadioItem(...)` equals `MeshRadio.put(...).params().Item`
 * field-for-field on the parity-defining attributes.
 *
 * Also locks the per-radio conversion: base64->0x hex (32-byte guard),
 * nodeId pad-8 canonicalization, nodeNum derivation, flag carry-over, and the
 * malformed/empty-key SKIP signal (the get-first idempotency short-circuit in the
 * script relies on the composed pk/sk matching the entity's, which these prove).
 */

const table = "run-human-electro";

// A deterministic 32-byte X25519-shaped key as base64 (bytes 0..31).
function base64Key32(): string {
  const bytes = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) bytes[i] = i;
  return bytes.toString("base64");
}

describe("toMeshRadioItem — conversion + canonicalization", () => {
  it("converts a 32-byte base64 pubkey and pads an unpadded nodeId", () => {
    const radio: EmbeddedRadio = {
      nodeId: "!abcdef", // unpadded (manual-add historically) → must become !00abcdef
      publicKey: base64Key32(),
      verified: true,
      verifiedAt: 1_700_000_000_000,
      verificationCode: "123456",
      verificationAttempts: 2,
      resendAttempts: 1,
      impersonate: true,
      showOnMap: true,
      createdAt: 1_699_000_000_000,
    };

    const item = toMeshRadioItem("user-abc", radio, 1_800_000_000_000);
    expect(item).not.toBeNull();
    if (!item) return;

    // nodeId pad-8 lowercase (L2) + uint32 nodeNum.
    expect(item.nodeId).toBe("!00abcdef");
    expect(item.nodeNum).toBe(0x00abcdef);

    // base64 -> "0x" + 64 lowercase hex chars (L3).
    expect(item.publicKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(item.publicKey).toBe(
      "0x" + Buffer.from(base64Key32(), "base64").toString("hex")
    );

    // Flags carried over verbatim.
    expect(item.userId).toBe("user-abc");
    expect(item.verified).toBe(true);
    expect(item.verifiedAt).toBe(1_700_000_000_000);
    expect(item.verificationCode).toBe("123456");
    expect(item.verificationAttempts).toBe(2);
    expect(item.resendAttempts).toBe(1);
    expect(item.impersonate).toBe(true);
    expect(item.showOnMap).toBe(true);
    expect(item.source).toBe("manual");

    // Original createdAt preserved; updatedAt = now.
    expect(item.createdAt).toBe(1_699_000_000_000);
    expect(item.updatedAt).toBe(1_800_000_000_000);
  });

  it("applies entity defaults when embedded flags are absent", () => {
    const item = toMeshRadioItem(
      "user-xyz",
      { nodeId: "!433d1cec", publicKey: base64Key32() },
      42
    );
    expect(item).not.toBeNull();
    if (!item) return;
    expect(item.verified).toBe(false);
    expect(item.verificationAttempts).toBe(0);
    expect(item.resendAttempts).toBe(0);
    expect(item.impersonate).toBe(false);
    expect(item.showOnMap).toBe(false);
    expect(item.createdAt).toBe(42); // no embedded createdAt → falls back to `now`
    // Absent optionals are omitted, not written as undefined.
    expect("privateKey" in item).toBe(false);
    expect("verificationCode" in item).toBe(false);
    expect("verifiedAt" in item).toBe(false);
  });
});

describe("toMeshRadioItem — malformed / empty key SKIP signal", () => {
  it("returns null for a non-32-byte (too short) key", () => {
    const short = Buffer.alloc(31).toString("base64");
    expect(toMeshRadioItem("user-abc", { nodeId: "!433d1cec", publicKey: short })).toBeNull();
  });

  it("returns null for a non-32-byte (too long) key", () => {
    const long = Buffer.alloc(33).toString("base64");
    expect(toMeshRadioItem("user-abc", { nodeId: "!433d1cec", publicKey: long })).toBeNull();
  });

  it("returns null when the pubkey is absent", () => {
    expect(toMeshRadioItem("user-abc", { nodeId: "!433d1cec" })).toBeNull();
  });

  it("returns null when the nodeId is absent", () => {
    expect(toMeshRadioItem("user-abc", { publicKey: base64Key32() })).toBeNull();
  });

  it("returns null when the userId is absent", () => {
    expect(toMeshRadioItem("", { nodeId: "!433d1cec", publicKey: base64Key32() })).toBeNull();
  });
});

describe("toMeshRadioItem — parity with the MeshRadio entity (L1 lock)", () => {
  it("hand-composed keys match ElectroDB's composed item field-for-field", () => {
    const nodeId = "!433d1cec";
    const userId = "user-abc";
    const publicKey = "0x" + Buffer.from(base64Key32(), "base64").toString("hex");

    const item = toMeshRadioItem(userId, { nodeId, publicKey: base64Key32() });
    expect(item).not.toBeNull();
    if (!item) return;

    // The entity is the source of truth for the composed key + internal markers.
    const entityItem = MeshRadio.put({
      nodeId,
      nodeNum: item.nodeNum,
      userId,
      publicKey,
      source: "manual",
    }).params({ table }).Item as Record<string, unknown>;

    for (const field of [
      "pk",
      "sk",
      "gsi1pk",
      "gsi1sk",
      "__edb_e__",
      "__edb_v__",
      "nodeId",
      "nodeNum",
      "userId",
      "publicKey",
    ] as const) {
      expect(
        (item as unknown as Record<string, unknown>)[field],
        `field ${field} must match the entity`
      ).toEqual(entityItem[field]);
    }

    // And the exact parity literals meshtk composes in Go (plan 66-07).
    expect(item.pk).toBe("$run#nodeid_!433d1cec");
    expect(item.sk).toBe("$meshradio_1");
    expect(item.gsi1pk).toBe("$run#userid_user-abc");
    expect(item.gsi1sk).toBe("$meshradio_1#nodeid_!433d1cec");
  });

  it("agrees with meshRadioKeyFor (the single programmatic key source)", () => {
    const item = toMeshRadioItem("user-abc", {
      nodeId: "!433d1cec",
      publicKey: base64Key32(),
    });
    expect(item).not.toBeNull();
    if (!item) return;
    expect({ pk: item.pk, sk: item.sk }).toEqual(meshRadioKeyFor("!433d1cec"));
  });
});
