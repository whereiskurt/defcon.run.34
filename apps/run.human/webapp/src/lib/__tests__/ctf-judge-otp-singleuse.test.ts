import { describe, it, expect } from "vitest";

import { judgeSolve, type CtfStore, type JudgeCtf } from "../ctf-judge";
import { totpAt } from "../ctf-otp";
import { applyOtpClaim, otpCodeHash, otpClaimTtlSeconds } from "../ctf-otp-claim";

/**
 * SINGLE-USE OTP judge suite (Phase 65, CTFT-17). Proves the first-come single-use
 * finalize against a FULLY in-memory fake CtfStore (NO DynamoDB). The fake's
 * `claimOtpCode` backs onto the 65-01 pure `applyOtpClaim` over a shared Map — so
 * the offline race model and the pure gate share ONE source of truth, and the
 * has-check+set happen with NO await between them (modeling attribute_not_exists
 * on the key: the first writer wins, a concurrent second collides).
 *
 * Success criteria proven here:
 *   SC1 — two concurrent same-code submissions ⇒ exactly one winner.
 *   SC2 — default-off (singleUse absent) still credits MULTIPLE users (regression).
 *   SC3 — claim carries the TTL; the winner scores via recordScoreEvent(bucket=codeHash).
 *   SC4 — consumed/re-submit ⇒ indistinguishable NON_SOLVE (same log, no leak),
 *         no double-award; a wrong code never touches the claim.
 */

const CHALLENGE = "goldstein-otp";
const OTP_SECRET = "JBSWY3DPEHPK3PXP"; // valid RFC 4648 base32 (test-only)
const OTP_PERIOD = 120;
const NON_SOLVE = { solved: false, points: 0, ordinal: null, firstBlood: false, capped: false };

function singleUseOtpCtf(overrides: Partial<JudgeCtf> = {}): JudgeCtf {
  return {
    challenge: CHALLENGE,
    answerHash: "",
    enabled: true,
    // Flat award 100 (pointMax == pointFloor; huge maxSolves so no curve cap).
    pointMax: 100,
    pointFloor: 100,
    maxSolves: 100000,
    firstBloodBonus: 0,
    timeTiers: undefined,
    maxAttempts: 1000,
    rateLimitWindow: 60,
    answerType: "otp",
    otp: { secret: OTP_SECRET, digits: 6, period: OTP_PERIOD, algorithm: "SHA1", skew: 1, singleUse: true },
    ...overrides,
  };
}

/** A shared (non-single-use) OTP flag — the default-off regression fixture. */
function sharedOtpCtf(): JudgeCtf {
  const ctf = singleUseOtpCtf();
  return { ...ctf, otp: { ...ctf.otp!, singleUse: false } };
}

type StoredEvent = { challenge: string; user: string; bucket: string; points: number };

/**
 * In-memory CtfStore fake with an UPSERTING recordScoreEvent (the single-use path
 * pre-creates no ledger row — same as the wordlist path — so record must create),
 * a claimOtpCode backed by the pure `applyOtpClaim`, and the shared-OTP repeatable
 * ops (claimScoreEvent time-bucket) for the regression test.
 */
function makeStore(ctf: JudgeCtf | null) {
  const events = new Map<string, StoredEvent>(); // `${c}|${u}|${b}`
  const otpClaims = new Map<string, { claimedBy: string }>(); // codeHash → winner
  const ordinals = new Map<string, number>();
  const calls = { allocate: 0, claimOtp: 0, recordEvent: 0 };
  const claimArgs: Array<{ codeHash: string; ttl: number; user: string }> = [];
  const eKey = (c: string, u: string, b: string) => `${c}|${u}|${b}`;

  const store: CtfStore = {
    async getCtf() {
      return ctf;
    },
    async overAttemptLimit() {
      return false; // attempt cap not under test here
    },
    async allocateOrdinal(challenge) {
      calls.allocate++;
      const n = (ordinals.get(challenge) ?? 0) + 1;
      ordinals.set(challenge, n);
      return n;
    },
    // repeatable (shared OTP) ops — used by the default-off regression path
    async claimScoreEvent({ challenge, user, bucket }) {
      const k = eKey(challenge, user, bucket);
      if (events.has(k)) return { claimed: false };
      events.set(k, { challenge, user, bucket, points: 0 });
      return { claimed: true };
    },
    async overPerPlayerMax() {
      return false;
    },
    async recordScoreEvent({ challenge, user, bucket, points }) {
      calls.recordEvent++;
      // UPSERT: create if absent (single-use path has no pre-created row), else set.
      events.set(eKey(challenge, user, bucket), { challenge, user, bucket, points });
    },
    // single-use OTP claim — atomic create-if-absent, backed by the pure model.
    async claimOtpCode({ codeHash, user, ttl }) {
      calls.claimOtp++;
      claimArgs.push({ codeHash, ttl, user });
      return applyOtpClaim(otpClaims, codeHash, user);
    },
    // unused-but-required-by-type ops kept minimal
    async claimSolve() {
      return { claimed: true };
    },
    async recordScore() {},
  };

  return { store, events, otpClaims, calls, claimArgs };
}

