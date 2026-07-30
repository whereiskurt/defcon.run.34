import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ctf-unsolve-store orchestration test. The pure sole-solver decision is
 * proven in ctf-unsolve.test.ts; this locks how applyPlan WIRES the ElectroDB
 * deletes to rescoreUser (points-consistency's SOLE writer of RunUser score
 * fields) and to the sole-solver Ctf.solveCount reset:
 *   - rescoreUser is called exactly once per unsolve action, AFTER the row
 *     deletes, so it always re-derives from the post-delete ledger;
 *   - a phantom userId (no RunUser row) skips rescoreUser rather than letting
 *     its patch (item-must-exist) throw;
 *   - Ctf.solveCount is reset ONLY where the target was the sole solver, and
 *     the sole-solver test reads the PRE-delete count.
 *
 * The ElectroDB entities are mocked with chainable stubs; rescoreUser itself
 * is mocked outright — its own math is proven by rescore.ts's own tests.
 */

const h = vi.hoisted(() => {
  const goOf = (data: unknown) => ({ go: vi.fn().mockResolvedValue({ data }) });
  return {
    goOf,
    // per-test data
    solveRows: [] as Array<{ challenge: string; user: string; points?: number }>,
    eventRows: [] as Array<{ challenge: string; user: string; bucket: string; points?: number }>,
    primaryCounts: {} as Record<string, number>, // challenge -> total CtfSolve rows
    userExists: true,
    ctfExists: {} as Record<string, boolean>,
    rescoreResult: { score: 0, counts: { solves: 0 } } as {
      score: number;
      counts: { solves: number };
    },
    // spies
    rescoreUser: vi.fn(),
    ctfPatchSet: vi.fn(),
    solveDelete: vi.fn(),
    eventDelete: vi.fn(),
    attemptDelete: vi.fn(),
  };
});

vi.mock("@/entities/ctf", () => ({
  CtfSolve: {
    query: {
      byUser: vi.fn(() => h.goOf(h.solveRows)),
      primary: vi.fn((k: { challenge: string }) =>
        h.goOf(Array.from({ length: h.primaryCounts[k.challenge] ?? 0 }, () => ({})))
      ),
    },
    delete: vi.fn((k: unknown) => {
      h.solveDelete(k);
      return h.goOf({});
    }),
  },
  CtfScoreEvent: {
    query: { byUser: vi.fn(() => h.goOf(h.eventRows)) },
    delete: vi.fn((k: unknown) => {
      h.eventDelete(k);
      return h.goOf({});
    }),
  },
  CtfAttempt: {
    delete: vi.fn((k: unknown) => {
      h.attemptDelete(k);
      return { go: vi.fn().mockResolvedValue({ data: null }) };
    }),
  },
}));

vi.mock("@/entities/qr", () => ({
  Ctf: {
    get: vi.fn((k: { challenge: string }) => h.goOf(h.ctfExists[k.challenge] ? { challenge: k.challenge } : null)),
    patch: vi.fn(() => ({
      set: (obj: unknown) => {
        h.ctfPatchSet(obj);
        return h.goOf({});
      },
    })),
  },
}));

vi.mock("@/entities/run-user", () => ({
  getRunUser: vi.fn((userId: string) =>
    Promise.resolve(h.userExists ? { userId } : null)
  ),
}));

vi.mock("@/lib/rescore", () => ({
  rescoreUser: (userId: string) => {
    h.rescoreUser(userId);
    return Promise.resolve(h.rescoreResult);
  },
}));

vi.mock("@/lib/qr-admin", () => ({
  normalizeChallenge: (s: string) => s.toLowerCase().trim(),
}));

import { unsolveUser, unsolveChallenge } from "../ctf-unsolve-store";

beforeEach(() => {
  h.solveRows = [];
  h.eventRows = [];
  h.primaryCounts = {};
  h.userExists = true;
  h.ctfExists = {};
  h.rescoreResult = { score: 0, counts: { solves: 0 } };
  h.rescoreUser.mockReset();
  h.ctfPatchSet.mockReset();
  h.solveDelete.mockReset();
  h.eventDelete.mockReset();
  h.attemptDelete.mockReset();
});

