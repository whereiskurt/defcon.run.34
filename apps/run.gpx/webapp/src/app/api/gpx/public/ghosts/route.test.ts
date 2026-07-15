import { describe, it, expect, vi, afterEach } from "vitest";

const ghost = {
  longName: "ghost-condor-00", shortName: "GC00",
  latitude: 360817149, longitude: -1151727650, privkey: "0xSECRET",
};

afterEach(() => vi.restoreAllMocks());

describe("ghost proxy", () => {
  it("returns a ghost FeatureCollection from the feed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, json: async () => ({ "1": ghost }),
    })));
    const { GET } = await import("./route");
    const res = await GET();
    const body = await res.json();
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/SECRET/);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=60");
  });
  it("fails soft to an empty collection on upstream error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body).toEqual({ type: "FeatureCollection", features: [] });
  });
});
