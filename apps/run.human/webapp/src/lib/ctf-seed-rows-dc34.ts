/**
 * ctf-seed-rows-dc34.ts — PURE builder for the DC34 value retune, per the
 * approved spec (`docs/superpowers/specs/2026-07-30-points-consistency-design.md`).
 * Consumed by the operator script `scripts/seed-ctf-dc34.mts` and its vitest.
 *
 * ── WHY this file is import-pure ─────────────────────────────────────────────
 * Same rationale as `ctf-seed-rows.ts`: no ElectroDB `Ctf` entity import (that
 * would pull @auth/dynamodb-adapter, ESM-only, into a standalone `tsx` CJS
 * run and make the builder untestable in isolation). This module imports
 * ONLY the `CtfSeedRow` type — no runtime imports at all. Key-composition
 * (pk/sk + __edb_* markers) lives in seed-ctf-dc34.mts.
 *
 * ── knobsOnly vs. full insert ─────────────────────────────────────────────
 * Most DC34 rows already exist (authored via the admin UI with their real
 * answer/effect/otp config) — this seed only RETUNES their scoring knobs
 * (pointMax/pointFloor/maxSolves/firstBloodBonus/floorAfterMax/
 * perPlayerIntervalHours). Those rows carry `knobsOnly: true` and the operator
 * script SKIPS (warns) them if no existing row is found — it never fabricates
 * a challenge definition. A handful of grant-only rows (bot unlocks, jack-egg,
 * exceptional-run) don't exist yet and are inserted whole, with an unguessable
 * `answerHash: ZERO_HASH` — there is no salted preimage, so they are claimable
 * ONLY via `grant: true` paths (admin/bot), never by a player guess. That also
 * means this seed needs NO `CTF_ANSWER_SALT` — knobsOnly rows never touch
 * answer fields, and inserts hardcode ZERO_HASH rather than hashing anything.
 *
 * `ricky`: knobsOnly flat 100, same as the other personas. If no row named
 * `ricky` exists at seed time, the operator script warns and skips — confirm
 * ricky's real challenge slug via the admin CTF list before the prod run.
 */
import type { CtfSeedRow } from "./ctf-seed-rows";

export type Dc34SeedRow = CtfSeedRow & {
  knobsOnly?: boolean;
  floorAfterMax?: boolean;
};

/** 64 zeros — no salted preimage exists, so grant-only flags are unguessable. */
export const ZERO_HASH = "0".repeat(64);

const ANTI_SPAM = { maxAttempts: 5, rateLimitWindow: 60 } as const;
const flat = (n: number) =>
  ({ pointMax: n, pointFloor: n, maxSolves: 100000, firstBloodBonus: 0 }) as const;

const EGGS = ["rainbow-egg", "coffee-egg", "deuce-egg", "sao-egg", "dc34-egg"];
const PERSONAS = ["goldstein", "mudge", "condor", "grace-hopper", "turing"];
const PHONES = ["didhtp1", "didhtp3234", "didhtp3283", "didhtp8283"];

export function buildDc34SeedRows(): Dc34SeedRow[] {
  return [
    // UI/keystroke eggs — flat 5 (knobs only; answers/effects stay as authored).
    // NOTE: `enabled: false` here is inert — knobsOnly rows never write
    // `enabled` (the operator script preserves the existing row's value). The
    // field is present only to satisfy the `CtfSeedRow` type.
    ...EGGS.map((challenge): Dc34SeedRow => ({
      challenge, knobsOnly: true, ...flat(5), enabled: false, ...ANTI_SPAM,
    })),
    // Persona chat flags + ricky — flat 100 (knobs only).
    ...[...PERSONAS, "ricky"].map((challenge): Dc34SeedRow => ({
      challenge, knobsOnly: true, ...flat(100), enabled: false, ...ANTI_SPAM,
    })),
    // Daily OTP chains — retuned 25/day (streak track carries consistency now).
    ...PERSONAS.map((p): Dc34SeedRow => ({
      challenge: `${p}-otp`, knobsOnly: true, ...flat(25),
      perPlayerIntervalHours: 24, enabled: false, ...ANTI_SPAM,
    })),
    // Payphones — decay 200→100 over 25 solvers, then floor forever.
    ...PHONES.map((challenge): Dc34SeedRow => ({
      challenge, knobsOnly: true,
      pointMax: 200, pointFloor: 100, maxSolves: 25, firstBloodBonus: 0,
      floorAfterMax: true, enabled: false, ...ANTI_SPAM,
    })),
    // Bot unlocks — grant-only inserts, 250 each (ricky has no unlock).
    ...PERSONAS.map((p): Dc34SeedRow => ({
      challenge: `unlock-${p}`, answerType: "static", answerHash: ZERO_HASH,
      ...flat(250), enabled: true, ...ANTI_SPAM,
    })),
    // Jack-egg (QR gesture) — grant-only, 10.
    {
      challenge: "jack-egg", answerType: "static", answerHash: ZERO_HASH,
      ...flat(10), enabled: true, ...ANTI_SPAM,
    },
    // Admin exceptional-run bonus — grant-only, 1000, once per day per user.
    {
      challenge: "exceptional-run", answerType: "static", answerHash: ZERO_HASH,
      ...flat(1000), perPlayerIntervalHours: 24, enabled: true, ...ANTI_SPAM,
    },
  ];
}
