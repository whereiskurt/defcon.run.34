import { describe, it, expect } from "vitest";

import {
  normalizeCode,
  normalizeChallenge,
  validateDestination,
  upsertQr,
  QrValidationError,
} from "../qr-admin";

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
  it("uppercases and trims", () => {
    expect(normalizeCode("  bunny ")).toBe("BUNNY");
    expect(normalizeCode("Flag-1_a")).toBe("FLAG-1_A");
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
});
