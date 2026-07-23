import { describe, it, expect } from "vitest";

import { RunnerToken } from "../runner-token";

/**
 * Key-shape lock for the RunnerToken mapping (token → userId). The /r scan
 * route and the backfill/mint scripts both address rows through this entity;
 * .params() encodes offline (no network I/O).
 */
const table = "run-human-electro";

describe("RunnerToken key shape", () => {
  it("encodes the primary key from the token", () => {
    const key = RunnerToken.get({ token: "9f86d081884c7d65" }).params({ table })
      .Key;
    expect(key).toEqual({
      pk: "$run#token_9f86d081884c7d65",
      sk: "$runnertoken_1",
    });
  });

  it("create() is conditional on non-existence", () => {
    const params = RunnerToken.create({
      token: "9f86d081884c7d65",
      userId: "user-1",
      hash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    }).params({ table });
    expect(params.ConditionExpression).toContain("attribute_not_exists");
    expect(params.Item.pk).toBe("$run#token_9f86d081884c7d65");
    expect(params.Item.userId).toBe("user-1");
  });
});
