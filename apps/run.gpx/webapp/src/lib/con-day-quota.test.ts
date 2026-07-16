import { describe, it, expect } from "vitest";
import {
  PER_CON_DAY_LIMIT,
  conDayLimit,
  conDayRemaining,
  isConDayCapped,
} from "./con-day-quota";

describe("conDayLimit", () => {
  it("is 10 for upload, 0 for zero, effectively unlimited for admin", () => {
    expect(PER_CON_DAY_LIMIT).toBe(10);
    expect(conDayLimit("upload")).toBe(10);
    expect(conDayLimit("zero")).toBe(0);
    expect(conDayLimit("admin")).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("conDayRemaining", () => {
  it("counts down and floors at 0 for the upload tier", () => {
    expect(conDayRemaining(0, "upload")).toBe(10);
    expect(conDayRemaining(2, "upload")).toBe(8);
    expect(conDayRemaining(10, "upload")).toBe(0);
    expect(conDayRemaining(11, "upload")).toBe(0); // never negative
  });
  it("treats a negative count as 0 used", () => {
    expect(conDayRemaining(-5, "upload")).toBe(10);
  });
  it("stays effectively unlimited for admin", () => {
    expect(conDayRemaining(500, "admin")).toBeGreaterThan(1000);
  });
});

describe("isConDayCapped", () => {
  it("caps the upload tier at the limit", () => {
    expect(isConDayCapped(9, "upload")).toBe(false);
    expect(isConDayCapped(10, "upload")).toBe(true);
    expect(isConDayCapped(99, "upload")).toBe(true);
  });
  it("caps the zero tier immediately", () => {
    expect(isConDayCapped(0, "zero")).toBe(true);
  });
  it("never caps admin", () => {
    expect(isConDayCapped(10_000, "admin")).toBe(false);
  });
});
