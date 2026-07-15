import { describe, it, expect } from "vitest";

import {
  judgeSolve,
  type CtfStore,
  type JudgeCtf,
  type OtpEnrollEffect,
  type PriorAward,
} from "../ctf-judge";
import { hashAnswer } from "../ctf-hash";

/**
 * Effect-return plumbing suite (Slice 1a, CTFT-05 / D-06 / SC-5). Proves the
 * reward `effect` authored on a `Ctf` row is carried VERBATIM onto `JudgeResult`
 * for a CREDITED solve — and stays OFF every NON_SOLVE / gate-failure path — against
 * a fully in-memory fake `CtfStore` (NO DynamoDB). The judge never interprets the
 * payload; the recognized `otp-enroll` shape is a carried payload only (renderer
 * is Slice 1b). The covert byte-identity invariant is proven separately in
 * covert-egg.test.ts.
 */

const NON_SOLVE = {
  solved: false,
  points: 0,
  ordinal: null,
  firstBlood: false,
  capped: false,
};

const CHALLENGE = "goldstein";
const FLAG = "the-answer-is-42";
const WRONG = "not-the-flag";

/** The recognized net-new reward payload the judge carries out unchanged. */
const OTP_ENROLL: OtpEnrollEffect = {
  kind: "otp-enroll",
  otpauth:
    "otpauth://totp/Defcon.run:goldstein-dawn?secret=JBSWY3DPEHPK3PXP&issuer=Defcon.run&period=120",
  nextFlag: "goldstein-dawn",
};

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

type StoredSolve = PriorAward & { challenge: string; user: string };

/**
 * A minimal but faithful in-memory CtfStore — the STATIC one-award path is enough
 * to exercise effect plumbing (genuine solve, idempotent replay, wrong answer).
 */
function makeStore(ctf: JudgeCtf | null) {
  const solves = new Map<string, StoredSolve>();
  const ordinals = new Map<string, number>();
  const attempts = new Map<string, number>();
  const sKey = (c: string, u: string) => `${c}|${u}`;

  const store: CtfStore = {
    async getCtf() {
      return ctf;
    },
    async overAttemptLimit({ challenge, user, max }) {
      const k = sKey(challenge, user);
      const c = (attempts.get(k) ?? 0) + 1;
      attempts.set(k, c);
      return c > max;
    },
    async claimSolve({ challenge, user }) {
      const k = sKey(challenge, user);
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
      const n = (ordinals.get(challenge) ?? 0) + 1;
      ordinals.set(challenge, n);
      return n;
    },
    async recordScore({ challenge, user, ordinal, points, firstBlood }) {
      solves.set(sKey(challenge, user), { challenge, user, ordinal, points, firstBlood });
    },
    async accrue() {
      /* no-op — accrual parity is covered by the gate suite */
    },
    async reaccrue() {
      /* no-op — admin re-score path (main #619) not exercised by this suite */
    },
  };

  return { store, solves, ordinals };
}

// ---------------------------------------------------------------------------
// (1) a credited solve carries the row's effect verbatim (incl. otp-enroll).
// ---------------------------------------------------------------------------
describe("effect — credited solve surfaces the reward (SC-5)", () => {
  it("returns the flag's otp-enroll effect VERBATIM on a genuine credited solve", async () => {
    const { store } = makeStore(fixtureCtf({ effect: OTP_ENROLL }));
    const res = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store, now: 0, log: () => {} },
    );
    expect(res.solved).toBe(true);
    expect(res.points).toBeGreaterThan(0);
    // carried out unchanged — same object shape, never interpreted.
    expect(res.effect).toEqual(OTP_ENROLL);
    expect((res.effect as OtpEnrollEffect).kind).toBe("otp-enroll");
    expect((res.effect as OtpEnrollEffect).otpauth).toBe(OTP_ENROLL.otpauth);
  });

  it("carries an arbitrary (non-otp) effect payload through untyped", async () => {
    const custom = { kind: "confetti", intensity: 11 };
    const { store } = makeStore(fixtureCtf({ effect: custom }));
    const res = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store, now: 0, log: () => {} },
    );
    expect(res.solved).toBe(true);
    expect(res.effect).toEqual(custom);
  });
});

// ---------------------------------------------------------------------------
// (2) a wrong guess / locked gate is NON_SOLVE with NO effect.
// ---------------------------------------------------------------------------
describe("effect — non-solve paths carry no reward (SC-5)", () => {
  it("a wrong guess returns NON_SOLVE with effect absent/undefined", async () => {
    const { store } = makeStore(fixtureCtf({ effect: OTP_ENROLL }));
    const res = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: WRONG, channel: "qr" },
      { store, now: 0, log: () => {} },
    );
    expect(res).toEqual(NON_SOLVE);
    expect(res.effect).toBeUndefined();
  });

  it("a locked unlock gate returns NON_SOLVE with no effect (indistinguishable)", async () => {
    // unlockAfter set + no prereq score + no hasScoreFor op ⇒ withheld (locked).
    const { store } = makeStore(
      fixtureCtf({ effect: OTP_ENROLL, unlockAfter: "prereq" }),
    );
    const res = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store, now: 0, log: () => {} },
    );
    expect(res).toEqual(NON_SOLVE);
    expect(res.effect).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (3) a flag with no effect returns a solve whose effect is undefined (compat).
// ---------------------------------------------------------------------------
describe("effect — backward compatible (SC-5)", () => {
  it("a credited solve of a flag with NO effect returns effect === undefined", async () => {
    const { store } = makeStore(fixtureCtf()); // no effect authored
    const res = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store, now: 0, log: () => {} },
    );
    expect(res.solved).toBe(true);
    expect(res.points).toBeGreaterThan(0);
    expect(res.effect).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (4) the idempotent replay of a credited award STILL carries the effect.
// ---------------------------------------------------------------------------
describe("effect — idempotent replay re-surfaces the reward (SC-5)", () => {
  it("a second solve of an already-credited flag replays the effect", async () => {
    const { store } = makeStore(fixtureCtf({ effect: OTP_ENROLL }));
    const first = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store, now: 0, log: () => {} },
    );
    expect(first.solved).toBe(true);
    expect(first.effect).toEqual(OTP_ENROLL);

    // Re-submit the same credited flag → idempotent replay (prior award), effect re-surfaced.
    const replay = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store, now: 0, log: () => {} },
    );
    expect(replay.solved).toBe(true);
    expect(replay.points).toBe(first.points);
    expect(replay.effect).toEqual(OTP_ENROLL);
  });
});
