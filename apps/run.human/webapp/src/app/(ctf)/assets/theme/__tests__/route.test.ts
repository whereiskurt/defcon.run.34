import { describe, it, expect, vi } from "vitest";

import { handleCovert } from "../route";
import { judgeSolve, type CtfStore, type JudgeCtf, type PriorAward } from "@/lib/ctf-judge";
import { createPending, type PendingStore, type PendingRow } from "@/lib/ctf-pending";
import { encodeFlag } from "@/lib/ctf-covert-codec";
import { AWARD_PROP, SIZE_TOLERANCE, buildDecoySheet } from "@/lib/ctf-covert-css";
import { hashAnswer } from "@/lib/ctf-hash";

/**
 * The invisibility matrix for the covert /use1/assets/theme route (CTF-07/08/09).
 * Every outcome is driven through the REAL judgeSolve / createPending against
 * in-memory fakes (no DynamoDB), with the same injected-deps seam the Phase-44
 * judge test uses — so this proves the true credit/park behavior AND that the
 * network envelope + logs are indistinguishable across win / wrong / unauth /
 * garbage.
 */

const FLAG = "s3cr3t-defcon-flag";
const WRONG = "PLEASE-DO-NOT-LEAK-ME-42";
const CHALLENGE = "meshmaze";

const COARSE_MARKERS = new Set(["solve", "no-solve", "capped", "replay"]);

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

