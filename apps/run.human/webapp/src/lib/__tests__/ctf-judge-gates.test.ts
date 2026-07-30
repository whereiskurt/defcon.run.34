import { describe, it, expect } from "vitest";

import {
  judgeSolve,
  type CtfStore,
  type JudgeCtf,
  type PriorAward,
} from "../ctf-judge";
import { hashAnswer } from "../ctf-hash";
import { totpAt } from "../ctf-otp";

/**
 * Flag-types GATE suite (Slice 1a, CTFT-03/04) — proves the new judge gates
 * against a FULLY in-memory fake CtfStore (NO DynamoDB). The fake faithfully
 * models the load-bearing atomic semantics 53-03 depends on:
 *   - claimScoreEvent does a real map-keyed attribute_not_exists on (challenge,
 *     user, bucket) with NO await between the has-check and the set → the first
 *     writer in a window wins, a same-window double-submit collides (once-per-
 *     window), exactly like the shipped CtfSolve claim but per-window.
 *   - allocateOrdinal is a real global per-challenge counter → globalMax is
 *     enforced off the ordinal, never a partition query.
 *   - overPerPlayerMax counts THIS player's ledger rows for THIS challenge.
 *
 * Every gate FAILURE must return the SAME NON_SOLVE shape (indistinguishable —
 * SC-4 / the covert-channel invariant).
 */

const NON_SOLVE = {
  solved: false,
  points: 0,
  ordinal: null,
  firstBlood: false,
  capped: false,
};

const CHALLENGE = "meshmaze";
const FLAG = "s3cr3t-defcon-flag";
const WRONG = "not-the-flag";
// A valid RFC 4648 base32 shared TOTP secret (test-only).
const OTP_SECRET = "JBSWY3DPEHPK3PXP";
const OTP_PERIOD = 120;

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
type StoredEvent = {
  challenge: string;
  user: string;
  bucket: string;
  points: number;
};

/**
 * The in-memory CtfStore fake. Models BOTH the static CtfSolve path and the new
 * repeatable CtfScoreEvent ledger with faithful atomicity.
 */
function makeStore(ctf: JudgeCtf | null) {
  const solves = new Map<string, StoredSolve>(); // `${c}|${u}` static CtfSolve
  const events = new Map<string, StoredEvent>(); // `${c}|${u}|${b}` ledger
  const ordinals = new Map<string, number>(); // challenge → solveCount
  const attempts = new Map<string, number>();
  const state = { allocateCalls: 0 };
  const sKey = (c: string, u: string) => `${c}|${u}`;
  const eKey = (c: string, u: string, b: string) => `${c}|${u}|${b}`;

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
      state.allocateCalls++;
      const n = (ordinals.get(challenge) ?? 0) + 1; // real atomic ADD
      ordinals.set(challenge, n);
      return n;
    },
    async recordScore({ challenge, user, ordinal, points, firstBlood }) {
      solves.set(sKey(challenge, user), { challenge, user, ordinal, points, firstBlood });
    },

    // --- flag-types ops ---
    async hasScoreFor({ challenge, user }) {
      if (solves.has(sKey(challenge, user))) return true;
      for (const ev of events.values()) {
        if (ev.challenge === challenge && ev.user === user) return true;
      }
      return false;
    },
    async claimScoreEvent({ challenge, user, bucket }) {
      const k = eKey(challenge, user, bucket);
      // attribute_not_exists: first writer in this (user,bucket) wins. NO await
      // between the has-check and the set → no lost update under Promise.all.
      if (events.has(k)) return { claimed: false };
      events.set(k, { challenge, user, bucket, points: 0 });
      return { claimed: true };
    },
    async overPerPlayerMax({ challenge, user, max }) {
      if (!max || !Number.isFinite(max) || max <= 0) return false;
      let count = 0;
      for (const ev of events.values()) {
        if (ev.challenge === challenge && ev.user === user) count++;
      }
      return count > max;
    },
    async recordScoreEvent({ challenge, user, bucket, points }) {
      const ev = events.get(eKey(challenge, user, bucket));
      if (ev) ev.points = points;
    },
  };

  return { store, solves, events, ordinals, attempts, state };
}

// A 6-digit code guaranteed NOT to match any code in the ±1 skew window at `now`.
function wrongOtpCode(nowSeconds: number): string {
  const valid = new Set([
    totpAt(OTP_SECRET, nowSeconds - OTP_PERIOD, { period: OTP_PERIOD }),
    totpAt(OTP_SECRET, nowSeconds, { period: OTP_PERIOD }),
    totpAt(OTP_SECRET, nowSeconds + OTP_PERIOD, { period: OTP_PERIOD }),
  ]);
  for (let i = 0; i < 1_000_000; i++) {
    const c = String(i).padStart(6, "0");
    if (!valid.has(c)) return c;
  }
  return "000000";
}

