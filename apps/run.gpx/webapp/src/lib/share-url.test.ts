import { describe, it, expect, afterEach } from "vitest";
import { buildShareUrl } from "./share-url";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("buildShareUrl", () => {
  it("uses the region-prefixed production URL when both env vars are set", () => {
    process.env.WEBAPP_ORIGIN = "gpx.defcon.run";
    process.env.REGION_SHORT = "use1";

    expect(buildShareUrl("tok123")).toBe(
      "https://gpx.defcon.run/use1/studio/share/tok123"
    );
  });

  it("falls back to localhost when the origin is unset", () => {
    delete process.env.WEBAPP_ORIGIN;
    delete process.env.REGION_SHORT;
    process.env.PORT = "3003";

    expect(buildShareUrl("tok123")).toBe(
      "http://localhost:3003/studio/share/tok123"
    );
  });

  it("falls back to localhost when the region is missing — never a prefix-less prod URL", () => {
    process.env.WEBAPP_ORIGIN = "gpx.defcon.run";
    delete process.env.REGION_SHORT;
    process.env.PORT = "3003";

    expect(buildShareUrl("tok123")).toBe(
      "http://localhost:3003/studio/share/tok123"
    );
  });
});
