import { describe, it, expect } from "vitest";

import { judgeSolve, type CtfStore, type JudgeCtf } from "../ctf-judge";
import { hashAnswer } from "../ctf-hash";
import { DEFCON_RUN_HOURS, type ScoreWindow } from "../ctf-score-window";

/**
 * Scoring-window GATE suite (Slice 2, CTFT-10) — proves the judge's step-3
 * day/time/tz window gate against a FULLY in-memory fake CtfStore (NO DynamoDB).
 *
 * The gate is INSERTED between the unlock gate (1b) and the attempt-cap gate (2):
 * when a flag carries `scoreWindow` and `now` (evaluated in the flag's IANA tz via
 * the pure DST-correct `isWithinScoreWindow`) is OUTSIDE the day/time window, the
 * judge returns the shared NON_SOLVE — byte-identical to a wrong-answer non-solve,
 * on BOTH the "qr" and "covert" channels, and it NEVER logs the guess or secret.
 *
 * Absent `scoreWindow` ⇒ the gate is a no-op (every shipped flag unchanged).
 *
 * The DST instants are the same summer/winter Thursdays the 55-01 predicate test
 * uses, so the judge is proven to inherit the predicate's DST correctness.
 */

const NON_SOLVE = {
  solved: false,
  points: 0,
  ordinal: null,
  firstBlood: false,
  capped: false,
};

const CHALLENGE = "runhours-flag";
const FLAG = "s3cr3t-defcon-flag";
const WRONG = "not-the-flag";

// Two Thursdays at the identical 13:30 UTC (mirrors ctf-score-window.test.ts):
//   summer 2026-08-06 → 06:30 PDT (UTC-7) → INSIDE DEFCON_RUN_HOURS (06:00–08:00).
//   winter 2026-01-08 → 05:30 PST (UTC-8) → OUTSIDE (before 06:00).
const SUMMER_INSIDE = Date.parse("2026-08-06T13:30:00Z");
const WINTER_OUTSIDE = Date.parse("2026-01-08T13:30:00Z");
// A same-day instant plainly outside the window (Thu 05:30 PDT, before 06:00).
const SUMMER_OUTSIDE = Date.parse("2026-08-06T12:30:00Z");

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

type StoredSolve = {
  challenge: string;
  user: string;
  ordinal: number;
  points: number;
  firstBlood: boolean;
};

/**
 * In-memory CtfStore fake for the STATIC one-award path. `overAttemptLimit`
 * records whether it was reached (and can be forced to fail/throw) so the ORDER
 * test can prove the window gate short-circuits BEFORE the attempt-cap gate.
 */
