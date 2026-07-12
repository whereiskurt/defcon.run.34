import { describe, it, expect } from "vitest";
import {
  autoDefaultName,
  isDisplayNameLocked,
  normalizeSyncedName,
} from "@/lib/rabbit-name-sync";

describe("autoDefaultName", () => {
  it("mirrors upsertRunUser: rabbit_ + first 4 chars of the adapter id", () => {
    expect(autoDefaultName("abcd1234-5678")).toBe("rabbit_abcd");
  });
});

describe("normalizeSyncedName", () => {
  it("returns null for empty / whitespace / 1-2 chars", () => {
    expect(normalizeSyncedName("")).toBeNull();
    expect(normalizeSyncedName("   ")).toBeNull();
    expect(normalizeSyncedName("ab")).toBeNull();
    expect(normalizeSyncedName("  x ")).toBeNull();
  });
  it("trims and passes 3-20 char names verbatim", () => {
    expect(normalizeSyncedName("  OGRE ")).toBe("OGRE");
    expect(normalizeSyncedName("12345678901234567890")).toBe(
      "12345678901234567890"
    );
  });
  it("truncates > 20 chars to the first 20 (after trim)", () => {
    expect(normalizeSyncedName("abcdefghijklmnopqrstuvwx")).toBe(
      "abcdefghijklmnopqrst"
    );
  });
});

describe("isDisplayNameLocked", () => {
  const uid = "abcd1234";
  it("locked when the manual flag is explicitly true", () => {
    expect(isDisplayNameLocked("anything", true, uid)).toBe(true);
  });
  it("unlocked when the manual flag is explicitly false", () => {
    expect(isDisplayNameLocked("PrevBibName", false, uid)).toBe(false);
  });
  it("flag absent + still the exact auto-default => unlocked", () => {
    expect(isDisplayNameLocked("rabbit_abcd", undefined, uid)).toBe(false);
  });
  it("flag absent + name differs from the auto-default => locked", () => {
    expect(isDisplayNameLocked("KPH", undefined, uid)).toBe(true);
  });
  it("flag absent + undefined current name => unlocked (treat as default)", () => {
    // A user with no displayName at all was never manually claimed.
    expect(isDisplayNameLocked(undefined, undefined, uid)).toBe(false);
  });
});
