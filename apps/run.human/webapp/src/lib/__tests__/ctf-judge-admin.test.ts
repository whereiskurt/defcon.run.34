import { describe, it, expect } from "vitest";

import { judgeSolve, type CtfStore, type JudgeCtf, type PriorAward } from "../ctf-judge";
import { hashAnswer } from "../ctf-hash";

/**
 * The `admin` input (points-consistency, Task 6). The judge no longer re-scores
 * an already-solved flag in place (the old admin re-submit override, design:
 * 2026-07-14-ctf-admin-resubmit-override, is removed — `accrue`/`reaccrue` are
 * gone from `CtfStore` and re-scoring now happens exclusively via
 * `rescoreBestEffort` after a `solved: true` result). `admin` is kept SOLELY to
 * bypass the per-challenge attempt cap, so operators can iterate on a challenge
 * without self-locking out. Correctness (a wrong answer) is never bypassed.
 *
 * All against an in-memory fake CtfStore — no DynamoDB.
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
 *  challenge setup between calls if needed. */
function makeStore(ctfRef: { current: JudgeCtf | null }) {
  const solves = new Map<string, Stored>();
  const ordinals = new Map<string, number>();
  const attempts = new Map<string, number>();
  const state = { allocateCalls: 0 };
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
  };

  return { store, solves, ordinals, attempts, state };
}

const silent = { now: 0, log: () => {} };

describe("admin — attempt cap bypass, correctness preserved", () => {
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

  it("an admin's first-ever solve takes the normal fresh-solve path", async () => {
    const ctfRef = { current: fixtureCtf() };
    const { store, ordinals, state } = makeStore(ctfRef);
    const res = await judgeSolve(
      { user: "op", challenge: CHALLENGE, guess: FLAG, channel: "covert", admin: true },
      { store, ...silent },
    );
    expect(res.solved).toBe(true);
    expect(res.ordinal).toBe(1);
    expect(res.firstBlood).toBe(true);
    expect(ordinals.get(CHALLENGE)).toBe(1);
    expect(state.allocateCalls).toBe(1);
  });

  it("an admin re-submitting an already-solved flag gets the frozen PRIOR award (no re-score in place)", async () => {
    const ctfRef = { current: fixtureCtf({ pointMax: 500 }) };
    const { store } = makeStore(ctfRef);
    const first = await judgeSolve(
      { user: "op", challenge: CHALLENGE, guess: FLAG, channel: "covert", admin: true },
      { store, ...silent },
    );
    expect(first.solved).toBe(true);

    // Operator changes the challenge config after the first solve.
    ctfRef.current = fixtureCtf({ pointMax: 300 });
    const second = await judgeSolve(
      { user: "op", challenge: CHALLENGE, guess: FLAG, channel: "covert", admin: true },
      { store, ...silent },
    );
    // NOT re-scored to the new config — the judge echoes the frozen prior award.
    // (Re-scoring against live config is now Tasks 7-10's rescoreBestEffort job.)
    expect(second.solved).toBe(true);
    expect(second.ordinal).toBe(first.ordinal);
    expect(second.points).toBe(first.points);
  });
});