function makeCtfStore(ctf: JudgeCtf | null) {
  const solves = new Map<string, Stored>();
  const ordinals = new Map<string, number>();
  const userScore = new Map<string, { points: number; solves: number }>();
  const attempts = new Map<string, number>();
  const state = { allocateCalls: 0 };
  const key = (c: string, u: string) => `${c}|${u}`;

  const store: CtfStore = {
    async getCtf() {
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
        return {
          claimed: false,
          existing: {
            ordinal: existing.ordinal,
            points: existing.points,
            firstBlood: existing.firstBlood,
          },
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
      const s = userScore.get(user) ?? { points: 0, solves: 0 };
      s.points += points;
      s.solves += 1;
      userScore.set(user, s);
    },
  };

  return { store, solves, ordinals, userScore, state };
}

function makePendingStore() {
  const rows: PendingRow[] = [];
  const store: PendingStore = {
    async putPending(row) {
      rows.push(row);
    },
    async getPending() {
      return null;
    },
    async deletePending() {},
  };
  return { store, rows };
}

type Deps = Parameters<typeof handleCovert>[1];

function makeDeps(opts: {
  store: CtfStore;
  pendingStore: PendingStore;
  log: (o: unknown) => void;
  authUserId: string | null;
}): Deps {
  return {
    getSession: async () =>
      opts.authUserId ? { user: { authUserId: opts.authUserId } } : null,
    judge: (input) => judgeSolve(input, { store: opts.store, now: 0, log: opts.log }),
    park: (challenge, guess) =>
      createPending(challenge, guess, { store: opts.pendingStore, now: 0 }),
  };
}

function themeReq(v: string | null): Request {
  const base = "https://run.defcon.run/use1/assets/theme";
  const url = v === null ? base : `${base}?v=${encodeURIComponent(v)}`;
  return new Request(url);
}

async function run(opts: {
  v: string | null;
  authUserId: string | null;
  ctf?: JudgeCtf | null;
  log?: (o: unknown) => void;
  ctxOverride?: ReturnType<typeof makeCtfStore>;
}) {
  const ctx = opts.ctxOverride ?? makeCtfStore(opts.ctf ?? fixtureCtf());
  const pending = makePendingStore();
  const log = opts.log ?? (() => {});
  const res = await handleCovert(
    themeReq(opts.v),
    makeDeps({ store: ctx.store, pendingStore: pending.store, log, authUserId: opts.authUserId }),
  );
  const body = await res.text();
  return { res, body, ctx, pending };
}

const winV = () => encodeFlag(CHALLENGE, FLAG);
const wrongV = () => encodeFlag(CHALLENGE, WRONG);

describe("covert route — outcome bodies (CTF-07/08/09)", () => {
  it("signed-in + correct → win sheet carrying the award property", async () => {
    const { res, body, ctx } = await run({ v: winV(), authUserId: "u1" });
    expect(res.status).toBe(200);
    expect(body).toContain(AWARD_PROP);
    expect(ctx.userScore.get("u1")?.solves).toBe(1);
  });

  it("signed-in + wrong → decoy sheet, no award property", async () => {
    const { res, body, ctx } = await run({ v: wrongV(), authUserId: "u1" });
    expect(res.status).toBe(200);
    expect(body).toBe(buildDecoySheet());
    expect(body).not.toContain(AWARD_PROP);
    expect(ctx.userScore.size).toBe(0);
  });

  it("unauth + any v → decoy, and parks the hash-only via createPending", async () => {
    const { res, body, pending, ctx } = await run({ v: winV(), authUserId: null });
    expect(res.status).toBe(200);
    expect(body).toBe(buildDecoySheet());
    expect(body).not.toContain(AWARD_PROP);
    // parked exactly once, submittedFlagHash only, never the raw guess.
    expect(pending.rows).toHaveLength(1);
    expect(pending.rows[0].submittedFlagHash).toBe(hashAnswer(FLAG));
    expect(JSON.stringify(pending.rows)).not.toContain(FLAG);
    // the judge was never invoked on the unauth path (no self-credit).
    expect(ctx.state.allocateCalls).toBe(0);
    expect(ctx.userScore.size).toBe(0);
  });

  it("garbage / missing v → decoy, no judge, no park, no throw", async () => {
    const garbage = await run({ v: "not-a-number!!", authUserId: "u1" });
    expect(garbage.res.status).toBe(200);
    expect(garbage.body).toBe(buildDecoySheet());
    expect(garbage.ctx.state.allocateCalls).toBe(0);
    expect(garbage.pending.rows).toHaveLength(0);

    const missing = await run({ v: null, authUserId: null });
    expect(missing.res.status).toBe(200);
    expect(missing.body).toBe(buildDecoySheet());
    expect(missing.pending.rows).toHaveLength(0);
  });

  it("capped win (points 0) renders the decoy, not the award", async () => {
    const { res, body } = await run({
      v: winV(),
      authUserId: "u1",
      ctf: fixtureCtf({ maxSolves: 0 }), // ordinal 1 > maxSolves → points 0
    });
    expect(res.status).toBe(200);
    expect(body).toBe(buildDecoySheet());
    expect(body).not.toContain(AWARD_PROP);
  });

  it("idempotent re-fire: second win returns the prior award and never double-scores", async () => {
    const ctx = makeCtfStore(fixtureCtf());
    const first = await run({ v: winV(), authUserId: "u1", ctxOverride: ctx });
    const second = await run({ v: winV(), authUserId: "u1", ctxOverride: ctx });
    expect(first.body).toContain(AWARD_PROP);
    expect(second.body).toContain(AWARD_PROP);
    expect(second.body).toBe(first.body); // same award value re-rendered
    expect(ctx.state.allocateCalls).toBe(1); // ordinal allocated once
    expect(ctx.userScore.get("u1")?.solves).toBe(1); // scored once
  });
});

describe("covert route — invisibility matrix (CTF-08)", () => {
  it("identical status / content-type / cache-control across win / wrong / unauth / garbage", async () => {
    const outcomes = await Promise.all([
      run({ v: winV(), authUserId: "u1" }),
      run({ v: wrongV(), authUserId: "u1" }),
      run({ v: winV(), authUserId: null }),
      run({ v: "garbage", authUserId: "u1" }),
    ]);
    for (const { res } of outcomes) {
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")?.startsWith("text/css")).toBe(true);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("win and decoy bodies are ≈equal size (within SIZE_TOLERANCE)", async () => {
    const win = await run({ v: winV(), authUserId: "u1" });
    const decoy = await run({ v: wrongV(), authUserId: "u1" });
    expect(Math.abs(win.body.length - decoy.body.length)).toBeLessThanOrEqual(SIZE_TOLERANCE);
  });

  it("the award property appears in the win body ONLY", async () => {
    const win = await run({ v: winV(), authUserId: "u1" });
    const wrong = await run({ v: wrongV(), authUserId: "u1" });
    const unauth = await run({ v: winV(), authUserId: null });
    expect(win.body).toContain(AWARD_PROP);
    expect(wrong.body).not.toContain(AWARD_PROP);
    expect(unauth.body).not.toContain(AWARD_PROP);
  });
});

describe("covert route — log hygiene (CTF-08, T-46-05)", () => {
  it("no log line carries the raw guess or the AWARD value; only coarse markers emit", async () => {
    const log = vi.fn();

    const win = await run({ v: winV(), authUserId: "u1", log });
    const awardValue = String(win.body.match(/--accent-ramp:\s*(\d+)/)?.[1] ?? "");
    await run({ v: wrongV(), authUserId: "u1", log });

    expect(log).toHaveBeenCalled();
    const dump = JSON.stringify(log.mock.calls);
    expect(dump).not.toContain(FLAG); // raw correct guess
    expect(dump).not.toContain(WRONG); // raw wrong guess
    expect(awardValue.length).toBeGreaterThan(0);
    expect(dump).not.toContain(`"result":${awardValue}`); // award never a logged field

    // Every emitted record's `result` is a coarse outcome marker, not the guess.
    for (const [rec] of log.mock.calls) {
      const result = (rec as { result?: string }).result;
      expect(COARSE_MARKERS.has(result ?? "")).toBe(true);
    }
  });

  it("the handler itself emits ZERO logs on the unauth and garbage paths (judge never runs)", async () => {
    const unauthLog = vi.fn();
    await run({ v: winV(), authUserId: null, log: unauthLog });
    expect(unauthLog).not.toHaveBeenCalled();

    const garbageLog = vi.fn();
    await run({ v: "garbage", authUserId: "u1", log: garbageLog });
    expect(garbageLog).not.toHaveBeenCalled();
  });
});
