import { describe, it, expect, beforeEach } from "vitest";

import {
  judgeScan,
  DAILY_SCAN_CAP,
  type ScanStore,
  type SocialUser,
} from "../social-scan";
import { SOCIAL_SCAN_POINTS } from "../scoring-engine";

const NOW = Date.parse("2026-08-06T18:00:00Z"); // 11:00 PDT → day 2026-08-06
const HASH_B =
  "b".repeat(64).slice(0, 64);

type Awarded = { userId: string; social: number };

function makeFakeStore(users: SocialUser[]) {
  const byToken = new Map<string, SocialUser>();
  const byHash = new Map<string, SocialUser>();
  const byId = new Map<string, SocialUser>();
  for (const u of users) byId.set(u.userId, u);

  const state = {
    pairs: new Set<string>(),
    quotas: new Map<string, number>(),
    awards: [] as Awarded[],
    ledgers: [] as Array<{
      challenge: string;
      user: string;
      bucket: string;
      points: number;
    }>,
    deltas: [] as Array<[number, number]>,
    passes: [] as Array<{ userId: string; grantedBy: string }>,
    bibs: new Map<string, "none" | "ready">(),
    bibReads: [] as string[],
    byToken,
    byHash,
  };

  const store: ScanStore = {
    async resolveOwnerByToken(token) {
      return byToken.get(token) ?? null;
    },
    async resolveOwnerByHash(hash) {
      return byHash.get(hash) ?? null;
    },
    async getUser(userId) {
      return byId.get(userId) ?? null;
    },
    async claimPairDay(pk, day) {
      const key = `${pk}|${day}`;
      if (state.pairs.has(key)) return false;
      state.pairs.add(key);
      return true;
    },
    async bumpQuota(userId, day) {
      const key = `${userId}|${day}`;
      const next = (state.quotas.get(key) ?? 0) + 1;
      state.quotas.set(key, next);
      return next;
    },
    async award(userId, social) {
      state.awards.push({ userId, social });
    },
    async ledger(challenge, user, bucket, points) {
      state.ledgers.push({ challenge, user, bucket, points });
    },
    async scoreDelta(oldScore, newScore) {
      state.deltas.push([oldScore, newScore]);
    },
    async bibStatus(userId) {
      state.bibReads.push(userId);
      return state.bibs.get(userId) ?? "none";
    },
    async mintPickupPass(userId, grantedBy) {
      state.passes.push({ userId, grantedBy });
    },
  };

  return { store, state };
}

const TOKEN = "9f86d081884c7d65";

