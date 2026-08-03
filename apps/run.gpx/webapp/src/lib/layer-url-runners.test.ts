import { describe, it, expect } from "vitest";

/**
 * The `runners` token added to `?layers=` when the live runner pins stopped being
 * force-shown and became a real, addressable layer.
 *
 * Exercised from the webapp's vitest by relative path, like the studio's other pure
 * modules — see checkin-cluster.test.ts for why.
 */
import {
  parseLayerParam,
  resolveRunnersVisible,
} from "../../../gpx-studio/website/src/lib/stores/layer-url";
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
    // Parsing is literal: "routes" simply does not name runners. What that ABSENCE means
    // is decided by resolveRunnersVisible below, not here.
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

describe("resolveRunnersVisible", () => {
  // Regression guard for the 2026-08-03 bug: `?layers=routes` was read as "turn runners
  // off", which killed the pins on every existing routes link (all of run.human's map
  // CTAs use exactly that) and, because a hidden layer never polled, also removed the row
  // that would have let anyone turn them back on.
  it("leaves a stored ON alone when the link does not mention runners", () => {
    expect(resolveRunnersVisible(parseLayerParam("routes"), true)).toBe(true);
  });

  it("leaves a stored OFF alone when the link does not mention runners", () => {
    expect(resolveRunnersVisible(parseLayerParam("routes"), false)).toBe(false);
  });

  it("turns runners on when the link names them, overriding a stored OFF", () => {
    expect(resolveRunnersVisible(parseLayerParam("routes,runners"), false)).toBe(
      true,
    );
  });

  it("falls back to the stored value when there is no ?layers= at all", () => {
    expect(resolveRunnersVisible(null, true)).toBe(true);
    expect(resolveRunnersVisible(null, false)).toBe(false);
  });

  it("does not let an unrelated token turn runners off", () => {
    // parseLayerParam returns null for a value naming nothing known — must not read as OFF.
    expect(resolveRunnersVisible(parseLayerParam("nonsense"), true)).toBe(true);
    expect(resolveRunnersVisible(parseLayerParam("heat:dc34"), true)).toBe(true);
  });
});
