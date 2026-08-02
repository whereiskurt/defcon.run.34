import { describe, it, expect } from "vitest";
import { routeSchema } from "./route";
import { GpxFile } from "./gpx-file";

describe("share link plumbing", () => {
  it("GpxFile carries an optional publishedRouteId", () => {
    const attrs = (
      GpxFile as unknown as {
        schema: {
          attributes: Record<string, { required?: boolean; type: string }>;
        };
      }
    ).schema.attributes;

    expect(attrs.publishedRouteId).toBeDefined();
    expect(attrs.publishedRouteId.type).toBe("string");
    expect(attrs.publishedRouteId.required).toBeFalsy();
  });

  it("Route still has no conDay attribute — routes stay structurally unscoreable", () => {
    expect(Object.keys(routeSchema.attributes)).not.toContain("conDay");
  });
});
