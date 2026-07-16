/**
 * ctf-seed-rows.ts (CTFP-04, 57-03) — PURE builder for the curated set of ten
 * REAL DC33 CTF starter flags: five personas, each an OTP CHAIN (a static
 * flag whose solve reward reveals the enrollment QR, chained to a rotating-OTP
 * flag). Consumed by the operator script `scripts/seed-ctf.mts` (which adds
 * DynamoDB key-composition) and by its vitest. Sourced from the persona codes +
 * real OtpUrl seeds in ~/working/meshtk/meshtk.bak.yaml.
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
  // NOTE: no legacy `points` field — the judge's scorer (narrowCtf →
  // computePoints) IGNORES it entirely and reads only the four knobs below
  // (+ optional timeTiers). Setting `points` alone awards 0 on solve (CR-01,
  // 57-REVIEW). Every scoring row sets pointMax/pointFloor/maxSolves/
  // firstBloodBonus explicitly.
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

// Flat "award 100" scoring knobs shared by every seeded flag: pointMax ==
// pointFloor (no decline), maxSolves huge so the flat curve never caps, no
// first-blood bonus. The judge's scorer reads exactly these four knobs
// (narrowCtf → computePoints); the legacy `points` field is ignored (CR-01).
const FLAT_100 = { pointMax: 100, pointFloor: 100, maxSolves: 100000, firstBloodBonus: 0 } as const;

/**
 * The five REAL DC33 personas. Each has a static flag code (embedded in its
 * meshtk system prompt) AND a real `otpauth://` TOTP seed (from
 * ~/working/meshtk/meshtk.bak.yaml). Every persona becomes an OTP CHAIN: a
 * static-answer flag whose solve REWARD reveals the enrollment QR, chained to a
 * rotating-OTP flag whose answer is the live TOTP code. All seeds are SHA1 /
 * 6-digit / 120s period (meshtk convention). NOTE: some DC33 secrets are short
 * (e.g. `O5RQ`) — weak but authentic; they still enroll + generate codes.
 */
const DC33_PERSONAS: ReadonlyArray<{
  name: string;
  answer: string;
  otpauth: string;
  secret: string;
}> = [
  {
    name: "goldstein",
    answer: "hackers4evr",
    otpauth:
      "otpauth://totp/Emmanuel%20Goldstein?secret=GZRGQNKGKN4DINQ&issuer=Defcon.run&algorithm=SHA1&digits=6&period=120",
    secret: "GZRGQNKGKN4DINQ",
  },
  {
    name: "mudge",
    answer: "0g3l33t",
    otpauth: "otpauth://totp/Mudge?secret=NA2DG&issuer=Defcon.run&algorithm=SHA1&digits=6&period=120",
    secret: "NA2DG",
  },
  {
    name: "condor",
    answer: "fr33k3v1n",
    otpauth: "otpauth://totp/Condor?secret=EZRWO&issuer=Defcon.run&algorithm=SHA1&digits=6&period=120",
    secret: "EZRWO",
  },
  {
    name: "grace-hopper",
    // D3 answer "d3bugth3sYstem" has an uppercase S; hashAnswer trim+lowercases,
    // so the stored hash is over the normalized "d3bugth3system".
    answer: "d3bugth3sYstem",
    otpauth:
      "otpauth://totp/Grandma%20COBOL?secret=I4TDMITCMU&issuer=Defcon.run&algorithm=SHA1&digits=6&period=120",
    secret: "I4TDMITCMU",
  },
  {
    name: "turing",
    answer: "3n1gim@",
    otpauth: "otpauth://totp/Prof?secret=O5RQ&issuer=Defcon.run&algorithm=SHA1&digits=6&period=120",
    secret: "O5RQ",
  },
];

/**
 * Build the ten curated DC33 starter rows — a static+OTP-reward flag and its
 * chained rotating-OTP flag for each of the five personas. Pure + deterministic
 * (aside from the salted hash, deterministic for a fixed CTF_ANSWER_SALT).
 * Returns plain attribute objects — no DynamoDB keys, no entity coupling.
 */
export function buildSeedRows(): CtfSeedRow[] {
  return DC33_PERSONAS.flatMap(({ name, answer, otpauth, secret }): CtfSeedRow[] => [
    // Static reward flag — solve reveals the enrollment QR (effect.otp-enroll)
    // and chains into the rotating OTP flag via effect.nextFlag. Flat award 100.
    {
      challenge: name,
      answerType: "static",
      answerHash: hashAnswer(answer),
      ...FLAT_100,
      effect: { kind: "otp-enroll", otpauth, nextFlag: `${name}-otp` },
      enabled: false,
      ...ANTI_SPAM,
    },
    // Chained rotating OTP flag — verifies via the TOTP secret (no static
    // answer). Unlocked only after the persona's static flag; repeatable at most
    // once per 24h. Flat award 100.
    {
      challenge: `${name}-otp`,
      answerType: "otp",
      otp: { secret, digits: 6, period: 120, algorithm: "SHA1", skew: 1 },
      unlockAfter: name,
      perPlayerIntervalHours: 24,
      ...FLAT_100,
      enabled: false,
      ...ANTI_SPAM,
    },
  ]);
}
