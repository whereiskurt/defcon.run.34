import { describe, it, expect } from "vitest";
import { Qrstat, ELECTRO_TABLE } from "../lib/entities.mjs";

describe("Qrstat entity", () => {
  it("targets the shared electro table", () => {
    const params = Qrstat.put({ code: "BUNNY", bucket: "total", count: 0 }).params();
    expect(params.TableName).toBe(ELECTRO_TABLE);
  });

  it("encodes pk from code and sk from bucket (service run / entity Qrstat / v1)", () => {
    const params = Qrstat.put({ code: "BUNNY", bucket: "total", count: 0 }).params();
    expect(params.Item.pk).toBe("$run#code_bunny");
    expect(params.Item.sk).toBe("$qrstat_1#bucket_total");
    expect(params.Item.__edb_e__).toBe("Qrstat");
    expect(params.Item.__edb_v__).toBe("1");
  });

  it("supports the atomic add/set upsert shape used by the rollup", () => {
    const params = Qrstat.update({ code: "BUNNY", bucket: "day#2026-07-12" })
      .add({ count: 3 })
      .set({ lastSeen: "2026-07-12T12:00:00.000Z" })
      .params();
    expect(params.Key.pk).toBe("$run#code_bunny");
    expect(params.Key.sk).toBe("$qrstat_1#bucket_day#2026-07-12");
  });
});
