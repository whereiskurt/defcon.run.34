/**
 * CTF plaintext→answerHash migration DECISION (CTF-10, Phase 47).
 *
 * This module is PURE: it makes the per-row decision only and performs no I/O.
 * The DynamoDB write lives in the standalone operator script
 * `scripts/migrate-ctf-answerhash.mts`. The app NEVER imports this at request
 * time — the only in-app consumer is the unit test.
 *
 * Parity is load-bearing: we import `hashAnswer` from `./ctf-hash` (the SAME
 * seam the Phase-44 judge verifies against) rather than re-implementing the
 * salt/normalize, so a migrated `answerHash` is byte-identical to what the
 * judge produces — migrated answers still verify.
 *
 * Decision (idempotent by construction):
 *   - answer present (non-empty after trim) AND no answerHash → hash-and-clear
 *   - answer present AND answerHash already set               → clear-only
 *   - no meaningful plaintext answer                          → skip
 * A row that has already been migrated (plaintext removed, answerHash set)
 * re-plans to `skip`, so a re-run is a no-op.
 */

import { hashAnswer } from "./ctf-hash";

export interface CtfMigrationRow {
  challenge: string;
  answer?: string;
  answerHash?: string;
}

export type CtfMigrationPlan =
  | { action: "skip" }
  | { action: "clear-only" }
  | { action: "hash-and-clear"; answerHash: string };

/** True only when `answer` is a non-empty, non-whitespace string. */
function hasPlaintextAnswer(answer?: string): answer is string {
  return typeof answer === "string" && answer.trim().length > 0;
}

/**
 * Decide what to do with a single Ctf row. Pure — no DynamoDB, no logging.
 * `answerHash` is included only for the `hash-and-clear` case (computed via the
 * judge's `hashAnswer`, so it is byte-identical to what the judge verifies).
 */
export function planCtfMigration(row: CtfMigrationRow): CtfMigrationPlan {
  if (!hasPlaintextAnswer(row.answer)) {
    // Nothing meaningful to hash — already migrated or never had an answer.
    return { action: "skip" };
  }
  if (row.answerHash) {
    // Hash already set: don't clobber it, just strip the leftover plaintext.
    return { action: "clear-only" };
  }
  // Plaintext present, no hash yet: hash it (judge parity) and clear plaintext.
  return { action: "hash-and-clear", answerHash: hashAnswer(row.answer) };
}
