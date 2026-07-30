import { describe, it, expect, vi } from "vitest";

import { judgeSolve, type CtfStore, type JudgeCtf, type PriorAward } from "../ctf-judge";
import { ctfJudgeLog } from "../ctf-log";
import { hashAnswer } from "../ctf-hash";

/**
 * These tests prove SC-2 (idempotency / cap-safety under concurrency) and the
 * hygiene half of SC-3 (the raw guess is never logged) against an IN-MEMORY fake
 * CtfStore — no DynamoDB. The fake faithfully models the load-bearing semantics:
 *   - claimSolve does a real map-keyed attribute_not_exists check (first caller
 *     wins → claimed:true; later callers → claimed:false + the stored prior award),
 *   - allocateOrdinal is a real incrementing per-challenge counter,
 *   - accrue sums into a per-user total,
 *   - overAttemptLimit is a per-(challenge,user) counter.
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

function makeStore(
  ctf: JudgeCtf | null,
  opts: { getCtfThrows?: boolean } = {},
) {
  const solves = new Map<string, Stored>(); // `${challenge}|${user}` → award
  const ordinals = new Map<string, number>(); // challenge → solveCount
  const userScore = new Map<string, { points: number; solves: number }>();
  const attempts = new Map<string, number>(); // `${challenge}|${user}` → count
  const scoreEventClaims = new Set<string>(); // `${challenge}|${user}|${bucket}` → claimed
  const scoreEvents: Array<{
    challenge: string;
    user: string;
    bucket: string;
    ordinal?: number;
    points: number;
    tierCeiling: number;
    channel: string;
  }> = []; // recordScoreEvent call log, in call order
  const state = { allocateCalls: 0 };
  const key = (c: string, u: string) => `${c}|${u}`;

  const store: CtfStore = {
    async getCtf() {
      if (opts.getCtfThrows) throw new Error("boom: store getCtf failed");
      return ctf;
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
        // attribute_not_exists FAILS → already solved; return the prior award.
        return {
          claimed: false,
          existing: {
            ordinal: existing.ordinal,
            points: existing.points,
            firstBlood: existing.firstBlood,
          },
        };
      }
      // First caller wins the conditional put. Reserve the row (score filled by
      // recordScore). No await between the has-check and the set → no lost update.
      solves.set(k, { challenge, user, ordinal: 0, points: 0, firstBlood: false });
      return { claimed: true };
    },
    async allocateOrdinal(challenge) {
      state.allocateCalls++;
      const n = (ordinals.get(challenge) ?? 0) + 1; // real atomic ADD
      ordinals.set(challenge, n);
      return n;
    },
    async recordScore({ challenge, user, ordinal, points, firstBlood }) {
      solves.set(key(challenge, user), { challenge, user, ordinal, points, firstBlood });
    },
    async accrue({ user, points }) {
      const s = userScore.get(user) ?? { points: 0, solves: 0 };
      s.points += points;
      s.solves += 1;
      userScore.set(user, s);
    },
    async reaccrue({ user, delta }) {
      const s = userScore.get(user) ?? { points: 0, solves: 0 };
      s.points += delta; // net adjustment; solve count is NOT bumped
      userScore.set(user, s);
    },
    async claimScoreEvent({ challenge, user, bucket }) {
      // attribute_not_exists(sk) once-per-window claim, mirroring claimSolve.
      const k = `${challenge}|${user}|${bucket}`;
      if (scoreEventClaims.has(k)) return { claimed: false };
      scoreEventClaims.add(k);
      return { claimed: true };
    },
    async overPerPlayerMax() {
      return false; // no per-player cap exercised by these tests
    },
    async recordScoreEvent({ challenge, user, bucket, ordinal, points, tierCeiling, channel }) {
      scoreEvents.push({ challenge, user, bucket, ordinal, points, tierCeiling, channel });
    },
  };

  return { store, solves, ordinals, userScore, attempts, scoreEvents, state };
}

describe("judgeSolve — concurrency & gap-free ordinals (SC-2)", () => {
  it("distinct new users get distinct, gap-free ordinals and each scores once", async () => {
    const ctf = fixtureCtf();
    const { store, ordinals, userScore, state } = makeStore(ctf);
    const users = ["u1", "u2", "u3", "u4", "u5"];

    // Genuinely concurrent submissions of the correct flag.
    const results = await Promise.all(
      users.map((user) =>
        judgeSolve({ user, challenge: CHALLENGE, guess: FLAG, channel: "qr" }, { store, now: 0, log: () => {} }),
      ),
    );

    // Every solver won a distinct ordinal; the set is exactly {1..5}, gap-free.
    const gotOrdinals = results.map((r) => r.ordinal).sort((a, b) => (a! - b!));
    expect(gotOrdinals).toEqual([1, 2, 3, 4, 5]);
    expect(ordinals.get(CHALLENGE)).toBe(5); // counter advanced exactly N times
    expect(state.allocateCalls).toBe(5); // one allocation per genuinely-new solver

    // Exactly one solver is first blood; each user scored exactly once.
    expect(results.filter((r) => r.firstBlood)).toHaveLength(1);
    for (const user of users) {
      expect(userScore.get(user)?.solves).toBe(1);
    }
    // Per-user totals sum to the expected points (each scored once, no double-count).
    const sumPerUser = users.reduce((acc, u) => acc + (userScore.get(u)?.points ?? 0), 0);
    const sumResults = results.reduce((acc, r) => acc + r.points, 0);
    expect(sumPerUser).toBe(sumResults);
    expect(results.every((r) => r.solved)).toBe(true);
  });
});

describe("judgeSolve — idempotent re-trigger (SC-2)", () => {
  it("same-user double-submit returns the PRIOR points/ordinal and never re-scores", async () => {
    const ctf = fixtureCtf();
    const { store, ordinals, userScore, state } = makeStore(ctf);
    const call = () =>
      judgeSolve({ user: "solo", challenge: CHALLENGE, guess: FLAG, channel: "qr" }, { store, now: 0, log: () => {} });

    const first = await call();
    expect(first.solved).toBe(true);
    expect(first.ordinal).toBe(1);
    expect(first.firstBlood).toBe(true);
    const firstPoints = first.points;

    const second = await call();
    // Idempotent re-trigger still celebrates, with the SAME award.
    expect(second.solved).toBe(true);
    expect(second.ordinal).toBe(1);
    expect(second.points).toBe(firstPoints);
    expect(second.firstBlood).toBe(true);

    // A third replay is likewise a no-op on solveCount and ctfScore.
    const third = await call();
    expect(third.ordinal).toBe(1);
    expect(third.points).toBe(firstPoints);

    // The ordinal counter and user total never moved past the first solve.
    expect(ordinals.get(CHALLENGE)).toBe(1); // Ctf.solveCount did NOT double-increment
    expect(state.allocateCalls).toBe(1); // claim-before-allocate: losers never allocate
    expect(userScore.get("solo")?.points).toBe(firstPoints); // RunUser.ctfScore unchanged
    expect(userScore.get("solo")?.solves).toBe(1);
  });
});

describe("judgeSolve — never throws, degrades to non-solve", () => {
  const NON_SOLVE = { solved: false, points: 0, ordinal: null, firstBlood: false, capped: false };

  it("wrong guess → solved:false, no claim, no throw", async () => {
    const ctf = fixtureCtf();
    const { store, solves, ordinals } = makeStore(ctf);
    const res = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: WRONG, channel: "qr" },
      { store, now: 0, log: () => {} },
    );
    expect(res).toEqual(NON_SOLVE);
    expect(solves.size).toBe(0); // never claimed
    expect(ordinals.get(CHALLENGE) ?? 0).toBe(0); // never allocated
  });

  it("missing challenge (getCtf → null) degrades to solved:false without throwing", async () => {
    const { store } = makeStore(null);
    await expect(
      judgeSolve({ user: "u1", challenge: "nope", guess: FLAG, channel: "qr" }, { store, now: 0, log: () => {} }),
    ).resolves.toEqual(NON_SOLVE);
  });

  it("disabled challenge → solved:false", async () => {
    const { store } = makeStore(fixtureCtf({ enabled: false }));
    const res = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store, now: 0, log: () => {} },
    );
    expect(res).toEqual(NON_SOLVE);
  });

  it("a throwing store degrades to solved:false without throwing", async () => {
    const { store } = makeStore(fixtureCtf(), { getCtfThrows: true });
    await expect(
      judgeSolve({ user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" }, { store, now: 0, log: () => {} }),
    ).resolves.toEqual(NON_SOLVE);
  });

  it("over-attempt-limit is INDISTINGUISHABLE from a wrong guess (invisibility)", async () => {
    const { store: overStore } = makeStore(fixtureCtf({ maxAttempts: 0 }));
    const overRes = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store: overStore, now: 0, log: () => {} },
    );
    const { store: wrongStore } = makeStore(fixtureCtf());
    const wrongRes = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: WRONG, channel: "qr" },
      { store: wrongStore, now: 0, log: () => {} },
    );
    expect(overRes).toEqual(wrongRes); // same result shape → no oracle
    expect(overRes).toEqual(NON_SOLVE);
  });
});

describe("judgeSolve — pre-hashed guess path (guessHash) parity", () => {
  const NON_SOLVE = { solved: false, points: 0, ordinal: null, firstBlood: false, capped: false };

  it("a correct guessHash solves + scores + is first-blood, identical to the raw path", async () => {
    const ctf = fixtureCtf();
    const { store: rawStore } = makeStore(ctf);
    const raw = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store: rawStore, now: 0, log: () => {} },
    );

    const { store: hashStore, ordinals, userScore } = makeStore(fixtureCtf());
    const hashed = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guessHash: hashAnswer(FLAG), channel: "qr" },
      { store: hashStore, now: 0, log: () => {} },
    );

    expect(hashed).toEqual(raw); // byte-identical result shape
    expect(hashed.solved).toBe(true);
    expect(hashed.firstBlood).toBe(true);
    expect(ordinals.get(CHALLENGE)).toBe(1);
    expect(userScore.get("u1")?.solves).toBe(1);
  });

  it("a wrong guessHash returns the identical NON_SOLVE shape (no claim, no allocate)", async () => {
    const { store, solves, ordinals } = makeStore(fixtureCtf());
    const res = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guessHash: hashAnswer(WRONG), channel: "qr" },
      { store, now: 0, log: () => {} },
    );
    expect(res).toEqual(NON_SOLVE);
    expect(solves.size).toBe(0);
    expect(ordinals.get(CHALLENGE) ?? 0).toBe(0);
  });

  it("the hashed path is idempotent — a re-claim returns the prior award, never re-scores", async () => {
    const { store, ordinals, userScore, state } = makeStore(fixtureCtf());
    const call = () =>
      judgeSolve(
        { user: "solo", challenge: CHALLENGE, guessHash: hashAnswer(FLAG), channel: "qr" },
        { store, now: 0, log: () => {} },
      );
    const first = await call();
    const second = await call();
    expect(second.ordinal).toBe(first.ordinal);
    expect(second.points).toBe(first.points);
    expect(ordinals.get(CHALLENGE)).toBe(1);
    expect(state.allocateCalls).toBe(1);
    expect(userScore.get("solo")?.solves).toBe(1);
  });

  it("guessHash takes precedence: a correct hash solves even with an empty/absent guess", async () => {
    const { store } = makeStore(fixtureCtf());
    const res = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guessHash: hashAnswer(FLAG), channel: "qr" },
      { store, now: 0, log: () => {} },
    );
    expect(res.solved).toBe(true);
  });
});

describe("judgeSolve — repeatable score events carry the solve ordinal (Task 3)", () => {
  it("records ordinal on repeatable score events, including capped ones", async () => {
    const ctf = fixtureCtf({ perPlayerIntervalHours: 24, globalMax: 1 });
    const { store, scoreEvents } = makeStore(ctf);

    const a = await judgeSolve(
      { user: "userA", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store, now: 0, log: () => {} },
    );
    const b = await judgeSolve(
      { user: "userB", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store, now: 0, log: () => {} },
    );

    // Solver A is first in, under globalMax:1 → scores; solver B is capped.
    expect(a.ordinal).toBe(1);
    expect(a.points).toBeGreaterThan(0);
    expect(b.ordinal).toBe(2);
    expect(b.points).toBe(0);
    expect(b.capped).toBe(true);

    // BOTH recorded events — including the capped one — carry the ordinal.
    expect(scoreEvents[0]).toMatchObject({ ordinal: 1 });
    expect(scoreEvents[1]).toMatchObject({ ordinal: 2, points: 0 });
  });
});

describe("log hygiene — the raw guess is NEVER logged (SC-3)", () => {
  it("no captured log call contains the guess substring, on solve OR wrong guess", async () => {
    const log = vi.fn();

    // A winning solve.
    const { store } = makeStore(fixtureCtf());
    await judgeSolve({ user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" }, { store, now: 0, log });
    // A wrong guess (a distinctive string we can hunt for).
    const distinctiveWrong = "PLEASE-DO-NOT-LEAK-ME-42";
    await judgeSolve(
      { user: "u2", challenge: CHALLENGE, guess: distinctiveWrong, channel: "qr" },
      { store, now: 0, log },
    );

    expect(log).toHaveBeenCalled();
    // Every logged record must be JSON-serializable.
    for (const [rec] of log.mock.calls) {
      expect(() => JSON.stringify(rec)).not.toThrow();
    }
    // Deep-stringify ALL captured calls and assert neither guess appears anywhere.
    const dump = JSON.stringify(log.mock.calls);
    expect(dump).not.toContain(FLAG);
    expect(dump).not.toContain(distinctiveWrong);
  });

  it("ctfJudgeLog output has no key holding the guess and no value/guess key", async () => {
    const rec = ctfJudgeLog({ challenge: CHALLENGE, result: "solve" });
    expect(Object.keys(rec)).toEqual(["type", "challenge", "result"]);
    expect(Object.keys(rec)).not.toContain("value");
    expect(Object.keys(rec)).not.toContain("guess");
    expect(Object.values(rec)).not.toContain(FLAG);
  });

  it("the judge emits at most one log line per call", async () => {
    const log = vi.fn();
    const { store } = makeStore(fixtureCtf());
    await judgeSolve({ user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" }, { store, now: 0, log });
    expect(log.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("the hashed path leaks neither the raw guess NOR the submitted hash to any log line", async () => {
    const log = vi.fn();
    const { store } = makeStore(fixtureCtf());
    const guessHash = hashAnswer(FLAG);
    await judgeSolve({ user: "u1", challenge: CHALLENGE, guessHash, channel: "qr" }, { store, now: 0, log });
    await judgeSolve(
      { user: "u2", challenge: CHALLENGE, guessHash: hashAnswer("PLEASE-DO-NOT-LEAK-THE-HASH"), channel: "qr" },
      { store, now: 0, log },
    );
    const dump = JSON.stringify(log.mock.calls);
    expect(dump).not.toContain(FLAG); // raw guess never present
    expect(dump).not.toContain(guessHash); // the submitted hash never present either
  });
});
