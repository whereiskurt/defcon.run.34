import { describe, it, expect } from "vitest";
import { normalizeCodeKey } from "./qr-code-normalize";

describe("normalizeCodeKey", () => {
  it("lowercases and trims like the stored ElectroDB pk", () => {
    expect(normalizeCodeKey("  Rick ")).toBe("rick");
    expect(normalizeCodeKey("DONATE")).toBe("donate");
  });

  it("passes percent-encoded / emoji codes through WITHOUT throwing", () => {
    // Rows created outside upsertQr (e.g. the ☎ CTF codes, stored as their
    // lowercase percent-encoded form) must be loadable + deletable from the
    // admin. The strict CODE_RE guard is write-only; reads must not throw.
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
