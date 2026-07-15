import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Covert-channel wordlist invariant (SC4 / T-53-04-01 / T-56-02-02).
 *
 * The Slice-3 wordlist single-use logic must live SOLELY on the visible judge/store
 * path (ctf-judge.ts + the CtfCode entity). The covert CSS channel reads only
 * `solved` + `points` and MUST stay byte-identical: a used or unknown wordlist code
 * is a NON_SOLVE indistinguishable from a wrong answer, and NO wordlist reason may
 * leak into any covert module.
 *
 * This test reads the covert source files from disk and asserts none of them
 * reference a Slice-3 wordlist token (`wordlist`, `CtfCode`, `claimCode`,
 * `codeHash`) — i.e. the single-use claim is confined to the visible path and never
 * leaked into the covert channel. It is an author-time guard (mirrors the
 * ctf-reward-covert-invariant gate): if a future edit leaks a wordlist reference
 * into any covert module, this test goes red.
 */

/** Covert modules that must never carry a wordlist reference. */
const COVERT_FILES: Array<{ label: string; rel: string }> = [
  { label: "covert-egg.ts", rel: "../covert-egg.ts" },
  { label: "EggTrigger.tsx", rel: "../../components/EggTrigger.tsx" },
  { label: "CtfCelebration.tsx", rel: "../../components/CtfCelebration.tsx" },
  { label: "ctf-covert-css.ts", rel: "../ctf-covert-css.ts" },
  { label: "assets/theme/route.ts", rel: "../../app/(ctf)/assets/theme/route.ts" },
];

/** Slice-3 wordlist tokens that must NOT appear in any covert module. */
const WORDLIST_TOKENS = ["wordlist", "CtfCode", "claimCode", "codeHash"];

function readCovert(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("covert channel references no wordlist single-use token (SC4)", () => {
  it("resolves every covert source file (guards against a moved/renamed path)", () => {
    for (const { label, rel } of COVERT_FILES) {
      const src = readCovert(rel);
      expect(src.length, `${label} should be readable`).toBeGreaterThan(0);
    }
  });

  for (const { label, rel } of COVERT_FILES) {
    it(`${label} references no wordlist token`, () => {
      const src = readCovert(rel);
      for (const token of WORDLIST_TOKENS) {
        expect(
          src.includes(token),
          `${label} must not reference "${token}" (covert channel is wordlist-free)`,
        ).toBe(false);
      }
    });
  }
});
