import { describe, it, expect } from "vitest";
import { sanitizeRadio, type MeshtasticRadio } from "./run-user";

describe("sanitizeRadio showOnMap", () => {
  it("defaults showOnMap to false when absent", () => {
    const r = sanitizeRadio({ id: "a", nodeId: "!ff", verified: true } as MeshtasticRadio);
    expect(r.showOnMap).toBe(false);
  });
  it("preserves an explicit showOnMap", () => {
    const r = sanitizeRadio({ id: "a", nodeId: "!ff", verified: true, showOnMap: true } as MeshtasticRadio);
    expect(r.showOnMap).toBe(true);
  });
});
