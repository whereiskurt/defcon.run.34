import { describe, it, expect } from "vitest";
import { buildScannerCopy } from "../scanner-copy";

describe("buildScannerCopy", () => {
  it("uses the fallback for every field when the CMS has nothing", () => {
    const copy = buildScannerCopy((_key, fallback) => fallback);
    expect(copy).toEqual({
      title: "Scan a runner",
      hint: "Point your camera at another runner's QR",
      miss: "Not a runner QR - keep it in frame",
      found: "🐰 Runner found!",
      claim: "Claim connection",
      again: "Scan another",
      unavailable:
        "Camera unavailable - use your phone's camera app on the QR instead.",
      cancel: "Done",
    });
  });

  it("lets a CMS value win over the fallback", () => {
    const copy = buildScannerCopy((key, fallback) =>
      key === "socialqr.scan.title" ? "Find a runner" : fallback,
    );
    expect(copy.title).toBe("Find a runner");
    expect(copy.cancel).toBe("Done");
  });

  it("asks for every socialqr.scan.* key exactly once", () => {
    const asked: string[] = [];
    buildScannerCopy((key, fallback) => {
      asked.push(key);
      return fallback;
    });
    expect(asked).toEqual([
      "socialqr.scan.title",
      "socialqr.scan.hint",
      "socialqr.scan.miss",
      "socialqr.scan.found",
      "socialqr.scan.claim",
      "socialqr.scan.again",
      "socialqr.scan.unavailable",
      "socialqr.scan.cancel",
    ]);
  });

  // The button LABEL key is deliberately absent: /whoami says "Connect" via
  // socialqr.scan.button and the landing page says "Scan" via
  // socialqr.scan.button.short. Pulling either into the shared modal copy
  // would let one CMS edit rename both buttons.
  it("does not own either button label", () => {
    const asked: string[] = [];
    buildScannerCopy((key, fallback) => {
      asked.push(key);
      return fallback;
    });
    expect(asked).not.toContain("socialqr.scan.button");
    expect(asked).not.toContain("socialqr.scan.button.short");
  });
});
