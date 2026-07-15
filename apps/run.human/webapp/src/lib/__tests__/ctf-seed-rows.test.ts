import { describe, it, expect } from "vitest";

import { hashAnswer } from "@/lib/ctf-hash";
import { buildSeedRows, type CtfSeedRow } from "@/lib/ctf-seed-rows";

// The six curated DC33 starters (57-CONTEXT.md D3), one per flag type. These
// tests assert the pure builder against the documented field contract. Answer
// hashes are compared against `hashAnswer(...)` computed live, so the assertions
// are salt-independent (both sides use whatever CTF_ANSWER_SALT is in the env).

const rows = buildSeedRows();
const byName = (name: string): CtfSeedRow => {
  const row = rows.find((r) => r.challenge === name);
  if (!row) throw new Error(`missing seed row: ${name}`);
  return row;
};

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

  it("goldstein: static flat 100 with the otp-enroll effect + nextFlag chain", () => {
    const g = byName("goldstein");
    expect(g.answerHash).toBe(hashAnswer("hackers4evr"));
    expect(g.points).toBe(100);
    expect(g.pointMax).toBe(100);
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
    expect(c.points).toBe(100);
  });

  it("grace-hopper: timed drop with the DEF CON 34 timeTier ceiling (answer lowercased)", () => {
    const gh = byName("grace-hopper");
    // hashAnswer trim+lowercases, so the D3 "d3bugth3sYstem" normalizes to
    // "d3bugth3system" — assert against the normalized form.
    expect(gh.answerHash).toBe(hashAnswer("d3bugth3system"));
    expect(gh.answerHash).toBe(hashAnswer("d3bugth3sYstem")); // same after normalize
    expect(gh.pointMax).toBe(100);
    expect(gh.pointFloor).toBe(1);
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
    expect(t.points).toBe(10);
    expect(t.effect).toEqual({ kind: "confetti", intensity: 11 });
  });
});
