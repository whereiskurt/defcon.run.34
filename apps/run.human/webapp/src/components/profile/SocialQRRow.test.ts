import { describe, it, expect } from "vitest";
import { buildTiles } from "./buildTiles";

/**
 * Unit tests for buildTiles — the pure tile-selection logic behind SocialQRRow.
 * Proves presence/kind/order without the async QR encode or the DOM:
 *   - a tile appears ONLY when its URL/QR is a non-empty string
 *   - Strava/Signal are 'link' tiles, Runner is an 'image' tile (eqr, display-only)
 *   - order is always Strava, Signal, Runner
 */
describe("buildTiles", () => {
  it("returns all three tiles in order when every source is present", () => {
    const tiles = buildTiles({
      stravaUrl: "https://strava.com/clubs/dc34",
      signalUrl: "https://signal.group/#abc",
      runnerQr: "data:image/png;base64,RUNNER",
    });
    expect(tiles).toEqual([
      { kind: "link", label: "Strava", url: "https://strava.com/clubs/dc34" },
      { kind: "link", label: "Signal", url: "https://signal.group/#abc" },
      { kind: "image", label: "Runner", src: "data:image/png;base64,RUNNER" },
    ]);
  });

  it("omits the Strava tile when stravaUrl is empty or undefined", () => {
    expect(buildTiles({ stravaUrl: "", signalUrl: "s", runnerQr: "r" }).map((t) => t.label))
      .toEqual(["Signal", "Runner"]);
    expect(buildTiles({ signalUrl: "s", runnerQr: "r" }).map((t) => t.label))
      .toEqual(["Signal", "Runner"]);
  });

  it("omits the Signal tile when signalUrl is empty or undefined", () => {
    expect(buildTiles({ stravaUrl: "s", signalUrl: "", runnerQr: "r" }).map((t) => t.label))
      .toEqual(["Strava", "Runner"]);
  });

  it("omits the Runner tile when runnerQr is empty or undefined", () => {
    expect(buildTiles({ stravaUrl: "s", signalUrl: "g" }).map((t) => t.label))
      .toEqual(["Strava", "Signal"]);
  });

  it("returns an empty array when nothing is present", () => {
    expect(buildTiles({})).toEqual([]);
    expect(buildTiles({ stravaUrl: "", signalUrl: "", runnerQr: "" })).toEqual([]);
  });

  it("treats whitespace-only strings as absent", () => {
    expect(buildTiles({ stravaUrl: "   ", signalUrl: "g", runnerQr: "" }).map((t) => t.label))
      .toEqual(["Signal"]);
  });

  it("only Runner present → single display-only image tile", () => {
    expect(buildTiles({ runnerQr: "data:xyz" })).toEqual([
      { kind: "image", label: "Runner", src: "data:xyz" },
    ]);
  });
});