function makeStore(
  ctf: JudgeCtf | null,
  opts: { attemptCapFails?: boolean } = {},
) {
  const solves = new Map<string, StoredSolve>();
  const ordinals = new Map<string, number>();
  const userScore = new Map<string, { points: number; solves: number }>();
  const state = { overAttemptCalls: 0 };
  const sKey = (c: string, u: string) => `${c}|${u}`;

  const store: CtfStore = {
    async getCtf() {
      return ctf;
    },
    async overAttemptLimit() {
      state.overAttemptCalls++;
      // When configured, the attempt-cap gate ALSO fails — the ORDER test proves
      // a closed window returns before this is ever reached.
      return opts.attemptCapFails ?? false;
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
    async accrue({ user, points }) {
      const s = userScore.get(user) ?? { points: 0, solves: 0 };
      s.points += points;
      s.solves += 1;
      userScore.set(user, s);
    },
    async reaccrue({ user, delta }) {
      const s = userScore.get(user) ?? { points: 0, solves: 0 };
      s.points += delta; // net-delta re-score; ctfSolves untouched (main #619)
      userScore.set(user, s);
    },
  };

  return { store, solves, ordinals, userScore, state };
}

// Capture every emitted log line as its JSON string so we can assert the raw
// guess/secret never appears.
function makeLogCapture() {
  const lines: string[] = [];
  return { log: (o: unknown) => lines.push(JSON.stringify(o)), lines };
}

// ---------------------------------------------------------------------------
// (1) BACKWARD COMPAT — no scoreWindow ⇒ the gate is a no-op; scores as today.
// ---------------------------------------------------------------------------
describe("window gate — backward compat (SC-1)", () => {
  it("a row with NO scoreWindow and a correct guess scores exactly as today", async () => {
    const { store, solves, userScore } = makeStore(fixtureCtf());
    const res = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store, now: WINTER_OUTSIDE, log: () => {} }, // clock is irrelevant with no window
    );
    expect(res.solved).toBe(true);
    expect(res.ordinal).toBe(1);
    expect(res.firstBlood).toBe(true);
    expect(res.points).toBeGreaterThan(0);
    expect(solves.size).toBe(1);
    expect(userScore.get("u1")?.solves).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (2) INSIDE — a correct guess inside a DEFCON-run-hours window scores.
// ---------------------------------------------------------------------------
describe("window gate — inside the window (SC-1)", () => {
  it("a correct guess when now is INSIDE the window scores", async () => {
    const { store, userScore } = makeStore(
      fixtureCtf({ scoreWindow: DEFCON_RUN_HOURS }),
    );
    const res = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store, now: SUMMER_INSIDE, log: () => {} },
    );
    expect(res.solved).toBe(true);
    expect(res.points).toBeGreaterThan(0);
    expect(userScore.get("u1")?.solves).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (3) OUTSIDE — a correct guess outside the window is a NON_SOLVE; no leak.
// ---------------------------------------------------------------------------
describe("window gate — outside the window is indistinguishable (SC-4)", () => {
  it("a CORRECT guess outside the window returns the shared NON_SOLVE (no effect) and never logs the guess", async () => {
    const { store, solves, ordinals } = makeStore(
      fixtureCtf({ scoreWindow: DEFCON_RUN_HOURS, effect: { kind: "otp-enroll", otpauth: "otpauth://x" } }),
    );
    const cap = makeLogCapture();
    const res = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store, now: SUMMER_OUTSIDE, log: cap.log },
    );
    // Byte-identical to a wrong-answer non-solve; no reward payload leaks.
    expect(res).toEqual(NON_SOLVE);
    expect(res.effect).toBeUndefined();
    // Short-circuited before claim/allocate — nothing was written.
    expect(solves.size).toBe(0);
    expect(ordinals.get(CHALLENGE)).toBeUndefined();
    // The captured log carries the coarse "no-solve" marker and NEVER the guess.
    const joined = cap.lines.join("\n");
    expect(joined).not.toContain(FLAG);
    expect(joined).toContain("no-solve");
  });

  it("deep-equals a wrong-answer non-solve inside the SAME window", async () => {
    const { store: outStore } = makeStore(fixtureCtf({ scoreWindow: DEFCON_RUN_HOURS }));
    const outside = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store: outStore, now: SUMMER_OUTSIDE, log: () => {} },
    );
    const { store: wrongStore } = makeStore(fixtureCtf({ scoreWindow: DEFCON_RUN_HOURS }));
    const wrong = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: WRONG, channel: "qr" },
      { store: wrongStore, now: SUMMER_INSIDE, log: () => {} },
    );
    expect(outside).toEqual(NON_SOLVE);
    expect(outside).toEqual(wrong);
  });
});

// ---------------------------------------------------------------------------
// (4) DST — same UTC hour, summer scores / winter withheld (inherited from 55-01).
// ---------------------------------------------------------------------------
describe("window gate — DST correctness inherited from the predicate (SC-2)", () => {
  it("summer Thu 13:30Z (06:30 PDT) scores; winter Thu 13:30Z (05:30 PST) is a non-solve", async () => {
    const { store: summerStore } = makeStore(fixtureCtf({ scoreWindow: DEFCON_RUN_HOURS }));
    const summer = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store: summerStore, now: SUMMER_INSIDE, log: () => {} },
    );
    expect(summer.solved).toBe(true);

    const { store: winterStore } = makeStore(fixtureCtf({ scoreWindow: DEFCON_RUN_HOURS }));
    const winter = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store: winterStore, now: WINTER_OUTSIDE, log: () => {} },
    );
    expect(winter).toEqual(NON_SOLVE);
  });
});

// ---------------------------------------------------------------------------
// (5) ORDER — the window gate short-circuits BEFORE the attempt-cap gate.
// ---------------------------------------------------------------------------
describe("window gate — ordered before the attempt-cap gate (CTFT-10)", () => {
  it("a closed window returns non-solve even when the attempt-cap would ALSO fail, without reaching the cap", async () => {
    const { store, state } = makeStore(
      fixtureCtf({ scoreWindow: DEFCON_RUN_HOURS }),
      { attemptCapFails: true }, // the cap gate would ALSO reject if reached
    );
    const res = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store, now: SUMMER_OUTSIDE, log: () => {} },
    );
    expect(res).toEqual(NON_SOLVE);
    // Proof of placement: the attempt-cap gate was NEVER reached (window gate ran first).
    expect(state.overAttemptCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (6) COVERT INDISTINGUISHABLE — a closed window on the covert channel is the
//     identical NON_SOLVE with no reward payload.
// ---------------------------------------------------------------------------
describe("window gate — covert-channel indistinguishability (T-53-04-01)", () => {
  it("a closed window on channel 'covert' returns the identical NON_SOLVE with no effect", async () => {
    const window: ScoreWindow = DEFCON_RUN_HOURS;
    const { store } = makeStore(
      fixtureCtf({ scoreWindow: window, effect: { kind: "otp-enroll", otpauth: "otpauth://x" } }),
    );
    const res = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "covert" },
      { store, now: SUMMER_OUTSIDE, log: () => {} },
    );
    expect(res).toEqual(NON_SOLVE);
    expect(res.effect).toBeUndefined();
  });
});
