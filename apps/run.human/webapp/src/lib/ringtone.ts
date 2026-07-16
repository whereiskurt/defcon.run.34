/**
 * RTTTL ringtone validation — shared by the admin PATCH route (server) and the
 * admin console editor (client). Pure, no imports, so it is safe on both sides.
 *
 * A ringtone is a Meshtastic RTTTL string ("name:defaults:notes"). We keep the
 * structural check permissive (do NOT reimplement a full RTTTL parser) but
 * enforce the shape + the firmware length cap. null / empty means "clear the
 * field" (revert the runner to their class default).
 */
export const MAX_RINGTONE_LEN = 230;

export type RingtoneValidation =
  | { ok: true; value: string | null }
  | { ok: false; reason: string };

export function validateRingtone(
  input: string | null | undefined
): RingtoneValidation {
  if (input == null) return { ok: true, value: null };
  const s = String(input).trim();
  if (s.length === 0) return { ok: true, value: null };
  if (s.length > MAX_RINGTONE_LEN) {
    return { ok: false, reason: `too_long (max ${MAX_RINGTONE_LEN})` };
  }
  const parts = s.split(":");
  if (parts.length !== 3 || parts.some((p) => p.trim().length === 0)) {
    return { ok: false, reason: "not_rtttl (expected name:defaults:notes)" };
  }
  return { ok: true, value: s };
}
