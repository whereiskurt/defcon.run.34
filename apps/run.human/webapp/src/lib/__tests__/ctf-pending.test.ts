import { describe, it, expect, vi } from "vitest";

import {
  createPending,
  claimPending,
  type PendingStore,
  type PendingRow,
} from "../ctf-pending";
import { hashAnswer } from "../ctf-hash";
import type { JudgeResult, judgeSolve } from "../ctf-judge";

type JudgeInput = Parameters<typeof judgeSolve>[0];

/**
 * Park-and-claim helper proof (CTF-06) against an IN-MEMORY PendingStore and a
 * spy `judge` — no DynamoDB. Proves:
 *   T-45-01  createPending stores ONLY submittedFlagHash (never the raw guess) + a future TTL.
 *   T-45-02  claimPending credits EXACTLY ONCE via judgeSolve and no-ops on a spent/absent nonce.
 *   reuse    both take injectable deps (Phase 46 calls them the same way).
 */

const CHALLENGE = "MeshMaze"; // mixed-case → proves normalization
const GUESS = "s3cr3t-defcon-flag";
const NON_SOLVE: JudgeResult = {
  solved: false,
  points: 0,
  ordinal: null,
  firstBlood: false,
  capped: false,
};

function makeStore() {
  const rows = new Map<string, PendingRow>();
  const store: PendingStore = {
    async putPending(row) {
      rows.set(row.nonce, { ...row });
    },
    async getPending(nonce) {
      return rows.get(nonce) ?? null;
    },
    async deletePending(nonce) {
      rows.delete(nonce);
    },
  };
  return { store, rows };
}

const AWARD: JudgeResult = {
  solved: true,
  points: 500,
  ordinal: 1,
  firstBlood: true,
  capped: false,
};

describe("createPending — parks only the hash (T-45-01)", () => {
  it("stores submittedFlagHash, NOT the raw guess, with a normalized challenge + future TTL", async () => {
    const { store, rows } = makeStore();
    const now = 1_000_000_000_000; // fixed epoch-ms
    const { nonce } = await createPending(GUESS && CHALLENGE, GUESS, {
      store,
      now,
      newNonce: () => "nonce-abc",
    });

    expect(nonce).toBe("nonce-abc");
    const row = rows.get("nonce-abc")!;
    expect(row).toBeTruthy();
    // Only the hash is stored — the raw guess must be absent everywhere in the row.
    expect(row.submittedFlagHash).toBe(hashAnswer(GUESS));
    expect(JSON.stringify(row)).not.toContain(GUESS);
    // Challenge is normalized (lowercased).
    expect(row.challenge).toBe("meshmaze");
    // TTL is now + 30d in epoch SECONDS, comfortably in the future.
    const nowSec = Math.floor(now / 1000);
    expect(row.ttl).toBe(nowSec + 30 * 24 * 60 * 60);
    expect(row.ttl).toBeGreaterThan(nowSec);
  });

  it("returns a fresh random nonce by default (crypto.randomUUID)", async () => {
    const { store } = makeStore();
    const a = await createPending(CHALLENGE, GUESS, { store });
    const b = await createPending(CHALLENGE, GUESS, { store });
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.nonce).toMatch(/[0-9a-f-]{36}/i);
  });
});

describe("createPending flagHash — parks a caller-supplied hash verbatim", () => {
  it("stores the supplied flagHash instead of hashing the guess", async () => {
    const { store, rows } = makeStore();
    await createPending(CHALLENGE, "", {
      store,
      flagHash: "deadbeef",
      newNonce: () => "fh1",
    });
    const row = rows.get("fh1")!;
    expect(row.submittedFlagHash).toBe("deadbeef");
    // NOT the hash of the (empty) guess argument.
    expect(row.submittedFlagHash).not.toBe(hashAnswer(""));
  });

  it("prefers flagHash over the guess, and the raw guess never reaches the row", async () => {
    const { store, rows } = makeStore();
    await createPending(CHALLENGE, GUESS, {
      store,
      flagHash: "abc",
      newNonce: () => "fh2",
    });
    const row = rows.get("fh2")!;
    expect(row.submittedFlagHash).toBe("abc");
    expect(row.submittedFlagHash).not.toBe(hashAnswer(GUESS));
    expect(JSON.stringify(row)).not.toContain(GUESS);
  });

  it("without flagHash the existing hash-the-guess path is unchanged", async () => {
    const { store, rows } = makeStore();
    await createPending(CHALLENGE, GUESS, { store, newNonce: () => "fh3" });
    expect(rows.get("fh3")!.submittedFlagHash).toBe(hashAnswer(GUESS));
  });

  it("still normalizes the challenge and sets a TTL on the flagHash path", async () => {
    const { store, rows } = makeStore();
    await createPending(CHALLENGE, "", {
      store,
      now: 0,
      ttlSeconds: 3600,
      flagHash: "abc",
      newNonce: () => "fh4",
    });
    const row = rows.get("fh4")!;
    expect(row.challenge).toBe("meshmaze");
    expect(row.ttl).toBe(3600);
  });
});

describe("claimPending — credits exactly once via judgeSolve (T-45-02)", () => {
  it("present row → calls judge with { guessHash, channel:'qr' } and deletes the row", async () => {
    const { store, rows } = makeStore();
    const now = 1_700_000_000_000;
    const { nonce } = await createPending(CHALLENGE, GUESS, {
      store,
      now,
      newNonce: () => "n1",
    });
    const judge = vi.fn(async (_input: JudgeInput): Promise<JudgeResult> => AWARD);

    const result = await claimPending(nonce, "user-42", { store, judge });

    expect(result).toEqual(AWARD);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(judge).toHaveBeenCalledWith({
      user: "user-42",
      challenge: "meshmaze",
      guessHash: hashAnswer(GUESS),
      channel: "qr",
    });
    // Row consumed on claim.
    expect(rows.has("n1")).toBe(false);
  });

  it("missing / already-claimed nonce → NON_SOLVE no-op, judge never called", async () => {
    const { store } = makeStore();
    const judge = vi.fn(async () => AWARD);
    const result = await claimPending("does-not-exist", "user-42", { store, judge });
    expect(result).toEqual(NON_SOLVE);
    expect(judge).not.toHaveBeenCalled();
  });

  it("double-claim of the SAME nonce invokes judge at most once (idempotent, no double-credit)", async () => {
    const { store } = makeStore();
    const { nonce } = await createPending(CHALLENGE, GUESS, {
      store,
      newNonce: () => "dup",
    });
    const judge = vi.fn(async () => AWARD);

    const first = await claimPending(nonce, "user-42", { store, judge });
    const second = await claimPending(nonce, "user-42", { store, judge });

    expect(first).toEqual(AWARD);
    expect(second).toEqual(NON_SOLVE); // row already consumed → no-op
    expect(judge).toHaveBeenCalledTimes(1); // credited exactly once
  });

  it("does not log or expose the raw guess during a claim", async () => {
    const { store } = makeStore();
    const { nonce } = await createPending(CHALLENGE, GUESS, { store, newNonce: () => "n" });
    const judge = vi.fn(async (input: { guessHash?: string }) => {
      // The judge receives the HASH, never the raw guess.
      expect(input.guessHash).toBe(hashAnswer(GUESS));
      return AWARD;
    });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await claimPending(nonce, "user-42", { store, judge });
    const dump = JSON.stringify(spy.mock.calls);
    expect(dump).not.toContain(GUESS);
    spy.mockRestore();
  });
});