const NOW = 1_700_000_400_000; // epoch ms (a multiple of the 120s period boundary)
const validCode = () => totpAt(OTP_SECRET, Math.floor(NOW / 1000), { period: OTP_PERIOD });

// A 6-digit code that matches NO offset in the ±1 skew window at NOW.
function wrongCode(): string {
  const sec = Math.floor(NOW / 1000);
  const valid = new Set([
    totpAt(OTP_SECRET, sec - OTP_PERIOD, { period: OTP_PERIOD }),
    totpAt(OTP_SECRET, sec, { period: OTP_PERIOD }),
    totpAt(OTP_SECRET, sec + OTP_PERIOD, { period: OTP_PERIOD }),
  ]);
  for (let i = 0; i < 1_000_000; i++) {
    const c = String(i).padStart(6, "0");
    if (!valid.has(c)) return c;
  }
  return "000000";
}

describe("single-use OTP — winner scores once (SC1/SC3)", () => {
  it("a valid unclaimed code scores via the codeHash-keyed ledger", async () => {
    const ctf = singleUseOtpCtf({ effect: { kind: "otp-enroll", otpauth: "otpauth://x" } });
    const { store, events, claimArgs } = makeStore(ctf);

    const res = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: validCode(), channel: "qr" },
      { store, now: NOW }
    );

    expect(res.solved).toBe(true);
    expect(res.points).toBe(100);
    expect(res.ordinal).toBe(1);
    expect(res.effect).toEqual({ kind: "otp-enroll", otpauth: "otpauth://x" });
    // one ledger row keyed by the codeHash (not a time bucket).
    const codeHash = otpCodeHash(validCode());
    expect(events.get(`${CHALLENGE}|u1|${codeHash}`)?.points).toBe(100);
    // the claim carried the correct DynamoDB TTL.
    expect(claimArgs[0].ttl).toBe(otpClaimTtlSeconds(NOW, ctf.otp));
    expect(claimArgs[0].codeHash).toBe(codeHash);
  });
});

describe("single-use OTP — global first-come (SC1)", () => {
  it("two concurrent submissions of the same code by two players → exactly one winner", async () => {
    const { store, calls } = makeStore(singleUseOtpCtf());
    const code = validCode();

    const [a, b] = await Promise.all([
      judgeSolve({ user: "u1", challenge: CHALLENGE, guess: code, channel: "qr" }, { store, now: NOW }),
      judgeSolve({ user: "u2", challenge: CHALLENGE, guess: code, channel: "qr" }, { store, now: NOW }),
    ]);

    const winners = [a, b].filter((r) => r.solved && r.points > 0);
    const losers = [a, b].filter((r) => !r.solved);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toEqual(NON_SOLVE);
    // the two claimers hit the seam but only one wins.
    expect(calls.claimOtp).toBe(2);
  });

  it("a second player submitting the same code sequentially → indistinguishable NON_SOLVE (same log, no leak)", async () => {
    const { store } = makeStore(singleUseOtpCtf());
    const code = validCode();
    const logs: unknown[] = [];
    const log = (o: unknown) => logs.push(o);

    await judgeSolve({ user: "u1", challenge: CHALLENGE, guess: code, channel: "qr" }, { store, now: NOW, log });
    const second = await judgeSolve(
      { user: "u2", challenge: CHALLENGE, guess: code, channel: "qr" },
      { store, now: NOW, log }
    );

    expect(second).toEqual(NON_SOLVE);

    // The consumed-code log is BYTE-identical to a wrong-code log, and neither
    // carries the guess/codeHash (ctfJudgeLog is structurally guess-free).
    const { store: store2 } = makeStore(singleUseOtpCtf());
    const wrongLogs: unknown[] = [];
    await judgeSolve(
      { user: "u9", challenge: CHALLENGE, guess: wrongCode(), channel: "qr" },
      { store: store2, now: NOW, log: (o) => wrongLogs.push(o) }
    );
    expect(logs[logs.length - 1]).toEqual(wrongLogs[wrongLogs.length - 1]);
    const codeHash = otpCodeHash(code);
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(code);
    expect(serialized).not.toContain(codeHash);
  });
});

