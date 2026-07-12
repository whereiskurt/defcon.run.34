import { describe, it, expect } from "vitest";
import { pickEcLevel } from "../render";

describe("pickEcLevel", () => {
  it("prefers H for short URLs", () => {
    expect(pickEcLevel("https://q.defcon.run/CTF", false)).toBe("H");
  });

  it("floors at Q when a logo is present", () => {
    // Lowercase forces byte mode (uppercase runs get alphanumeric segments).
    // 1721 bytes: over Q's 1663-byte cap, inside M's 2331 — so the no-logo
    // ladder degrades to M, and the logo ladder (floored at Q) must throw.
    const long = "https://q.defcon.run/" + "a".repeat(1700);
    const noLogo = pickEcLevel(long, false);
    expect(["M", "L"]).toContain(noLogo);
    expect(() => pickEcLevel(long, true)).toThrow(/too long/i);
  });

  it("throws when the URL exceeds even level L", () => {
    // 4021 bytes: beyond L's 2953-byte version-40 cap.
    const monster = "https://q.defcon.run/" + "a".repeat(4000);
    expect(() => pickEcLevel(monster, false)).toThrow(/too long/i);
  });
});
