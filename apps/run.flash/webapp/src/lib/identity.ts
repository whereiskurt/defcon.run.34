/**
 * Byte-safe device identity (owner long/short name) construction.
 *
 * Firmware limits are BYTES, not characters: mesh.proto User has nanopb
 * max_size 40 for long_name (39 usable + NUL) and 5 for short_name (4 usable).
 * A string over the limit fails nanopb decode on the device, silently dropping
 * the whole SetOwner write — and a shortName byte-sliced mid-code-point renders
 * as garbage (same failure class as Meshtastic-Android #1730). All slicing here
 * is by code point with a UTF-8 byte budget.
 *
 * Kept OUT of lib/meshtastic.ts (a "use client" module that imports the
 * web-serial transport) so this stays pure + unit-testable in Node.
 */

export const LONG_NAME_MAX_BYTES = 39;
export const SHORT_NAME_MAX_BYTES = 4;

/** Used when no character of the name fits the short-name byte budget. */
const SHORT_NAME_FALLBACK = "DC34";

const encoder = new TextEncoder();

export function utf8ByteLength(s: string): number {
  return encoder.encode(s).length;
}

/** Trim and cap at LONG_NAME_MAX_BYTES, never splitting a code point. */
export function clampLongName(name: string): string {
  const trimmed = name.trim();
  if (utf8ByteLength(trimmed) <= LONG_NAME_MAX_BYTES) return trimmed;
  let out = "";
  for (const cp of trimmed) {
    if (utf8ByteLength(out + cp) > LONG_NAME_MAX_BYTES) break;
    out += cp;
  }
  return out;
}

/**
 * Derive a short name: leading code points of the (trimmed) long name,
 * uppercased, accumulated while the UTF-8 total stays within 4 bytes.
 * Uppercasing happens BEFORE the byte check — some characters expand when
 * uppercased (ﬀ -> FF) and the budget applies to what we actually write.
 */
export function buildShortName(longName: string): string {
  let out = "";
  for (const cp of longName.trim()) {
    const upper = cp.toUpperCase();
    if (utf8ByteLength(out + upper) > SHORT_NAME_MAX_BYTES) break;
    out += upper;
  }
  return out.length > 0 ? out : SHORT_NAME_FALLBACK;
}

/**
 * Resolve the device identity with the /api/config precedence:
 * RunUser.displayName -> session name -> generated DCR34_<id> — treating
 * whitespace-only values as missing (a blank displayName must not produce a
 * whitespace owner name on the radio).
 */
export function buildIdentity(input: {
  displayName?: string | null;
  sessionName?: string | null;
  userId: string;
}): { longName: string; shortName: string } {
  const displayName = input.displayName?.trim();
  const sessionName = input.sessionName?.trim();
  const base = displayName || sessionName || `DCR34_${input.userId.slice(0, 4)}`;
  const longName = clampLongName(base);
  return { longName, shortName: buildShortName(longName) };
}
