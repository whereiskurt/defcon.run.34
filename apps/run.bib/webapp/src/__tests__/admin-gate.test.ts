import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Plan 22-05-07 tests: admin-gate helper.
 *
 * Covers parseAdminAllowlist (pure) + getAdminAllowlist + isAdmin +
 * requireAdmin. Mocks getSecureParam so no SSM call is attempted.
 *
 * Key invariants:
 *   - Empty / missing allowlist → deny all (fail-closed).
 *   - Whitespace / empty entries dropped in the parse.
 *   - Session-less caller → no_session, not_allowlisted only for
 *     signed-in-but-not-on-list.
 */

const mockGetSecureParam = vi.fn();

vi.mock("@/lib/ssm", () => ({
  getSecureParam: (opts: unknown) => mockGetSecureParam(opts),
}));

import {
  getAdminAllowlist,
  isAdmin,
  parseAdminAllowlist,
  requireAdmin,
} from "@/lib/admin-gate";

describe("parseAdminAllowlist()", () => {
  it("parses a simple comma-separated string into a Set", () => {
    const set = parseAdminAllowlist("alice,bob,carol");
    expect(set.has("alice")).toBe(true);
    expect(set.has("bob")).toBe(true);
    expect(set.has("carol")).toBe(true);
    expect(set.size).toBe(3);
  });

  it("trims whitespace around entries", () => {
    const set = parseAdminAllowlist("  alice , bob ,  carol  ");
    expect(set.has("alice")).toBe(true);
    expect(set.has("bob")).toBe(true);
    expect(set.has("carol")).toBe(true);
  });

  it("drops empty entries (double comma, trailing comma)", () => {
    const set = parseAdminAllowlist("alice,,bob,");
    expect(set.size).toBe(2);
    expect(set.has("alice")).toBe(true);
    expect(set.has("bob")).toBe(true);
    expect(set.has("")).toBe(false);
  });

  it("collapses duplicate entries", () => {
    const set = parseAdminAllowlist("alice,alice,bob");
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
  });

  it("returns the parsed allowlist on happy path", async () => {
    mockGetSecureParam.mockResolvedValue("alice,bob");
    const set = await getAdminAllowlist();
    expect(set.has("alice")).toBe(true);
    expect(set.has("bob")).toBe(true);
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
});

describe("isAdmin()", () => {
  beforeEach(() => {
    mockGetSecureParam.mockReset();
  });

  it("returns true when ownerSub is on the allowlist", async () => {
    mockGetSecureParam.mockResolvedValue("alice,bob");
    expect(await isAdmin("alice")).toBe(true);
  });

  it("returns false when ownerSub is not on the allowlist", async () => {
    mockGetSecureParam.mockResolvedValue("alice,bob");
    expect(await isAdmin("charlie")).toBe(false);
  });

  it("returns false when ownerSub is null / undefined / empty", async () => {
    mockGetSecureParam.mockResolvedValue("alice,bob");
    expect(await isAdmin(null)).toBe(false);
    expect(await isAdmin(undefined)).toBe(false);
    expect(await isAdmin("")).toBe(false);
  });

  it("returns false when allowlist SSM fetch fails", async () => {
    mockGetSecureParam.mockRejectedValue(new Error("SSM down"));
    expect(await isAdmin("alice")).toBe(false);
  });

  it("returns false when allowlist is empty (fail-closed)", async () => {
    mockGetSecureParam.mockResolvedValue("");
    expect(await isAdmin("alice")).toBe(false);
  });
});

describe("requireAdmin()", () => {
  beforeEach(() => {
    mockGetSecureParam.mockReset();
  });

  it("returns ok=true for a session on the allowlist", async () => {
    mockGetSecureParam.mockResolvedValue("alice,bob");
    const result = await requireAdmin({ user: { id: "alice" } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ownerSub).toBe("alice");
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

  it("returns ok=false with no_session when session.user.id is missing", async () => {
    const result = await requireAdmin({ user: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no_session");
    }
  });

  it("returns ok=false with not_allowlisted when session sub is not on list", async () => {
    mockGetSecureParam.mockResolvedValue("alice,bob");
    const result = await requireAdmin({ user: { id: "charlie" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_allowlisted");
    }
  });

  it("returns ok=false with not_allowlisted when SSM is misconfigured (empty)", async () => {
    // Fail-closed: an empty allowlist rejects everyone.
    mockGetSecureParam.mockResolvedValue("");
    const result = await requireAdmin({ user: { id: "alice" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_allowlisted");
    }
  });
});
