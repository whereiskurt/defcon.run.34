import { describe, it, expect, afterEach, vi } from "vitest";

// ALTCHA_HMAC_KEY must be set BEFORE importing the module (it reads at import for signing).
// We set it here and import dynamically inside tests to control env.
const KEY = "test-hmac-key-1234567890";

async function load(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  vi.stubEnv("ALTCHA_HMAC_KEY", KEY);
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v ?? "");
  return await import("./altcha-gate");
}

// Loads the module with ALTCHA_HMAC_KEY stubbed to empty BEFORE the dynamic import,
// so signPayload/verifyPayload inside this module instance both see the empty key.
async function loadEmptyKey(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  vi.stubEnv("ALTCHA_HMAC_KEY", "");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v ?? "");
  return await import("./altcha-gate");
}

afterEach(() => vi.unstubAllEnvs());

describe("challengeRequirement", () => {
  it("returns count 0 when not jailed and baseline disabled", async () => {
    const m = await load({ ALTCHA_OAUTH_ENFORCED: undefined });
    expect(m.challengeRequirement({})).toEqual({ count: 0, difficulty: 0 });
    expect(m.challengeRequirement(null)).toEqual({ count: 0, difficulty: 0 });
  });

  it("returns single baseline solve when baseline enabled and not jailed", async () => {
    const m = await load({ ALTCHA_OAUTH_ENFORCED: "true" });
    expect(m.challengeRequirement({})).toEqual({ count: 1, difficulty: m.BASE_MAXNUMBER });
  });

  it("escalates count and difficulty by jail level (jail overrides baseline-off)", async () => {
    const m = await load({ ALTCHA_OAUTH_ENFORCED: undefined });
    expect(m.challengeRequirement({ jailed: true, jailLevel: 3 })).toEqual({ count: 4, difficulty: 4_000_000 });
    expect(m.challengeRequirement({ jailed: true, jailLevel: 5 })).toEqual({ count: 8, difficulty: 8_000_000 });
  });

  it("treats jailed with missing/low level as level 1, clamps >5 to 5", async () => {
    const m = await load();
    expect(m.challengeRequirement({ jailed: true })).toEqual({ count: 2, difficulty: 2_000_000 });
    expect(m.challengeRequirement({ jailed: true, jailLevel: 99 })).toEqual({ count: 8, difficulty: 8_000_000 });
  });

  it("rounds a fractional jailLevel instead of indexing undefined", async () => {
    const m = await load();
    expect(m.challengeRequirement({ jailed: true, jailLevel: 2.5 })).toEqual({ count: 4, difficulty: 4_000_000 });
  });
});

describe("signPayload / verifyPayload", () => {
  it("round-trips a payload", async () => {
    const m = await load();
    const token = m.signPayload({ k: "sub-1", n: 2 });
    expect(m.verifyPayload<{ k: string; n: number }>(token)).toMatchObject({ k: "sub-1", n: 2 });
  });
  it("rejects a tampered body", async () => {
    const m = await load();
    const token = m.signPayload({ k: "sub-1" });
    const tampered = "x" + token.slice(1);
    expect(m.verifyPayload(tampered)).toBeNull();
  });
  it("rejects a wrong signature", async () => {
    const m = await load();
    const token = m.signPayload({ k: "sub-1" });
    const [body] = token.split(".");
    expect(m.verifyPayload(`${body}.deadbeef`)).toBeNull();
  });
  it("rejects an expired payload", async () => {
    const m = await load();
    const token = m.signPayload({ k: "sub-1", exp: Date.now() - 1000 });
    expect(m.verifyPayload(token)).toBeNull();
  });
  it("returns null on empty/garbage input", async () => {
    const m = await load();
    expect(m.verifyPayload(undefined)).toBeNull();
    expect(m.verifyPayload("")).toBeNull();
    expect(m.verifyPayload("no-dot")).toBeNull();
  });
  it("fails closed when ALTCHA_HMAC_KEY is empty (never validates, even its own tokens)", async () => {
    const m = await loadEmptyKey();
    const token = m.signPayload({ k: "sub-1" });
    expect(m.verifyPayload(token)).toBeNull();
  });
});

