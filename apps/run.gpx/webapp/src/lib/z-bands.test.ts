import { describe, it, expect } from "vitest";

/**
 * Tests for the studio's map layer z-order bands.
 *
 * Same arrangement as checkin-cluster.test.ts: the module lives in gpx-studio (where the
 * map uses it) but the studio has no test runner, so it is exercised from the webapp's
 * vitest by relative path.
 *
 * The point of these tests is the ORDERING INVARIANT, which is the thing that actually
 * broke in production: markers must end up above routes no matter which feed resolves
 * first. A fake map recording stack order proves that without needing mapbox-gl or a DOM.
 */
import {
  BANDS,
  bandAnchor,
  installBands,
  addInBand,
  moveToBand,
} from "../../../gpx-studio/website/src/lib/components/map/z-bands";

/** Minimal mapbox-gl stand-in that records stack order the way the real one does. */
function fakeMap() {
  const layers: string[] = [];
  const sources = new Set<string>();
  return {
    layers,
    getSource: (id: string) => (sources.has(id) ? {} : undefined),
    addSource: (id: string) => {
      sources.add(id);
    },
    getLayer: (id: string) => (layers.includes(id) ? { id } : undefined),
    addLayer: (spec: { id: string }, before?: string) => {
      const at = before ? layers.indexOf(before) : -1;
      if (at === -1) layers.push(spec.id);
      else layers.splice(at, 0, spec.id);
    },
    moveLayer: (id: string, before?: string) => {
      const cur = layers.indexOf(id);
      if (cur !== -1) layers.splice(cur, 1);
      const at = before ? layers.indexOf(before) : -1;
      if (at === -1) layers.push(id);
      else layers.splice(at, 0, id);
    },
  };
}

describe("z-bands", () => {
  it("declares bands bottom-to-top", () => {
    expect(BANDS).toEqual(["heat", "routes", "tracks", "markers", "tools"]);
  });

  it("installs one anchor per band, in order, idempotently", () => {
    const m = fakeMap();
    installBands(m as never);
    installBands(m as never);
    expect(m.layers).toEqual(BANDS.map(bandAnchor));
  });

  it("keeps markers above routes no matter which arrives first", () => {
    const m = fakeMap();
    installBands(m as never);
    // Markers first — the losing order under the old append-only behaviour.
    addInBand(m as never, { id: "ghosts" } as never, "markers");
    addInBand(m as never, { id: "route-a" } as never, "routes");
    expect(m.layers.indexOf("ghosts")).toBeGreaterThan(
      m.layers.indexOf("route-a"),
    );
  });

  it("keeps the whole band order regardless of arrival order", () => {
    const m = fakeMap();
    installBands(m as never);
    addInBand(m as never, { id: "tool" } as never, "tools");
    addInBand(m as never, { id: "heat" } as never, "heat");
    addInBand(m as never, { id: "marker" } as never, "markers");
    addInBand(m as never, { id: "route" } as never, "routes");
    addInBand(m as never, { id: "track" } as never, "tracks");
    const at = (id: string) => m.layers.indexOf(id);
    expect(at("heat")).toBeLessThan(at("route"));
    expect(at("route")).toBeLessThan(at("track"));
    expect(at("track")).toBeLessThan(at("marker"));
    expect(at("marker")).toBeLessThan(at("tool"));
  });

  it("honours an in-band beneath anchor", () => {
    const m = fakeMap();
    installBands(m as never);
    addInBand(m as never, { id: "heat-dc34" } as never, "heat");
    addInBand(m as never, { id: "heat-dc33" } as never, "heat", "heat-dc34");
    expect(m.layers.indexOf("heat-dc33")).toBeLessThan(
      m.layers.indexOf("heat-dc34"),
    );
  });

  it("ignores a beneath anchor that does not exist yet", () => {
    const m = fakeMap();
    installBands(m as never);
    addInBand(m as never, { id: "arrows" } as never, "tracks", "distance-markers");
    expect(m.layers).toContain("arrows");
    expect(m.layers.indexOf("arrows")).toBeLessThan(
      m.layers.indexOf(bandAnchor("tracks")),
    );
  });

  it("moveToBand re-seats a layer inside its band instead of the top", () => {
    const m = fakeMap();
    installBands(m as never);
    addInBand(m as never, { id: "track" } as never, "tracks");
    addInBand(m as never, { id: "ghosts" } as never, "markers");
    // This is GPXLayer.moveToFront()'s job — it must NOT jump the markers.
    moveToBand(m as never, "track", "tracks");
    expect(m.layers.indexOf("track")).toBeLessThan(m.layers.indexOf("ghosts"));
  });

  it("moveToBand is a no-op for a layer that is not on the map", () => {
    const m = fakeMap();
    installBands(m as never);
    const before = [...m.layers];
    moveToBand(m as never, "nope", "tracks");
    expect(m.layers).toEqual(before);
  });

  it("self-installs when a caller skipped installBands", () => {
    const m = fakeMap();
    addInBand(m as never, { id: "ghosts" } as never, "markers");
    expect(m.layers).toContain(bandAnchor("heat"));
    expect(m.layers.indexOf("ghosts")).toBeLessThan(
      m.layers.indexOf(bandAnchor("markers")),
    );
  });
});
