import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * leaderboard-hidden.test.ts — the HIDDEN guarantee (LDBR-11, SC #2, threat
 * T-52-07). The admin leaderboard route ships reachable by URL ONLY: it is
 * linked from NO navigation until launch. This test reads every UI source file
 * under src/components AND src/app from disk and asserts NONE of them reference
 * the leaderboard route path — no header link, no dropdown entry, no menu item,
 * no footer/profile link anywhere.
 *
 * ── Why the whole tree, not just header/ ──────────────────────────────────────
 * SC #2 says the route appears in NO navigation surface — header, dropdown, AND
 * any profile/footer/menu. A header-only scan would miss a stray link elsewhere,
 * so we sweep all of components + app and EXCLUDE this feature's own files (which
 * legitimately contain the route: the page, its API handlers, its client, and
 * its own test files). Any surviving hit is, by construction, a nav/link leak.
 *
 * ── Precise route match (not a substring) ─────────────────────────────────────
 * The needle is BUILT at runtime from the segment name so the bare route string
 * is never baked in as a constant this file would match itself. It matches the
 * route ONLY at a path boundary — "/leaderboard" NOT followed by a word char,
 * "-", or "/" — so it flags a real nav link (href="/leaderboard", /leaderboard?…)
 * but never a lib import like "@/lib/leaderboard-scoring" or a component-dir
 * import like "@/components/leaderboard/LeaderboardTable".
 *
 * No new dependencies — node:fs + import.meta only (mirrors copy-catalog-human).
 */

const testDir = dirname(fileURLToPath(import.meta.url)); // …/src/lib
const srcRoot = resolve(testDir, ".."); // …/src

/** The route segment for the hidden page, assembled so the literal path never
 *  appears as a constant in THIS file (which would self-trip the assertion). */
const SEGMENT = "leaderboard";
/** Matches the route ONLY at a path boundary: "/leaderboard" not continued by a
 *  word char, "-", or "/". Flags a nav link; ignores lib/component import paths. */
const ROUTE_PATTERN = new RegExp("/" + SEGMENT + "(?![A-Za-z0-9_/-])");

/** Roots whose UI/nav source must never link the hidden route. */
const SCAN_ROOTS = ["components", "app"].map((d) => join(srcRoot, d));

/**
 * This feature's OWN files legitimately contain the route (the page, its API,
 * its client, its libs, its tests). Exclude them so only nav/link leaks survive.
 * Matched as path substrings against forward-slash-normalized absolute paths.
 */
const EXCLUDED_SUBPATHS = [
  "/components/leaderboard/", // the LeaderboardTable + PolylineRenderer client dir
  "/app/(protected)/leaderboard/", // the hidden page itself
  "/app/api/leaderboard/", // the leaderboard API route handlers
  "/lib/leaderboard-", // leaderboard-* libs (defensive; not under scan roots)
  "/lib/polyline-geometry", // polyline geometry lib (defensive)
  "leaderboard-hidden.test", // this test file (defensive; not under scan roots)
];

const SOURCE_EXT = [".ts", ".tsx", ".js", ".jsx"];

function isSource(file: string): boolean {
  return SOURCE_EXT.some((ext) => file.endsWith(ext));
}

function isExcluded(absPath: string): boolean {
  const norm = absPath.split("\\").join("/");
  return EXCLUDED_SUBPATHS.some((sub) => norm.includes(sub));
}

/** Recursively collect all in-scope source files under a root. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // a missing scan root contributes nothing
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (entry.isFile() && isSource(full) && !isExcluded(full)) {
      out.push(full);
    }
  }
  return out;
}

describe("leaderboard route is hidden from all navigation (SC #2, T-52-07)", () => {
  const files = SCAN_ROOTS.flatMap(collectSourceFiles).filter((f) => !isExcluded(f));

  it("scans a non-empty set of UI source files (guard against a vacuous pass)", () => {
    // If the glob silently returns nothing, the leak assertion below would pass
    // for the wrong reason. Prove we actually read real nav/UI source.
    expect(files.length).toBeGreaterThan(0);
  });

  it("finds the route path in NO navigation/UI component outside the feature's own files", () => {
    const offenders = files.filter((file) =>
      ROUTE_PATTERN.test(readFileSync(file, "utf8")),
    );
    // Report the actual offending paths so a regression is instantly locatable.
    expect(offenders.map((f) => f.split("\\").join("/"))).toEqual([]);
  });
});
