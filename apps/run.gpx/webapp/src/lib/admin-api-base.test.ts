import { describe, it, expect } from "vitest";
import { adminApiBase } from "./admin-api-base";

describe("adminApiBase", () => {
  it("extracts the region prefix in production", () => {
    expect(adminApiBase("/use1/admin/routes")).toBe("/use1");
    expect(adminApiBase("/use1/admin/heatmap")).toBe("/use1");
    expect(adminApiBase("/cac1/admin/heatmap")).toBe("/cac1");
  });

  it("returns empty in dev, where there is no basePath", () => {
    expect(adminApiBase("/admin/routes")).toBe("");
    expect(adminApiBase("/admin/heatmap")).toBe("");
  });

  it("handles a nested admin path", () => {
    expect(adminApiBase("/use1/admin/heatmap/anything")).toBe("/use1");
  });

  it("returns empty for a path with no /admin segment rather than guessing", () => {
    expect(adminApiBase("/use1/studio/app")).toBe("");
    expect(adminApiBase("/")).toBe("");
  });
});
