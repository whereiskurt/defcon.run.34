import { describe, it, expect, vi } from "vitest";

import { judgeSolve, type CtfStore, type JudgeCtf } from "../ctf-judge";
import { ctfJudgeLog } from "../ctf-log";
import { hashAnswer } from "../ctf-hash";

/**
 * Wordlist single-use judge tests (CTFT-13, Slice 3).
 *
 * These prove the concurrency-correct heart of the wordlist answer type against
 * an IN-MEMORY fake CtfStore — no DynamoDB. The fake `claimCode` faithfully
 * models the load-bearing `attribute_not_exists(claimedBy)` semantics:
 *   - a Map<codeHash, {claimedBy?}> seeded with the pre-loaded (unclaimed) codes,
 *   - the presence-check and the set happen with NO await between them, exactly
 *     like the sibling `claimSolve` fake, so the first concurrent claimer wins
 *     (`claimed:true`) and the loser gets `claimed:false` (no lost update).
 *
 * SC1: two concurrent submissions of the SAME unclaimed code → EXACTLY one solve.
 * SC2: a used/unknown code is a NON_SOLVE indistinguishable from a wrong answer;
 *      a valid code scores through the ledger+accrue path.
 * The guess/codeHash is NEVER passed to the logger.
 *
 * ⚠ DB-write coverage note: the fake `recordScoreEvent` is a plain array push
 * with NO create-vs-patch precondition, so it CANNOT catch the real defaultStore
 * create-vs-patch distinction — the wordlist finalize bypasses `claimScoreEvent`,
 * so the ledger row must be UPSERT/created, not patched (a `.patch()` would throw
 * ConditionalCheckFailed on a first-time code → NON_SOLVE). That semantics is
 * confirmed by reading the ElectroDB call in defaultStore, not by these tests.
 */

const CHALLENGE = "wordmaze";
const CODE = "alpha-bravo-charlie";
const CODE2 = "delta-echo-foxtrot";

export function wordlistCtf(overrides: Partial<JudgeCtf> = {}): JudgeCtf {
  return {
    challenge: CHALLENGE,
    // answerHash is unused on the wordlist path (validation is the atomic claim).
    answerHash: "",
    enabled: true,
    answerType: "wordlist",
    pointMax: 500,
    pointFloor: 100,
    maxSolves: 100,
    firstBloodBonus: 50,
    timeTiers: undefined,
    maxAttempts: 1000,
    rateLimitWindow: 60,
    ...overrides,
  };
}

/**
 * An in-memory CtfStore whose `claimCode` models the conditional single-use claim
 * over a Map seeded with the pre-loaded (unclaimed) codeHashes. `recordScoreEvent`
 * records the ledger row; `accrue` sums per-user.
 */
export function makeWordlistStore(ctf: JudgeCtf | null, seededCodes: string[]) {
  const codes = new Map<string, { claimedBy?: string }>();
  for (const c of seededCodes) codes.set(hashAnswer(c), {});
  const ordinals = new Map<string, number>();
  const userScore = new Map<string, { points: number; solves: number }>();
  const ledger: Array<{ challenge: string; user: string; bucket: string; points: number }> = [];
  const state = { accrueCalls: 0, claimCodeCalls: 0, recordScoreEventCalls: 0 };

  const store: CtfStore = {
    async getCtf() {
      return ctf;
    },
    async overAttemptLimit() {
      return false;
    },
    // Never reached on the wordlist path (validation is claimCode, finalize is the
    // dedicated wordlist block) — present only to satisfy the interface.
    async claimSolve() {
      return { claimed: true };
    },
    async allocateOrdinal(challenge) {
      const n = (ordinals.get(challenge) ?? 0) + 1; // real atomic ADD
      ordinals.set(challenge, n);
      return n;
    },
    async recordScore() {
      /* unused on wordlist path */
    },
    async accrue({ user, points }) {
      state.accrueCalls++;
      const s = userScore.get(user) ?? { points: 0, solves: 0 };
      s.points += points;
      s.solves += 1;
      userScore.set(user, s);
    },
    async recordScoreEvent({ challenge, user, bucket, points }) {
      state.recordScoreEventCalls++;
      ledger.push({ challenge, user, bucket, points });
    },
    async claimCode({ codeHash, user }) {
      state.claimCodeCalls++;
      const row = codes.get(codeHash);
      // attribute_not_exists(claimedBy): unknown row OR already-claimed ⇒ no claim.
      if (!row || row.claimedBy) return { claimed: false };
      // No await between the presence-check and the set → models the atomic
      // conditional (first concurrent claimer wins, no lost update).
      row.claimedBy = user;
      return { claimed: true };
    },
  };

  return { store, codes, ordinals, userScore, ledger, state };
}

