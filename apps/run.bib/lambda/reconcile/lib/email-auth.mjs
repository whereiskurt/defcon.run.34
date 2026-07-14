/**
 * Email authentication (DMARC) gate for the bib-payment receiver.
 *
 * The From-address allowlist alone is spoofable — the From: header is just a
 * string. Amazon SES, as the receiving MTA, verifies SPF/DKIM/DMARC and stamps
 * the verdict into an `Authentication-Results: amazonses.com; ...` header that
 * it prepends ABOVE the original message before writing it to S3. We read that
 * verdict and require dmarc=pass, so a spoofed From (wrong IP / no valid DKIM)
 * is rejected even when the forged address is on the allowlist.
 *
 * Trust anchor: only SES's own header counts. SES prepends its header at the
 * very top, so the TOPMOST Authentication-Results is SES's; an attacker's
 * forged copy embedded in the original message sits below it and is ignored.
 * If the topmost Authentication-Results is not from the amazonses.com
 * authserv-id (or is absent), we return null and the caller fails closed.
 */

/**
 * The DMARC result SES stamped for this message, or null if SES stamped none.
 * @param {string|Buffer} rawEmail  Raw MIME as read from S3.
 * @returns {string|null} e.g. "pass" | "fail" | "none", lowercased.
 */
export function sesDmarcResult(rawEmail) {
  const text = Buffer.isBuffer(rawEmail)
    ? rawEmail.toString("latin1")
    : String(rawEmail);

  // Header block = everything before the first blank line.
  const headerBlock = text.split(/\r?\n\r?\n/, 1)[0];
  // Unfold folded headers: a continuation line begins with WSP.
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, " ");

  for (const line of unfolded.split(/\r?\n/)) {
    const m = /^Authentication-Results:\s*(.*)$/i.exec(line);
    if (!m) continue;

    // First Authentication-Results wins (SES's, at the top). If it isn't SES's,
    // refuse to read a verdict — don't fall through to a lower, forgeable one.
    const value = m[1];
    const authservId = value.split(/[;\s]/, 1)[0].trim().toLowerCase();
    if (authservId !== "amazonses.com") return null;

    const dm = /(?:^|;)\s*dmarc\s*=\s*([a-z]+)/i.exec(value);
    return dm ? dm[1].toLowerCase() : null;
  }
  return null;
}

/**
 * True only when SES stamped dmarc=pass. Fail-closed on a missing/non-SES
 * verdict.
 * @param {string|Buffer} rawEmail
 * @returns {boolean}
 */
export function isDmarcPass(rawEmail) {
  return sesDmarcResult(rawEmail) === "pass";
}
