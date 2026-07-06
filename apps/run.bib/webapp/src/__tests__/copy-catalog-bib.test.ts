import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import snapshot from "@/lib/copy-snapshot.json";

/**
 * Phase 37-01 copy-catalog guard tests.
 *
 * This file is the CONTRACT the Wave 2 migration plans (37-02..37-05) depend on:
 *   - Test A (key-set floor): every bib.* key a Wave 2 plan will consume MUST
 *     already resolve from copy-snapshot.json `default` (SC-4). If a Wave 2 plan
 *     references a key not authored here, this test fails first.
 *   - Test B (interpolation shape): the interpolated keys carry the exact tokens
 *     the components pass at runtime (copy-core.interpolate uses `{token}`).
 *   - Test C (server->client token boundary, security / T-37-03): NO "use client"
 *     component may import the server-only `@/lib/copy` resolver — that reads
 *     STRAPI_API_TOKEN / CMS_INTERNAL_URL and would leak into the client bundle.
 *
 * No new dependencies — node:fs + import.meta only, mirroring copy.test.ts.
 */

const DEFAULT: Record<string, string> = (
  snapshot as Record<string, Record<string, string>>
).default;

/**
 * Every bib.* key the Phase 37 surface (Wave 2 plans) consumes. This inline list
 * IS the contract — keep it in lock-step with the authoritative key table in
 * 37-01-PLAN.md. Excludes the 2 retained bib.selftest.* toolkit self-test keys.
 */
const REQUIRED_BIB_KEYS = [
  "bib.landing.title",
  "bib.landing.intro",
  "bib.donate.trigger",
  "bib.donate.title",
  "bib.donate.subhead",
  "bib.donate.amountLabel",
  "bib.sponsor.amountLabel",
  "bib.checkout.sliderHelper",
  "bib.checkout.paymentMethod",
  "bib.checkout.providerCard",
  "bib.checkout.providerCashApp",
  "bib.checkout.providerVenmo",
  "bib.checkout.providerNote",
  "bib.checkout.redirecting",
  "bib.checkout.error",
  "bib.checkout.cta",
  "bib.contribution.sponsorVerb",
  "bib.contribution.donateVerb",
  "bib.contribution.kickerSupport",
  "bib.contribution.kickerThis",
  "bib.contribution.kickerOrThat",
  "bib.contribution.donateBody",
  "bib.contribution.sponsorTitle",
  "bib.contribution.sponsorBody",
  "bib.contribution.limitNote",
  "bib.contribution.optInPerson",
  "bib.contribution.optBurn",
  "bib.contribution.hintInPerson",
  "bib.contribution.hintBurn",
  "bib.contribution.hintNothing",
  "bib.contribution.saveError",
  "bib.contribution.thanks",
  "bib.contribution.chipAria",
  "bib.status.paymentSuccess",
  "bib.status.paymentCancel",
  "bib.status.pledgeTagline",
  "bib.status.burningBibAlt",
  "bib.status.stampUnsaved",
  "bib.status.stampDraft",
  "bib.status.stampPaid",
  "bib.status.stampThankYou",
  "bib.instructions.payVia",
  "bib.instructions.sendTo",
  "bib.instructions.requiredComment",
  "bib.instructions.requiredCommentHint",
  "bib.instructions.openProvider",
  "bib.instructions.reconcileNoteBefore",
  "bib.instructions.reconcileNoteAfter",
  "bib.instructions.venmoTitle",
  "bib.instructions.venmoSubhead",
  "bib.instructions.cashappTitle",
  "bib.instructions.cashappSubhead",
  "bib.instructions.backToBib",
  "bib.bibform.save",
  "bib.bibform.verifying",
  "bib.bibform.saving",
  "bib.bibform.cancel",
  "bib.bibform.lockedHint",
  "bib.bibform.saveError",
  "bib.bibform.runnerCodeLabel",
  "bib.bibform.copy",
  "bib.bibform.copied",
  // Phase 39-01 (MIGR-02): remaining bib transaction-history prose (39-04 wires it).
  "bib.txn.totalContributed",
  "bib.txn.kindBib",
  "bib.txn.kindDonation",
  "bib.txn.inProgress",
  "bib.txn.reconcileNote",
  // Phase 39-01 (MIGR-02): remaining bib admin-action prose (39-04 wires it).
  "bib.admin.failText",
  "bib.admin.dedupedText",
  "bib.admin.approve",
  "bib.admin.paid",
  "bib.admin.alreadyBooked",
  "bib.admin.reject",
  "bib.admin.rejectConfirm",
] as const;

