import { describe, it, expect } from "vitest";
import { isGpxAdmin, GPX_ADMIN_GROUPS } from "./gpx-admin";

describe("isGpxAdmin", () => {
  it("admits admin", () => {
    expect(isGpxAdmin(["gpxstudio", "admin"])).toBe(true);
  });

  it("admits runadmin — the group run.auth and run.bib already honour", () => {
    expect(isGpxAdmin(["gpxstudio", "runadmin"])).toBe(true);
  });

  it("rejects an ordinary runner", () => {
    expect(isGpxAdmin(["gpxstudio"])).toBe(false);
    expect(isGpxAdmin(["run", "strava"])).toBe(false);
  });

  it("rejects empty and undefined rather than throwing", () => {
    expect(isGpxAdmin([])).toBe(false);
    expect(isGpxAdmin(undefined)).toBe(false);
  });

  it("does not admit a lookalike group", () => {
    expect(isGpxAdmin(["administrator"])).toBe(false);
    expect(isGpxAdmin(["run-admin"])).toBe(false);
  });

  it("stays in step with run.auth's ADMIN_GROUPS", () => {
    expect([...GPX_ADMIN_GROUPS]).toEqual(["admin", "runadmin"]);
  });
});
