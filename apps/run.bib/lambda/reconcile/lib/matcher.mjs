/**
 * Reconciliation matcher for extracted payment fields → Bib rows.
 *
 * Two-stage matching:
 *   1. Primary: runnerCode regex on `comment_text`. `BIB-[A-HJ-NP-Z2-9]{4}`
 *      matches the runner-code alphabet from
 *      `apps/run.bib/webapp/src/lib/runner-code.ts`. Immediate lookup via
 *      the `runnerCode-index` GSI (`Bib.byRunnerCode`). Confidence: high.
 *   2. Fallback: normalize the extracted `sender_display_name` (lowercase,
 *      strip whitespace + punctuation) and scan all Bibs whose
 *      `nameOnBib` (also normalized) contains OR is contained by the
 *      sender name. Only invoked when the primary lookup returns null.
 *      Confidence: medium (single unique candidate) or low (ambiguous —
 *      matcher returns no match to stay conservative).
 *
 * The scan is bounded — matcher accepts a caller-provided `listAllBibs`
 * fn so production can plug in a paged scan (Phase 22 launch sits at ~200
 * bibs; a full-table scan is cheap). Tests inject an in-memory array.
 *
 * When the primary match hits, the fallback scan is skipped entirely.
 */

/**
 * Match a runnerCode reference out of a payment comment. Returns the
 * matched substring normalized to uppercase (e.g. "BIB-K7QM") or null.
 *
 * Case-insensitive: payers type the code into a free-text Venmo/CashApp note
 * in whatever case they like (real prod miss: a $200 note read "bib-frcb").
 * The stored runnerCode and the byRunnerCode GSI key are always uppercase and
 * DynamoDB equality is case-sensitive, so we uppercase the match before
 * returning it for the lookup.
 *
 * @param {string} commentText
 * @returns {string|null}
 */
export function extractRunnerCode(commentText) {
  if (typeof commentText !== "string" || commentText.length === 0) return null;
  const m = commentText.match(/BIB-[A-HJ-NP-Z2-9]{4}/i);
  return m ? m[0].toUpperCase() : null;
}

/**
 * Normalize a display name for fuzzy comparison. Lowercases and strips
 * everything that isn't a letter or a digit (so "Bob Rivera!" and "bob
 * rivera" collide, but "Bob" doesn't accidentally match "Bobbi").
 */
export function normalizeName(name) {
  if (typeof name !== "string") return "";
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Fuzzy-match candidates by normalized name.
 *
 * A candidate is a match iff its normalized nameOnBib either contains OR
 * is contained by the normalized sender name AND both normalized forms
 * are ≥3 chars (avoids matching everyone with "Al" in their name).
 *
 * Returns an array of matched Bib records so the caller can distinguish
 * "single unique match" (medium confidence) from "ambiguous" (do nothing).
 */
export function fuzzyMatchByName(senderDisplayName, bibs) {
  const senderNorm = normalizeName(senderDisplayName);
  if (senderNorm.length < 3) return [];

  const matches = [];
  for (const bib of bibs) {
    const bibNorm = normalizeName(bib?.nameOnBib);
    if (bibNorm.length < 3) continue;
    if (bibNorm.includes(senderNorm) || senderNorm.includes(bibNorm)) {
      matches.push(bib);
    }
  }
  return matches;
}

/**
 * Reconcile an extracted payment against the Bib table.
 *
 * @param {object} opts
 * @param {{
 *   provider: "venmo"|"cashapp"|"unknown",
 *   amount_cents: number,
 *   sender_display_name: string,
 *   comment_text: string,
 *   confidence: string,
 * }} opts.extracted
 * @param {(runnerCode: string) => Promise<object|null>} opts.getBibByRunnerCode
 *   Async lookup keyed by runnerCode (byRunnerCode GSI query).
 * @param {() => Promise<object[]>} [opts.listAllBibs]
 *   Async iterable of every Bib for the fallback scan. Only called when
 *   the primary lookup returns null. Optional — omit to disable fallback.
 * @returns {Promise<{
 *   status: "matched"|"unmatched",
 *   matchedOwnerSub?: string,
 *   matchedRunnerCode?: string,
 *   matchStrategy: "runner_code"|"name_fallback"|"none",
 *   confidence: "high"|"medium"|"low",
 * }>}
 */
export async function reconcileExtractedPayment({
  extracted,
  getBibByRunnerCode,
  listAllBibs,
}) {
  const runnerCode = extractRunnerCode(extracted?.comment_text);

  // Primary: exact runnerCode lookup.
  if (runnerCode) {
    const bib = await getBibByRunnerCode(runnerCode);
    if (bib && bib.ownerSub) {
      return {
        status: "matched",
        matchedOwnerSub: bib.ownerSub,
        matchedRunnerCode: bib.runnerCode,
        matchStrategy: "runner_code",
        confidence: "high",
      };
    }
  }

  // Fallback: fuzzy match on display name.
  if (typeof listAllBibs === "function" && extracted?.sender_display_name) {
    const bibs = await listAllBibs();
    const candidates = fuzzyMatchByName(
      extracted.sender_display_name,
      bibs
    );
    if (candidates.length === 1) {
      return {
        status: "matched",
        matchedOwnerSub: candidates[0].ownerSub,
        matchedRunnerCode: candidates[0].runnerCode,
        matchStrategy: "name_fallback",
        confidence: "medium",
      };
    }
    // 0 or >1 → do nothing. Ambiguous fallback is worse than none.
  }

  return {
    status: "unmatched",
    matchStrategy: "none",
    confidence: "low",
  };
}
