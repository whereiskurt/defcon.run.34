/**
 * Structured log-line builder for the run.human CTF judge (CTF-04).
 *
 * This mirrors the q.defcon.run resolver's `logline.mjs` shape (see
 * `apps/run.qr/lambda/resolver/lib/logline.mjs`) and extends its hygiene rule to
 * the judge: the judge emits at most ONE structured JSON line per solve attempt.
 *
 * The builder is PURE — it returns the plain object. `emit` is the only
 * side-effecting function (a single `console.log`), kept separate so the shape
 * stays trivially testable and so the judge can inject a spy in tests.
 *
 * LOG-HYGIENE INVARIANT (do not weaken): a CTF judge line must NEVER carry the
 * submitted guess. `ctfJudgeLog` structurally cannot leak it — its signature does
 * not accept a guess/answer/value argument at all. `result` is a COARSE outcome
 * marker (e.g. "solve" | "no-solve" | "capped" | "replay"), never the submitted
 * string. Leaving the raw guess in CloudWatch would both hand attackers the flags
 * and pollute analytics. Enforced by the hygiene test in
 * `__tests__/ctf-judge.test.ts`.
 */

/**
 * Build the log record for a single judge outcome.
 *
 * Signature takes ONLY `challenge` + a coarse `result` marker. There is no
 * `value`/`guess`/`answer` parameter and no such key in the output — this is the
 * structural enforcement point for the no-raw-guess invariant above.
 */
export function ctfJudgeLog({
  challenge,
  result,
}: {
  challenge: string;
  result: string;
}): { type: "ctf-judge"; challenge: string; result: string } {
  return { type: "ctf-judge", challenge, result };
}

/**
 * Emit a log record as a single JSON line to stdout. This is the only I/O in the
 * module; the judge injects it as `log` (default) so tests can substitute a spy.
 */
export function emit(obj: unknown): void {
  console.log(JSON.stringify(obj));
}