// ---------------------------------------------------------------------------
// (1) backward-compat: a no-answerType row scores on the STATIC CtfSolve path.
// ---------------------------------------------------------------------------
describe("gate — static parity (SC-1)", () => {
  it("a row with no answerType routes through CtfSolve unchanged (never touches the ledger)", async () => {
    const { store, solves, events, ordinals } = makeStore(fixtureCtf());
    const res = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store, now: 0, log: () => {} },
    );
    expect(res.solved).toBe(true);
    expect(res.ordinal).toBe(1);
    expect(res.firstBlood).toBe(true);
    expect(res.points).toBeGreaterThan(0);
    // Static path only: the CtfSolve row exists, the ledger is untouched.
    expect(solves.size).toBe(1);
    expect(events.size).toBe(0);
    expect(ordinals.get(CHALLENGE)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (2) unlock gate — withholds until prereq scored; locked == wrong (SC-4).
// ---------------------------------------------------------------------------
describe("gate — unlock/chaining indistinguishability (SC-4)", () => {
  it("a locked gate deep-equals the wrong-answer NON_SOLVE, and unlocks once the prereq is scored", async () => {
    const ctf = fixtureCtf({ unlockAfter: "goldstein" });

    // Locked: the player has no score for `goldstein` → withheld.
    const { store: lockedStore, solves: lockedSolves, events: lockedEvents } =
      makeStore(ctf);
    const locked = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store: lockedStore, now: 0, log: () => {} },
    );

    // Wrong answer on the SAME (unlocked-irrelevant) flag → also NON_SOLVE.
    const { store: unlockedWrongStore } = makeStore(ctf);
    // Give u1 a prereq score so the ONLY reason this fails is the wrong answer.
    await unlockedWrongStore.claimSolve({
      challenge: "goldstein",
      user: "u1",
      channel: "qr",
      solvedAt: "1970-01-01T00:00:00.000Z",
    });
    const wrong = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: WRONG, channel: "qr" },
      { store: unlockedWrongStore, now: 0, log: () => {} },
    );

    // INDISTINGUISHABLE: a locked gate looks exactly like a wrong guess.
    expect(locked).toEqual(NON_SOLVE);
    expect(locked).toEqual(wrong);
    // Locked: never claimed, never allocated.
    expect(lockedSolves.size).toBe(0);
    expect(lockedEvents.size).toBe(0);

    // Now score the prerequisite for u1 → the gate opens → correct answer solves.
    const { store: openStore } = makeStore(ctf);
    await openStore.claimSolve({
      challenge: "goldstein",
      user: "u1",
      channel: "qr",
      solvedAt: "1970-01-01T00:00:00.000Z",
    });
    const opened = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store: openStore, now: 0, log: () => {} },
    );
    expect(opened.solved).toBe(true);
    expect(opened.ordinal).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (3) answer-type dispatch — otp verifies via verifyTotp; wrong code is a miss.
// ---------------------------------------------------------------------------
describe("gate — otp answer-type dispatch (CTFT-04)", () => {
  const nowMs = 1_700_000_000_000;
  const nowSec = Math.floor(nowMs / 1000);
  const ctf = () =>
    fixtureCtf({
      answerType: "otp",
      otp: { secret: OTP_SECRET, digits: 6, period: OTP_PERIOD, skew: 1 },
      // otp ⇒ repeatable; give it a large per-player cap so this test isolates dispatch.
      perPlayerMax: 100,
    });

  it("a valid current TOTP code solves", async () => {
    const { store, events } = makeStore(ctf());
    const code = totpAt(OTP_SECRET, nowSec, { period: OTP_PERIOD });
    const res = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: code, channel: "qr" },
      { store, now: nowMs, log: () => {} },
    );
    expect(res.solved).toBe(true);
    expect(res.points).toBeGreaterThan(0);
    expect(events.size).toBe(1); // scored onto the ledger, not CtfSolve
  });

  it("an invalid code is an indistinguishable NON_SOLVE (never touches the ledger)", async () => {
    const { store, events } = makeStore(ctf());
    const bad = wrongOtpCode(nowSec);
    const res = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: bad, channel: "qr" },
      { store, now: nowMs, log: () => {} },
    );
    expect(res).toEqual(NON_SOLVE);
    expect(events.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (4) atomic once-per-window — two same-window submits accrue exactly once;
//     a submit in the next window scores again (SC-3 / T-53-03-01).
// ---------------------------------------------------------------------------
describe("gate — atomic once-per-window (SC-3)", () => {
  const now1 = 1_700_000_000_000;
  const sec1 = Math.floor(now1 / 1000);
  const ctf = () =>
    fixtureCtf({
      answerType: "otp",
      otp: { secret: OTP_SECRET, digits: 6, period: OTP_PERIOD, skew: 1 },
      perPlayerMax: 100,
    });

  it("two concurrent identical rolling-code submits in the same bucket score EXACTLY once", async () => {
    const { store, events, ordinals, state } = makeStore(ctf());
    const code = totpAt(OTP_SECRET, sec1, { period: OTP_PERIOD });

    const [a, b] = await Promise.all([
      judgeSolve(
        { user: "u1", challenge: CHALLENGE, guess: code, channel: "qr" },
        { store, now: now1, log: () => {} },
      ),
      judgeSolve(
        { user: "u1", challenge: CHALLENGE, guess: code, channel: "qr" },
        { store, now: now1, log: () => {} },
      ),
    ]);

    // Exactly one of the pair scored; the other is an indistinguishable non-solve.
    const scored = [a, b].filter((r) => r.solved && r.points > 0);
    const missed = [a, b].filter((r) => !r.solved);
    expect(scored).toHaveLength(1);
    expect(missed).toHaveLength(1);
    expect(missed[0]).toEqual(NON_SOLVE);
    // The ledger holds ONE row for this window.
    expect(events.size).toBe(1);
    expect(ordinals.get(CHALLENGE)).toBe(1);
    expect(state.allocateCalls).toBe(1); // claim-before-allocate: the loser never allocated
  });

  it("a submit in the NEXT window scores again", async () => {
    const { store, events } = makeStore(ctf());
    const code1 = totpAt(OTP_SECRET, sec1, { period: OTP_PERIOD });
    const first = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: code1, channel: "qr" },
      { store, now: now1, log: () => {} },
    );
    expect(first.solved).toBe(true);

    const now2 = now1 + OTP_PERIOD * 1000; // next period ⇒ next bucket
    const sec2 = Math.floor(now2 / 1000);
    const code2 = totpAt(OTP_SECRET, sec2, { period: OTP_PERIOD });
    const second = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: code2, channel: "qr" },
      { store, now: now2, log: () => {} },
    );
    expect(second.solved).toBe(true);
    expect(second.points).toBeGreaterThan(0);

    // Two distinct windows ⇒ two ledger rows.
    expect(events.size).toBe(2);
    const total = [...events.values()].reduce((acc, e) => acc + e.points, 0);
    expect(total).toBe(first.points + second.points);
  });
});

