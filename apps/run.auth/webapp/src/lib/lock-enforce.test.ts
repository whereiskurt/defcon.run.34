import { describe, it, expect } from "vitest";
import { isLockedOut } from "./lock-enforce";

describe("isLockedOut", () => {
  it("is true only when the profile explicitly has lockedOut === true", () => {
    expect(isLockedOut({ lockedOut: true })).toBe(true);
  });

  it("is false for an unlocked, missing, or absent-flag profile (fail-open)", () => {
    expect(isLockedOut({ lockedOut: false })).toBe(false);
    expect(isLockedOut({})).toBe(false);        // brand-new / no flag
    expect(isLockedOut(null)).toBe(false);       // no profile row
    expect(isLockedOut(undefined)).toBe(false);  // lookup failed
  });
});
