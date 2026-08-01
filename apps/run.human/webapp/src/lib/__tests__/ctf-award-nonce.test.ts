import { describe, it, expect, vi, afterEach } from "vitest";

import { newAwardNonce, AWARD_LINK_TTL_SECONDS } from "../ctf-pending";

/**
 * The short award nonce (Phase 72) and its TTL knob. Bot awards are delivered as
 * `https://q.defcon.run/a/<nonce>` over a LoRa channel, so the nonce is both
 * hand-transcribable and a bearer token — these tests pin the two properties that
 * makes safe:
 *   T-72-11  12 symbols of Crockford base32 = 60 bits, generated unbiased from
 *            crypto.getRandomValues (no modulo skew, no constant seed).
 *   alphabet no `i` / `l` / `o` / `u`, so a human reading the link off a radio
 *            screen cannot land on an ambiguous glyph.
 * The TTL is asserted at its 3600s default and through the
 * BOT_CLAIM_LINK_TTL_SECONDS override, including the garbage-in clamp — a bad
 * env value must NOT be able to mint an already-expired award.
 */

/** Crockford base32, lowercase: no i, l, o, u. */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const NONCE_RE = /^[0-9a-hjkmnp-tv-z]{12}$/;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Re-evaluate the module so the module-load-time TTL sees a stubbed env. */
async function ttlWithEnv(value?: string): Promise<number> {
  vi.resetModules();
  if (value === undefined) vi.stubEnv("BOT_CLAIM_LINK_TTL_SECONDS", "");
  else vi.stubEnv("BOT_CLAIM_LINK_TTL_SECONDS", value);
  const mod = await import("../ctf-pending");
  return mod.AWARD_LINK_TTL_SECONDS;
}

describe("newAwardNonce — 12 Crockford base32 lowercase symbols (T-72-11)", () => {
  it("returns exactly 12 characters", () => {
    expect(newAwardNonce()).toHaveLength(12);
  });

  it("draws every character from the declared alphabet", () => {
    expect(newAwardNonce()).toMatch(NONCE_RE);
  });

  it("never emits the ambiguous glyphs i, l, o or u", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      for (const ch of newAwardNonce()) seen.add(ch);
    }
    for (const bad of ["i", "l", "o", "u"]) expect(seen.has(bad)).toBe(false);
  });

  it("2000 samples are all distinct and stay inside the alphabet", () => {
    const nonces = new Set<string>();
    const chars = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const n = newAwardNonce();
      nonces.add(n);
      for (const ch of n) chars.add(ch);
    }
    // No constant seed, no obvious collision at 60 bits.
    expect(nonces.size).toBe(2000);
    // Observed character union is a SUBSET of the declared alphabet.
    for (const ch of chars) expect(ALPHABET).toContain(ch);
  });

  it("exercises the whole alphabet across enough samples (no dead symbols)", () => {
    const chars = new Set<string>();
    for (let i = 0; i < 2000; i++) for (const ch of newAwardNonce()) chars.add(ch);
    // 24k symbols over 32 slots — every symbol should appear if the mask is right.
    expect(chars.size).toBe(ALPHABET.length);
  });
});

describe("AWARD_LINK_TTL_SECONDS — 3600s, env-tunable, clamped", () => {
  it("defaults to 3600 seconds", () => {
    expect(AWARD_LINK_TTL_SECONDS).toBe(3600);
  });

  it("honours a numeric BOT_CLAIM_LINK_TTL_SECONDS", async () => {
    await expect(ttlWithEnv("900")).resolves.toBe(900);
  });

  it("falls back to 3600 for a non-numeric value", async () => {
    await expect(ttlWithEnv("banana")).resolves.toBe(3600);
  });

  it("falls back to 3600 for zero or a negative value (never mints an expired row)", async () => {
    await expect(ttlWithEnv("0")).resolves.toBe(3600);
    await expect(ttlWithEnv("-60")).resolves.toBe(3600);
  });

  it("falls back to 3600 when the env var is empty/unset", async () => {
    await expect(ttlWithEnv()).resolves.toBe(3600);
  });
});
