import { describe, it, expect } from "vitest";
import { isShareState, deriveShareState, canGoPublic } from "./share-state";

describe("isShareState", () => {
  it("accepts exactly the three states", () => {
    expect(isShareState("private")).toBe(true);
    expect(isShareState("link")).toBe(true);
    expect(isShareState("public")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isShareState("published")).toBe(false);
    expect(isShareState("")).toBe(false);
    expect(isShareState(undefined)).toBe(false);
    expect(isShareState(3)).toBe(false);
  });
});

describe("deriveShareState", () => {
  it("is public when a published route is linked — public outranks a link", () => {
    expect(
      deriveShareState({ publishedRouteId: "r1", hasActiveLink: true })
    ).toBe("public");
  });

  it("is link when a token exists and nothing is published", () => {
    expect(deriveShareState({ hasActiveLink: true })).toBe("link");
  });

  it("is private with neither", () => {
    expect(deriveShareState({ hasActiveLink: false })).toBe("private");
  });
});

describe("canGoPublic", () => {
  it("allows an active, eligible file", () => {
    expect(
      canGoPublic({
        status: "active",
        publicShareEligible: true,
        source: "upload",
      })
    ).toEqual({ ok: true });
  });

  it("treats a legacy file with no eligibility flag as eligible", () => {
    expect(canGoPublic({ status: "active" })).toEqual({ ok: true });
  });

  it("rejects a non-active file", () => {
    expect(canGoPublic({ status: "pending" })).toEqual({
      ok: false,
      reason: "inactive",
    });
  });

  it("flags a raw Strava import as needing conversion first", () => {
    expect(
      canGoPublic({
        status: "active",
        publicShareEligible: false,
        source: "strava",
      })
    ).toEqual({ ok: false, reason: "needs-conversion" });
  });

  it("reports inactive before conversion for a pending Strava import", () => {
    expect(
      canGoPublic({ status: "pending", publicShareEligible: false })
    ).toEqual({ ok: false, reason: "inactive" });
  });
});