describe("single-use OTP — no double-award on winner re-submit (SC4)", () => {
  it("the winner re-submitting the same code → NON_SOLVE, no second award", async () => {
    const { store } = makeStore(singleUseOtpCtf());
    const code = validCode();

    const first = await judgeSolve({ user: "u1", challenge: CHALLENGE, guess: code, channel: "qr" }, { store, now: NOW });
    const again = await judgeSolve({ user: "u1", challenge: CHALLENGE, guess: code, channel: "qr" }, { store, now: NOW });

    expect(first.solved).toBe(true);
    expect(again).toEqual(NON_SOLVE);
  });
});

describe("single-use OTP — a wrong code never claims (SC4)", () => {
  it("an invalid code returns NON_SOLVE and claimOtpCode is never called", async () => {
    const { store, calls } = makeStore(singleUseOtpCtf());
    const res = await judgeSolve(
      { user: "u1", challenge: CHALLENGE, guess: wrongCode(), channel: "qr" },
      { store, now: NOW }
    );
    expect(res).toEqual(NON_SOLVE);
    expect(calls.claimOtp).toBe(0); // verifyTotp gate short-circuits before any claim
  });
});

describe("single-use OTP — globalMax (SC3)", () => {
  it("a claim past globalMax is capped (solved, points 0, no award)", async () => {
    // globalMax 1: the FIRST winning claim awards, the SECOND (a distinct valid
    // code from the +1-skew window, so a distinct claim key) allocates ordinal 2
    // and is capped. Two distinct current-window-valid codes are needed so BOTH
    // pass the claim (a re-used code would non-solve before reaching globalMax).
    const s = makeStore(singleUseOtpCtf({ globalMax: 1 }));
    const sec = Math.floor(NOW / 1000);
    const c1 = totpAt(OTP_SECRET, sec, { period: OTP_PERIOD });
    const c2 = totpAt(OTP_SECRET, sec + OTP_PERIOD, { period: OTP_PERIOD }); // next window, valid at +skew
    expect(c1).not.toBe(c2);

    const first = await judgeSolve({ user: "u1", challenge: CHALLENGE, guess: c1, channel: "qr" }, { store: s.store, now: NOW });
    expect(first).toMatchObject({ solved: true, points: 100, ordinal: 1 });

    const second = await judgeSolve({ user: "u2", challenge: CHALLENGE, guess: c2, channel: "qr" }, { store: s.store, now: NOW });
    expect(second).toEqual({ solved: true, points: 0, ordinal: 2, firstBlood: false, capped: true });
  });
});

describe("shared OTP regression — default-off unchanged (SC2)", () => {
  it("a non-single-use OTP flag credits MULTIPLE users for the same code; claimOtpCode never called", async () => {
    const { store, calls } = makeStore(sharedOtpCtf());
    const code = validCode();

    const a = await judgeSolve({ user: "u1", challenge: CHALLENGE, guess: code, channel: "qr" }, { store, now: NOW });
    const b = await judgeSolve({ user: "u2", challenge: CHALLENGE, guess: code, channel: "qr" }, { store, now: NOW });

    expect(a.solved).toBe(true);
    expect(a.points).toBe(100);
    expect(b.solved).toBe(true);
    expect(b.points).toBe(100);
    // BOTH users scored (shared) — the single-use claim seam was never touched.
    expect(calls.claimOtp).toBe(0);
  });
});
