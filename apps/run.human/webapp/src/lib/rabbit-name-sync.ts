/**
 * Pure helpers for the bib-name -> rabbit-name (displayName) sync.
 *
 * Kept dependency-free so the lock policy and length reconciliation are unit
 * testable in isolation. The internal PATCH route composes these; see
 * docs/superpowers/specs/2026-07-11-bib-name-rabbit-sync-design.md.
 */

export const DISPLAYNAME_MIN = 3;
export const DISPLAYNAME_MAX = 20;

/** The exact displayName upsertRunUser() generates for a brand-new user. */
export function autoDefaultName(adapterUserId: string): string {
  return `rabbit_${adapterUserId.slice(0, 4)}`;
}

/**
 * True when the sync must NOT overwrite the rabbit name.
 *
 * - manual flag true  -> locked (runner claimed it with the pencil).
 * - manual flag false -> unlocked (a prior sync stamped it; keep saving over).
 * - flag absent (pre-feature users): locked unless the name is still the exact
 *   auto-default, since nothing had ever bib-synced before this shipped, so any
 *   non-default name was chosen deliberately.
 */
export function isDisplayNameLocked(
  currentDisplayName: string | undefined,
  displayNameManual: boolean | undefined,
  adapterUserId: string
): boolean {
  if (displayNameManual === true) return true;
  if (displayNameManual === false) return false;
  // Flag absent: locked only if a non-empty name differs from the auto-default.
  // An empty/undefined name was never claimed, so treat it as unlocked.
  const current = currentDisplayName ?? "";
  return current !== "" && current !== autoDefaultName(adapterUserId);
}

/**
 * Reconcile an incoming bib name to run.human's 3-20 rules.
 * Returns null when it can't be a valid rabbit name (< 3 chars after trim),
 * else the trimmed name clamped to 20 chars.
 */
export function normalizeSyncedName(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length < DISPLAYNAME_MIN) return null;
  return trimmed.slice(0, DISPLAYNAME_MAX);
}