/**
 * Phase 39-01 (MIGR-03): the shared `common.*` chrome union authored into the
 * bib snapshot floor. Both run.bib and run.human carry the FULL union as their
 * offline floor (D-07) — the server `t` has no floor of its own, so the CMS-down
 * fallback must render from the snapshot `default` map, never `{}`. 39-02 authors
 * the byte-identical common.* subset into run.human's snapshot; 39-06 verifies
 * the two are identical. 39-03 wires bib's chrome to these keys.
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

describe("Test A — bib.* key-set floor (SC-4 contract)", () => {
  it("authors every Wave-2-consumed bib.* key under `default`, non-empty", () => {
    const missing = REQUIRED_BIB_KEYS.filter(
      (k) => typeof DEFAULT[k] !== "string" || DEFAULT[k].length === 0
    );
    expect(missing, `missing/empty snapshot keys: ${missing.join(", ")}`).toEqual(
      []
    );
  });

  it("retains the 2 toolkit self-test keys (bib + common + 2 selftest total)", () => {
    expect(DEFAULT["bib.selftest.serverGreeting"]).toBeTruthy();
    expect(DEFAULT["bib.selftest.clientGreeting"]).toBeTruthy();
    expect(Object.keys(DEFAULT)).toHaveLength(
      REQUIRED_BIB_KEYS.length + REQUIRED_COMMON_KEYS.length + 2
    );
  });
});

describe("Test A2 — common.* chrome floor (MIGR-03 / SC-4 contract)", () => {
  it("authors every shared common.* chrome key under `default`, non-empty", () => {
    const missing = REQUIRED_COMMON_KEYS.filter(
      (k) => typeof DEFAULT[k] !== "string" || DEFAULT[k].length === 0
    );
    expect(
      missing,
      `missing/empty common.* snapshot keys: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("keeps bib.donate.trigger seeded alongside the re-homed common.header.donate", () => {
    // D-07: common.header.donate is the shared chrome key both apps read in
    // Wave 2, but bib.donate.trigger stays seeded (other surfaces/tests still
    // reference it) — 39-04 re-points bib's header/menu at common.header.donate.
    expect(DEFAULT["bib.donate.trigger"]).toBe("Donate $");
    expect(DEFAULT["common.header.donate"]).toBe("Donate $");
  });
});

/**
 * Phase 39-06 (D-07 invariant): the two apps carry their own offline snapshot
 * floors, but the shared `common.*` subset MUST be byte-identical across both —
 * a single CMS `common.*` row is what changes wording in bib AND run.human live
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
  it("bib and run.human snapshots carry a byte-identical common.* subset", () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    // apps/run.bib/webapp/src/__tests__ -> apps/run.human/webapp/src/lib
    const siblingPath = resolve(
      testDir,
      "../../../../run.human/webapp/src/lib/copy-snapshot.json"
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

describe("Test B — interpolation token shape", () => {
  it("bib.checkout.cta carries {label} and {amount}", () => {
    expect(DEFAULT["bib.checkout.cta"]).toContain("{label}");
    expect(DEFAULT["bib.checkout.cta"]).toContain("{amount}");
  });

  it("bib.checkout.sliderHelper carries {min} and {max}", () => {
    expect(DEFAULT["bib.checkout.sliderHelper"]).toContain("{min}");
    expect(DEFAULT["bib.checkout.sliderHelper"]).toContain("{max}");
  });

  it("bib.instructions.payVia carries {provider}", () => {
    expect(DEFAULT["bib.instructions.payVia"]).toContain("{provider}");
  });

  it("bib.contribution.chipAria carries {amount} and {providers}", () => {
    expect(DEFAULT["bib.contribution.chipAria"]).toContain("{amount}");
    expect(DEFAULT["bib.contribution.chipAria"]).toContain("{providers}");
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

describe("Test C — server->client token boundary (T-37-03)", () => {
  it("no \"use client\" component imports the server-only @/lib/copy resolver", () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const srcRoot = resolve(testDir, "..");
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
