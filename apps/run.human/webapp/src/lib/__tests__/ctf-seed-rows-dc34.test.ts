import { describe, it, expect } from "vitest";
import { buildDc34SeedRows, ZERO_HASH } from "../ctf-seed-rows-dc34";

describe("buildDc34SeedRows", () => {
  const rows = buildDc34SeedRows();
  const byName = new Map(rows.map((r) => [r.challenge, r]));

  it("emits the full DC34 set", () => {
    // 5 eggs + 6 personas(+ricky) + 5 otp chains + 4 phones + 5 unlocks +
    // jack-egg + exceptional-run = 27, per the LOCKED value table.
    expect(rows).toHaveLength(27);
    expect(new Set(rows.map((r) => r.challenge)).size).toBe(27);
  });

  it("eggs are knobsOnly flat 5", () => {
    for (const c of ["rainbow-egg", "coffee-egg", "deuce-egg", "sao-egg", "dc34-egg"]) {
      expect(byName.get(c)).toMatchObject({ knobsOnly: true, pointMax: 5, pointFloor: 5 });
    }
  });

  it("phones decay 200→100 over 25 then floor forever", () => {
    expect(byName.get("didhtp3234")).toMatchObject({
      knobsOnly: true, pointMax: 200, pointFloor: 100, maxSolves: 25, floorAfterMax: true,
    });
  });

  it("chains retune to 25/day; personas and ricky to flat 100", () => {
    expect(byName.get("goldstein-otp")).toMatchObject({ pointMax: 25, pointFloor: 25, perPlayerIntervalHours: 24 });
    expect(byName.get("ricky")).toMatchObject({ knobsOnly: true, pointMax: 100 });
  });

  it("grant-only inserts are unguessable and enabled", () => {
    for (const c of ["unlock-goldstein", "jack-egg", "exceptional-run"]) {
      const r = byName.get(c)!;
      expect(r.knobsOnly).toBeUndefined();
      expect(r.answerHash).toBe(ZERO_HASH);
      expect(r.enabled).toBe(true);
    }
    expect(byName.get("unlock-goldstein")).toMatchObject({ pointMax: 250 });
    expect(byName.get("exceptional-run")).toMatchObject({ pointMax: 1000, perPlayerIntervalHours: 24 });
    expect(byName.get("jack-egg")).toMatchObject({ pointMax: 10 });
  });

  it("no row ever carries a plaintext answer or an OTP secret", () => {
    for (const r of rows) {
      expect((r as { answer?: string }).answer).toBeUndefined();
      expect((r as { otp?: unknown }).otp).toBeUndefined();
    }
  });
});
