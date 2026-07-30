import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Points-consistency invariant: lib/rescore.ts is the ONLY module that writes
 * RunUser score fields. Award-time accrual must never come back.
 */
const SRC = join(__dirname, "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}

describe("scoring write invariant", () => {
  const files = walk(SRC);

  it("only rescore.ts sets the derived score field", () => {
    const offenders = files.filter((p) => {
      if (p.endsWith("lib/rescore.ts")) return false;
      if (p.includes("entities/run-user.ts")) return false; // schema definition
      const src = readFileSync(p, "utf8");
      // any RunUser patch/update that mentions score:/scoreBreakdown/streakDays
      return /RunUser\s*\.\s*(patch|update|upsert)/.test(src) &&
        /(scoreBreakdown|streakDays|[^a-zA-Z]score\s*:)/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("nothing accrues ctfScore anywhere anymore", () => {
    const offenders = files.filter((p) => {
      const src = readFileSync(p, "utf8");
      return /\.add\(\s*\{[^}]*ctfScore/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
