import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adminApi, BASE } from "./base";

describe("adminApi", () => {
  it("prefixes the path with BASE", () => {
    expect(adminApi("/api/admin/x")).toBe(`${BASE}/api/admin/x`);
  });
});

// Regression guard for the pre-existing bug where AdminActions' lock/jail/unlink/
// delete fetches used bare `/api/...` (no region prefix) and silently 404'd under
// basePath:/{region}. Every admin client fetch MUST go through the region base.
describe("admin client fetches are region-prefixed", () => {
  const files = ["AdminActions.tsx", "AdminConsole.tsx"];
  // Matches a fetch() whose URL literal starts at the domain root ("/api...")
  // instead of an interpolated ${BASE}/adminApi(...) — i.e. the 404 bug.
  const bareFetch = /fetch\(\s*[`"']\/api\//;

  for (const f of files) {
    it(`${f} has no bare "/api/..." fetch`, () => {
      const src = readFileSync(join(__dirname, f), "utf8");
      const offenders = src.split("\n").filter((l) => bareFetch.test(l));
      expect(offenders, `bare fetch(s) in ${f}:\n${offenders.join("\n")}`).toEqual([]);
    });
  }
});
