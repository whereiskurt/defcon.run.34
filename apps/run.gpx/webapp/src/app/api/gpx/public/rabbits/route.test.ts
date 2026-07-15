import { describe, it, expect, vi, afterEach } from "vitest";

const real = { longName: "elkentaro-09", shortName: "J09", latitude: 356303231, longitude: 1397374428 };

afterEach(() => vi.restoreAllMocks());

function stubFetch(nodes: any, mapBody: any, mapOk = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("mesh-map")) {
        return { ok: mapOk, json: async () => mapBody };
      }
      return { ok: true, json: async () => nodes };
    })
  );
}

describe("rabbit proxy", () => {
  it("emits only intersected opted-in rabbits", async () => {
    stubFetch(
      { "2503245760": real },
      { entries: [{ nodeNum: 2503245760, displayName: "rabbit_9f2a", pinIcon: "star", pinColor: "#00d4aa" }] }
    );
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body.features).toHaveLength(1);
    expect(body.features[0].properties.displayName).toBe("rabbit_9f2a");
  });
  it("fails soft when the internal feed errors", async () => {
    stubFetch({ "2503245760": real }, { entries: [] }, false);
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body).toEqual({ type: "FeatureCollection", features: [] });
  });
});
