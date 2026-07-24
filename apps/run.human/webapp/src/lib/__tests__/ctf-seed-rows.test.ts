import { describe, it, expect } from "vitest";

import { hashAnswer } from "@/lib/ctf-hash";
import { buildSeedRows, type CtfSeedRow } from "@/lib/ctf-seed-rows";
import { computePoints, type ScoringConfig } from "@/lib/ctf-scoring";

// The ten curated DC33 starters: five personas, each an OTP CHAIN (a static
// flag whose solve reward reveals the enrollment QR, chained to a rotating-OTP
// flag). These tests assert the pure builder against the documented field
// contract. Answer hashes are compared against `hashAnswer(...)` computed live,
// so the assertions are salt-independent (both sides use whatever
// CTF_ANSWER_SALT is in the env).
//
// CR-01 (57-REVIEW): the judge's scorer IGNORES the legacy `points` field and
// reads `pointMax`/`pointFloor`/`maxSolves`/`firstBloodBonus` only (narrowCtf →
// computePoints). Earlier revisions of this test asserted the ignored `points`
// field, which masked the fact that starters awarded 0 on solve. These tests now
// assert the REAL scoring knobs AND run each row through the same `computePoints`
// the judge uses, asserting the FIRST-solver award.

// Fixture mirror of the builder's persona table (name → code + real DC33 seed).
const PERSONAS = [
  {
    name: "goldstein",
    answer: "hackers4evr",
    secret: "GZRGQNKGKN4DINQ",
    otpauth:
      "otpauth://totp/Emmanuel%20Goldstein?secret=GZRGQNKGKN4DINQ&issuer=Defcon.run&algorithm=SHA1&digits=6&period=30",
  },
  {
    name: "mudge",
    answer: "0g3l33t",
    secret: "NA2DG",
    otpauth: "otpauth://totp/Mudge?secret=NA2DG&issuer=Defcon.run&algorithm=SHA1&digits=6&period=30",
  },
  {
    name: "condor",
    answer: "fr33k3v1n",
    secret: "EZRWO",
    otpauth: "otpauth://totp/Condor?secret=EZRWO&issuer=Defcon.run&algorithm=SHA1&digits=6&period=30",
  },
  {
    name: "grace-hopper",
    // hashAnswer trim+lowercases, so "d3bugth3sYstem" normalizes to "d3bugth3system".
    answer: "d3bugth3sYstem",
    secret: "I4TDMITCMU",
    otpauth:
      "otpauth://totp/Grandma%20COBOL?secret=I4TDMITCMU&issuer=Defcon.run&algorithm=SHA1&digits=6&period=30",
  },
  {
    name: "turing",
    answer: "3n1gim@",
    secret: "O5RQ",
    otpauth: "otpauth://totp/Prof?secret=O5RQ&issuer=Defcon.run&algorithm=SHA1&digits=6&period=30",
  },
] as const;

const rows = buildSeedRows();
const byName = (name: string): CtfSeedRow => {
  const row = rows.find((r) => r.challenge === name);
  if (!row) throw new Error(`missing seed row: ${name}`);
  return row;
};

// Build the ScoringConfig the judge would derive from a seed row (narrowCtf
// reads exactly these four knobs plus optional timeTiers). Every starter sets
// all four explicitly, so no defaulting is needed here.
const scoringOf = (r: CtfSeedRow): ScoringConfig => ({
  pointMax: r.pointMax as number,
  pointFloor: r.pointFloor as number,
  maxSolves: r.maxSolves as number,
  firstBloodBonus: r.firstBloodBonus as number,
  timeTiers: r.timeTiers,
});

describe("buildSeedRows() — DC33 persona OTP-chain starter set", () => {
  it("returns exactly the 10 rows: a static + a -otp flag per persona", () => {
    expect(rows).toHaveLength(10);
    const expected = PERSONAS.flatMap((p) => [p.name, `${p.name}-otp`]).sort();
    expect(rows.map((r) => r.challenge).sort()).toEqual(expected);
  });

  it("every row is disabled with the anti-spam defaults", () => {
    for (const r of rows) {
      expect(r.enabled).toBe(false);
      expect(r.maxAttempts).toBe(5);
      expect(r.rateLimitWindow).toBe(60);
    }
  });

  it("never stores a raw plaintext answer, and never the legacy dead `points` field (CR-01)", () => {
    for (const r of rows) {
      expect(r.answer).toBeUndefined();
      expect((r as { points?: number }).points).toBeUndefined();
    }
  });

  it("every row sets the four real scoring knobs the judge reads (flat 100)", () => {
    for (const r of rows) {
      expect(r.pointMax).toBe(100);
      expect(r.pointFloor).toBe(100);
      expect(r.maxSolves).toBe(100000);
      expect(r.firstBloodBonus).toBe(0);
    }
  });

  describe.each(PERSONAS)("persona %s", ({ name, answer, secret, otpauth }) => {
    it("static flag: hashed answer + otp-enroll reward chaining to the -otp flag", () => {
      const s = byName(name);
      expect(s.answerType).toBe("static");
      expect(s.answerHash).toBe(hashAnswer(answer));
      expect(s.effect).toEqual({ kind: "otp-enroll", otpauth, nextFlag: `${name}-otp` });
      // reward flags verify a static answer — never carry an otp map.
      expect(s.otp).toBeUndefined();
      expect(s.unlockAfter).toBeUndefined();
    });

    it("chained OTP flag: answerType otp, real secret, unlockAfter + 24h cadence, no static answer", () => {
      const o = byName(`${name}-otp`);
      expect(o.answerType).toBe("otp");
      expect(o.otp).toEqual({ secret, digits: 6, period: 30, algorithm: "SHA1", skew: 1 });
      // Default-off invariant (Phase 65, SC2): the seeded DC33 OTP chains stay
      // SHARED — no shipped/seeded flag becomes single-use by the new option.
      expect(o.otp?.singleUse).toBeUndefined();
      expect(o.unlockAfter).toBe(name);
      expect(o.perPlayerIntervalHours).toBe(24);
      // OTP flag verifies via TOTP secret — it holds no static answer/hash + no reward effect.
      expect(o.answer).toBeUndefined();
      expect(o.answerHash).toBeUndefined();
      expect(o.effect).toBeUndefined();
    });

    it("first solver earns a flat 100 through the judge's scorer (CR-01 award parity)", () => {
      // Closes the CR-01 masking gap: both flags run through the SAME
      // computePoints the judge calls; before the fix these returned 0.
      expect(computePoints(1, scoringOf(byName(name)))).toBe(100);
      expect(computePoints(1, scoringOf(byName(`${name}-otp`)))).toBe(100);
    });
  });
});
