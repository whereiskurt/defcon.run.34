import { describe, it, expect } from "vitest";
import manifest from "@/../public/data/firmware-manifest.json";
import { FIRMWARE_VERSIONS, DEFAULT_FIRMWARE_VERSION } from "./firmware";

describe("firmware-manifest snapshot", () => {
  it("has at least one version entry", () => {
    expect(manifest.versions.length).toBeGreaterThan(0);
  });

  it("has exactly one default version", () => {
    expect(manifest.versions.filter((v) => v.default)).toHaveLength(1);
  });

  it("every entry has a well-formed meshtastic version and non-empty label", () => {
    for (const v of manifest.versions) {
      expect(v.version).toMatch(/^\d+\.\d+\.\d+\.[0-9a-f]+$/);
      expect(v.label.length).toBeGreaterThan(0);
    }
  });

  it("never leaks upstream hostnames (DPLY-06)", () => {
    const raw = JSON.stringify(manifest);
    expect(raw).not.toContain("api.meshtastic.org");
    expect(raw).not.toContain("github.com/meshtastic");
  });
});

describe("firmware config exports", () => {
  it("FIRMWARE_VERSIONS mirrors the snapshot", () => {
    expect(FIRMWARE_VERSIONS.map((v) => v.version)).toEqual(
      manifest.versions.map((v) => v.version)
    );
  });

  it("DEFAULT_FIRMWARE_VERSION is the default entry's version", () => {
    const def = manifest.versions.find((v) => v.default);
    expect(DEFAULT_FIRMWARE_VERSION).toBe(def?.version);
  });
});
