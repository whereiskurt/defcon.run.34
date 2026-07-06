import { describe, expect, it } from "vitest";
import { t } from "@/lib/copy";
import snapshot from "@/lib/copy-snapshot.json";

/**
 * Phase 37-06 Task 1 — server-floor fallback test (SC-4, automated).
 *
 * MECHANISM (resolved-map / floor validation). The migrated SERVER surfaces
 * (SponsorInstructions, ContributionChip) call `loadCopy()` internally and do
 * NOT accept an injected copy map, so rendering them here is impractical in
 * vitest. Instead this test validates the exact object a CMS-down `loadCopy()`
 * returns: the committed snapshot `default` map. That is the equivalence that
 * makes SC-4 hold — when Strapi + S3 are both unreachable, `resolveCopy`/
 * `loadCopy` fall back to this map, so the server `t(map, key)` resolves every
 * consumed key to real wording instead of echoing the dotted key.
 *
 * The REAL end-to-end server-render SC-4 proof is the live CMS-down human
 * walkthrough in Task 3; this test locks the floor those renders depend on.
 *
 * No new dependencies — vitest + the same `@/lib/copy` re-export and
 * `copy-snapshot.json` import the production server code uses.
 */

/** Byte-identical to the CMS-down `loadCopy("default")` output. */
const snapshotDefaultMap: Record<string, string> = (
  snapshot as Record<string, Record<string, string>>
).default;

/**
 * A resolved value must never be key-shaped. A naive `toContain("bib.")` is
 * wrong — a legit hint may end a sentence with "…your bib." — so we match the
 * dotted-key shape `bib.<segment>.` instead. A match means the server `t`
 * echoed the key (the key is absent from the floor → SC-4 broken).
 */
const KEY_SHAPE = /bib\.[a-z]\w*\./;

/**
 * The bib.* keys consumed by the migrated SERVER surfaces, each with the
 * representative interpolation vars the components pass at runtime.
 * - SponsorInstructions: bib.instructions.* + the sponsor-page landing/title copy.
 * - ContributionChip: bib.contribution.thanks + bib.contribution.chipAria.
 */
const SERVER_SURFACE_KEYS: ReadonlyArray<{
  key: string;
  vars?: Record<string, string>;
}> = [
  // bib.instructions.* (SponsorInstructions + the venmo/cashapp sponsor pages)
  { key: "bib.instructions.payVia", vars: { provider: "Venmo" } },
  { key: "bib.instructions.sendTo" },
  { key: "bib.instructions.requiredComment" },
  { key: "bib.instructions.requiredCommentHint" },
  { key: "bib.instructions.openProvider", vars: { provider: "Venmo" } },
  { key: "bib.instructions.reconcileNoteBefore" },
  { key: "bib.instructions.reconcileNoteAfter" },
  { key: "bib.instructions.venmoTitle" },
  { key: "bib.instructions.venmoSubhead" },
  { key: "bib.instructions.cashappTitle" },
  { key: "bib.instructions.cashappSubhead" },
  { key: "bib.instructions.backToBib" },
  // landing header (server-rendered)
  { key: "bib.landing.title" },
  { key: "bib.landing.intro" },
  // ContributionChip
  { key: "bib.contribution.thanks" },
  {
    key: "bib.contribution.chipAria",
    vars: { amount: "$25.00", providers: "Venmo" },
  },
];

describe("Server-floor fallback (SC-4) — CMS-down snapshot resolves via server `t`", () => {
  it.each(SERVER_SURFACE_KEYS)(
    "$key resolves to real wording with no key-shaped token",
    ({ key, vars }) => {
      const resolved = t(snapshotDefaultMap, key, vars);
      expect(typeof resolved).toBe("string");
      expect(resolved.length).toBeGreaterThan(0);
      // The floor must carry the key — the server `t` must not echo it.
      expect(
        KEY_SHAPE.test(resolved),
        `server t echoed a dotted key for "${key}": ${resolved}`
      ).toBe(false);
    }
  );

  it("interpolates the provider var into the pay-via / open-provider lines", () => {
    expect(t(snapshotDefaultMap, "bib.instructions.payVia", { provider: "Venmo" })).toBe(
      "Pay via Venmo"
    );
    expect(
      t(snapshotDefaultMap, "bib.instructions.openProvider", { provider: "Cash App" })
    ).toBe("Open Cash App");
    // No stray unreplaced token remains.
    expect(
      t(snapshotDefaultMap, "bib.instructions.payVia", { provider: "Venmo" })
    ).not.toContain("{provider}");
  });

  it("spot-checks representative server-surface wording", () => {
    expect(t(snapshotDefaultMap, "bib.instructions.sendTo")).toBe("Send to");
    expect(t(snapshotDefaultMap, "bib.contribution.thanks")).toBe("Thank you");
    expect(t(snapshotDefaultMap, "bib.landing.title")).toBe("Bibs & Donation");
  });

  it("interpolates the chip aria-label amount + providers", () => {
    const aria = t(snapshotDefaultMap, "bib.contribution.chipAria", {
      amount: "$25.00",
      providers: "Venmo, Cash App",
    });
    expect(aria).toContain("$25.00");
    expect(aria).toContain("Venmo, Cash App");
    expect(aria).not.toContain("{amount}");
    expect(aria).not.toContain("{providers}");
    expect(KEY_SHAPE.test(aria)).toBe(false);
  });

  it("would FAIL LOUDLY if a consumed key were absent from the floor (echo guard)", () => {
    // Sanity: an unknown key IS echoed by `t` and IS key-shaped — proving the
    // KEY_SHAPE guard above actually catches a broken floor.
    const echoed = t(snapshotDefaultMap, "bib.instructions.doesNotExist");
    expect(echoed).toBe("bib.instructions.doesNotExist");
    expect(KEY_SHAPE.test(echoed)).toBe(true);
  });
});
