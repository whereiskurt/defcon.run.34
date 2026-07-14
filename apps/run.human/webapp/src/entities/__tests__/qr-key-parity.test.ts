import { describe, it, expect } from "vitest";

import { Qr, Ctf, Qrstat } from "../qr";

/**
 * The q.defcon.run resolver READS Qr/Ctf and the rollup writes Qrstat on the
 * shared run-human-electro table. run.human's admin CRUD (src/entities/qr.ts) is
 * a TS mirror of those .mjs entities. If the two compose even slightly different
 * DynamoDB keys, the resolver reads the wrong row and every scan 404s forever.
 *
 * This locks the mirror to the EXACT encoded strings asserted by the resolver's
 * own test (apps/run.qr/lambda/resolver/tests/entities.test.mjs). Any drift in
 * entity/version/service or composite-key config fails here loudly.
 */
const table = "run-human-electro";

describe("Qr mirror key parity", () => {
  it("encodes the primary Key the resolver expects", () => {
    const key = Qr.get({ code: "BUNNY" }).params({ table }).Key;
    expect(key).toEqual({ pk: "$run#code_bunny", sk: "$qr_1" });
  });

  it("encodes the byOwner GSI the resolver expects", () => {
    const params = Qr.query.byOwner({ owner: "kurt" }).params({ table });
    expect(params.IndexName).toBe("gsi1pk-gsi1sk-index");
    expect(params.ExpressionAttributeValues[":pk"]).toBe("$run#owner_kurt");
  });
});

describe("Ctf mirror key parity", () => {
  it("encodes the primary Key the resolver expects", () => {
    const key = Ctf.get({ challenge: "sao" }).params({ table }).Key;
    expect(key).toEqual({ pk: "$run#challenge_sao", sk: "$ctf_1" });
  });

  it("accepts the Phase-44 scoring attributes without moving the key", () => {
    // The attribute extension (44-01) must not disturb the parity-locked key,
    // and the entity must accept the new scoring shape. .params() encodes
    // offline (no network I/O).
    const params = Ctf.put({
      challenge: "sao",
      answerHash: "sha256:deadbeef",
      pointMax: 500,
      pointFloor: 50,
      maxSolves: 100,
      firstBloodBonus: 100,
      solveCount: 0,
      timeTiers: [
        { from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z", ceiling: 750 },
      ],
    }).params({ table });
    expect(params.Item.pk).toBe("$run#challenge_sao");
    expect(params.Item.sk).toBe("$ctf_1");
    expect(params.Item.answerHash).toBe("sha256:deadbeef");
    expect(params.Item.timeTiers).toEqual([
      { from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z", ceiling: 750 },
    ]);
  });
});

describe("Qrstat mirror key parity", () => {
  it("encodes a counter row Key the rollup expects", () => {
    const key = Qrstat.get({ code: "BUNNY", bucket: "total" }).params({ table }).Key;
    expect(key).toEqual({ pk: "$run#code_bunny", sk: "$qrstat_1#bucket_total" });
  });

  it("encodes the reserved _meta/watermark row", () => {
    const key = Qrstat.get({ code: "_meta", bucket: "watermark" }).params({ table }).Key;
    expect(key).toEqual({
      pk: "$run#code__meta",
      sk: "$qrstat_1#bucket_watermark",
    });
  });
});
