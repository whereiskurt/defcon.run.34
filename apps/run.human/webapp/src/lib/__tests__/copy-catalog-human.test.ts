import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import snapshot from "@/lib/copy-snapshot.json";

/**
 * Phase 39-02 run.human copy-catalog guard test.
 *
 * run.human adopts the Phase 36 copy toolkit (ported verbatim from run.bib in
 * 39-02). This file is the run.human counterpart of run.bib's copy-catalog guard:
 *   - Test A (common.* key-floor): every shared chrome key in the byte-identical
 *     common.* union MUST resolve from copy-snapshot.json `default` (D-07). The
 *     server `t` has no floor of its own, so the CMS-down fallback renders from
 *     the snapshot `default` map, never `{}`. 39-05 wires run.human's chrome to
 *     these keys; if a key is missing here, the chrome would render a raw dotted
 *     key (FALL-04 / SC-1 violation) — this test fails first.
 *   - Test C (server->client token boundary, security / T-39-04): NO "use client"
 *     component may import the server-only `@/lib/copy` resolver — that reads
 *     STRAPI_API_TOKEN / CMS_INTERNAL_URL and would leak the token into the
 *     client bundle.
 *
 * No new dependencies — node:fs + import.meta only.
 */

const DEFAULT: Record<string, string> = (
  snapshot as Record<string, Record<string, string>>
).default;

/**
 * The shared `common.*` chrome union carried as run.human's offline floor. This
 * list MUST stay byte-identical to run.bib's REQUIRED_COMMON_KEYS (39-01); 39-06
 * verifies the two snapshots' common.* subsets are identical. run.human authors
 * ZERO human.* easy-win keys in 39-02 (D-06 bias-to-defer — all visible run.human
 * prose beyond chrome is deep-client-state coupled → MIGR-04).
 */
const REQUIRED_COMMON_KEYS = [
  "common.header.maps",
  "common.header.meshtastic",
  "common.header.bib",
  "common.header.donate",
  "common.header.admin",
  "common.header.myBibMobile",
  "common.header.whoami",
  "common.header.faq",
  "common.profileMenu.profile",
  "common.profileMenu.myBib",
  "common.profileMenu.cms",
  "common.profileMenu.adminReports",
  "common.profileMenu.gpsCheckin",
  "common.profileMenu.showQr",
  "common.profileMenu.signOut",
  "common.profileMenu.logout",
  "common.footer.credits",
] as const;

describe("Test A — common.* chrome key-floor (D-07 / SC-4 contract)", () => {
  it("authors every shared common.* chrome key under `default`, non-empty", () => {
    const missing = REQUIRED_COMMON_KEYS.filter(
      (k) => typeof DEFAULT[k] !== "string" || DEFAULT[k].length === 0
    );
    expect(
      missing,
      `missing/empty common.* snapshot keys: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("carries ONLY the common.* union (zero human.* keys — D-06 bias-to-defer)", () => {
    const nonCommon = Object.keys(DEFAULT).filter(
      (k) => !k.startsWith("common.")
    );
    expect(
      nonCommon,
      `unexpected non-common keys in run.human snapshot: ${nonCommon.join(", ")}`
    ).toEqual([]);
    expect(Object.keys(DEFAULT)).toHaveLength(REQUIRED_COMMON_KEYS.length);
  });
});

/**
 * Phase 39-06 (D-07 invariant): the two apps carry their own offline snapshot
 * floors, but the shared `common.*` subset MUST be byte-identical across both —
 * a single CMS `common.*` row is what changes wording in run.human AND bib live
 * (SC-3), so the offline floors that back it must never diverge. Reading the
 * sibling app's snapshot straight off disk (node:fs, no bundler alias) makes any
 * future divergence of the shared floor a RED test in BOTH apps.
 */
function commonSubset(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(map)
      .filter(([k]) => k.startsWith("common."))
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

describe("Test D — cross-snapshot common.* byte-equality (D-07 shared floor)", () => {
  it("run.human and bib snapshots carry a byte-identical common.* subset", () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    // apps/run.human/webapp/src/lib/__tests__ -> apps/run.bib/webapp/src/lib
    const siblingPath = resolve(
      testDir,
      "../../../../../run.bib/webapp/src/lib/copy-snapshot.json"
    );
    const sibling = JSON.parse(readFileSync(siblingPath, "utf8")) as {
      default: Record<string, string>;
    };
    const mine = commonSubset(DEFAULT);
    const theirs = commonSubset(sibling.default);
    // Guard against a vacuous pass: both floors must actually carry common.* keys.
    expect(Object.keys(mine).length).toBeGreaterThan(0);
    expect(Object.keys(theirs).length).toBe(Object.keys(mine).length);
    // Deep-equality: same keys AND same values (byte-equal shared floor).
    expect(mine).toEqual(theirs);
  });
});

/** Recursively collect every `.tsx` file under `dir` (missing dir → []). */
function collectTsx(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out = out.concat(collectTsx(full));
    } else if (full.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

/** True if the file's first non-empty, non-comment line is a "use client" directive. */
function isUseClient(source: string): boolean {
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) {
      continue;
    }
    return /^["']use client["'];?$/.test(line);
  }
  return false;
}

describe("Test C — server->client token boundary (T-39-04)", () => {
  it('no "use client" component imports the server-only @/lib/copy resolver', () => {
    // This test file lives at src/lib/__tests__/, so src is two levels up.
    const testDir = dirname(fileURLToPath(import.meta.url));
    const srcRoot = resolve(testDir, "../..");
    const files = [
      ...collectTsx(join(srcRoot, "components")),
      ...collectTsx(join(srcRoot, "app")),
    ];

    const offenders = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      if (!isUseClient(source)) return false;
      // Anchored specifier: trailing double-quote so it does NOT match
      // `@/lib/copy-core` (client-safe) or `@/lib/copy-snapshot.json`.
      return source.includes('@/lib/copy"');
    });

    expect(
      offenders,
      `"use client" files importing server-only @/lib/copy: ${offenders.join(", ")}`
    ).toEqual([]);
  });
});