describe("judgeSolve wordlist — two-claimers-one-wins race (SC1)", () => {
  it("two concurrent submissions of the SAME unclaimed code yield exactly one solve", async () => {
    const { store, ledger, state } = makeWordlistStore(wordlistCtf(), [CODE]);

    const results = await Promise.all([
      judgeSolve({ user: "u1", challenge: CHALLENGE, guess: CODE, channel: "qr" }, { store, now: 0, log: () => {} }),
      judgeSolve({ user: "u2", challenge: CHALLENGE, guess: CODE, channel: "qr" }, { store, now: 0, log: () => {} }),
    ]);

    const winners = results.filter((r) => r.solved);
    const losers = results.filter((r) => !r.solved);
    expect(winners).toHaveLength(1); // EXACTLY one winner
    expect(losers).toHaveLength(1); // EXACTLY one non-solve
    expect(winners[0].points).toBeGreaterThan(0);
    expect(state.accrueCalls).toBe(1); // exactly one accrue
    expect(ledger).toHaveLength(1); // exactly one ledger row written
  });

  it("a SECOND distinct code by the same user still scores (per-code single-use, not per-user once)", async () => {
    const { store, ledger, state } = makeWordlistStore(wordlistCtf(), [CODE, CODE2]);

    const first = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: CODE, channel: "qr" },
      { store, now: 0, log: () => {} },
    );
    const second = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: CODE2, channel: "qr" },
      { store, now: 0, log: () => {} },
    );

    expect(first.solved).toBe(true);
    expect(second.solved).toBe(true);
    expect(state.accrueCalls).toBe(2);
    expect(ledger).toHaveLength(2);
    // Each code maps to its OWN ledger row keyed by that code's hash.
    expect(new Set(ledger.map((l) => l.bucket)).size).toBe(2);
  });
});

describe("judgeSolve wordlist — used/unknown code ⇒ non-solve (SC2, claimCode semantics)", () => {
  it("an UNKNOWN code (no pre-loaded row) is a non-solve", async () => {
    const { store, ledger, state } = makeWordlistStore(wordlistCtf(), [CODE]);
    const r = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: "totally-unknown-code", channel: "qr" },
      { store, now: 0, log: () => {} },
    );
    expect(r.solved).toBe(false);
    expect(state.accrueCalls).toBe(0);
    expect(ledger).toHaveLength(0);
  });

  it("an ALREADY-claimed code is a non-solve on the second submit", async () => {
    const { store, state } = makeWordlistStore(wordlistCtf(), [CODE]);
    const first = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: CODE, channel: "qr" },
      { store, now: 0, log: () => {} },
    );
    const second = await judgeSolve(
      { user: "u2", challenge: CHALLENGE, guess: CODE, channel: "qr" },
      { store, now: 0, log: () => {} },
    );
    expect(first.solved).toBe(true);
    expect(second.solved).toBe(false);
    expect(state.accrueCalls).toBe(1);
  });
});

describe("judgeSolve wordlist — scoring, indistinguishability & covert (SC2/SC4)", () => {
  it("a valid code scores points>0, writes ONE ledger row keyed by codeHash, and accrues once", async () => {
    const { store, userScore, ledger, state } = makeWordlistStore(wordlistCtf(), [CODE]);
    const r = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: CODE, channel: "qr" },
      { store, now: 0, log: () => {} },
    );
    expect(r.solved).toBe(true);
    expect(r.points).toBeGreaterThan(0);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].bucket).toBe(hashAnswer(CODE)); // ledger row keyed by the codeHash
    expect(state.accrueCalls).toBe(1);
    expect(userScore.get("u1")?.solves).toBe(1);
  });

  it("a used/unknown code returns the EXACT NON_SOLVE a wrong static answer yields + the SAME no-solve log (no guess/codeHash leak)", async () => {
    const { store } = makeWordlistStore(wordlistCtf(), [CODE]);
    const log = vi.fn();
    const guess = "totally-unknown-code";
    const r = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess, channel: "qr" },
      { store, now: 0, log },
    );
    // Byte-for-byte the shape a wrong static answer returns (no `effect` key).
    expect(r).toEqual({ solved: false, points: 0, ordinal: null, firstBlood: false, capped: false });
    // Same coarse no-solve payload the sibling gates emit — no extra fields.
    expect(log).toHaveBeenCalledWith(ctfJudgeLog({ challenge: CHALLENGE, result: "no-solve" }));
    // The guess and its hash NEVER appear in any log argument.
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(guess);
    expect(logged).not.toContain(hashAnswer(guess));
  });

  it("solves indistinguishably over the COVERT guessHash path (no raw guess)", async () => {
    const { store, ledger } = makeWordlistStore(wordlistCtf(), [CODE]);
    const r = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guessHash: hashAnswer(CODE), channel: "covert" },
      { store, now: 0, log: () => {} },
    );
    expect(r.solved).toBe(true);
    expect(r.points).toBeGreaterThan(0);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].bucket).toBe(hashAnswer(CODE)); // covert derives codeHash from guessHash
  });

  it("honors globalMax: a claim past the global cap is solved:true/points:0/capped with NO accrue", async () => {
    const { store, state } = makeWordlistStore(wordlistCtf({ globalMax: 1 }), [CODE, CODE2]);
    const first = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: CODE, channel: "qr" },
      { store, now: 0, log: () => {} },
    );
    const second = await judgeSolve(
      { user: "u2", challenge: CHALLENGE, guess: CODE2, channel: "qr" },
      { store, now: 0, log: () => {} },
    );
    expect(first.solved).toBe(true);
    expect(first.points).toBeGreaterThan(0);
    expect(second).toMatchObject({ solved: true, points: 0, capped: true });
    expect(state.accrueCalls).toBe(1); // the capped claim did NOT accrue
  });
});
