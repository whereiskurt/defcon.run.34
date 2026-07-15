import { describe, it, expect, vi } from "vitest";

// admin-gate re-exports revalidateAdmin/revalidateGroups from config/auth,
// which drags in next-auth (unresolvable under vitest). We only test the pure
// sync helpers here, so stub the whole auth config module.
vi.mock("@/config/auth", () => ({
  revalidateAdmin: vi.fn(),
  revalidateGroups: vi.fn(),
}));

import {
  ADMIN_GROUPS,
  QR_ADMIN_GROUPS,
  CTF_ADMIN_GROUPS,
  isMemberOf,
  requireGroups,
  isAdmin,
  isCtfAdmin,
  requireAdmin,
} from "../admin-gate";

const sess = (services: string[] | null) =>
  ({ user: { services, email: "x@y.z" } }) as never;

describe("QR_ADMIN_GROUPS", () => {
  it("is ADMIN_GROUPS plus qradmin", () => {
    expect([...QR_ADMIN_GROUPS]).toEqual([...ADMIN_GROUPS, "qradmin"]);
  });
});

describe("CTF_ADMIN_GROUPS / isCtfAdmin", () => {
  it("is ADMIN_GROUPS plus ctfadmin", () => {
    expect([...CTF_ADMIN_GROUPS]).toEqual([...ADMIN_GROUPS, "ctfadmin"]);
  });

  it("grants the CTF override to admin, runadmin, and ctfadmin", () => {
    for (const g of ["admin", "runadmin", "ctfadmin"]) {
      expect(isCtfAdmin(sess([g]))).toBe(true);
    }
  });

  it("denies non-CTF-admin groups, empty services, and no session", () => {
    expect(isCtfAdmin(sess(["qradmin"]))).toBe(false);
    expect(isCtfAdmin(sess(["bibadmin"]))).toBe(false);
    expect(isCtfAdmin(sess([]))).toBe(false);
    expect(isCtfAdmin(sess(null))).toBe(false);
    expect(isCtfAdmin(null)).toBe(false);
    expect(isCtfAdmin(undefined)).toBe(false);
  });
});

describe("isMemberOf / requireGroups", () => {
  it("admits qradmin on QR groups but NOT on admin groups", () => {
    const s = sess(["qradmin"]);
    expect(isMemberOf(s, QR_ADMIN_GROUPS)).toBe(true);
    expect(requireGroups(s, QR_ADMIN_GROUPS)).toEqual({ ok: true, email: "x@y.z" });
    expect(isAdmin(s)).toBe(false);
    expect(requireAdmin(s).ok).toBe(false);
  });

  it("admits admin and runadmin on both group lists", () => {
    for (const g of ["admin", "runadmin"]) {
      expect(isMemberOf(sess([g]), ADMIN_GROUPS)).toBe(true);
      expect(isMemberOf(sess([g]), QR_ADMIN_GROUPS)).toBe(true);
    }
  });

  it("denies empty/absent services and missing session", () => {
    expect(requireGroups(sess([]), QR_ADMIN_GROUPS)).toEqual({
      ok: false,
      reason: "not_admin",
    });
    expect(requireGroups(sess(null), QR_ADMIN_GROUPS).ok).toBe(false);
    expect(requireGroups(null, QR_ADMIN_GROUPS)).toEqual({
      ok: false,
      reason: "no_session",
    });
  });

  it("existing requireAdmin behavior is unchanged (wrapper)", () => {
    expect(requireAdmin(sess(["admin"]))).toEqual({ ok: true, email: "x@y.z" });
    expect(requireAdmin(sess(["qradmin", "somethingelse"])).ok).toBe(false);
  });
});
