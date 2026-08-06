import { describe, it, expect } from "vitest";
import { judgeSolve, type CtfStore, type JudgeCtf } from "../ctf-judge";
import { hashAnswer } from "../ctf-hash";

/**
 * First blood must stay claimable by a real player after an operator has solved
 * a challenge while testing it (2026-08-05, Kurt). On DC34, 32 of the first 42
 * first bloods were an operator's, because the rule was simply "ordinal 1".
 *
 * The rule is ADDITIVE — nothing is taken from anyone who already earned one:
 *   - the genuinely-first solver keeps it, operator or not;
 *   - AND the first non-admin solver also gets it.
 *
 * Proven here against an in-memory store with the same two-counter semantics as
 * the real one: `solveCount` counts every solve, `playerSolveCount` only
 * non-admin solves, both as atomic increments.
 */

const ANSWER = "opensesame";

function makeCtf(over: Partial<JudgeCtf> = {}): JudgeCtf {
  return {
    challenge: "treadmill",
    answerHash: hashAnswer(ANSWER),
    enabled: true,
    pointMax: 250,
    pointFloor: 250,
    maxSolves: 100000,
    firstBloodBonus: 0,
    ...over,
  } as JudgeCtf;
}

function makeStore(ctf: JudgeCtf, opts: { withPlayerOrdinal?: boolean } = {}) {
  const solves = new Map<string, { ordinal: number; points: number; firstBlood: boolean }>();
  const ordinals = new Map<string, number>();
  const playerOrdinals = new Map<string, number>();
  const key = (c: string, u: string) => `${c}|${u}`;

  const store: CtfStore = {
    async getCtf() {
      return ctf;
    },
    async overAttemptLimit() {
      return false;
    },
    async claimSolve({ challenge, user }) {
      const k = key(challenge, user);
      const existing = solves.get(k);
      if (existing) return { claimed: false, existing };
      solves.set(k, { ordinal: 0, points: 0, firstBlood: false });
      return { claimed: true };
    },
    async allocateOrdinal(challenge) {
      const n = (ordinals.get(challenge) ?? 0) + 1;
      ordinals.set(challenge, n);
      return n;
    },
    async recordScore({ challenge, user, ordinal, points, firstBlood }) {
      solves.set(key(challenge, user), { ordinal, points, firstBlood });
    },
  };

  if (opts.withPlayerOrdinal !== false) {
    store.allocatePlayerOrdinal = async (challenge: string) => {
      const n = (playerOrdinals.get(challenge) ?? 0) + 1;
      playerOrdinals.set(challenge, n);
      return n;
    };
  }
  return { store, solves, playerOrdinals };
}

const solve = (store: CtfStore, user: string, actorIsAdmin = false) =>
  judgeSolve(
    { user, challenge: "treadmill", guess: ANSWER, channel: "qr", actorIsAdmin },
    { store, log: () => {} },
  );

describe("first blood after an operator has solved", () => {
  it("gives the first NON-ADMIN solver a first blood even though an admin solved first", async () => {
    const { store } = makeStore(makeCtf());
    const admin = await solve(store, "operator", true);
    const player = await solve(store, "realrunner");

    expect(admin.ordinal).toBe(1);
    expect(admin.firstBlood).toBe(true); // the operator KEEPS theirs
    expect(player.ordinal).toBe(2); // ordinals stay gap-free and count everyone
    expect(player.firstBlood).toBe(true); // …and the player still gets a 🩸
  });

  it("gives only ONE player first blood — the second player does not get one", async () => {
    const { store } = makeStore(makeCtf());
    await solve(store, "operator", true);
    const first = await solve(store, "player-one");
    const second = await solve(store, "player-two");

    expect(first.firstBlood).toBe(true);
    expect(second.firstBlood).toBe(false);
    expect(second.ordinal).toBe(3);
  });

  it("does not hand out a second badge when a PLAYER was genuinely first", async () => {
    const { store } = makeStore(makeCtf());
    const first = await solve(store, "player-one");
    const second = await solve(store, "player-two");

    expect(first.firstBlood).toBe(true);
    expect(second.firstBlood).toBe(false);
  });

  it("does not burn a player ordinal on an admin solve", async () => {
    const { store, playerOrdinals } = makeStore(makeCtf());
    await solve(store, "operator-a", true);
    await solve(store, "operator-b", true);
    expect(playerOrdinals.get("treadmill") ?? 0).toBe(0);

    const player = await solve(store, "realrunner");
    expect(player.firstBlood).toBe(true);
  });

  it("still gives an admin first blood when they are genuinely first and no player has solved", async () => {
    const { store } = makeStore(makeCtf());
    const admin = await solve(store, "operator", true);
    expect(admin.firstBlood).toBe(true);
  });

  it("treats an un-updated caller (no actorIsAdmin) as a player", async () => {
    // Back-compat: a caller that never learned about the flag keeps working and
    // its solver can still take the player slot.
    const { store } = makeStore(makeCtf());
    const a = await solve(store, "someone");
    expect(a.firstBlood).toBe(true);
  });

  it("degrades to the original ordinal-1 rule when the store has no player allocator", async () => {
    // An existing store fake without allocatePlayerOrdinal must not throw.
    const { store } = makeStore(makeCtf(), { withPlayerOrdinal: false });
    store.allocatePlayerOrdinal = undefined;
    const admin = await solve(store, "operator", true);
    const player = await solve(store, "realrunner");
    expect(admin.firstBlood).toBe(true);
    expect(player.firstBlood).toBe(false);
  });

  it("replays the stored award on a repeat claim rather than re-awarding", async () => {
    const { store } = makeStore(makeCtf());
    await solve(store, "operator", true);
    const first = await solve(store, "realrunner");
    const again = await solve(store, "realrunner");

    expect(first.firstBlood).toBe(true);
    expect(again.firstBlood).toBe(true); // replayed, not newly granted
    expect(again.ordinal).toBe(first.ordinal);
  });

  it("does not let a repeat claim consume another player ordinal", async () => {
    const { store, playerOrdinals } = makeStore(makeCtf());
    await solve(store, "realrunner");
    await solve(store, "realrunner");
    await solve(store, "realrunner");
    expect(playerOrdinals.get("treadmill")).toBe(1);
  });
});
