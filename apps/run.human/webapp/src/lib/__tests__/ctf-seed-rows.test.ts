import { describe, it, expect } from "vitest";

import { hashAnswer } from "@/lib/ctf-hash";
import { buildSeedRows, type CtfSeedRow } from "@/lib/ctf-seed-rows";
import { computePoints, type ScoringConfig } from "@/lib/ctf-scoring";

// The six curated DC33 starters (57-CONTEXT.md D3), one per flag type. These
// tests assert the pure builder against the documented field contract. Answer
// hashes are compared against `hashAnswer(...)` computed live, so the assertions
// are salt-independent (both sides use whatever CTF_ANSWER_SALT is in the env).
//
// CR-01 (57-REVIEW): the judge's scorer IGNORES the legacy `points` field and
// reads `pointMax`/`pointFloor`/`maxSolves`/`firstBloodBonus` only (narrowCtf →
// computePoints). Earlier revisions of this test asserted the ignored `points`
// field, which masked the fact that 5 of 6 starters awarded 0 on solve. These
// tests now assert the REAL scoring knobs AND run each row through the same
// `computePoints` the judge uses, asserting the FIRST-solver award.

const rows = buildSeedRows();
const byName = (name: string): CtfSeedRow => {
  const row = rows.find((r) => r.challenge === name);
  if (!row) throw new Error(`missing seed row: ${name}`);
  return row;
};

// Build the ScoringConfig the judge would derive from a seed row (narrowCtf
// reads exactly these four knobs plus optional timeTiers). Every fixed starter
// sets all four explicitly, so no defaulting is needed here.
const scoringOf = (r: CtfSeedRow): ScoringConfig => ({
  pointMax: r.pointMax as number,
  pointFloor: r.pointFloor as number,
  maxSolves: r.maxSolves as number,
  firstBloodBonus: r.firstBloodBonus as number,
  timeTiers: r.timeTiers,
});

// A time INSIDE and a time OUTSIDE grace-hopper's DEF CON 34 tier window.
const INSIDE_WINDOW = new Date("2026-08-07T12:00:00Z");
const OUTSIDE_WINDOW = new Date("2026-01-01T00:00:00Z");

