import { describe, it, expect } from "vitest";

/**
 * v1.6 admin-gate tests (Kurt 2026-07-03: group-claim model).
 *
 * Admin access = the `"admin"` entry in `session.user.services` (the
 * run.auth groups model), mirroring run.human. Supersedes the Phase 22-05
 * SSM email allowlist.
 *
 * Invariants:
 *   - isAdmin true ONLY when services includes "admin".
 *   - Missing session / user / services → not admin (fail-closed).
 *   - requireAdmin: null/absent user → no_session; authed non-admin → not_admin;
 *     admin → ok with the email echoed back.
 */

import { isAdmin, requireAdmin, requireBibAdmin, requireRunAdmin } from "@/lib/admin-gate";

describe("isAdmin()", () => {
  it("returns true when services includes 'admin'", () => {
    expect(isAdmin({ user: { services: ["auth", "run", "admin"] } })).toBe(true);
  });

  it("returns false when services lacks 'admin'", () => {
    expect(isAdmin({ user: { services: ["auth", "run", "flash"] } })).toBe(false);
  });

  it("returns false for empty / missing / null services", () => {
    expect(isAdmin({ user: { services: [] } })).toBe(false);
    expect(isAdmin({ user: {} })).toBe(false);
    expect(isAdmin({ user: { services: null } })).toBe(false);
  });

  it("returns false for null / undefined session", () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });

  it("does not match on a substring or wrong case", () => {
    expect(isAdmin({ user: { services: ["administrator"] } })).toBe(false);
    expect(isAdmin({ user: { services: ["Admin"] } })).toBe(false);
  });
});

describe("requireAdmin()", () => {
  it("returns ok=true and echoes email for an admin session", () => {
    const result = requireAdmin({
      user: { email: "alice@x.com", services: ["run", "admin"] },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.email).toBe("alice@x.com");
  });

  it("returns ok=true with null email when the session omits email", () => {
    const result = requireAdmin({ user: { services: ["admin"] } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.email).toBeNull();
  });

  it("returns no_session for null session", () => {
    const result = requireAdmin(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_session");
  });

  it("returns no_session when session.user is missing", () => {
    const result = requireAdmin({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_session");
  });

  it("returns not_admin for an authenticated non-admin", () => {
    const result = requireAdmin({
      user: { email: "bob@x.com", services: ["run", "flash"] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_admin");
  });
});

describe("requireBibAdmin()", () => {
  it("admits a bibadmin", () => {
    const r = requireBibAdmin({ user: { email: "a@x.com", services: ["run", "bibadmin"] } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.email).toBe("a@x.com");
  });
  it("admits a superuser admin without bibadmin", () => {
    expect(requireBibAdmin({ user: { services: ["admin"] } }).ok).toBe(true);
  });
  it("rejects a plain user (not_admin)", () => {
    const r = requireBibAdmin({ user: { services: ["run", "flash"] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_admin");
  });
  it("rejects no session (no_session)", () => {
    const r = requireBibAdmin(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_session");
  });
});

describe("requireRunAdmin()", () => {
  it("admits a runadmin", () => {
    expect(requireRunAdmin({ user: { services: ["runadmin"] } }).ok).toBe(true);
  });
  it("admits a superuser admin", () => {
    expect(requireRunAdmin({ user: { services: ["admin"] } }).ok).toBe(true);
  });
  it("rejects a bibadmin-only user", () => {
    const r = requireRunAdmin({ user: { services: ["bibadmin"] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_admin");
  });
});