describe("unsolveChallenge — rescore wiring (finding [0] repeatable flag)", () => {
  it("calls rescoreUser once, after the deletes, and reports its result", async () => {
    // A repeatable challenge: NO CtfSolve rows, 3 score events.
    h.eventRows = [
      { challenge: "daily", user: "u1", bucket: "b1", points: 10 },
      { challenge: "daily", user: "u1", bucket: "b2", points: 10 },
      { challenge: "daily", user: "u1", bucket: "b3", points: 10 },
    ];
    h.primaryCounts = { daily: 0 };
    h.rescoreResult = { score: 10, counts: { solves: 0 } };

    const r = await unsolveChallenge("u1", "Daily");

    expect(h.rescoreUser).toHaveBeenCalledTimes(1);
    expect(h.rescoreUser).toHaveBeenCalledWith("u1");
    expect(h.eventDelete).toHaveBeenCalledTimes(3);
    expect(r.removedScoreEvents).toBe(3);
    expect(r.removedSolves).toBe(0); // reported = actual CtfSolve rows
    expect(r.nextScore).toBe(10);
    expect(r.nextSolves).toBe(0);
  });

  it("skips rescoreUser for a phantom userId (no RunUser row) instead of throwing", async () => {
    h.solveRows = [{ challenge: "alpha", user: "u1", points: 50 }];
    h.primaryCounts = { alpha: 1 };
    h.userExists = false;

    const r = await unsolveChallenge("u1", "alpha");

    expect(h.rescoreUser).not.toHaveBeenCalled();
    expect(r.nextScore).toBe(0);
    expect(r.nextSolves).toBe(0);
  });
});

describe("unsolveChallenge — static flag / sole-solver reset", () => {
  it("leaves Ctf.solveCount untouched when another solver still holds the challenge", async () => {
    h.solveRows = [{ challenge: "alpha", user: "u1", points: 50 }];
    h.primaryCounts = { alpha: 2 }; // another solver exists → NOT sole
    h.ctfExists = { alpha: true };

    await unsolveChallenge("u1", "alpha");

    expect(h.ctfPatchSet).not.toHaveBeenCalled();
  });

  it("resets Ctf.solveCount to 0 when the target is the SOLE solver", async () => {
    h.solveRows = [{ challenge: "solo", user: "u1", points: 20 }];
    h.primaryCounts = { solo: 1 }; // sole solver
    h.ctfExists = { solo: true };

    const r = await unsolveChallenge("u1", "solo");

    expect(h.ctfPatchSet).toHaveBeenCalledWith({ solveCount: 0 });
    expect(r.solveCountReset).toEqual(["solo"]);
  });

  it("skips the solveCount reset when the Ctf config row is gone (no 500)", async () => {
    h.solveRows = [{ challenge: "ghost", user: "u1", points: 20 }];
    h.primaryCounts = { ghost: 1 };
    h.ctfExists = { ghost: false }; // config deleted, solve lingered

    const r = await unsolveChallenge("u1", "ghost");

    expect(h.ctfPatchSet).not.toHaveBeenCalled();
    expect(r.solveCountReset).toEqual([]);
  });
});

describe("unsolveUser", () => {
  it("rescores exactly once and deletes every row across both ledgers", async () => {
    h.solveRows = [
      { challenge: "alpha", user: "u1", points: 50 },
      { challenge: "beta", user: "u1", points: 30 },
    ];
    h.eventRows = [{ challenge: "daily", user: "u1", bucket: "b1", points: 10 }];
    h.primaryCounts = { alpha: 1, beta: 2, daily: 0 };
    h.ctfExists = { alpha: true };
    h.rescoreResult = { score: 0, counts: { solves: 0 } };

    const r = await unsolveUser("u1");

    expect(h.rescoreUser).toHaveBeenCalledTimes(1);
    expect(h.rescoreUser).toHaveBeenCalledWith("u1");
    expect(h.solveDelete).toHaveBeenCalledTimes(2);
    expect(h.eventDelete).toHaveBeenCalledTimes(1);
    // Only the sole-solver challenge (alpha) is reset; beta (2 solvers) is not.
    expect(r.solveCountReset).toEqual(["alpha"]);
    expect(r.removedSolves).toBe(2);
    expect(r.removedScoreEvents).toBe(1);
    expect(r.nextScore).toBe(0);
    expect(r.nextSolves).toBe(0);
  });
});
