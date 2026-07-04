import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Parity guard for the silent-SSO unit.
 *
 * The five silent-SSO unit files are authored once and placed byte-identically
 * into every full-user NextAuth RP (run.gpx = canonical, run.flash, run.bib).
 * This test is the continuous enforcement of that "placed identically"
 * delivery constraint: if any copy drifts by a single byte, it fails and names
 * the divergent file. Treats run.gpx as the source of truth.
 *
 * Pure node-env test: reads files off disk, no DOM, no app imports.
 */

// Directory of THIS test file: apps/run.bib/webapp/src/__tests__
const testDir = fileURLToPath(new URL(".", import.meta.url));
// Climb to the monorepo `apps/` directory (src/__tests__ -> src -> webapp -> run.bib -> apps).
const appsRoot = resolve(testDir, "../../../..");

const WEBAPP_ROOTS = {
  "run.gpx": join(appsRoot, "run.gpx", "webapp"),
  "run.flash": join(appsRoot, "run.flash", "webapp"),
  "run.bib": join(appsRoot, "run.bib", "webapp"),
} as const;

// The five files that make up the byte-identical silent-SSO unit.
const UNIT_FILES = [
  "src/lib/silent-sso.ts",
  "src/app/api/auth/silent-signin/route.ts",
  "src/app/api/auth/auto-signin/route.ts",
  "src/app/silent-callback/page.tsx",
  "src/components/SilentSSO.tsx",
] as const;

describe("silent-SSO unit parity across run.gpx / run.flash / run.bib", () => {
  for (const rel of UNIT_FILES) {
    it(`${rel} is byte-identical in run.flash and run.bib vs canonical run.gpx`, () => {
      const canonical = readFileSync(join(WEBAPP_ROOTS["run.gpx"], rel), "utf8");

      for (const app of ["run.flash", "run.bib"] as const) {
        const copy = readFileSync(join(WEBAPP_ROOTS[app], rel), "utf8");
        expect(
          copy === canonical,
          `Silent-SSO unit drift: ${app}/${rel} differs from canonical run.gpx/${rel}`,
        ).toBe(true);
      }
    });
  }
});
