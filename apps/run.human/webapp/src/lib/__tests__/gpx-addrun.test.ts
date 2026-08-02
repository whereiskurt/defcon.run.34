import { describe, it, expect, afterEach, vi } from "vitest";
import { gpxAddRunUrl } from "../gpx-addrun";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("gpxAddRunUrl", () => {
  it("points at the local gpx dev server outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(gpxAddRunUrl()).toBe("http://localhost:3003/studio/app?addrun");
  });

  it("builds the region-prefixed studio URL in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_DOMAIN", "defcon.run");
    vi.stubEnv("NEXT_PUBLIC_REGION_SHORT", "use1");
    expect(gpxAddRunUrl()).toBe("https://gpx.defcon.run/use1/studio/app?addrun");
  });

  it("falls back to defcon.run and use1 when the env is unset", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_DOMAIN", "");
    vi.stubEnv("NEXT_PUBLIC_REGION_SHORT", "");
    expect(gpxAddRunUrl()).toBe("https://gpx.defcon.run/use1/studio/app?addrun");
  });

  // The landmine this function exists to prevent: a link to the bare gpx
  // origin hits an interstitial that does location.replace('/'+region+'/'),
  // which drops the query string. The ?addrun payload would vanish with no
  // error. Only /{region}/studio/app is terminal.
  it("never returns the bare gpx origin and always keeps ?addrun", () => {
    vi.stubEnv("NODE_ENV", "production");
    const url = gpxAddRunUrl();
    expect(url).toMatch(/\/studio\/app\?addrun$/);
    expect(url).not.toBe("https://gpx.defcon.run");
    expect(url).not.toBe("https://gpx.defcon.run/");
  });
});
