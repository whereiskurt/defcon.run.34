import { describe, it, expect } from "vitest";
import { groupAccountsByUser } from "./admin-identity";

describe("groupAccountsByUser", () => {
  it("groups ACCOUNT rows by userId and drops non-account items", () => {
    const items = [
      { pk: "USER#u1", sk: "ACCOUNT#github#g1", userId: "u1", provider: "github", providerAccountId: "g1" },
      { pk: "USER#u1", sk: "ACCOUNT#linkedin#l1", userId: "u1", provider: "linkedin", providerAccountId: "l1" },
      { pk: "USER#u2", sk: "USER#u2", userId: "u2" }, // not an account row
    ];
    const grouped = groupAccountsByUser(items);
    expect(grouped.u1.map((a) => a.provider).sort()).toEqual(["github", "linkedin"]);
    expect(grouped.u2).toBeUndefined();
  });
});
