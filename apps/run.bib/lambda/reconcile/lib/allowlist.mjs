/**
 * Sender allowlist for the bib-payment receiver.
 *
 * The receiver trusts a small set of admin forwarders. The allowlist itself
 * lives in config (env var BIB_ALLOWED_SENDERS, comma-separated) — never in
 * source — so this module only knows how to parse + match, not who is on it.
 */

/**
 * Parse a comma-separated allowlist into a normalized Set of addresses.
 * @param {string|undefined|null} raw
 * @returns {Set<string>}
 */
function parseAllowlist(raw) {
  if (!raw) return new Set();
  return new Set(
    String(raw)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0)
  );
}

/**
 * Is `fromAddress` authorized to submit a receipt?
 *
 * Fail-closed: an empty or missing allowlist rejects everyone (a lost config
 * removes access rather than silently disabling the control). A null/empty
 * From is likewise rejected.
 *
 * @param {string|null|undefined} fromAddress  Parsed From address.
 * @param {string|null|undefined} rawAllowlist  Comma-separated allowlist.
 * @returns {boolean}
 */
export function isSenderAllowed(fromAddress, rawAllowlist) {
  const allow = parseAllowlist(rawAllowlist);
  if (allow.size === 0) return false;
  if (!fromAddress) return false;
  return allow.has(String(fromAddress).trim().toLowerCase());
}
