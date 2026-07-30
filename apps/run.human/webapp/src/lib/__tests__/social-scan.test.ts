import { describe, it, expect, beforeEach } from "vitest";

import {
  judgeScan,
  DAILY_SCAN_CAP,
  type ScanStore,
  type SocialUser,
} from "../social-scan";

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
    expect(fake.state.ledgers).toEqual([
      { challenge: "social-scan", user: "scanner", bucket, points: 0 },
      { challenge: "social-scan", user: "owner", bucket, points: 0 },
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
