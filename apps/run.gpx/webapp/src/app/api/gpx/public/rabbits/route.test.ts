import { describe, it, expect, vi, afterEach } from "vitest";

const real = { longName: "elkentaro-09", shortName: "J09", latitude: 356303231, longitude: 1397374428 };
const sim = {
  longName: "rabbit-sim-swift-00", shortName: "R00",
  latitude: 360817149, longitude: -1151727650, hwModel: "TRACKER_T1000_E", batteryLevel: 71,
};

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
  it("includes sim rabbits alongside real ones", async () => {
    stubFetch(
      { "2503245760": real, "111": sim },
      { entries: [{ nodeNum: 2503245760, displayName: "rabbit_9f2a", pinColor: "#00d4aa" }] }
    );
    const { GET } = await import("./route");
    const names = (await (await GET()).json()).features.map((f: any) => f.properties.displayName);
    expect(names).toContain("rabbit_9f2a"); // real
    expect(names).toContain("rabbit_4a1c"); // sim swift
  });

  it("still returns sim rabbits when the internal mesh-map feed errors", async () => {
    stubFetch({ "111": sim }, { entries: [] }, false); // mapOk=false
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body.features.map((f: any) => f.properties.displayName)).toEqual(["rabbit_4a1c"]);
  });

  it("still returns sim rabbits when the mesh-map body is 200 but fails to parse as JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("mesh-map")) {
          return {
            ok: true,
            json: async () => {
              throw new SyntaxError("bad json");
            },
          };
        }
        return { ok: true, json: async () => ({ "111": sim }) };
      })
    );
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body.features.map((f: any) => f.properties.displayName)).toEqual(["rabbit_4a1c"]);
  });

  it("fails soft to empty when the nodes feed itself errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("mesh-map")
        ? { ok: true, json: async () => ({ entries: [] }) }
        : { ok: false, json: async () => ({}) }
    ));
    const { GET } = await import("./route");
    expect(await (await GET()).json()).toEqual({ type: "FeatureCollection", features: [] });
  });
});
