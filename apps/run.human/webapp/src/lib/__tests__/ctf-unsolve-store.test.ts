import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ctf-unsolve-store orchestration test. The pure decisions are proven in
 * ctf-unsolve.test.ts; this locks how applyPlan WIRES them through the entities:
 *   - the ctfSolves decrement counts BOTH ledgers (CtfSolve + CtfScoreEvent),
 *     so a repeatable flag (0 solve rows, N score events) is not left inflated
 *     (the review's finding [0]);
 *   - Ctf.solveCount is reset ONLY where the target was the sole solver, and the
 *     sole-solver test reads the PRE-delete count;
 *   - a user zero sets both counters to 0.
 *
 * The ElectroDB entities are mocked with chainable stubs; we assert on the exact
 * objects handed to RunUser.patch().set() and Ctf.patch().set().
 */

const h = vi.hoisted(() => {
  const goOf = (data: unknown) => ({ go: vi.fn().mockResolvedValue({ data }) });
  return {
    goOf,
    // per-test data
    solveRows: [] as Array<{ challenge: string; user: string; points?: number }>,
    eventRows: [] as Array<{ challenge: string; user: string; bucket: string; points?: number }>,
    primaryCounts: {} as Record<string, number>, // challenge -> total CtfSolve rows
    user: null as { ctfScore?: number; ctfSolves?: number } | null,
    ctfExists: {} as Record<string, boolean>,
    // spies
    runUserSet: vi.fn(),
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
  getRunUser: vi.fn(() => Promise.resolve(h.user)),
  RunUser: {
    patch: vi.fn(() => ({
      set: (obj: unknown) => {
        h.runUserSet(obj);
        return h.goOf({});
      },
    })),
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
  h.user = { ctfScore: 0, ctfSolves: 0 };
  h.ctfExists = {};
  h.runUserSet.mockReset();
  h.ctfPatchSet.mockReset();
  h.solveDelete.mockReset();
  h.eventDelete.mockReset();
  h.attemptDelete.mockReset();
});

describe("unsolveChallenge — repeatable flag (finding [0])", () => {
  it("decrements ctfSolves by the score-event count, not the (zero) CtfSolve count", async () => {
    // A repeatable challenge: NO CtfSolve rows, 3 score events × 10 pts.
    h.eventRows = [
      { challenge: "daily", user: "u1", bucket: "b1", points: 10 },
      { challenge: "daily", user: "u1", bucket: "b2", points: 10 },
      { challenge: "daily", user: "u1", bucket: "b3", points: 10 },
    ];
    h.user = { ctfScore: 40, ctfSolves: 3 };
    h.primaryCounts = { daily: 0 };

    const r = await unsolveChallenge("u1", "Daily");

    // 40 - 30 = 10 ; 3 - 3 = 0 (the bug left ctfSolves at 3).
    expect(h.runUserSet).toHaveBeenCalledWith({ ctfScore: 10, ctfSolves: 0 });
    expect(h.eventDelete).toHaveBeenCalledTimes(3);
    expect(r.removedScoreEvents).toBe(3);
    expect(r.removedSolves).toBe(0); // reported = actual CtfSolve rows
  });
});

describe("unsolveChallenge — static flag", () => {
  it("decrements by the single CtfSolve row's points and 1 solve, floored at 0", async () => {
    h.solveRows = [{ challenge: "alpha", user: "u1", points: 50 }];
    h.user = { ctfScore: 50, ctfSolves: 1 };
    h.primaryCounts = { alpha: 2 }; // another solver exists → NOT sole
    h.ctfExists = { alpha: true };

    await unsolveChallenge("u1", "alpha");

    expect(h.runUserSet).toHaveBeenCalledWith({ ctfScore: 0, ctfSolves: 0 });
    // Multi-solver challenge → solveCount left untouched (ordinals preserved).
    expect(h.ctfPatchSet).not.toHaveBeenCalled();
  });

  it("resets Ctf.solveCount to 0 when the target is the SOLE solver", async () => {
    h.solveRows = [{ challenge: "solo", user: "u1", points: 20 }];
    h.user = { ctfScore: 20, ctfSolves: 1 };
    h.primaryCounts = { solo: 1 }; // sole solver
    h.ctfExists = { solo: true };

    const r = await unsolveChallenge("u1", "solo");

    expect(h.ctfPatchSet).toHaveBeenCalledWith({ solveCount: 0 });
    expect(r.solveCountReset).toEqual(["solo"]);
  });

  it("skips the solveCount reset when the Ctf config row is gone (no 500)", async () => {
    h.solveRows = [{ challenge: "ghost", user: "u1", points: 20 }];
    h.user = { ctfScore: 20, ctfSolves: 1 };
    h.primaryCounts = { ghost: 1 };
    h.ctfExists = { ghost: false }; // config deleted, solve lingered

    const r = await unsolveChallenge("u1", "ghost");

    expect(h.ctfPatchSet).not.toHaveBeenCalled();
    expect(r.solveCountReset).toEqual([]);
  });
});

describe("unsolveUser", () => {
  it("zeroes both counters and deletes every row across both ledgers", async () => {
    h.solveRows = [
      { challenge: "alpha", user: "u1", points: 50 },
      { challenge: "beta", user: "u1", points: 30 },
    ];
    h.eventRows = [{ challenge: "daily", user: "u1", bucket: "b1", points: 10 }];
    h.user = { ctfScore: 90, ctfSolves: 3 };
    h.primaryCounts = { alpha: 1, beta: 2, daily: 0 };
    h.ctfExists = { alpha: true };

    const r = await unsolveUser("u1");

    expect(h.runUserSet).toHaveBeenCalledWith({ ctfScore: 0, ctfSolves: 0 });
    expect(h.solveDelete).toHaveBeenCalledTimes(2);
    expect(h.eventDelete).toHaveBeenCalledTimes(1);
    // Only the sole-solver challenge (alpha) is reset; beta (2 solvers) is not.
    expect(r.solveCountReset).toEqual(["alpha"]);
    expect(r.removedSolves).toBe(2);
    expect(r.removedScoreEvents).toBe(1);
  });
});
