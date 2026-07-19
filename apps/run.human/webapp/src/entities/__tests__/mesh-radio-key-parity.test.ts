import { describe, it, expect } from "vitest";

import { MeshRadio, meshRadioKeyFor } from "../mesh-radio";

/**
 * pk/sk PARITY LOCK — the biggest landmine of Phase 66 (RESEARCH L1).
 *
 * meshtk (Go, plan 66-07) resolves a sender's authoritative pubkey with a direct
 * DynamoDB `GetItem`, composing the key BY HAND from a uint32 nodeNum:
 *
 *   pk = "$run#nodeid_" + fmt.Sprintf("!%08x", nodeNum)   e.g. "$run#nodeid_!433d1cec"
 *   sk = "$meshradio_1"                                    (== "$<entity>_<version>")
 *
 * and lists per user via the byUser GSI:
 *
 *   gsi1pk = "$run#userid_" + userId                       e.g. "$run#userid_user-abc"
 *
 * These EXACT literal strings are the cross-language CONTRACT. If ElectroDB here
 * and the hand-rolled Go key drift by even one byte (entity/version/service
 * rename, composite-key change), every meshtk decrypt 404s silently. This test
 * locks the run.human side; the Go side asserts the same strings in plan 66-07.
 *
 * .params({ table }) encodes offline — no network I/O.
 */
const table = "run-human-electro";

describe("MeshRadio primary key parity", () => {
  it("encodes the exact GetItem Key meshtk composes by hand", () => {
    const key = MeshRadio.get({ nodeId: "!433d1cec" }).params({ table }).Key;
    expect(key).toEqual({ pk: "$run#nodeid_!433d1cec", sk: "$meshradio_1" });
  });
});

describe("meshRadioKeyFor helper parity", () => {
  it("is the single programmatic source of the parity-locked key", () => {
    expect(meshRadioKeyFor("!433d1cec")).toEqual({
      pk: "$run#nodeid_!433d1cec",
      sk: "$meshradio_1",
    });
  });
});

describe("MeshRadio byUser GSI parity", () => {
  it("encodes the byUser query on gsi1 the readers expect", () => {
    const params = MeshRadio.query
      .byUser({ userId: "user-abc" })
      .params({ table });
    expect(params.IndexName).toBe("gsi1pk-gsi1sk-index");
    expect(params.ExpressionAttributeValues[":pk"]).toBe("$run#userid_user-abc");
  });
});

describe("MeshRadio put key parity", () => {
  it("puts a full-state radio without moving the parity-locked key", () => {
    const params = MeshRadio.put({
      nodeId: "!433d1cec",
      nodeNum: 1128733676,
      userId: "user-abc",
      publicKey: "0x" + "a".repeat(64),
      source: "flash",
    }).params({ table });
    expect(params.Item.pk).toBe("$run#nodeid_!433d1cec");
    expect(params.Item.sk).toBe("$meshradio_1");
    // byUser GSI attributes ride along on the same item. The GSI partition is
    // the plain "$run#userid_<id>" contract meshtk queries; the GSI sort key
    // carries ElectroDB's entity marker prefix ("$<entity>_<version>#...") —
    // locked here so the composed format is documented, not guessed.
    expect(params.Item.gsi1pk).toBe("$run#userid_user-abc");
    expect(params.Item.gsi1sk).toBe("$meshradio_1#nodeid_!433d1cec");
  });
});