describe("judgeScan", () => {
  let fake: ReturnType<typeof makeFakeStore>;

  beforeEach(() => {
    fake = makeFakeStore([
      { userId: "scanner", displayName: "Scanner", socialScore: 3 },
      { userId: "owner", displayName: "Bunny", socialScore: 7 },
    ]);
    fake.state.byToken.set(TOKEN, {
      userId: "owner",
      displayName: "Bunny",
      socialScore: 7,
    });
    fake.state.byHash.set(HASH_B, {
      userId: "owner",
      displayName: "Bunny",
      socialScore: 7,
    });
  });

  it("awards both parties +1/+1 with ledger rows and board deltas", async () => {
    const result = await judgeScan(
      { scannerId: "scanner", token: TOKEN, nowMs: NOW },
      fake.store
    );
    expect(result).toEqual({
      ok: true,
      ownerId: "owner",
      ownerName: "Bunny",
      remainingToday: DAILY_SCAN_CAP - 1,
    });
    expect(fake.state.awards).toEqual([
      { userId: "scanner", social: 1 },
      { userId: "owner", social: 1 },
    ]);
    const bucket = "2026-08-06#owner_scanner";
    // Both parties get their own row, each stamped with the scan's worth
    // (2026-08-06: was 0). The stamp is an audit trail — scoring derives the
    // same constant, so it does not matter that older rows still read 0.
    expect(fake.state.ledgers).toEqual([
      { challenge: "social-scan", user: "scanner", bucket, points: SOCIAL_SCAN_POINTS },
      { challenge: "social-scan", user: "owner", bucket, points: SOCIAL_SCAN_POINTS },
    ]);
    expect(fake.state.deltas).toEqual([
      [3, 4],
      [7, 8],
    ]);
  });

  it("legacy full-hash path awards identically", async () => {
    const result = await judgeScan(
      { scannerId: "scanner", hash: HASH_B, nowMs: NOW },
      fake.store
    );
    expect(result.ok).toBe(true);
    expect(fake.state.awards).toHaveLength(2);
  });

  it("rejects self-scan without burning quota or pair", async () => {
    fake.state.byToken.set(TOKEN, { userId: "scanner" });
    const result = await judgeScan(
      { scannerId: "scanner", token: TOKEN, nowMs: NOW },
      fake.store
    );
    expect(result).toEqual({ ok: false, code: "self" });
    expect(fake.state.pairs.size).toBe(0);
    expect(fake.state.awards).toHaveLength(0);
  });

  it("blocks the same pair the same day in either direction", async () => {
    await judgeScan({ scannerId: "scanner", token: TOKEN, nowMs: NOW }, fake.store);
    // owner scans scanner back (their token)
    fake.state.byToken.set("aaaaaaaaaaaaaaaa", {
      userId: "scanner",
      displayName: "Scanner",
      socialScore: 4,
    });
    const back = await judgeScan(
      { scannerId: "owner", token: "aaaaaaaaaaaaaaaa", nowMs: NOW + 3_600_000 },
      fake.store
    );
    expect(back).toEqual({ ok: false, code: "already_today" });
  });

  it("allows the same pair the next PT day", async () => {
    await judgeScan({ scannerId: "scanner", token: TOKEN, nowMs: NOW }, fake.store);
    const nextDay = await judgeScan(
      { scannerId: "scanner", token: TOKEN, nowMs: NOW + 24 * 3_600_000 },
      fake.store
    );
    expect(nextDay.ok).toBe(true);
  });

  it("enforces the daily cap and burns the pair", async () => {
    fake.state.quotas.set(`scanner|2026-08-06`, DAILY_SCAN_CAP);
    const result = await judgeScan(
      { scannerId: "scanner", token: TOKEN, nowMs: NOW },
      fake.store
    );
    expect(result).toEqual({ ok: false, code: "cap" });
    expect(fake.state.awards).toHaveLength(0);
    expect(fake.state.pairs.size).toBe(1); // deliberately burned
  });

  it("capExempt (admin attendance) scans succeed past the daily cap", async () => {
    fake.state.quotas.set(`scanner|2026-08-06`, DAILY_SCAN_CAP);
    const result = await judgeScan(
      { scannerId: "scanner", token: TOKEN, nowMs: NOW, capExempt: true },
      fake.store
    );
    expect(result.ok).toBe(true);
    // Both parties still awarded; ledger rows still written (honest audit trail).
    expect(fake.state.awards).toHaveLength(2);
    expect(fake.state.ledgers).toHaveLength(2);
    // Usage still counted, just not enforced.
    expect(fake.state.quotas.get(`scanner|2026-08-06`)).toBe(DAILY_SCAN_CAP + 1);
  });

  it("capExempt still respects pair-day dedup and self-scan", async () => {
    const first = await judgeScan(
      { scannerId: "scanner", token: TOKEN, nowMs: NOW, capExempt: true },
      fake.store
    );
    expect(first.ok).toBe(true);
    const dup = await judgeScan(
      { scannerId: "scanner", token: TOKEN, nowMs: NOW, capExempt: true },
      fake.store
    );
    expect(dup).toEqual({ ok: false, code: "already_today" });
    fake.state.byToken.set(TOKEN, {
      userId: "scanner", displayName: "Scanner", socialScore: 3,
    });
    const self = await judgeScan(
      { scannerId: "scanner", token: TOKEN, nowMs: NOW, capExempt: true },
      fake.store
    );
    expect(self).toEqual({ ok: false, code: "self" });
  });

  it("rejects malformed tokens and hashes", async () => {
    expect(
      (await judgeScan({ scannerId: "s", token: "XYZ", nowMs: NOW }, fake.store))
        .ok
    ).toBe(false);
    expect(
      (await judgeScan({ scannerId: "s", hash: "beef", nowMs: NOW }, fake.store))
        .ok
    ).toBe(false);
    expect(
      (await judgeScan({ scannerId: "s", nowMs: NOW }, fake.store)).ok
    ).toBe(false);
  });

  it("unknown token → not_found", async () => {
    const result = await judgeScan(
      { scannerId: "s", token: "0000000000000000", nowMs: NOW },
      fake.store
    );
    expect(result).toEqual({ ok: false, code: "not_found" });
  });
});

