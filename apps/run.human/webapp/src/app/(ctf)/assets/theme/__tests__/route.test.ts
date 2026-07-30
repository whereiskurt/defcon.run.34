import { describe, it, expect, vi } from "vitest";

// route.ts now imports admin-gate (isCtfAdmin), which statically re-exports from
// @/config/auth → next-auth → next/server (unresolvable under vitest). The route
// injects its own session via deps, so stub the auth config like admin-gate's own
// test does — the pure isCtfAdmin path needs none of it.
vi.mock("@/config/auth", () => ({
  auth: vi.fn(),
  revalidateAdmin: vi.fn(),
  revalidateGroups: vi.fn(),
}));

import { handleCovert } from "../route";
import { judgeSolve, type CtfStore, type JudgeCtf, type PriorAward } from "@/lib/ctf-judge";
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
  };

  return { store, solves, ordinals, state };
}

type Deps = Parameters<typeof handleCovert>[1];

function makeDeps(opts: {
  store: CtfStore;
  log: (o: unknown) => void;
  userId: string | null;
  services?: string[];
}): Deps {
  return {
    getSession: async () =>
      // Mock the session shape the route now reads: the Auth.js adapter uuid at
      // `session.user.id` (the `RunUser.userId` space), NOT the OIDC sub. Optional
      // `services` drives the CTF-admin override gate (isCtfAdmin).
      opts.userId ? { user: { id: opts.userId, services: opts.services } } : null,
    judge: (input) => judgeSolve(input, { store: opts.store, now: 0, log: opts.log }),
  };
}

function themeReq(v: string | null): Request {
  const base = "https://run.defcon.run/use1/assets/theme";
  const url = v === null ? base : `${base}?v=${encodeURIComponent(v)}`;
  return new Request(url);
}

async function run(opts: {
  v: string | null;
  userId: string | null;
  services?: string[];
  ctf?: JudgeCtf | null;
  log?: (o: unknown) => void;
  ctxOverride?: ReturnType<typeof makeCtfStore>;
}) {
  const ctx = opts.ctxOverride ?? makeCtfStore(opts.ctf ?? fixtureCtf());
  const log = opts.log ?? (() => {});
  const res = await handleCovert(
    themeReq(opts.v),
    makeDeps({
      store: ctx.store,
      log,
      userId: opts.userId,
      services: opts.services,
    }),
  );
  const body = await res.text();
  return { res, body, ctx };
}

const winV = () => encodeFlag(CHALLENGE, FLAG);
const wrongV = () => encodeFlag(CHALLENGE, WRONG);

describe("covert route — outcome bodies (CTF-07/08/09)", () => {
  it("signed-in + correct → win sheet carrying the award property", async () => {
    const { res, body, ctx } = await run({ v: winV(), userId: "u1" });
    expect(res.status).toBe(200);
    expect(body).toContain(AWARD_PROP);
    expect(ctx.solves.has(`${CHALLENGE}|u1`)).toBe(true);
  });

  it("signed-in + wrong → decoy sheet, no award property", async () => {
    const { res, body, ctx } = await run({ v: wrongV(), userId: "u1" });
    expect(res.status).toBe(200);
    expect(body).toBe(buildDecoySheet());
    expect(body).not.toContain(AWARD_PROP);
    expect(ctx.solves.size).toBe(0);
  });

  it("unauth + any v → decoy, awards NOTHING and parks NOTHING (no anonymous footprint)", async () => {
    const { res, body, ctx } = await run({ v: winV(), userId: null });
    expect(res.status).toBe(200);
    expect(body).toBe(buildDecoySheet());
    expect(body).not.toContain(AWARD_PROP);
    // A logged-out fire never reaches the judge and leaves no trace: no ordinal
    // allocated, no score, no parked pending. The covert channel awards ONLY a
    // live-signed-in visitor, so a logged-out visit is a pure no-op.
    expect(ctx.state.allocateCalls).toBe(0);
    expect(ctx.solves.size).toBe(0);
  });

  it("garbage / missing v → decoy, no judge, no throw", async () => {
    const garbage = await run({ v: "not-a-number!!", userId: "u1" });
    expect(garbage.res.status).toBe(200);
    expect(garbage.body).toBe(buildDecoySheet());
    expect(garbage.ctx.state.allocateCalls).toBe(0);

    const missing = await run({ v: null, userId: null });
    expect(missing.res.status).toBe(200);
    expect(missing.body).toBe(buildDecoySheet());
  });

  it("capped win (points 0) renders the decoy, not the award", async () => {
    const { res, body } = await run({
      v: winV(),
      userId: "u1",
      ctf: fixtureCtf({ maxSolves: 0 }), // ordinal 1 > maxSolves → points 0
    });
    expect(res.status).toBe(200);
    expect(body).toBe(buildDecoySheet());
    expect(body).not.toContain(AWARD_PROP);
  });

  it("ignores an extra cache-bust query param (client appends &_= to defeat browser caching)", async () => {
    // The covert client now cache-busts with `&_=<token>` so repeat fires re-hit
    // the server; the route must still read `v` and credit the solve.
    const ctx = makeCtfStore(fixtureCtf());
    const url = `https://run.defcon.run/use1/assets/theme?v=${encodeURIComponent(winV())}&_=xk3f9`;
    const res = await handleCovert(
      new Request(url),
      makeDeps({ store: ctx.store, log: () => {}, userId: "u1" }),
    );
    const body = await res.text();
    expect(body).toContain(AWARD_PROP); // credited despite the extra param
    expect(ctx.solves.has(`${CHALLENGE}|u1`)).toBe(true);
  });

  it("idempotent re-fire: second win returns the prior award and never double-scores", async () => {
    const ctx = makeCtfStore(fixtureCtf());
    const first = await run({ v: winV(), userId: "u1", ctxOverride: ctx });
    const second = await run({ v: winV(), userId: "u1", ctxOverride: ctx });
    expect(first.body).toContain(AWARD_PROP);
    expect(second.body).toContain(AWARD_PROP);
    expect(second.body).toBe(first.body); // same award value re-rendered
    expect(ctx.state.allocateCalls).toBe(1); // ordinal allocated once
  });
});

