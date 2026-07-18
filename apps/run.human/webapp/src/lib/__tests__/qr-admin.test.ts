import { describe, it, expect } from "vitest";

import {
  normalizeCode,
  normalizeChallenge,
  validateDestination,
  upsertQr,
  qrAttributes,
  ctfAttributes,
  hashCodeBatch,
  QrValidationError,
} from "../qr-admin";
import { hashAnswer } from "../ctf-hash";

describe("validateDestination", () => {
  it("accepts an absolute https URL", () => {
    expect(() => validateDestination("https://run.defcon.run/use1/ctf/claim")).not.toThrow();
    expect(() => validateDestination("https://example.com/x?y=1#z")).not.toThrow();
  });

  it.each([
    ["http (insecure)", "http://run.defcon.run"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>"],
    ["relative", "/use1/ctf/claim"],
    ["bare host", "run.defcon.run"],
    ["empty", ""],
    ["garbage", "not a url"],
  ])("rejects %s", (_label, url) => {
    expect(() => validateDestination(url)).toThrow(QrValidationError);
  });
});

describe("normalizeCode", () => {
  it("lowercases and trims", () => {
    expect(normalizeCode("  BUNNY ")).toBe("bunny");
    expect(normalizeCode("Flag-1_A")).toBe("flag-1_a");
  });

  it.each([
    ["ctf", "ctf"],
    ["CTF", "CTF"],
    ["_flush", "_flush"],
    ["new", "new"],
    ["NEW", "NEW"],
  ])("rejects reserved %s", (_label, code) => {
    expect(() => normalizeCode(code)).toThrow(QrValidationError);
  });

  it.each([
    ["empty", ""],
    ["leading dash", "-x"],
    ["spaces inside", "a b"],
    ["punctuation", "a.b"],
    ["too long", "a".repeat(65)],
  ])("rejects bad shape %s", (_label, code) => {
    expect(() => normalizeCode(code)).toThrow(QrValidationError);
  });
});

describe("normalizeChallenge", () => {
  it("lowercases and trims", () => {
    expect(normalizeChallenge("  SAO ")).toBe("sao");
    expect(normalizeChallenge("Flag1")).toBe("flag1");
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["new sentinel", "new"],
    ["too long", "a".repeat(65)],
  ])("rejects %s", (_label, challenge) => {
    expect(() => normalizeChallenge(challenge)).toThrow(QrValidationError);
  });
});

describe("upsertQr validation ordering", () => {
  it("throws on a bad destination before touching DynamoDB", async () => {
    // If validation did NOT run first, this would hit the (uncredentialed)
    // DynamoDB client and fail with a network/credentials error instead.
    await expect(
      upsertQr({ code: "TESTONLY", destination: "http://insecure.example" })
    ).rejects.toBeInstanceOf(QrValidationError);
  });

  it("throws on a bad rule dest before touching DynamoDB", async () => {
    await expect(
      upsertQr({
        code: "TESTONLY",
        destination: "https://run.defcon.run",
        rules: [{ kind: "param", match: "a", dest: "javascript:alert(1)" }],
      })
    ).rejects.toBeInstanceOf(QrValidationError);
  });

  it("rejects a reserved code before touching DynamoDB", async () => {
    await expect(upsertQr({ code: "ctf" })).rejects.toBeInstanceOf(QrValidationError);
  });

  // Regression guard for the RICK 502: a rule with no destination must be
  // refused, not stored (a blank dest at the resolver → empty-Location 502).
  it("rejects a rule with an empty destination", async () => {
    await expect(
      upsertQr({
        code: "TESTONLY",
        destination: "https://run.defcon.run",
        rules: [{ kind: "time", from: "2026-01-01T00:00:00Z", to: "2026-12-01T00:00:00Z", dest: "" }],
      })
    ).rejects.toBeInstanceOf(QrValidationError);
  });

  it("rejects a time rule missing From/To", async () => {
    await expect(
      upsertQr({
        code: "TESTONLY",
        destination: "https://run.defcon.run",
        rules: [{ kind: "time", from: "", to: "", dest: "https://x.example" }],
      })
    ).rejects.toBeInstanceOf(QrValidationError);
  });

  it("rejects a param rule missing a match value", async () => {
    await expect(
      upsertQr({
        code: "TESTONLY",
        destination: "https://run.defcon.run",
        rules: [{ kind: "param", match: "", dest: "https://x.example" }],
      })
    ).rejects.toBeInstanceOf(QrValidationError);
  });
});

describe("qrAttributes schedule compilation", () => {
  it("compiles switch-points into consecutive time rules (sorted, open-ended last)", () => {
    const attrs = qrAttributes({
      code: "rickroll",
      destination: "https://run.defcon.run/use1/welcome",
      schedule: [
        { startsAt: "2026-08-06T18:00:00.000Z", dest: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
        { startsAt: "2026-08-06T15:00:00.000Z", dest: "https://run.defcon.run/use1/welcome" },
      ],
    });
    expect(attrs.rules).toEqual([
      { kind: "time", from: "2026-08-06T15:00:00.000Z", to: "2026-08-06T18:00:00.000Z", dest: "https://run.defcon.run/use1/welcome" },
      { kind: "time", from: "2026-08-06T18:00:00.000Z", to: "2999-01-01T00:00:00.000Z", dest: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    ]);
    expect(attrs.schedule).toHaveLength(2);
  });

  it("persists an empty schedule + leaves raw rules in charge when schedule is absent", () => {
    const attrs = qrAttributes({
      code: "plain",
      destination: "https://run.defcon.run",
      rules: [{ kind: "param", match: "*", dest: "https://x.example/" }],
    });
    expect(attrs.schedule).toEqual([]);
    expect(attrs.rules).toEqual([{ kind: "param", match: "*", dest: "https://x.example/" }]);
  });

  it("rejects a switch-point with a non-https dest", () => {
    expect(() =>
      qrAttributes({
        code: "rickroll",
        schedule: [{ startsAt: "2026-08-06T15:00:00.000Z", dest: "http://insecure.example/" }],
      })
    ).toThrow(QrValidationError);
  });

  it("rejects a switch-point with an invalid start time", () => {
    expect(() =>
      qrAttributes({
        code: "rickroll",
        schedule: [{ startsAt: "not-a-date", dest: "https://ok.example/" }],
      })
    ).toThrow(QrValidationError);
  });
});

describe("ctfAttributes hash-on-save", () => {
  const T = { challenge: "sao" };

  it("hashes a non-empty answer and never emits a plaintext answer key", () => {
    const result = ctfAttributes({ ...T, answer: "Flag1" });
    expect(result.answerHash).toBe(hashAnswer("Flag1"));
    expect("answer" in result).toBe(false);
  });

  it.each([
    ["empty string", ""],
    ["whitespace", "   "],
  ])("omits answerHash for a %s answer (no-clobber)", (_label, answer) => {
    const result = ctfAttributes({ ...T, answer });
    expect("answerHash" in result).toBe(false);
  });

  it("omits answerHash when answer is undefined (no-clobber)", () => {
    const result = ctfAttributes({ ...T });
    expect("answerHash" in result).toBe(false);
  });

  it("emits a valid time tier { from, to, ceiling }", () => {
    const from = "2026-08-06T00:00:00.000Z";
    const to = "2026-08-10T00:00:00.000Z";
    const result = ctfAttributes({ ...T, timeTiers: [{ from, to, ceiling: 500 }] });
    expect(result.timeTiers).toEqual([{ from, to, ceiling: 500 }]);
  });

  it.each([
    ["from equal to to", "2026-08-06T00:00:00Z", "2026-08-06T00:00:00Z"],
    ["from after to", "2026-08-10T00:00:00Z", "2026-08-06T00:00:00Z"],
  ])("throws when %s", (_label, from, to) => {
    expect(() =>
      ctfAttributes({ ...T, timeTiers: [{ from, to, ceiling: 500 }] })
    ).toThrow(QrValidationError);
  });

  it.each([
    ["non-numeric ceiling", "x" as unknown as number],
    ["NaN ceiling", Number.NaN],
    ["missing ceiling", undefined],
  ])("throws on a %s", (_label, ceiling) => {
    expect(() =>
      ctfAttributes({
        ...T,
        timeTiers: [{ from: "2026-08-06T00:00:00Z", to: "2026-08-10T00:00:00Z", ceiling }],
      })
    ).toThrow(QrValidationError);
  });

  it("passes scoring numbers through when provided", () => {
    const result = ctfAttributes({
      ...T,
      pointMax: 500,
      pointFloor: 50,
      maxSolves: 100,
      firstBloodBonus: 250,
    });
    expect(result.pointMax).toBe(500);
    expect(result.pointFloor).toBe(50);
    expect(result.maxSolves).toBe(100);
    expect(result.firstBloodBonus).toBe(250);
  });

  it("omits scoring numbers when absent", () => {
    const result = ctfAttributes({ ...T });
    expect("pointMax" in result).toBe(false);
    expect("pointFloor" in result).toBe(false);
    expect("maxSolves" in result).toBe(false);
    expect("firstBloodBonus" in result).toBe(false);
  });

  // Slice-2 day/time/tz scoring window (CTFT-11) — additive no-clobber passthrough.
  it("emits scoreWindow verbatim when provided", () => {
    const scoreWindow = { days: [0, 4, 5, 6], from: "06:00", to: "08:00", tz: "America/Los_Angeles" };
    const result = ctfAttributes({ ...T, scoreWindow });
    expect(result.scoreWindow).toEqual(scoreWindow);
  });

  it("omits scoreWindow when absent (no-clobber preserves the stored window)", () => {
    const result = ctfAttributes({ ...T });
    expect("scoreWindow" in result).toBe(false);
  });

  // CR-01: an explicit `null` clear must NOT become a `.set(scoreWindow: null)` — it
  // is applied as an attribute REMOVE in upsertCtf, so the .set() payload omits it.
  it("omits scoreWindow from the set payload when the input is explicit null (CR-01 clear)", () => {
    const result = ctfAttributes({ ...T, scoreWindow: null });
    expect("scoreWindow" in result).toBe(false);
  });

  // WR-01: reject a degenerate / never-scoring window at the write boundary.
  it.each([
    ["empty days", { days: [], from: "06:00", to: "08:00", tz: "UTC" }],
    ["overnight (to < from)", { days: [5], from: "22:00", to: "02:00", tz: "UTC" }],
    ["zero-length (from === to)", { days: [5], from: "08:00", to: "08:00", tz: "UTC" }],
    ["blank times", { days: [5], from: "", to: "", tz: "UTC" }],
    ["malformed time", { days: [5], from: "6:00", to: "08:00", tz: "UTC" }],
  ])("throws on %s", (_label, scoreWindow) => {
    expect(() => ctfAttributes({ ...T, scoreWindow })).toThrow(QrValidationError);
  });

  it("accepts a well-formed window", () => {
    const scoreWindow = { days: [0, 4, 5, 6], from: "06:00", to: "08:00", tz: "America/Los_Angeles" };
    expect(() => ctfAttributes({ ...T, scoreWindow })).not.toThrow();
  });

  it("a scoreWindow-only edit emits no flag-type keys (not part of the flip guard)", () => {
    const result = ctfAttributes({
      ...T,
      scoreWindow: { days: [1], from: "09:00", to: "17:00", tz: "UTC" },
    });
    expect("answerType" in result).toBe(false);
    expect("perPlayerMax" in result).toBe(false);
    expect("perPlayerIntervalHours" in result).toBe(false);
    expect("otp" in result).toBe(false);
  });

  it("carries otp.singleUse verbatim onto the row (Phase 65 — no transform)", () => {
    const result = ctfAttributes({
      ...T,
      answerType: "otp",
      otp: { secret: "JBSWY3DPEHPK3PXP", digits: 6, period: 120, singleUse: true },
    }) as { otp?: { secret?: string; singleUse?: boolean } };
    // The whole otp map round-trips unmodified, INCLUDING the single-use flag.
    expect(result.otp).toEqual({ secret: "JBSWY3DPEHPK3PXP", digits: 6, period: 120, singleUse: true });
  });

  it("omits otp entirely when no otp is posted (no-clobber unchanged)", () => {
    const result = ctfAttributes({ ...T });
    expect("otp" in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hashCodeBatch — pure wordlist bulk-hash helper (Slice 3, CTFT-14)
// ---------------------------------------------------------------------------
//
// The admin pastes plaintext one-time codes one-per-line; on save each surviving
// line is hashed through the SAME `hashAnswer` seam the judge (56-02) claims
// against — so a loaded code and a submitted guess hash identically. This helper
// is PURE (no DB): the add-only `CtfCode.create` write + `getCtfCodeCounts` read
// are I/O and are exercised by the judge's claim path / UAT, not unit-tested here
// (mirrors `ctfAttributes` being the pure test surface while `upsertCtf`'s DB
// path is not).
describe("hashCodeBatch — pure bulk-hash of wordlist codes", () => {
  it("trims blanks, drops empty lines, and de-dups within the batch (via hashAnswer normalization)", () => {
    // "A" and "a" and " A " all normalize+hash identically (trim+lowercase in
    // hashAnswer). " " is a blank line and is dropped. "b" is distinct.
    const out = hashCodeBatch(["A", "a", " ", "b", "A", " A "]);
    // distinct normalized codes: {a, b} ⇒ 2 hashes
    expect(out.codeHashes).toEqual([hashAnswer("A"), hashAnswer("b")]);
    expect(out.added).toBe(2);
    // surviving (non-blank) lines: A, a, b, A, " A " = 5; added = 2 ⇒ 3 duplicates
    expect(out.duplicates).toBe(3);
  });

  it("produces the EXACT same hash as hashAnswer for a given code (judge-claim parity)", () => {
    const out = hashCodeBatch(["FlagCode-1"]);
    expect(out.codeHashes).toEqual([hashAnswer("FlagCode-1")]);
    // parity: a guess of the same code hashes to the same value the judge claims on
    expect(out.codeHashes[0]).toBe(hashAnswer("flagcode-1"));
  });

  it.each([
    ["an empty array", [] as string[]],
    ["only blank/whitespace lines", ["   ", "", "\t", " "]],
  ])("returns the empty result for %s", (_label, lines) => {
    const out = hashCodeBatch(lines);
    expect(out).toEqual({ codeHashes: [], added: 0, duplicates: 0 });
  });

  it("never emits a plaintext code — only salted hashes cross the boundary", () => {
    const out = hashCodeBatch(["super-secret-code"]);
    expect(out.codeHashes[0]).not.toContain("super-secret-code");
    expect(out.codeHashes[0]).toMatch(/^[0-9a-f]{64}$/);
  });
});