/**
 * Bib priming (2026-08-04). An operator scanning a runner's bib QR leaves a
 * durable BibPickupPass so the runner's LATER self-scan can redeem the 200.
 *
 * The load-bearing case is "THE 409 TRAP" below. SocialPair burns an unordered
 * pair for the whole PT day, so if minting only happened on the success path,
 * an operator whose pair with this runner was already spent today would mint
 * NOTHING and that runner could never redeem. Priming must survive a spent
 * pair — which is why the mint sits BEFORE the pair claim.
 *
 * NOTE the division of labour: the judge mints whenever the store says `ready`
 * and asks no further questions. WHETHER there is anything to prime is entirely
 * lib/bib-pickup.judgeBibPrime's call, which is where the "already primed" and
 * "never bought a bib" gates live and where they are tested.
 */
describe("judgeScan — bib priming", () => {
  let fake: ReturnType<typeof makeFakeStore>;

  beforeEach(() => {
    fake = makeFakeStore([
      { userId: "scanner", displayName: "Scanner", socialScore: 3 },
      { userId: "owner", displayName: "Bunny", socialScore: 7 },
    ]);
    fake.state.byToken.set(TOKEN, {
      userId: "owner",
      displayName: "Bunny",
      socialScore: 7,
    });
  });

  const prime = () =>
    judgeScan(
      { scannerId: "scanner", token: TOKEN, nowMs: NOW, operator: true },
      fake.store
    );

  it("an operator scanning a bib-holder mints a pass and reports bib:ready", async () => {
    fake.state.bibs.set("owner", "ready");
    const result = await prime();

    expect(result).toMatchObject({ ok: true, bibStatus: "ready" });
    expect(fake.state.passes).toEqual([
      { userId: "owner", grantedBy: "scanner" },
    ]);
  });

  it("THE 409 TRAP: a same-day re-scan still mints and still reports bib:ready", async () => {
    fake.state.bibs.set("owner", "ready");
    await prime();
    const second = await prime();

    expect(second).toMatchObject({
      ok: false,
      code: "already_today",
      bibStatus: "ready",
      ownerName: "Bunny",
    });
    expect(fake.state.passes).toHaveLength(2);
  });

  /**
   * Everything that is NOT "a bought bib nobody has primed yet" — an unbought
   * placeholder row, an already-primed runner, someone who already collected —
   * is `none` at the store (see lib/bib-pickup.judgeBibPrime), and the judge
   * must then render it as the ordinary social scan it is. This is the case
   * that was drowning the connection card for 337 of 353 bib rows.
   */
  it("mints nothing and reports no bib when there is nothing left to prime", async () => {
    fake.state.bibs.set("owner", "none");
    const result = await prime();

    expect(result).toMatchObject({ ok: true, ownerName: "Bunny" });
    expect((result as { bibStatus?: string }).bibStatus).toBeUndefined();
    expect(fake.state.passes).toEqual([]);
  });

  it("mints nothing and reports no bib for a runner with no bib", async () => {
    const result = await prime();

    expect(result).toMatchObject({ ok: true });
    expect((result as { bibStatus?: string }).bibStatus).toBeUndefined();
    expect(fake.state.passes).toEqual([]);
  });

  it("a NON-operator never mints, and never even reads bib status", async () => {
    fake.state.bibs.set("owner", "ready");
    await judgeScan(
      { scannerId: "scanner", token: TOKEN, nowMs: NOW },
      fake.store
    );

    expect(fake.state.passes).toEqual([]);
    // Ordinary runner-to-runner scans must pay nothing extra on the hot path.
    expect(fake.state.bibReads).toEqual([]);
  });

  it("an operator self-scan mints nothing — self is rejected before the mint", async () => {
    fake.state.byToken.set(TOKEN, { userId: "scanner" });
    fake.state.bibs.set("scanner", "ready");
    const result = await prime();

    expect(result).toEqual({ ok: false, code: "self" });
    expect(fake.state.passes).toEqual([]);
    expect(fake.state.bibReads).toEqual([]);
  });

  it("a priming failure never fails the scan itself", async () => {
    fake.state.bibs.set("owner", "ready");
    const broken = {
      ...fake.store,
      bibStatus: async () => {
        throw new Error("dynamo is having a day");
      },
    };
    const result = await judgeScan(
      { scannerId: "scanner", token: TOKEN, nowMs: NOW, operator: true },
      broken
    );

    expect(result).toMatchObject({ ok: true, ownerId: "owner" });
  });
});
