import { describe, it, expect } from "vitest";

import { hashAnswer, verifyAnswer, verifyAnswerHash } from "../ctf-hash";

describe("hashAnswer", () => {
  it("is deterministic (same input → same output)", () => {
    expect(hashAnswer("flag")).toBe(hashAnswer("flag"));
  });

  it("is case- and space-insensitive", () => {
    expect(hashAnswer("  FLAG ")).toBe(hashAnswer("flag"));
    expect(hashAnswer("Flag")).toBe(hashAnswer("flag"));
  });

  it("different inputs produce different digests", () => {
    expect(hashAnswer("flag-a")).not.toBe(hashAnswer("flag-b"));
  });

  it("produces a 64-char hex SHA-256 digest", () => {
    expect(hashAnswer("flag")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("HYGIENE: the raw answer is NOT a substring of its stored hash (leak check)", () => {
    const raw = "supersecretflag";
    const hash = hashAnswer(raw);
    expect(hash.includes(raw)).toBe(false);
    // also the normalized form is absent
    expect(hash.includes(raw.toLowerCase())).toBe(false);
  });
});

describe("verifyAnswer", () => {
  it("true for the correct guess against its own hash", () => {
    const correct = "MyFlag";
    expect(verifyAnswer(correct, hashAnswer(correct))).toBe(true);
  });

  it("true is case/space-insensitive (normalization is applied)", () => {
    expect(verifyAnswer("  myflag ", hashAnswer("MYFLAG"))).toBe(true);
  });

  it("false for a wrong guess", () => {
    expect(verifyAnswer("wrong", hashAnswer("right"))).toBe(false);
  });

  it("false (no throw) on an empty answerHash", () => {
    expect(() => verifyAnswer("flag", "")).not.toThrow();
    expect(verifyAnswer("flag", "")).toBe(false);
  });

  it("false (no throw) on a short/malformed answerHash", () => {
    expect(() => verifyAnswer("flag", "deadbeef")).not.toThrow();
    expect(verifyAnswer("flag", "deadbeef")).toBe(false);
  });
});

describe("verifyAnswerHash", () => {
  it("true when the submitted hash equals the stored answerHash", () => {
    const answerHash = hashAnswer("MyFlag");
    expect(verifyAnswerHash(hashAnswer("MyFlag"), answerHash)).toBe(true);
  });

  it("false when the submitted hash does not match", () => {
    expect(verifyAnswerHash(hashAnswer("wrong"), hashAnswer("right"))).toBe(false);
  });

  it("false (no throw) on an empty submitted hash", () => {
    expect(() => verifyAnswerHash("", hashAnswer("flag"))).not.toThrow();
    expect(verifyAnswerHash("", hashAnswer("flag"))).toBe(false);
  });

  it("false (no throw) on an empty answerHash", () => {
    expect(() => verifyAnswerHash(hashAnswer("flag"), "")).not.toThrow();
    expect(verifyAnswerHash(hashAnswer("flag"), "")).toBe(false);
  });

  it("false (no throw) on a wrong-length hash (timingSafeEqual guard)", () => {
    expect(() => verifyAnswerHash("deadbeef", hashAnswer("flag"))).not.toThrow();
    expect(verifyAnswerHash("deadbeef", hashAnswer("flag"))).toBe(false);
  });

  it("verifyAnswer(guess, h) is byte-identical to verifyAnswerHash(hashAnswer(guess), h)", () => {
    const h = hashAnswer("secret");
    expect(verifyAnswer("secret", h)).toBe(verifyAnswerHash(hashAnswer("secret"), h));
    expect(verifyAnswer("nope", h)).toBe(verifyAnswerHash(hashAnswer("nope"), h));
  });
});
