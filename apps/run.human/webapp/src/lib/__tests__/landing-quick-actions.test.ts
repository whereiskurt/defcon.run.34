import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Source-text guard for the signed-in landing hero.
 *
 * run.human has no jsdom, so the three quick actions cannot be asserted by
 * rendering. What matters is structural and IS checkable in the source:
 *   - the Add Run href comes from gpxAddRunUrl(), not an inline gpx URL that
 *     could be written against the bare origin (which silently eats ?addrun);
 *   - the Scan button uses its own CMS key, so a CMS edit cannot rename
 *     /whoami's "Connect" button at the same time;
 *   - the page never sends isPrivate, keeping the fast check-in's privacy
 *     guarantee an omission rather than a client-side decision.
 */
const here = dirname(fileURLToPath(import.meta.url));
const PAGE = resolve(here, "../../app/(public)/page.tsx");
const src = readFileSync(PAGE, "utf8");

describe("landing quick actions", () => {
  it("sources the Add Run href from gpxAddRunUrl()", () => {
    expect(src).toContain('from "@/lib/gpx-addrun"');
    expect(src).toContain("gpxAddRunUrl()");
  });

  it("never hardcodes a gpx origin in the page", () => {
    expect(src).not.toMatch(/https:\/\/gpx\./);
    expect(src).not.toMatch(/localhost:3003/);
  });

  it("builds scanner copy from the shared module", () => {
    expect(src).toContain('from "@/lib/scanner-copy"');
    expect(src).toContain("buildScannerCopy(");
  });

  it("labels Scan from its own key, not /whoami's Connect key", () => {
    expect(src).toContain("socialqr.scan.button.short");
    expect(src).not.toContain('"socialqr.scan.button"');
  });

  it("mounts both quick-action modals", () => {
    expect(src).toContain("<QuickCheckInModal");
    expect(src).toContain("<QrScannerModal");
  });

  it("never sends isPrivate from the landing page", () => {
    expect(src).not.toContain("isPrivate");
  });
});
