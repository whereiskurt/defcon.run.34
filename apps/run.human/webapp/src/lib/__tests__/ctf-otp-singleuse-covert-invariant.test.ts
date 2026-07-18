import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Covert-channel + resolver invariant for the SINGLE-USE OTP path (Phase 65, SC3/SC4).
 *
 * Two structural guards, both author-time (mirror the wordlist covert gate):
 *
 * 1. COVERT — the single-use OTP logic must live SOLELY on the visible judge/store
 *    path (ctf-judge.ts + CtfOtpClaim + ctf-otp-claim.ts). The covert CSS channel
 *    reads only `solved` + `points` and MUST stay byte-identical: a consumed/lost
 *    code is a NON_SOLVE indistinguishable from a wrong answer, and NO single-use
 *    reason may leak into any covert module. (SC4 / T-53-04-01.)
 *
 * 2. RESOLVER — the HARD CONSTRAINT: single-use is enforced ONLY in the judge
 *    (post-login), NEVER in the public q.defcon.run resolver Lambda. Anonymous
 *    traffic must never trigger a DynamoDB write. This asserts NO resolver `.mjs`
 *    source references any single-use token — the resolver stays a dumb stateless
 *    302. (SC3.)
 */

const SINGLE_USE_TOKENS = ["singleUse", "CtfOtpClaim", "claimOtpCode"];

function readRel(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

// --- 1. Covert modules must never carry a single-use OTP reference ------------
const COVERT_FILES: Array<{ label: string; rel: string }> = [
  { label: "covert-egg.ts", rel: "../covert-egg.ts" },
  { label: "EggTrigger.tsx", rel: "../../components/EggTrigger.tsx" },
  { label: "CtfCelebration.tsx", rel: "../../components/CtfCelebration.tsx" },
  { label: "ctf-covert-css.ts", rel: "../ctf-covert-css.ts" },
  { label: "assets/theme/route.ts", rel: "../../app/(ctf)/assets/theme/route.ts" },
];

describe("covert channel references no single-use OTP token (SC4)", () => {
  it("resolves every covert source file (guards against a moved/renamed path)", () => {
    for (const { label, rel } of COVERT_FILES) {
      expect(readRel(rel).length, `${label} should be readable`).toBeGreaterThan(0);
    }
  });

  for (const { label, rel } of COVERT_FILES) {
    it(`${label} references no single-use OTP token`, () => {
      const src = readRel(rel);
      for (const token of SINGLE_USE_TOKENS) {
        expect(
          src.includes(token),
          `${label} must not reference "${token}" (covert channel is single-use-free)`
        ).toBe(false);
      }
    });
  }
});

// --- 2. The public resolver Lambda must be untouched by single-use logic -------
// resolver source lives at apps/run.qr/lambda/resolver (5 levels up from this file).
const RESOLVER_DIR = "../../../../../run.qr/lambda/resolver";

function resolverMjsFiles(): string[] {
  const base = fileURLToPath(new URL(RESOLVER_DIR + "/", import.meta.url));
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === "node_modules") continue;
      const full = `${dir}${ent.name}${ent.isDirectory() ? "/" : ""}`;
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith(".mjs")) out.push(full);
    }
  };
  walk(base);
  return out;
}

describe("resolver Lambda is untouched by single-use logic (SC3 — HARD CONSTRAINT)", () => {
  it("finds the resolver .mjs sources (guards against a moved resolver)", () => {
    const files = resolverMjsFiles();
    expect(files.length, "expected resolver .mjs sources under apps/run.qr/lambda/resolver").toBeGreaterThan(0);
  });

  it("no resolver .mjs references any single-use OTP token (judge-only enforcement)", () => {
    for (const file of resolverMjsFiles()) {
      const src = readFileSync(file, "utf8");
      for (const token of SINGLE_USE_TOKENS) {
        expect(
          src.includes(token),
          `${file} must not reference "${token}" — single-use is enforced ONLY in the judge`
        ).toBe(false);
      }
    }
  });
});
