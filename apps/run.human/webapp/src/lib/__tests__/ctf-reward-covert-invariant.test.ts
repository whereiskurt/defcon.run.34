import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Covert-channel reward invariant (T-54-03-01 / SC-5).
 *
 * The `otp-enroll` reward reveal must live SOLELY on the visible, authenticated
 * non-covert claim path (ClaimClient). The covert CSS channel reads only
 * `solved` + `points` and MUST stay byte-identical and reward-free (T-53-04-01).
 *
 * This test reads the covert source files from disk and asserts none of them
 * reference the reward-kind token (`otp-enroll`) or the reward renderer
 * (`CtfOtpEnroll`) — i.e. the renderer is imported ONLY by the non-covert
 * ClaimClient (and, after 54-04, the admin reveal-preview), never by the covert
 * modules. It is an author-time guard: if a future edit leaks a reward reference
 * into any covert module, this test goes red.
 */

/** Covert modules that must never carry a reward reference. */
const COVERT_FILES: Array<{ label: string; rel: string }> = [
  { label: "covert-egg.ts", rel: "../covert-egg.ts" },
  { label: "EggTrigger.tsx", rel: "../../components/EggTrigger.tsx" },
  { label: "CtfCelebration.tsx", rel: "../../components/CtfCelebration.tsx" },
  { label: "ctf-covert-css.ts", rel: "../ctf-covert-css.ts" },
  { label: "assets/theme/route.ts", rel: "../../app/(ctf)/assets/theme/route.ts" },
];

/** Reward tokens that must NOT appear in any covert module. */
const REWARD_TOKENS = ["otp-enroll", "CtfOtpEnroll", "ctf-otp-enroll"];

function readCovert(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("covert channel carries no reward payload", () => {
  it("resolves every covert source file (guards against a moved/renamed path)", () => {
    for (const { label, rel } of COVERT_FILES) {
      const src = readCovert(rel);
      expect(src.length, `${label} should be readable`).toBeGreaterThan(0);
    }
  });

  for (const { label, rel } of COVERT_FILES) {
    it(`${label} references no reward token`, () => {
      const src = readCovert(rel);
      for (const token of REWARD_TOKENS) {
        expect(
          src.includes(token),
          `${label} must not reference "${token}" (covert channel is reward-free)`,
        ).toBe(false);
      }
    });
  }
});
