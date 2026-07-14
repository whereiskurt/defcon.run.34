import { describe, it, expect } from "vitest";

import { hashAnswer } from "../ctf-hash";
import { planCtfMigration } from "../ctf-migration";

describe("planCtfMigration", () => {
  it("plaintext answer + no answerHash → hash-and-clear", () => {
    const plan = planCtfMigration({ challenge: "c1", answer: "secret" });
    expect(plan.action).toBe("hash-and-clear");
    if (plan.action === "hash-and-clear") {
      expect(plan.answerHash).toBe(hashAnswer("secret"));
    }
  });

  it("HASH PARITY: hash-and-clear answerHash === hashAnswer(answer) (judge parity)", () => {
    const answer = "The-Flag Is HERE";
    const plan = planCtfMigration({ challenge: "c1", answer });
    expect(plan.action).toBe("hash-and-clear");
    if (plan.action === "hash-and-clear") {
      // Byte-identical to what the judge's hashAnswer produces — migrated
      // answers still verify. This is the load-bearing parity assertion.
      expect(plan.answerHash).toBe(hashAnswer(answer));
    }
  });

  it("plaintext answer + existing answerHash → clear-only (do not clobber the hash)", () => {
    const plan = planCtfMigration({
      challenge: "c1",
      answer: "secret",
      answerHash: "deadbeef",
    });
    expect(plan.action).toBe("clear-only");
  });

  it("no plaintext answer, only answerHash → skip (already migrated)", () => {
    const plan = planCtfMigration({ challenge: "c1", answerHash: "deadbeef" });
    expect(plan.action).toBe("skip");
  });

  it("nothing (no answer, no answerHash) → skip", () => {
    const plan = planCtfMigration({ challenge: "c1" });
    expect(plan.action).toBe("skip");
  });

  it("whitespace-only answer → skip (nothing meaningful to hash)", () => {
    const plan = planCtfMigration({ challenge: "c1", answer: "   " });
    expect(plan.action).toBe("skip");
  });

  it("empty-string answer → skip", () => {
    const plan = planCtfMigration({ challenge: "c1", answer: "" });
    expect(plan.action).toBe("skip");
  });

  it("IDEMPOTENT: re-planning a post-migration row (answer removed) → skip", () => {
    // Simulate the shape after hash-and-clear was applied: plaintext removed,
    // answerHash set. A re-run must be a no-op.
    const migratedRow = { challenge: "c1", answerHash: hashAnswer("secret") };
    const plan = planCtfMigration(migratedRow);
    expect(plan.action).toBe("skip");
  });

  it("IDEMPOTENT: applying the plan twice is a no-op (hash-and-clear → skip)", () => {
    const first = planCtfMigration({ challenge: "c1", answer: "secret" });
    expect(first.action).toBe("hash-and-clear");
    // Apply the plan: answer removed, answerHash set.
    const afterApply =
      first.action === "hash-and-clear"
        ? { challenge: "c1", answerHash: first.answerHash }
        : { challenge: "c1" };
    const second = planCtfMigration(afterApply);
    expect(second.action).toBe("skip");
  });
});
