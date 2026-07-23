import { describe, it, expect } from "vitest";

import { SocialPair, SocialQuota, SocialEgg, SocialBoard } from "../social";

/** Key-shape locks for the social-scan entities. .params() encodes offline. */
const table = "run-human-electro";

describe("SocialPair", () => {
  it("keys by unordered pair + day, conditional create", () => {
    const params = SocialPair.create({
      pairKey: "alice_bob",
      day: "2026-08-06",
      scannerId: "alice",
      ownerId: "bob",
    }).params({ table });
    expect(params.Item.pk).toBe("$run#pairkey_alice_bob");
    expect(params.Item.sk).toBe("$socialpair_1#day_2026-08-06");
    expect(params.ConditionExpression).toContain("attribute_not_exists");
  });
});

describe("SocialQuota", () => {
  it("keys by user + day", () => {
    const key = SocialQuota.get({ userId: "u1", day: "2026-08-06" }).params({
      table,
    }).Key;
    expect(key).toEqual({
      pk: "$run#userid_u1",
      sk: "$socialquota_1#day_2026-08-06",
    });
  });
});

describe("SocialEgg", () => {
  it("keys by user, conditional create (once ever)", () => {
    const params = SocialEgg.create({ userId: "u1", via: "hold" }).params({
      table,
    });
    expect(params.Item.pk).toBe("$run#userid_u1");
    expect(params.Item.sk).toBe("$socialegg_1");
    expect(params.ConditionExpression).toContain("attribute_not_exists");
  });
});

describe("SocialBoard", () => {
  it("keys by board + score bucket", () => {
    const key = SocialBoard.get({
      boardId: "social",
      bucket: "score_000012",
    }).params({ table }).Key;
    expect(key).toEqual({
      pk: "$run#boardid_social",
      sk: "$socialboard_1#bucket_score_000012",
    });
  });
});
