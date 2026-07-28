import { describe, it, expect } from "vitest";
import {
  ROUTE_TOTAL_CAP,
  ROUTE_PUBLISH_CAP,
  ROUTE_MAX_SIZE,
  COPY_FILE_SANITY_CAP,
  isRouteCapped,
  isPublishCapped,
} from "../route-caps";

describe("route caps", () => {
  it("locks the spec'd cap values", () => {
    expect(ROUTE_TOTAL_CAP).toBe(50);
    expect(ROUTE_PUBLISH_CAP).toBe(20);
    expect(ROUTE_MAX_SIZE).toBe(10 * 1024 * 1024);
    expect(COPY_FILE_SANITY_CAP).toBe(500);
  });

  it("caps route creation at 50 for non-admins", () => {
    expect(isRouteCapped(49, false)).toBe(false);
    expect(isRouteCapped(50, false)).toBe(true);
    expect(isRouteCapped(51, false)).toBe(true);
  });

  it("never caps admins", () => {
    expect(isRouteCapped(5000, true)).toBe(false);
    expect(isPublishCapped(5000, true)).toBe(false);
  });

  it("caps publishing at 20 for non-admins", () => {
    expect(isPublishCapped(19, false)).toBe(false);
    expect(isPublishCapped(20, false)).toBe(true);
  });
});
