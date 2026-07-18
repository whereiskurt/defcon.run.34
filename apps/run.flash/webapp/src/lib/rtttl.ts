/**
 * RTTTL ringtone validation — pure, dependency-free, unit-testable in Node.
 *
 * Kept separate from config/meshtastic.ts and lib/ringtone-admin.ts so both the
 * server (config assembly) and client (device push) can guard on it without
 * pulling in @meshtastic/core or the web-serial transport.
 *
 * The goal is a hard guarantee: callers only ever write a well-formed, non-empty
 * ringtone to a device, or nothing at all. A malformed/empty RTTTL committed to
 * hardware has been implicated in post-config boot failures.
 */

/** Firmware cap on the stored RTTTL ringtone string length (bytes). */
export const MAX_RINGTONE_LEN = 230;

/** A single control entry: d=8 | o=6 | b=140 (duration / octave / tempo). */
const CONTROL_RE = /^[dob]=\d+$/i;

/**
 * A single RTTTL note/pause token: [duration][note|p][#][octave][dot].
 * e.g. c, e, g, c7, 2g, 4d#, p, 8a#5.
 */
const NOTE_RE = /^(1|2|4|8|16|32)?[a-gp]#?\.?[1-9]?\.?$/i;

/**
 * Validate an RTTTL ringtone string of the form `name:controls:notes`.
 *
 * Returns true only for a well-formed, non-empty tune within the firmware
 * length cap. Deliberately strict enough to reject empty strings, truncated
 * fragments, and free-text garbage; lenient enough to accept every tune in
 * RINGTONES and typical hand-authored tunes.
 */
export function isValidRtttl(rtttl: unknown): rtttl is string {
  if (typeof rtttl !== "string") return false;
  const s = rtttl.trim();
  if (s.length === 0 || s.length > MAX_RINGTONE_LEN) return false;

  const parts = s.split(":");
  if (parts.length !== 3) return false;
  const [name, controls, notes] = parts;

  // Name: 1..10 chars (RTTTL spec caps the name at 10).
  if (name.trim().length === 0 || name.length > 10) return false;

  // Controls: optional as a whole, but if present every entry must be a
  // recognized d=/o=/b= assignment.
  if (controls.trim().length > 0) {
    for (const kv of controls.split(",")) {
      if (!CONTROL_RE.test(kv.trim())) return false;
    }
  }

  // Notes: at least one, each a valid note/pause token.
  const tokens = notes
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return false;
  return tokens.every((t) => NOTE_RE.test(t));
}
