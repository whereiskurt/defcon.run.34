import { describe, it, expect } from "vitest";
import {
  sanitizeCardText,
  validateRouteCard,
  NAME_MAX,
  DESC_MAX,
  ROUTE_TYPES,
} from "../route-card";

describe("sanitizeCardText", () => {
  it("strips ASCII control characters", () => {
    expect(sanitizeCardText("a\u0000b\u001Fc")).toBe("abc");
  });

  it("strips DEL", () => {
    expect(sanitizeCardText("ab\u007Fc")).toBe("abc");
  });

  it("strips bidi and invisible overrides", () => {
    expect(sanitizeCardText("x\u202Ey\u200Bz\u2066\u2069")).toBe("xyz");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeCardText("  hello world  ")).toBe("hello world");
  });

  it("keeps normal unicode text", () => {
    expect(sanitizeCardText("Café ⛰️ Strip — 5k")).toBe("Café ⛰️ Strip — 5k");
  });
});

describe("validateRouteCard", () => {
  it("accepts a valid full card", () => {
    const r = validateRouteCard(
      { name: "Vegas Loop", description: "Nice run", routeType: "loop" },
      { requireName: true }
    );
    expect(r).toEqual({
      ok: true,
      value: { name: "Vegas Loop", description: "Nice run", routeType: "loop" },
    });
  });

  it("rejects missing name when required", () => {
    const r = validateRouteCard({}, { requireName: true });
    expect(r.ok).toBe(false);
  });

  it("allows missing name when not required (partial update)", () => {
    const r = validateRouteCard(
      { description: "updated" },
      { requireName: false }
    );
    expect(r).toEqual({ ok: true, value: { description: "updated" } });
  });

  it("rejects non-string name", () => {
    const r = validateRouteCard({ name: 42 }, { requireName: true });
    expect(r.ok).toBe(false);
  });

  it("rejects a name that sanitizes to empty", () => {
    const r = validateRouteCard({ name: " \u200B\u0007 " }, { requireName: true });
    expect(r.ok).toBe(false);
  });

  it("rejects name over NAME_MAX after sanitization", () => {
    const r = validateRouteCard(
      { name: "x".repeat(NAME_MAX + 1) },
      { requireName: true }
    );
    expect(r.ok).toBe(false);
  });

  it("accepts name at exactly NAME_MAX even when padded with strippable chars", () => {
    const r = validateRouteCard(
      { name: "  " + "x".repeat(NAME_MAX) + "\u200B" },
      { requireName: true }
    );
    expect(r).toEqual({ ok: true, value: { name: "x".repeat(NAME_MAX) } });
  });

  it("rejects description over DESC_MAX", () => {
    const r = validateRouteCard(
      { name: "ok", description: "d".repeat(DESC_MAX + 1) },
      { requireName: true }
    );
    expect(r.ok).toBe(false);
  });

  it("allows empty description", () => {
    const r = validateRouteCard(
      { name: "ok", description: "" },
      { requireName: true }
    );
    expect(r).toEqual({ ok: true, value: { name: "ok", description: "" } });
  });

  it("rejects routeType outside the allowlist", () => {
    const r = validateRouteCard(
      { name: "ok", routeType: "<script>" },
      { requireName: true }
    );
    expect(r.ok).toBe(false);
  });

  it("accepts every allowlisted routeType", () => {
    for (const t of ROUTE_TYPES) {
      const r = validateRouteCard(
        { name: "ok", routeType: t },
        { requireName: true }
      );
      expect(r.ok).toBe(true);
    }
  });

  it("rejects non-string routeType", () => {
    const r = validateRouteCard(
      { name: "ok", routeType: 7 },
      { requireName: true }
    );
    expect(r.ok).toBe(false);
  });

  it("ignores unknown fields (does not echo them back)", () => {
    const r = validateRouteCard(
      { name: "ok", ownerId: "evil", visibility: "published" },
      { requireName: true }
    );
    expect(r).toEqual({ ok: true, value: { name: "ok" } });
  });
});
