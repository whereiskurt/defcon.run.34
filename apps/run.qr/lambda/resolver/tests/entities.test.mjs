/**
 * Entity encoding tests — pure, no network.
 *
 * ElectroDB derives PK/SK strings from service ("run") + entity + version + the
 * composite key attributes. These tests LOCK IN the exact encoded strings so a
 * future schema tweak (rename entity, bump version, change composite order)
 * fails loudly instead of silently repointing the shared `run-human-electro`
 * rows. Strings below were captured from `.params()` output, not hand-written.
 */
import { describe, it, expect } from "vitest";
import { Qr, Ctf, Qrstat, ELECTRO_TABLE } from "../lib/entities.mjs";

describe("Qr entity encoding", () => {
  it("encodes the primary PK/SK for a code (get)", () => {
    const key = Qr.get({ code: "BUNNY" }).params().Key;
    expect(key).toEqual({ pk: "$run#code_bunny", sk: "$qr_1" });
  });

  it("encodes the same PK/SK on put, with defaults applied", () => {
    const item = Qr.put({
      code: "BUNNY",
      destination: "https://run.defcon.run",
      owner: "kurt",
    }).params().Item;
    expect(item.pk).toBe("$run#code_bunny");
    expect(item.sk).toBe("$qr_1");
    // defaults
    expect(item.type).toBe("redirect");
    expect(item.enabled).toBe(true);
    // GSI byOwner projection is written on put
    expect(item.gsi1pk).toBe("$run#owner_kurt");
    expect(item.gsi1sk).toMatch(/^\$qr_1#updatedat_/);
  });

  it("byOwner queries the gsi1 index with the owner PK", () => {
    const params = Qr.query.byOwner({ owner: "kurt" }).params();
    expect(params.IndexName).toBe("gsi1pk-gsi1sk-index");
    expect(params.ExpressionAttributeValues[":pk"]).toBe("$run#owner_kurt");
    expect(params.TableName).toBe(ELECTRO_TABLE);
  });

  it("accepts a loose rules list of mixed time/param kinds", () => {
    const item = Qr.put({
      code: "MIX",
      destination: "https://run.defcon.run",
      rules: [
        { kind: "time", from: "2026-01-01", to: "2026-12-31", dest: "https://a" },
        { kind: "param", match: "42", dest: "https://b" },
        { kind: "param", match: "*", dest: "https://c" },
      ],
      enrich: {
        preserveQuery: true,
        appendParam: true,
        utm: { source: "qr", medium: "print", campaign: "dc34" },
      },
    }).params().Item;
    expect(item.rules).toHaveLength(3);
    expect(item.enrich.utm.campaign).toBe("dc34");
  });
});

describe("Ctf entity encoding", () => {
  it("encodes the primary PK/SK for a challenge (get)", () => {
    const key = Ctf.get({ challenge: "sao" }).params().Key;
    expect(key).toEqual({ pk: "$run#challenge_sao", sk: "$ctf_1" });
  });

  it("stores a permissive effect map", () => {
    const item = Ctf.put({
      challenge: "sao",
      answer: "itsthebib",
      points: 100,
      effect: { kind: "confetti", intensity: 11 },
      maxAttempts: 5,
      rateLimitWindow: 60,
    }).params().Item;
    expect(item.pk).toBe("$run#challenge_sao");
    expect(item.sk).toBe("$ctf_1");
    expect(item.effect).toEqual({ kind: "confetti", intensity: 11 });
    expect(item.enabled).toBe(true);
  });
});

describe("Qrstat entity encoding", () => {
  it("encodes code PK + bucket SK for a counter row (get)", () => {
    const key = Qrstat.get({ code: "BUNNY", bucket: "total" }).params().Key;
    expect(key).toEqual({
      pk: "$run#code_bunny",
      sk: "$qrstat_1#bucket_total",
    });
  });

  it("encodes the reserved _meta/watermark row", () => {
    const key = Qrstat.get({ code: "_meta", bucket: "watermark" }).params().Key;
    expect(key).toEqual({
      pk: "$run#code__meta",
      sk: "$qrstat_1#bucket_watermark",
    });
  });

  it("applies the count default of 0 on put", () => {
    const item = Qrstat.put({ code: "BUNNY", bucket: "day#2026-07-12" })
      .params().Item;
    expect(item.count).toBe(0);
    expect(item.sk).toBe("$qrstat_1#bucket_day#2026-07-12");
  });

  it("supports the add/set upsert the rollup issues", () => {
    const params = Qrstat.update({ code: "BUNNY", bucket: "total" })
      .add({ count: 3 })
      .set({ lastSeen: "2026-07-12T04:00:00.000Z" })
      .params();
    expect(params.Key).toEqual({
      pk: "$run#code_bunny",
      sk: "$qrstat_1#bucket_total",
    });
    expect(params.TableName).toBe(ELECTRO_TABLE);
  });
});
