import { describe, it, expect } from "vitest";
import { viewWithoutBasePath } from "./middleware-path";

/**
 * Regression guard for the anonymous-empty-globe bug (2026-08-02).
 *
 * Production (AUTH_URL set) delivers `/use1/studio/app` to the middleware;
 * without AUTH_URL it delivers `/studio/app`. The studio guard must match in
 * BOTH shapes, and must never emit a doubled `/use1/use1` redirect.
 */
describe("viewWithoutBasePath", () => {
  describe("with the basePath present (production, AUTH_URL set)", () => {
    it("strips the prefix so the /studio guard matches", () => {
      const v = viewWithoutBasePath("/use1/studio/app", "/use1");
      expect(v.pathname).toBe("/studio/app");
      expect(v.pathname.startsWith("/studio")).toBe(true);
      expect(v.hasBasePath).toBe(true);
    });

    it("re-attaches the prefix on redirect targets exactly once", () => {
      const v = viewWithoutBasePath("/use1/studio/app", "/use1");
      expect(v.target("/signin")).toBe("/use1/signin");
      expect(v.target("/access-denied")).toBe("/use1/access-denied");
      expect(v.target("/studio/app")).toBe("/use1/studio/app");
      expect(v.target("/signin")).not.toBe("/use1/use1/signin");
    });

    it("maps the bare basePath to root", () => {
      expect(viewWithoutBasePath("/use1", "/use1").pathname).toBe("/");
    });

    it("handles the canonical /studio and /studio/ entry points", () => {
      expect(viewWithoutBasePath("/use1/studio", "/use1").pathname).toBe(
        "/studio",
      );
      expect(viewWithoutBasePath("/use1/studio/", "/use1").pathname).toBe(
        "/studio/",
      );
    });

    it("works for a non-use1 region", () => {
      const v = viewWithoutBasePath("/cac1/studio/app", "/cac1");
      expect(v.pathname).toBe("/studio/app");
      expect(v.target("/signin")).toBe("/cac1/signin");
    });
  });

  describe("with the basePath already stripped (AUTH_URL unset)", () => {
    it("leaves the pathname alone and does not add a prefix", () => {
      const v = viewWithoutBasePath("/studio/app", "/use1");
      expect(v.pathname).toBe("/studio/app");
      expect(v.hasBasePath).toBe(false);
      // Next re-applies basePath itself here; adding it would double it.
      expect(v.target("/signin")).toBe("/signin");
    });
  });

  describe("dev, where no basePath is applied at all", () => {
    it("is a no-op", () => {
      const v = viewWithoutBasePath("/studio/app", "");
      expect(v.pathname).toBe("/studio/app");
      expect(v.hasBasePath).toBe(false);
      expect(v.target("/signin")).toBe("/signin");
    });
  });

  it("does not strip a path that merely shares the prefix as a substring", () => {
    // "/use1x/..." is not inside the /use1 basePath and must be left intact,
    // otherwise the guard would compare a mangled path.
    const v = viewWithoutBasePath("/use1x/studio", "/use1");
    expect(v.hasBasePath).toBe(false);
    expect(v.pathname).toBe("/use1x/studio");
  });
});
