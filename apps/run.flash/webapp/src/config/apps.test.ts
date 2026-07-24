import { describe, it, expect } from "vitest";
import manifest from "@/../public/data/apps-manifest.json";
import { APP_DOWNLOADS, getAppHref } from "./apps";

describe("apps-manifest snapshot", () => {
  it("has two APKs and one store entry", () => {
    expect(manifest.apps.filter((a) => a.kind === "apk")).toHaveLength(2);
    expect(manifest.apps.filter((a) => a.kind === "store")).toHaveLength(1);
  });

  it("never leaks upstream hostnames (DPLY-06)", () => {
    const raw = JSON.stringify(manifest);
    expect(raw).not.toContain("github.com/meshtastic");
    expect(raw).not.toContain("api.meshtastic.org");
  });
});

describe("getAppHref", () => {
  it("builds local APK paths and passes store URLs through", () => {
    const apk = APP_DOWNLOADS.find((a) => a.kind === "apk")!;
    expect(getAppHref(apk)).toBe(`/apps/${apk.filename}`);
    const store = APP_DOWNLOADS.find((a) => a.kind === "store")!;
    expect(getAppHref(store)).toBe(store.storeUrl);
  });
});
