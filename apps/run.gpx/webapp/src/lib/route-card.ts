/**
 * Route card text validation (2026-07-28 routes-vs-runs spec, section 5).
 *
 * Attacker posture: every card field arrives hostile. Card text is stored as
 * PLAIN TEXT only — no markdown, no HTML — and stripped of ASCII control
 * characters plus bidi/invisible overrides (Trojan Source-style spoofing).
 * Length is checked AFTER sanitization so strippable padding can't smuggle an
 * oversized value, and routeType is a strict allowlist.
 */

export const ROUTE_TYPES = ["loop", "out-and-back", "point-to-point"] as const;
export type RouteType = (typeof ROUTE_TYPES)[number];
export const NAME_MAX = 80;
export const DESC_MAX = 2000;

// U+0000–U+001F, U+007F (ASCII controls incl. DEL); U+200B–U+200F (zero-width +
// LRM/RLM); U+202A–U+202E (bidi embeds/overrides); U+2066–U+2069 (bidi isolates).
const STRIP_RE = /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

export function sanitizeCardText(s: string): string {
  return s.replace(STRIP_RE, "").trim();
}

type Card = { name?: string; description?: string; routeType?: RouteType };

export function validateRouteCard(
  body: unknown,
  opts: { requireName: boolean }
): { ok: true; value: Card } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: Card = {};

  if (b.name !== undefined) {
    if (typeof b.name !== "string") {
      return { ok: false, error: "name must be a string" };
    }
    const name = sanitizeCardText(b.name);
    if (!name) return { ok: false, error: "name is required" };
    if (name.length > NAME_MAX) {
      return { ok: false, error: `name too long (max ${NAME_MAX})` };
    }
    out.name = name;
  } else if (opts.requireName) {
    return { ok: false, error: "name is required" };
  }

  if (b.description !== undefined) {
    if (typeof b.description !== "string") {
      return { ok: false, error: "description must be a string" };
    }
    const description = sanitizeCardText(b.description);
    if (description.length > DESC_MAX) {
      return { ok: false, error: `description too long (max ${DESC_MAX})` };
    }
    out.description = description;
  }

  if (b.routeType !== undefined) {
    if (
      typeof b.routeType !== "string" ||
      !(ROUTE_TYPES as readonly string[]).includes(b.routeType)
    ) {
      return { ok: false, error: "invalid routeType" };
    }
    out.routeType = b.routeType as RouteType;
  }

  return { ok: true, value: out };
}
