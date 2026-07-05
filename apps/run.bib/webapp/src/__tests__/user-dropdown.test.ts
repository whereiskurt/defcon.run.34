import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * user-dropdown source test (Plan 34-05, BIB-ADM-10).
 *
 * The bib user dropdown mirrors flash/run.human's menu (Profile, My Bib, CMS,
 * GPS Check-in, Show My QR, Sign out) PLUS bib's own Admin item. It is a
 * "use client" HeroUI component with useSession, so we pin its contract as a
 * source-content test (the vitest env is node — no jsdom) rather than a render:
 * we assert the menu keys, their order, that all three run.human deep links go
 * through the shared runHumanUrl helper with target="_blank", and the CMS/Admin
 * service-group gating. This guards the flash-parity contract from drift.
 */

const testDir = fileURLToPath(new URL(".", import.meta.url));
const src = readFileSync(
  resolve(testDir, "../components/user-dropdown.tsx"),
  "utf8"
);

describe("user-dropdown source contract", () => {
  it("declares the seven menu keys in flash/run.human order", () => {
    const keys = ["profile", "bib", "cms", "admin", "checkin", "showqr", "signout"];
    const positions = keys.map((k) => src.indexOf(`key="${k}"`));
    // every key present
    for (let i = 0; i < keys.length; i++) {
      expect(positions[i], `missing key="${keys[i]}"`).toBeGreaterThan(-1);
    }
    // strictly increasing => declared in order
    for (let i = 1; i < positions.length; i++) {
      expect(
        positions[i],
        `key="${keys[i]}" must come after key="${keys[i - 1]}"`
      ).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("routes all three run.human deep links through runHumanUrl", () => {
    expect(src).toContain('runHumanUrl("/whoami")');
    expect(src).toContain('runHumanUrl("/?open=checkin")');
    expect(src).toContain('runHumanUrl("/?open=qr")');
    // imported from the shared helper, never hand-built region-less URLs
    expect(src).toMatch(/import\s*\{\s*runHumanUrl\s*\}\s*from\s*["']@\/lib\/run-human-url["']/);
  });

  it("opens the run.human deep links in a new tab", () => {
    // profile, checkin, showqr each pair their runHumanUrl href with target="_blank"
    for (const path of ['/whoami', '/?open=checkin', '/?open=qr']) {
      const idx = src.indexOf(`runHumanUrl("${path}")`);
      expect(idx, `runHumanUrl("${path}") present`).toBeGreaterThan(-1);
      const window = src.slice(idx, idx + 200);
      expect(window, `target="_blank" near runHumanUrl("${path}")`).toContain(
        'target="_blank"'
      );
    }
  });

  it("gates the CMS item on the cms service group", () => {
    expect(src).toMatch(/services\??\.?.*includes\(["']cms["']\)/);
  });

  it("gates the Admin item on the admin service group", () => {
    expect(src).toMatch(/includes\(["']admin["']\)/);
  });

  it("keeps My Bib and Admin in-app and the signout callback unchanged", () => {
    expect(src).toContain('href="/orderform"');
    expect(src).toContain('href="/admin"');
    expect(src).toContain('signOut({ callbackUrl: "/orderform" })');
  });
});