describe("covert route — CTF-admin operator override wiring", () => {
  it("forwards admin from the session: an admin re-fires past a cap where a player gets the decoy", async () => {
    // maxAttempts:0 → the FIRST judge call is over-limit for a non-admin. The
    // ONLY difference between these two runs is the session's admin group, so a
    // win-vs-decoy split proves the route threads `admin` through to judgeSolve.
    const player = await run({ v: winV(), userId: "u1", ctf: fixtureCtf({ maxAttempts: 0 }) });
    expect(player.body).toBe(buildDecoySheet());
    expect(player.body).not.toContain(AWARD_PROP);

    const admin = await run({
      v: winV(),
      userId: "u1",
      services: ["ctfadmin"],
      ctf: fixtureCtf({ maxAttempts: 0 }),
    });
    expect(admin.body).toContain(AWARD_PROP); // cap bypassed → credited win
  });

  it("an admin re-fire on an already-solved flag echoes the FROZEN prior award, unaffected by a live config change", async () => {
    // The admin re-submit-in-place override was removed (points-consistency
    // Task 6) — accrue/reaccrue are gone from CtfStore, so an already-solved
    // flag ALWAYS returns the frozen prior award, admin or not. Re-deriving a
    // player's score against live config is now rescoreBestEffort's job
    // (Tasks 7-10), which the judge/route never call directly.
    const ref: { current: JudgeCtf } = { current: fixtureCtf({ pointMax: 500 }) };
    const ctx = makeCtfStore(ref.current);
    // Point the fake's getCtf at the mutable ref (makeCtfStore captured a copy).
    ctx.store.getCtf = async () => ref.current;

    const first = await run({ v: winV(), userId: "op", services: ["admin"], ctxOverride: ctx });
    expect(first.body).toContain(AWARD_PROP);
    const firstAward = first.body.match(/--accent-ramp:\s*(\d+)/)?.[1];

    ref.current = fixtureCtf({ pointMax: 300 }); // operator lowers the ceiling
    const second = await run({ v: winV(), userId: "op", services: ["admin"], ctxOverride: ctx });
    const secondAward = second.body.match(/--accent-ramp:\s*(\d+)/)?.[1];

    expect(second.body).toContain(AWARD_PROP); // still celebrates
    expect(secondAward).toBe(firstAward); // frozen — NOT re-scored to the live config
    expect(ctx.state.allocateCalls).toBe(1); // ordinal reused; solveCount not bumped
  });
});

describe("covert route — invisibility matrix (CTF-08)", () => {
  it("identical status / content-type / cache-control across win / wrong / unauth / garbage", async () => {
    const outcomes = await Promise.all([
      run({ v: winV(), userId: "u1" }),
      run({ v: wrongV(), userId: "u1" }),
      run({ v: winV(), userId: null }),
      run({ v: "garbage", userId: "u1" }),
    ]);
    for (const { res } of outcomes) {
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")?.startsWith("text/css")).toBe(true);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("win and decoy bodies are ≈equal size (within SIZE_TOLERANCE)", async () => {
    const win = await run({ v: winV(), userId: "u1" });
    const decoy = await run({ v: wrongV(), userId: "u1" });
    expect(Math.abs(win.body.length - decoy.body.length)).toBeLessThanOrEqual(SIZE_TOLERANCE);
  });

  it("the award property appears in the win body ONLY", async () => {
    const win = await run({ v: winV(), userId: "u1" });
    const wrong = await run({ v: wrongV(), userId: "u1" });
    const unauth = await run({ v: winV(), userId: null });
    expect(win.body).toContain(AWARD_PROP);
    expect(wrong.body).not.toContain(AWARD_PROP);
    expect(unauth.body).not.toContain(AWARD_PROP);
  });
});

describe("covert route — log hygiene (CTF-08, T-46-05)", () => {
  it("no log line carries the raw guess or the AWARD value; only coarse markers emit", async () => {
    const log = vi.fn();

    const win = await run({ v: winV(), userId: "u1", log });
    const awardValue = String(win.body.match(/--accent-ramp:\s*(\d+)/)?.[1] ?? "");
    await run({ v: wrongV(), userId: "u1", log });

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
    await run({ v: winV(), userId: null, log: unauthLog });
    expect(unauthLog).not.toHaveBeenCalled();

    const garbageLog = vi.fn();
    await run({ v: "garbage", userId: "u1", log: garbageLog });
    expect(garbageLog).not.toHaveBeenCalled();
  });
});