describe("buildSeedRows() — DC33 starter set", () => {
  it("returns exactly the 6 documented starters, one per name", () => {
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.challenge).sort()).toEqual(
      ["condor", "goldstein", "goldstein-otp", "grace-hopper", "mudge", "turing"].sort()
    );
  });

  it("every row is disabled with the anti-spam defaults", () => {
    for (const r of rows) {
      expect(r.enabled).toBe(false);
      expect(r.maxAttempts).toBe(5);
      expect(r.rateLimitWindow).toBe(60);
    }
  });

  it("never stores a raw plaintext answer when a hash suffices", () => {
    for (const r of rows) {
      expect(r.answer).toBeUndefined();
    }
  });

  it("never carries the legacy dead `points` field (judge ignores it — CR-01)", () => {
    for (const r of rows) {
      expect((r as { points?: number }).points).toBeUndefined();
    }
  });

  it("every row sets the four real scoring knobs the judge reads", () => {
    for (const r of rows) {
      expect(typeof r.pointMax).toBe("number");
      expect(typeof r.pointFloor).toBe("number");
      expect(typeof r.maxSolves).toBe("number");
      expect(typeof r.firstBloodBonus).toBe("number");
    }
  });

  it("goldstein: static flat 100 with the otp-enroll effect + nextFlag chain", () => {
    const g = byName("goldstein");
    expect(g.answerHash).toBe(hashAnswer("hackers4evr"));
    expect(g.pointMax).toBe(100);
    expect(g.pointFloor).toBe(100);
    expect(g.maxSolves).toBe(100000);
    expect(g.firstBloodBonus).toBe(0);
    expect(g.effect).toEqual({
      kind: "otp-enroll",
      otpauth:
        "otpauth://totp/Emmanuel%20Goldstein?secret=GZRGQNKGKN4DINQ&issuer=Defcon.run&algorithm=SHA1&digits=6&period=120",
      nextFlag: "goldstein-otp",
    });
  });

  it("goldstein-otp: answerType otp, otp map, unlockAfter chain, 24h cadence, no answer", () => {
    const o = byName("goldstein-otp");
    expect(o.answerType).toBe("otp");
    expect(o.otp).toEqual({
      secret: "GZRGQNKGKN4DINQ",
      digits: 6,
      period: 120,
      algorithm: "SHA1",
      skew: 1,
    });
    expect(o.unlockAfter).toBe("goldstein");
    expect(o.perPlayerIntervalHours).toBe(24);
    expect(o.pointMax).toBe(100);
    expect(o.pointFloor).toBe(100);
    expect(o.maxSolves).toBe(100000);
    expect(o.firstBloodBonus).toBe(0);
    // OTP flag verifies via TOTP secret — it holds no static answer/hash.
    expect(o.answer).toBeUndefined();
    expect(o.answerHash).toBeUndefined();
  });

  it("mudge: first-blood race curve", () => {
    const m = byName("mudge");
    expect(m.answerHash).toBe(hashAnswer("0g3l33t"));
    expect(m.pointMax).toBe(1000);
    expect(m.pointFloor).toBe(100);
    expect(m.maxSolves).toBe(100);
    expect(m.firstBloodBonus).toBe(250);
  });

  it("condor: flat award 100", () => {
    const c = byName("condor");
    expect(c.answerHash).toBe(hashAnswer("fr33k3v1n"));
    expect(c.pointMax).toBe(100);
    expect(c.pointFloor).toBe(100);
    expect(c.maxSolves).toBe(100000);
    expect(c.firstBloodBonus).toBe(0);
  });

  it("grace-hopper: timed drop with the DEF CON 34 timeTier ceiling (answer lowercased)", () => {
    const gh = byName("grace-hopper");
    // hashAnswer trim+lowercases, so the D3 "d3bugth3sYstem" normalizes to
    // "d3bugth3system" — assert against the normalized form.
    expect(gh.answerHash).toBe(hashAnswer("d3bugth3system"));
    expect(gh.answerHash).toBe(hashAnswer("d3bugth3sYstem")); // same after normalize
    expect(gh.pointMax).toBe(100);
    expect(gh.pointFloor).toBe(1);
    expect(gh.maxSolves).toBe(100);
    expect(gh.firstBloodBonus).toBe(0);
    expect(gh.timeTiers).toHaveLength(1);
    expect(gh.timeTiers?.[0].ceiling).toBe(500);
    expect(typeof gh.timeTiers?.[0].from).toBe("string");
    expect(typeof gh.timeTiers?.[0].to).toBe("string");
    // window must be well-formed (from strictly before to)
    expect(Date.parse(gh.timeTiers![0].from)).toBeLessThan(Date.parse(gh.timeTiers![0].to));
  });

  it("turing: easter-egg confetti award 10", () => {
    const t = byName("turing");
    expect(t.answerHash).toBe(hashAnswer("3n1gim@"));
    expect(t.pointMax).toBe(10);
    expect(t.pointFloor).toBe(10);
    expect(t.maxSolves).toBe(100000);
    expect(t.firstBloodBonus).toBe(0);
    expect(t.effect).toEqual({ kind: "confetti", intensity: 11 });
  });
});

describe("buildSeedRows() — first-solver award parity through the judge's scorer", () => {
  // This is the assertion that closes the CR-01 masking gap: run each starter
  // through the SAME computePoints the judge calls (narrowCtf → computePoints),
  // and assert a NON-ZERO, intended award to the first solver. Before the
  // row-builder fix these all returned 0 (maxSolves defaulted to 0 → n=1 > 0 →
  // capped).

  it("goldstein: first solver earns a flat 100", () => {
    expect(computePoints(1, scoringOf(byName("goldstein")))).toBe(100);
  });

  it("goldstein-otp: first solver earns a flat 100", () => {
    expect(computePoints(1, scoringOf(byName("goldstein-otp")))).toBe(100);
  });

  it("condor: first solver earns a flat 100", () => {
    expect(computePoints(1, scoringOf(byName("condor")))).toBe(100);
  });

  it("mudge: first solver earns 1000 curve + 250 first-blood = 1250", () => {
    expect(computePoints(1, scoringOf(byName("mudge")))).toBe(1250);
  });

  it("turing: first solver earns the fixed 10", () => {
    expect(computePoints(1, scoringOf(byName("turing")))).toBe(10);
  });

  it("grace-hopper: 100 outside the window, 500 inside the DEF CON 34 tier", () => {
    const gh = scoringOf(byName("grace-hopper"));
    expect(computePoints(1, gh, OUTSIDE_WINDOW)).toBe(100);
    expect(computePoints(1, gh, INSIDE_WINDOW)).toBe(500);
  });
});
