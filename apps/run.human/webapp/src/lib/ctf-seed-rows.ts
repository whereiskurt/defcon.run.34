/**
 * ctf-seed-rows.ts (CTFP-04, 57-03) — PURE builder for the curated set of six
 * REAL DC33 CTF starter flags, one per flag type. Consumed by the operator
 * script `scripts/seed-ctf.mts` (which adds DynamoDB key-composition) and by
 * its vitest. Sourced from 57-CONTEXT.md D3 (persona codes + OtpUrl seeds from
 * ~/working/meshtk/meshtk.bak.yaml).
 *
 * ── WHY this file is import-pure ─────────────────────────────────────────────
 * It imports ONLY `hashAnswer` from ctf-hash (crypto-only, no AWS/ESM). It does
 * NOT import the ElectroDB `Ctf` entity — that would pull @auth/dynamodb-adapter
 * (ESM-only) which a standalone `tsx` CJS run cannot require, and it would make
 * the builder untestable in isolation. Key-composition (pk/sk + __edb_* markers)
 * lives in seed-ctf.mts; each object here carries only its `challenge` NAME plus
 * attributes. The type below is a structural mirror of the Ctf attribute set in
 * src/entities/qr.ts — kept local on purpose so this module stays entity-free.
 *
 * SECURITY: every static/flat/race/timed/easter row stores `answerHash`
 * (salted SHA-256 via the SAME ctf-hash seam the judge verifies against) and
 * NEVER a raw plaintext `answer`. The OTP flag (goldstein-otp) verifies via its
 * TOTP `secret` and carries no static answer/hash at all. Every row ships
 * `enabled:false` — an admin must explicitly enable a flag before it scores.
 *
 * NOTE ON SALT: `hashAnswer` reads `CTF_ANSWER_SALT` (default in ctf-hash). A
 * prod `--confirm` seed run MUST use prod's salt or the hashes will never verify
 * against player guesses (57-CONTEXT.md D4). The unit test compares against
 * `hashAnswer(...)` computed live, so it is salt-independent.
 */
import { hashAnswer } from "@/lib/ctf-hash";

/** A single TOTP config (mirror of Ctf.otp in src/entities/qr.ts). */
export interface CtfSeedOtp {
  secret: string; // base32 shared secret
  digits: number;
  period: number; // seconds per window (120 — meshtk convention, NOT RFC 30)
  algorithm: string;
  skew: number; // ± windows accepted on verify
}

/** A single time tier (mirror of Ctf.timeTiers[] — UTC-ISO from/to). */
export interface CtfSeedTimeTier {
  from: string;
  to: string;
  ceiling: number;
}

/**
 * Structural mirror of the Ctf attribute set (src/entities/qr.ts) — the subset
 * a seed row populates. Deliberately NOT imported from the entity to keep this
 * module free of the ESM/AWS entity chain.
 */
export interface CtfSeedRow {
  challenge: string;
  answer?: string; // NEVER set by the builder — hashes supersede plaintext
  answerHash?: string;
  answerType?: "static" | "otp" | "wordlist";
  points?: number;
  pointMax?: number;
  pointFloor?: number;
  maxSolves?: number;
  firstBloodBonus?: number;
  otp?: CtfSeedOtp;
  unlockAfter?: string;
  perPlayerIntervalHours?: number;
  timeTiers?: CtfSeedTimeTier[];
  effect?: unknown;
  maxAttempts: number;
  rateLimitWindow: number;
  enabled: boolean;
}

// Anti-spam defaults on every starter (57-CONTEXT.md D3).
const ANTI_SPAM = { maxAttempts: 5, rateLimitWindow: 60 } as const;

// grace-hopper's timed-drop tier spans the DEF CON 34 window (2026). Inside the
// window the tier ceiling (500) overrides the base pointMax (100). Wall-clock
// UTC-ISO from/to per the Ctf.timeTiers contract.
const DEFCON_34_TIER: CtfSeedTimeTier = {
  from: "2026-08-06T00:00:00Z",
  to: "2026-08-10T00:00:00Z",
  ceiling: 500,
};

/**
 * Build the six curated DC33 starter rows. Pure + deterministic (aside from the
 * salted hash, which is deterministic for a fixed CTF_ANSWER_SALT). Returns
 * plain attribute objects — no DynamoDB keys, no entity coupling.
 */
export function buildSeedRows(): CtfSeedRow[] {
  return [
    // 1. static reward → chains into the rotating OTP flag via effect.nextFlag.
    {
      challenge: "goldstein",
      answerType: "static",
      answerHash: hashAnswer("hackers4evr"),
      points: 100,
      pointMax: 100,
      effect: {
        kind: "otp-enroll",
        otpauth:
          "otpauth://totp/Emmanuel%20Goldstein?secret=GZRGQNKGKN4DINQ&issuer=Defcon.run&algorithm=SHA1&digits=6&period=120",
        nextFlag: "goldstein-otp",
      },
      enabled: false,
      ...ANTI_SPAM,
    },
    // 2. chained rotating OTP — verifies via the TOTP secret (no static answer).
    //    Unlocked only after `goldstein`; repeatable at most once per 24h.
    {
      challenge: "goldstein-otp",
      answerType: "otp",
      otp: { secret: "GZRGQNKGKN4DINQ", digits: 6, period: 120, algorithm: "SHA1", skew: 1 },
      unlockAfter: "goldstein",
      perPlayerIntervalHours: 24,
      points: 100,
      enabled: false,
      ...ANTI_SPAM,
    },
    // 3. first-blood race — declining curve + flat bonus for ordinal #1.
    {
      challenge: "mudge",
      answerHash: hashAnswer("0g3l33t"),
      pointMax: 1000,
      pointFloor: 100,
      maxSolves: 100,
      firstBloodBonus: 250,
      enabled: false,
      ...ANTI_SPAM,
    },
    // 4. flat award.
    {
      challenge: "condor",
      answerHash: hashAnswer("fr33k3v1n"),
      points: 100,
      enabled: false,
      ...ANTI_SPAM,
    },
    // 5. timed drop — base 100/floor 1, DEF CON 34 tier ceiling 500 while active.
    //    D3 answer "d3bugth3sYstem" has an uppercase S; hashAnswer trim+lowercases,
    //    so the stored hash is over the normalized "d3bugth3system".
    {
      challenge: "grace-hopper",
      answerHash: hashAnswer("d3bugth3sYstem"),
      pointMax: 100,
      pointFloor: 1,
      timeTiers: [DEFCON_34_TIER],
      enabled: false,
      ...ANTI_SPAM,
    },
    // 6. easter egg — small award + confetti effect.
    {
      challenge: "turing",
      answerHash: hashAnswer("3n1gim@"),
      points: 10,
      effect: { kind: "confetti", intensity: 11 },
      enabled: false,
      ...ANTI_SPAM,
    },
  ];
}
