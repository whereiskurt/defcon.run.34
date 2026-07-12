import { describe, it, expect } from "vitest";
import { isAdmin, requireAdmin, ADMIN_GROUPS } from "./admin-gate";

describe("isAdmin", () => {
  it("admits admin group", () => {
    expect(isAdmin({ user: { services: ["run", "admin"] } })).toBe(true);
  });
  it("admits runadmin group", () => {
    expect(isAdmin({ user: { services: ["runadmin"] } })).toBe(true);
  });
  it("rejects non-admin services", () => {
    expect(isAdmin({ user: { services: ["run", "flash"] } })).toBe(false);
  });
  it("rejects missing/empty session", () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin({ user: {} })).toBe(false);
  });
});

describe("requireAdmin", () => {
  it("no_session when unauthenticated", () => {
    expect(requireAdmin(null)).toEqual({ ok: false, reason: "no_session" });
  });
  it("not_admin when authenticated without group", () => {
    expect(requireAdmin({ user: { services: ["run"], email: "a@b.c" } }))
      .toEqual({ ok: false, reason: "not_admin" });
  });
  it("ok with email when admin", () => {
    expect(requireAdmin({ user: { services: ["admin"], email: "a@b.c" } }))
      .toEqual({ ok: true, email: "a@b.c" });
  });
  it("exposes the group list", () => {
    expect(ADMIN_GROUPS).toContain("admin");
    expect(ADMIN_GROUPS).toContain("runadmin");
  });
});
