import { describe, it, expect } from "vitest";

/**
 * The `runners` token added to `?layers=` when the live runner pins stopped being
 * force-shown and became a real, addressable layer.
 *
 * Exercised from the webapp's vitest by relative path, like the studio's other pure
 * modules — see checkin-cluster.test.ts for why.
 */
import { parseLayerParam } from "../../../gpx-studio/website/src/lib/stores/layer-url";
import { LAYER } from "../../../gpx-studio/website/src/lib/stores/layer-visibility";

describe("?layers= runners token", () => {
  it("parses runners as a literal key", () => {
    expect(parseLayerParam("runners")?.keys.has(LAYER.runners)).toBe(true);
  });

  it("parses alongside a folder alias", () => {
    const sel = parseLayerParam("routes,runners");
    expect(sel?.folders.has("DEF CON 34 Maps")).toBe(true);
    expect(sel?.keys.has(LAYER.runners)).toBe(true);
  });

  it("leaves runners unnamed when the param names only routes", () => {
    // This is the whole point of the contract being authoritative in BOTH directions:
    // a link that says "routes" turns runners OFF even for someone who had them on.
    expect(parseLayerParam("routes")?.keys.has(LAYER.runners)).toBe(false);
  });

  it("is case- and whitespace-insensitive like every other token", () => {
    expect(parseLayerParam(" RUNNERS ")?.keys.has(LAYER.runners)).toBe(true);
  });

  it("still returns null for a param naming nothing known", () => {
    expect(parseLayerParam("nonsense")).toBeNull();
  });

  it("does not disturb the existing literal tokens", () => {
    const sel = parseLayerParam("aggregate,checkins,heat:dc34,runners");
    expect(sel?.keys.has(LAYER.aggregate)).toBe(true);
    expect(sel?.keys.has(LAYER.checkins)).toBe(true);
    expect(sel?.keys.has(LAYER.heatDc34)).toBe(true);
    expect(sel?.keys.has(LAYER.runners)).toBe(true);
    expect(sel?.keys.has(LAYER.heatDc33)).toBe(false);
  });
});