describe("altcha_ok cookie", () => {
  it("accepts a cookie whose key is in the acceptable set", async () => {
    const m = await load();
    const c = m.makeAltchaOk("sub-1", 1);
    expect(m.readAltchaOk(c, ["sub-1", "email:a@b.com"])).toBe(true);
  });
  it("rejects a cookie whose key is not acceptable (cross-user replay)", async () => {
    const m = await load();
    const c = m.makeAltchaOk("sub-1", 1);
    expect(m.readAltchaOk(c, ["sub-2"])).toBe(false);
  });
  it("emailKey lowercases", async () => {
    const m = await load();
    expect(m.emailKey("Foo@Bar.COM")).toBe("email:foo@bar.com");
  });
  it("rejects a progress token even when its key is acceptable (type confusion bypass)", async () => {
    const m = await load();
    const progressToken = m.makeProgress("sub-1", 1);
    expect(m.readAltchaOk(progressToken, ["sub-1"], 1)).toBe(false);
  });
  it("accepts a token whose satisfied count meets the required minCount", async () => {
    const m = await load();
    expect(m.readAltchaOk(m.makeAltchaOk("sub-1", 1), ["sub-1"], 1)).toBe(true);
  });
  it("rejects a baseline (n=1) token against a heavier jail requirement", async () => {
    const m = await load();
    expect(m.readAltchaOk(m.makeAltchaOk("sub-1", 1), ["sub-1"], 4)).toBe(false);
  });
  it("accepts a token minted for the same heavier requirement it must clear", async () => {
    const m = await load();
    expect(m.readAltchaOk(m.makeAltchaOk("sub-1", 4), ["sub-1"], 4)).toBe(true);
  });
});

describe("progress cookie", () => {
  it("returns solved count for matching key, 0 for mismatch", async () => {
    const m = await load();
    const c = m.makeProgress("sub-1", 2);
    expect(m.readProgress(c, "sub-1")).toBe(2);
    expect(m.readProgress(c, "sub-2")).toBe(0);
    expect(m.readProgress(undefined, "sub-1")).toBe(0);
  });
  it("rejects an altcha_ok token even when its key matches (type confusion bypass)", async () => {
    const m = await load();
    const okToken = m.makeAltchaOk("sub-1", 1);
    expect(m.readProgress(okToken, "sub-1")).toBe(0);
  });
});

describe("markSolutionUsed replay guard", () => {
  it("accepts a solution once then rejects the replay", async () => {
    const m = await load();
    expect(m.markSolutionUsed("payload-abc")).toBe(true);
    expect(m.markSolutionUsed("payload-abc")).toBe(false);
    expect(m.markSolutionUsed("payload-def")).toBe(true);
  });
});

describe("clearGateCookieHeader", () => {
  it("contains the base cookie-clear directives", async () => {
    const m = await load();
    const header = m.clearGateCookieHeader("altcha_ok");
    expect(header).toContain("altcha_ok=");
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("HttpOnly");
  });
  it("includes Secure in production and omits it otherwise", async () => {
    const m = await load({ NODE_ENV: "production" });
    expect(m.clearGateCookieHeader("altcha_ok")).toContain("Secure");

    const m2 = await load({ NODE_ENV: "development" });
    expect(m2.clearGateCookieHeader("altcha_ok")).not.toContain("Secure");
  });
  it("includes Domain when AUTH_COOKIE_DOMAIN is set and omits it when unset", async () => {
    const m = await load({ AUTH_COOKIE_DOMAIN: "defcon.run" });
    expect(m.clearGateCookieHeader("altcha_ok")).toContain("Domain=defcon.run");

    const m2 = await load({ AUTH_COOKIE_DOMAIN: undefined });
    expect(m2.clearGateCookieHeader("altcha_ok")).not.toContain("Domain=");
  });
});
