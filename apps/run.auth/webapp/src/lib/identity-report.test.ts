import { describe, it, expect } from "vitest";
import {
  maskEmail, csvCell, toCsv, deriveProviders, mergeIdentityRows,
  filterByEmail, sortRows, summaryTiles,
  type ProfileRow, type AccountRow,
} from "./identity-report";

describe("maskEmail", () => {
  it("masks local part", () => expect(maskEmail("kurt@gmail.com")).toBe("k•••@gmail.com"));
  it("empty for null", () => expect(maskEmail(null)).toBe(""));
  it("bullet for malformed", () => expect(maskEmail("nope")).toBe("•••"));
});

describe("csvCell injection guard", () => {
  it("quotes commas/quotes/newlines", () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
  });
  it("neutralises leading formula chars", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@x")).toBe("'@x");
  });
  it("passes plain text", () => expect(csvCell("rabbit_A1B2")).toBe("rabbit_A1B2"));
});

describe("toCsv", () => {
  it("serialises header + rows", () => {
    const csv = toCsv(
      [{ key: "a", header: "A" }, { key: "b", header: "B" }],
      [{ a: "1", b: "2" }, { a: "x,y", b: "=z" }],
    );
    expect(csv).toBe('A,B\n1,2\n"x,y",\'=z');
  });
});

describe("deriveProviders", () => {
  it("unions account providers with email fallback", () => {
    const accts: AccountRow[] = [
      { provider: "github", providerAccountId: "1", userId: "u1" },
      { provider: "linkedin", providerAccountId: "2", userId: "u1" },
    ];
    expect(deriveProviders(accts, "email").sort()).toEqual(["email", "github", "linkedin"]);
  });
  it("dedups and ignores unknown lastProvider", () => {
    const accts: AccountRow[] = [{ provider: "discord", providerAccountId: "9", userId: "u1" }];
    expect(deriveProviders(accts, "discord")).toEqual(["discord"]);
  });
});

describe("mergeIdentityRows", () => {
  const profiles: ProfileRow[] = [
    { userId: "u1", displayName: "rabbit_A", email: "a@x.com", services: ["run", "admin"],
      lastProvider: "github", createdAt: 1000, lockedOut: false,
      github: { linkedAt: 1000 }, discord: null, strava: null },
    { userId: "u2", displayName: "rabbit_B", email: "b@x.com", services: ["run"],
      lastProvider: "email", createdAt: 2000, lockedOut: true,
      github: null, discord: null, strava: null },
  ];
  const accountsByUser = {
    u1: [{ provider: "github", providerAccountId: "g1", userId: "u1" },
         { provider: "linkedin", providerAccountId: "l1", userId: "u1" }],
    u2: [],
  };
  it("builds one row per profile with merged providers", () => {
    const rows = mergeIdentityRows(profiles, accountsByUser);
    const u1 = rows.find((r) => r.userId === "u1")!;
    expect(u1.providers.sort()).toEqual(["github", "linkedin"]);
    expect(u1.providerCount).toBe(2);
    expect(u1.emailMasked).toBe("a•••@x.com");
    expect(u1.emailFull).toBe("a@x.com");
    const u2 = rows.find((r) => r.userId === "u2")!;
    expect(u2.lockedOut).toBe(true);
    expect(u2.providers).toEqual(["email"]); // no accounts, lastProvider=email
  });

  it("carries jailed and jailLevel onto the row", () => {
    const jailedProfiles: ProfileRow[] = [
      { userId: "u1", displayName: "rabbit_A", email: "a@x.com", services: ["run", "admin"],
        lastProvider: "github", createdAt: 1000, lockedOut: false, jailed: true, jailLevel: 3,
        github: { linkedAt: 1000 }, discord: null, strava: null },
      { userId: "u2", displayName: "rabbit_B", email: "b@x.com", services: ["run"],
        lastProvider: "email", createdAt: 2000, lockedOut: true,
        github: null, discord: null, strava: null },
    ];
    const rows = mergeIdentityRows(jailedProfiles, accountsByUser);
    const u1 = rows.find((r) => r.userId === "u1")!;
    expect(u1.jailed).toBe(true);
    expect(u1.jailLevel).toBe(3);
    const u2 = rows.find((r) => r.userId === "u2")!;
    expect(u2.jailed).toBe(false);
    expect(u2.jailLevel).toBe(null);
  });
});

describe("filter/sort/summary", () => {
  const profiles: ProfileRow[] = [
    { userId: "u1", displayName: "r_A", email: "alice@x.com", services: ["run"],
      lastProvider: "github", createdAt: 1000, lockedOut: false, github: { linkedAt: 1000 }, discord: null, strava: null },
    { userId: "u2", displayName: "r_B", email: "bob@x.com", services: ["run"],
      lastProvider: "discord", createdAt: 5000, lockedOut: false, github: null, discord: { linkedAt: 5000 }, strava: null },
  ];
  const rows = mergeIdentityRows(profiles, { u1: [{ provider: "github", providerAccountId: "1", userId: "u1" }], u2: [{ provider: "discord", providerAccountId: "2", userId: "u2" }] });
  it("filters by full email substring", () => {
    expect(filterByEmail(rows, "alice").map((r) => r.userId)).toEqual(["u1"]);
    expect(filterByEmail(rows, "").length).toBe(2);
  });
  it("sorts by createdAt desc", () => {
    expect(sortRows(rows, "created").map((r) => r.userId)).toEqual(["u2", "u1"]);
  });
  it("summary counts", () => {
    const t = summaryTiles(rows);
    expect(t.totalIdentities).toBe(2);
    expect(t.multiProvider).toBe(0);
    expect(t.locked).toBe(0);
  });
});