// ---------------------------------------------------------------------------
// (5) perPlayerMax — caps a player's total scoring solves.
// ---------------------------------------------------------------------------
describe("gate — perPlayerMax (SC-3)", () => {
  const HOUR_MS = 3600 * 1000;
  const ctf = () =>
    fixtureCtf({ perPlayerIntervalHours: 1, perPlayerMax: 2 });

  it("scores at most perPlayerMax times, then withholds (indistinguishable)", async () => {
    const { store, events } = makeStore(ctf());
    const base = 1_700_000_000_000;
    const submit = (now: number) =>
      judgeSolve(
        { user: "u1", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
        { store, now, log: () => {} },
      );

    const r1 = await submit(base); // window 1 → score
    const r2 = await submit(base + HOUR_MS); // window 2 → score
    const r3 = await submit(base + 2 * HOUR_MS); // window 3 → OVER cap → non-solve

    expect(r1.solved).toBe(true);
    expect(r2.solved).toBe(true);
    expect(r3).toEqual(NON_SOLVE);
    // window 3's once-per-window claim still creates a row before the perPlayerMax
    // gate rejects it (claim-before-cap), so only the SCORED rows are capped at 2.
    const scoredEvents = [...events.values()].filter((e) => e.points > 0);
    expect(scoredEvents).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// (6) globalMax — the (globalMax+1)-th event awards 0 / no award (T-53-03-03).
// ---------------------------------------------------------------------------
describe("gate — globalMax hard cutoff (SC-3)", () => {
  const ctf = () =>
    fixtureCtf({ perPlayerIntervalHours: 1, globalMax: 1 });

  it("the second global scoring event returns points 0, via the atomic ordinal", async () => {
    const { store, ordinals } = makeStore(ctf());
    const now = 1_700_000_000_000;

    const a = await judgeSolve(
      { user: "uA", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store, now, log: () => {} },
    );
    const b = await judgeSolve(
      { user: "uB", challenge: CHALLENGE, guess: FLAG, channel: "qr" },
      { store, now, log: () => {} },
    );

    // First global event scores; the second is over the global cap.
    expect(a.solved).toBe(true);
    expect(a.ordinal).toBe(1);
    expect(a.points).toBeGreaterThan(0);

    expect(b.solved).toBe(true); // still a solve...
    expect(b.ordinal).toBe(2);
    expect(b.points).toBe(0); // ...but awards nothing (globalMax=1)
    expect(b.capped).toBe(true);

    // The global ordinal advanced.
    expect(ordinals.get(CHALLENGE)).toBe(2);
  });
});
