import { describe, it, expect } from "vitest";
import { routeSchema } from "../route";

/**
 * Schema regression guard (2026-07-28 routes-vs-runs spec, section 3).
 *
 * A Route must be STRUCTURALLY unscoreable: the leaderboard's definition of a
 * scored run keys on GpxFile.conDay, so the Route entity must never grow a
 * conDay attribute. The index layout is also locked: gsi3 must stay unused
 * (the local-dev run-gpx-electro table only has gsi1/gsi2).
 */
const model = routeSchema as unknown as {
  attributes: Record<string, unknown>;
  indexes: Record<string, { index?: string }>;
};

describe("Route entity schema", () => {
  it("has no conDay attribute (structurally unscoreable)", () => {
    expect(model.attributes.conDay).toBeUndefined();
  });

  it("has no stravaActivityId attribute", () => {
    expect(model.attributes.stravaActivityId).toBeUndefined();
  });

  it("requires routeId and ownerId", () => {
    expect(
      (model.attributes.routeId as { required?: boolean }).required
    ).toBe(true);
    expect(
      (model.attributes.ownerId as { required?: boolean }).required
    ).toBe(true);
  });

  it("visibility is exactly private|published, defaulting private", () => {
    const vis = model.attributes.visibility as {
      type: string[];
      default?: string;
    };
    expect([...vis.type].sort()).toEqual(["private", "published"]);
    expect(vis.default).toBe("private");
  });

  it("status is the pending|active|failed lifecycle, defaulting pending", () => {
    const st = model.attributes.status as { type: string[]; default?: string };
    expect([...st.type].sort()).toEqual(["active", "failed", "pending"]);
    expect(st.default).toBe("pending");
  });

  it("byOwner rides gsi1 and byVisibility rides gsi2 (gsi3 stays unused)", () => {
    expect(model.indexes.byOwner.index).toBe("gsi1pk-gsi1sk-index");
    expect(model.indexes.byVisibility.index).toBe("gsi2pk-gsi2sk-index");
    const used = Object.values(model.indexes)
      .map((i) => i.index)
      .filter(Boolean);
    expect(used).not.toContain("gsi3pk-gsi3sk-index");
  });
});
