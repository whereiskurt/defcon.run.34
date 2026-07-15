import { describe, it, expect } from "vitest";

import { judgeSolve, type CtfStore, type JudgeCtf, type PriorAward } from "../ctf-judge";
import { computePoints } from "../ctf-scoring";
import { hashAnswer } from "../ctf-hash";

/**
 * The ADMIN re-submit override (design: 2026-07-14-ctf-admin-resubmit-override).
 *
 * An admin submitting an already-solved flag must:
 *   - re-score against the challenge's CURRENT config (not the frozen prior award),
 *   - reuse the existing ordinal (never bump Ctf.solveCount),
 *   - move RunUser.ctfScore by the NET DELTA only (idempotent — unchanged config
 *     → no change), leaving ctfSolves untouched (still one solve),
 *   - bypass the per-challenge attempt cap,
 *   - STILL require the correct answer (correctness is never bypassed).
 * Non-admins are wholly unaffected (the existing replay path).
 *
 * All against an in-memory fake CtfStore — no DynamoDB. `reaccrue` adjusts the
 * per-user points by a (possibly negative) delta and NEVER bumps the solve count.
 */

const FLAG = "s3cr3t-defcon-flag";
const WRONG = "not-the-flag";
const CHALLENGE = "meshmaze";

function fixtureCtf(overrides: Partial<JudgeCtf> = {}): JudgeCtf {
  return {
    challenge: CHALLENGE,
    answerHash: hashAnswer(FLAG),
    enabled: true,
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

type Stored = PriorAward & { challenge: string; user: string };

/** Fake store whose Ctf config is a MUTABLE ref, so a test can change the
 *  challenge setup between an admin's first solve and their re-submit. */
function makeStore(ctfRef: { current: JudgeCtf | null }) {
  const solves = new Map<string, Stored>();
  const ordinals = new Map<string, number>();
  const userScore = new Map<string, { points: number; solves: number }>();
  const attempts = new Map<string, number>();
  const state = { allocateCalls: 0, accrueCalls: 0, reaccrueCalls: [] as Array<{ user: string; delta: number }> };
  const key = (c: string, u: string) => `${c}|${u}`;

  const store: CtfStore = {
    async getCtf() {
      return ctfRef.current;
    },
    async overAttemptLimit({ challenge, user, max }) {
      const k = key(challenge, user);
      const c = (attempts.get(k) ?? 0) + 1;
      attempts.set(k, c);
      return c > max;
    },
    async claimSolve({ challenge, user }) {
      const k = key(challenge, user);
      const existing = solves.get(k);
      if (existing) {
        return {
          claimed: false,
          existing: { ordinal: existing.ordinal, points: existing.points, firstBlood: existing.firstBlood },
        };
      }
      solves.set(k, { challenge, user, ordinal: 0, points: 0, firstBlood: false });
      return { claimed: true };
    },
    async allocateOrdinal(challenge) {
      state.allocateCalls++;
      const n = (ordinals.get(challenge) ?? 0) + 1;
      ordinals.set(challenge, n);
      return n;
    },
    async recordScore({ challenge, user, ordinal, points, firstBlood }) {
      solves.set(key(challenge, user), { challenge, user, ordinal, points, firstBlood });
    },
    async accrue({ user, points }) {
      state.accrueCalls++;
      const s = userScore.get(user) ?? { points: 0, solves: 0 };
      s.points += points;
      s.solves += 1;
      userScore.set(user, s);
    },
    async reaccrue({ user, delta }) {
      state.reaccrueCalls.push({ user, delta });
      const s = userScore.get(user) ?? { points: 0, solves: 0 };
      s.points += delta; // net adjustment; solve count is NOT bumped
      userScore.set(user, s);
    },
  };

  return { store, solves, ordinals, userScore, attempts, state };
}

const silent = { now: 0, log: () => {} };

describe("admin override — re-score to CURRENT config, idempotent on the board", () => {
  it("re-submit as admin recomputes points for the live config, reuses the ordinal, moves ctfScore by the delta only", async () => {
    const ctfRef = { current: fixtureCtf({ pointMax: 500 }) };
    const { store, ordinals, userScore, state } = makeStore(ctfRef);

    // First solve under config A (pointMax 500). n=1 → 500 + 50 firstBlood = 550.
    const first = await judgeSolve(
      { user: "op", challenge: CHALLENGE, guess: FLAG, channel: "covert", admin: true },
      { store, ...silent },
    );
    const expectedA = computePoints(1, ctfRef.current!, 0);
    expect(first.solved).toBe(true);
    expect(first.ordinal).toBe(1);
    expect(first.points).toBe(expectedA);
    expect(userScore.get("op")).toEqual({ points: expectedA, solves: 1 });

    // Operator lowers the challenge ceiling (config B: pointMax 300).
    ctfRef.current = fixtureCtf({ pointMax: 300 });
    const expectedB = computePoints(1, ctfRef.current!, 0);
    expect(expectedB).not.toBe(expectedA); // sanity: the config really changed

    const second = await judgeSolve(
      { user: "op", challenge: CHALLENGE, guess: FLAG, channel: "covert", admin: true },
      { store, ...silent },
    );
    // Re-scored to the LIVE config; ordinal reused; still first blood.
    expect(second.solved).toBe(true);
    expect(second.ordinal).toBe(1);
    expect(second.firstBlood).toBe(true);
    expect(second.points).toBe(expectedB);

    // Board is idempotent: ctfScore reflects a SINGLE current award (delta applied),
    // ctfSolves unchanged, solveCount never bumped.
    expect(userScore.get("op")).toEqual({ points: expectedB, solves: 1 });
    expect(ordinals.get(CHALLENGE)).toBe(1); // solveCount did NOT advance
    expect(state.allocateCalls).toBe(1); // only the first solve allocated
    expect(state.reaccrueCalls).toEqual([{ user: "op", delta: expectedB - expectedA }]);
  });

  it("re-submit as admin with UNCHANGED config is a net-zero no-op on ctfScore (still celebrates)", async () => {
    const ctfRef = { current: fixtureCtf() };
    const { store, userScore, state } = makeStore(ctfRef);
    const call = () =>
      judgeSolve({ user: "op", challenge: CHALLENGE, guess: FLAG, channel: "covert", admin: true }, { store, ...silent });

    const first = await call();
    const second = await call();

    expect(second.solved).toBe(true);
    expect(second.points).toBe(first.points);
    expect(userScore.get("op")).toEqual({ points: first.points, solves: 1 }); // unchanged
    expect(state.reaccrueCalls).toEqual([{ user: "op", delta: 0 }]); // delta 0
  });
});

describe("admin override — non-admins are unaffected (regression)", () => {
  it("a non-admin re-submit returns the frozen prior award and never re-scores", async () => {
    const ctfRef = { current: fixtureCtf({ pointMax: 500 }) };
    const { store, userScore, state } = makeStore(ctfRef);
    const call = () =>
      judgeSolve({ user: "player", challenge: CHALLENGE, guess: FLAG, channel: "covert" }, { store, ...silent });

    const first = await call();
    // Config changes under the player's feet — a non-admin must NOT see it.
    ctfRef.current = fixtureCtf({ pointMax: 300 });
    const second = await call();

    expect(second.points).toBe(first.points); // frozen prior award, NOT re-scored
    expect(second.ordinal).toBe(1);
    expect(userScore.get("player")).toEqual({ points: first.points, solves: 1 });
    expect(state.reaccrueCalls).toEqual([]); // reaccrue never called for a player
  });
});

describe("admin override — attempt cap bypass, correctness preserved", () => {
  const NON_SOLVE = { solved: false, points: 0, ordinal: null, firstBlood: false, capped: false };

  it("an admin bypasses the attempt cap where a player would be blocked", async () => {
    const adminRef = { current: fixtureCtf({ maxAttempts: 0 }) };
    const { store: adminStore } = makeStore(adminRef);
    const adminRes = await judgeSolve(
      { user: "op", challenge: CHALLENGE, guess: FLAG, channel: "covert", admin: true },
      { store: adminStore, ...silent },
    );
    expect(adminRes.solved).toBe(true); // not rate-limited

    const playerRef = { current: fixtureCtf({ maxAttempts: 0 }) };
    const { store: playerStore } = makeStore(playerRef);
    const playerRes = await judgeSolve(
      { user: "player", challenge: CHALLENGE, guess: FLAG, channel: "covert" },
      { store: playerStore, ...silent },
    );
    expect(playerRes).toEqual(NON_SOLVE); // capped out
  });

  it("an admin with the WRONG answer is still a graceful non-solve (correctness not bypassed)", async () => {
    const ctfRef = { current: fixtureCtf() };
    const { store, solves } = makeStore(ctfRef);
    const res = await judgeSolve(
      { user: "op", challenge: CHALLENGE, guess: WRONG, channel: "covert", admin: true },
      { store, ...silent },
    );
    expect(res).toEqual(NON_SOLVE);
    expect(solves.size).toBe(0); // never claimed
  });

  it("an admin's first-ever solve takes the normal fresh-solve path (allocate + accrue once)", async () => {
    const ctfRef = { current: fixtureCtf() };
    const { store, ordinals, userScore, state } = makeStore(ctfRef);
    const res = await judgeSolve(
      { user: "op", challenge: CHALLENGE, guess: FLAG, channel: "covert", admin: true },
      { store, ...silent },
    );
    expect(res.solved).toBe(true);
    expect(res.ordinal).toBe(1);
    expect(res.firstBlood).toBe(true);
    expect(ordinals.get(CHALLENGE)).toBe(1);
    expect(state.allocateCalls).toBe(1);
    expect(state.accrueCalls).toBe(1);
    expect(state.reaccrueCalls).toEqual([]); // no re-score on a first solve
    expect(userScore.get("op")).toEqual({ points: res.points, solves: 1 });
  });
});
