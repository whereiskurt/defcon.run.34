import { describe, it, expect } from "vitest";
import { normalizeCodeKey, codeKeyCandidates } from "./qr-code-normalize";

describe("normalizeCodeKey", () => {
  it("lowercases and trims like the stored ElectroDB pk", () => {
    expect(normalizeCodeKey("  Rick ")).toBe("rick");
    expect(normalizeCodeKey("DONATE")).toBe("donate");
  });

  it("passes percent-encoded / emoji codes through WITHOUT throwing", () => {
    expect(() => normalizeCodeKey("%E2%98%8E")).not.toThrow();
    expect(normalizeCodeKey("%E2%98%8E")).toBe("%e2%98%8e");
    expect(() => normalizeCodeKey("☎")).not.toThrow();
    expect(normalizeCodeKey("☎")).toBe("☎");
  });

  it("is defensive against null/undefined", () => {
    expect(normalizeCodeKey(undefined as unknown as string)).toBe("");
    expect(normalizeCodeKey(null as unknown as string)).toBe("");
  });
});

describe("codeKeyCandidates", () => {
  it("returns a single candidate for normal codes", () => {
    expect(codeKeyCandidates("Rick")).toEqual(["rick"]);
    expect(codeKeyCandidates("donate")).toEqual(["donate"]);
  });

  it("adds the percent-DECODED form so admin can reach emoji-pk rows", () => {
    // The ☎ CTF rows: pk composed from the decoded emoji, attribute is the
    // percent string. The decoded candidate (☎ / ☎️) is what matches the pk.
    expect(codeKeyCandidates("%e2%98%8e%ef%b8%8f")).toEqual([
      "%e2%98%8e%ef%b8%8f",
      "☎️",
    ]);
    expect(codeKeyCandidates("%E2%98%8E")).toEqual(["%e2%98%8e", "☎"]);
  });

  it("does not throw and yields one candidate for malformed percent sequences", () => {
    expect(() => codeKeyCandidates("50%off")).not.toThrow();
    expect(codeKeyCandidates("50%off")).toEqual(["50%off"]);
  });
});
