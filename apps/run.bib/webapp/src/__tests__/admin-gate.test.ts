import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Plan 22-05-07 tests: admin-gate helper (Kurt 2026-07-02 email + container-cache correction).
 *
 * Covers parseAdminAllowlist (pure) + getAdminAllowlist + isAdmin +
 * requireAdmin. Mocks getSecureParam so no SSM call is attempted.
 *
 * Key invariants:
 *   - Empty / missing allowlist → deny all (fail-closed).
 *   - Whitespace / empty entries dropped in the parse.
 *   - Case-insensitive email comparison.
 *   - Container-scope cache: SSM read ONCE per successful call, not per request.
 *   - Session-less caller → no_session; requireAdmin checks session.user.email (OIDC email claim).
 */

const mockGetSecureParam = vi.fn();

vi.mock("@/lib/ssm", () => ({
  getSecureParam: (opts: unknown) => mockGetSecureParam(opts),
}));

import {
  _resetAdminAllowlistCacheForTests,
  getAdminAllowlist,
  isAdmin,
  parseAdminAllowlist,
  requireAdmin,
} from "@/lib/admin-gate";

describe("parseAdminAllowlist()", () => {
  it("parses a simple comma-separated email string into a Set", () => {
    const set = parseAdminAllowlist("alice@x.com,bob@x.com,carol@x.com");
    expect(set.has("alice@x.com")).toBe(true);
    expect(set.has("bob@x.com")).toBe(true);
    expect(set.has("carol@x.com")).toBe(true);
    expect(set.size).toBe(3);
  });

  it("trims whitespace around entries", () => {
    const set = parseAdminAllowlist("  alice@x.com , bob@x.com ,  carol@x.com  ");
    expect(set.has("alice@x.com")).toBe(true);
    expect(set.has("bob@x.com")).toBe(true);
    expect(set.has("carol@x.com")).toBe(true);
  });

  it("lowercases email entries", () => {
    const set = parseAdminAllowlist("Alice@X.COM,BOB@x.com");
    expect(set.has("alice@x.com")).toBe(true);
    expect(set.has("bob@x.com")).toBe(true);
    expect(set.has("Alice@X.COM")).toBe(false);
  });

  it("drops empty entries (double comma, trailing comma)", () => {
    const set = parseAdminAllowlist("alice@x.com,,bob@x.com,");
    expect(set.size).toBe(2);
    expect(set.has("alice@x.com")).toBe(true);
    expect(set.has("bob@x.com")).toBe(true);
    expect(set.has("")).toBe(false);
  });

  it("collapses duplicate entries", () => {
    const set = parseAdminAllowlist("alice@x.com,alice@x.com,bob@x.com");
    expect(set.size).toBe(2);
  });

  it("returns an empty Set for null / undefined / empty string", () => {
    expect(parseAdminAllowlist(null).size).toBe(0);
    expect(parseAdminAllowlist(undefined).size).toBe(0);
    expect(parseAdminAllowlist("").size).toBe(0);
    expect(parseAdminAllowlist("   ").size).toBe(0);
  });
});

describe("getAdminAllowlist()", () => {
  beforeEach(() => {
    mockGetSecureParam.mockReset();
    _resetAdminAllowlistCacheForTests();
  });

  it("returns the parsed allowlist on happy path", async () => {
    mockGetSecureParam.mockResolvedValue("alice@x.com,bob@x.com");
    const set = await getAdminAllowlist();
    expect(set.has("alice@x.com")).toBe(true);
    expect(set.has("bob@x.com")).toBe(true);
  });

  it("returns an empty Set on SSM failure (fail-closed)", async () => {
    mockGetSecureParam.mockRejectedValue(new Error("boom"));
    const set = await getAdminAllowlist();
    expect(set.size).toBe(0);
  });

  it("reads from the expected env key + SSM path", async () => {
    mockGetSecureParam.mockResolvedValue("");
    await getAdminAllowlist();
    expect(mockGetSecureParam).toHaveBeenCalledWith({
      envKey: "BIB_ADMIN_ALLOWLIST",
      ssmPath: "/dc34/secrets/use1/bib/admin/allowlist",
    });
  });

  it("caches successful reads — subsequent calls do not re-hit SSM", async () => {
    mockGetSecureParam.mockResolvedValue("alice@x.com");
    await getAdminAllowlist();
    await getAdminAllowlist();
    await getAdminAllowlist();
    expect(mockGetSecureParam).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache failed reads — next call retries", async () => {
    mockGetSecureParam.mockRejectedValueOnce(new Error("boom"));
    const first = await getAdminAllowlist();
    expect(first.size).toBe(0);
    mockGetSecureParam.mockResolvedValueOnce("alice@x.com");
    const second = await getAdminAllowlist();
    expect(second.has("alice@x.com")).toBe(true);
    expect(mockGetSecureParam).toHaveBeenCalledTimes(2);
  });
});

describe("isAdmin()", () => {
  beforeEach(() => {
    mockGetSecureParam.mockReset();
    _resetAdminAllowlistCacheForTests();
  });

  it("returns true when email is on the allowlist", async () => {
    mockGetSecureParam.mockResolvedValue("alice@x.com,bob@x.com");
    expect(await isAdmin("alice@x.com")).toBe(true);
  });

  it("returns true regardless of case", async () => {
    mockGetSecureParam.mockResolvedValue("alice@x.com,bob@x.com");
    expect(await isAdmin("Alice@X.COM")).toBe(true);
  });

  it("returns false when email is not on the allowlist", async () => {
    mockGetSecureParam.mockResolvedValue("alice@x.com,bob@x.com");
    expect(await isAdmin("charlie@x.com")).toBe(false);
  });

  it("returns false when email is null / undefined / empty", async () => {
    mockGetSecureParam.mockResolvedValue("alice@x.com,bob@x.com");
    expect(await isAdmin(null)).toBe(false);
    expect(await isAdmin(undefined)).toBe(false);
    expect(await isAdmin("")).toBe(false);
  });

  it("returns false when allowlist SSM fetch fails", async () => {
    mockGetSecureParam.mockRejectedValue(new Error("SSM down"));
    expect(await isAdmin("alice@x.com")).toBe(false);
  });

  it("returns false when allowlist is empty (fail-closed)", async () => {
    mockGetSecureParam.mockResolvedValue("");
    expect(await isAdmin("alice@x.com")).toBe(false);
  });
});

describe("requireAdmin()", () => {
  beforeEach(() => {
    mockGetSecureParam.mockReset();
    _resetAdminAllowlistCacheForTests();
  });

  it("returns ok=true for a session on the allowlist", async () => {
    mockGetSecureParam.mockResolvedValue("alice@x.com,bob@x.com");
    const result = await requireAdmin({ user: { email: "alice@x.com" } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.email).toBe("alice@x.com");
    }
  });

  it("returns ok=false with no_session when session is null", async () => {
    const result = await requireAdmin(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no_session");
    }
    expect(mockGetSecureParam).not.toHaveBeenCalled();
  });

  it("returns ok=false with no_session when session.user.email is missing", async () => {
    const result = await requireAdmin({ user: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no_session");
    }
  });

  it("returns ok=false with not_allowlisted when session email is not on list", async () => {
    mockGetSecureParam.mockResolvedValue("alice@x.com,bob@x.com");
    const result = await requireAdmin({ user: { email: "charlie@x.com" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_allowlisted");
    }
  });

  it("returns ok=false with not_allowlisted when SSM is misconfigured (empty)", async () => {
    mockGetSecureParam.mockResolvedValue("");
    const result = await requireAdmin({ user: { email: "alice@x.com" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_allowlisted");
    }
  });
});
