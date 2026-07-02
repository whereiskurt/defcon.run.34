import * as crypto from "crypto";
import { getBibByRunnerCode } from "@/entities/bib";

/**
 * runnerCode ("BIB-XXXX") generator + collision-safe wrapper.
 *
 * Design contract (Kurt v1.5):
 *   - Format: "BIB-XXXX" where XXXX are 4 characters from an unambiguous
 *     alphabet (no 0/O/I/1 confusion, per Kurt "no ambiguous chars").
 *   - Immutable per-user (Bib entity marks it readOnly).
 *   - Payers put this in the Venmo/CashApp comment to reconcile payment ->
 *     Bib via runnerCode-index GSI.
 *
 * Alphabet: [A-HJ-NP-Z2-9], which excludes 0/O/I/1 (visual ambiguity).
 * L is kept — the Arial-Black stack the bib SVG uses renders L distinctly
 * from 1 and I, and dropping L would break the alphabet's power-of-two
 * (32-char) shape that keeps rejection sampling uniform.
 * That leaves 32 characters -> 32^4 = 1,048,576 combinations. Comfortable
 * headroom for a single-event ~1000-bib target with negligible collision odds
 * (birthday-paradox ~50% at ~1023 codes for a 32^4 space) but collision is
 * still possible, hence the retry loop below.
 */

/**
 * Runtime-exported alphabet — also used by unit tests to assert the ambiguous
 * chars are excluded. Do NOT reorder or add characters without also updating
 * the tests in src/__tests__/runner-code.test.ts.
 */
export const RUNNER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Generate a single BIB-XXXX code with rejection sampling so the resulting
 * character distribution is uniform (naive mod-of-random-byte would bias
 * toward earlier alphabet indices because 256 % 32 == 0 — safe in this exact
 * case, but rejection sampling protects against future alphabet-size drift).
 */
export function generateRunnerCode(): string {
  const alphabet = RUNNER_CODE_ALPHABET;
  const alphabetLen = alphabet.length;
  // Highest byte value that yields a uniform mapping into alphabetLen.
  const rejectAt = 256 - (256 % alphabetLen);

  const chars: string[] = [];
  while (chars.length < 4) {
    // Grab a fresh random byte per attempt.
    const b = crypto.randomBytes(1)[0];
    if (b >= rejectAt) continue;
    chars.push(alphabet[b % alphabetLen]);
  }
  return `BIB-${chars.join("")}`;
}

/**
 * Generate a runnerCode that is not already in use.
 *
 * Queries Bib.byRunnerCode (runnerCode-index GSI) for each candidate until
 * the query returns empty. Retries up to `maxAttempts` times; throws if all
 * attempts collide.
 *
 * Realistic collision probability at ~1000 bibs is <0.001 (see comment
 * above), so maxAttempts=5 is generous.
 */
export async function generateUniqueRunnerCode(
  maxAttempts: number = 5
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = generateRunnerCode();
    const existing = await getBibByRunnerCode(candidate);
    if (!existing) {
      return candidate;
    }
  }
  throw new Error(
    `Unable to generate a unique runnerCode after ${maxAttempts} attempts`
  );
}
