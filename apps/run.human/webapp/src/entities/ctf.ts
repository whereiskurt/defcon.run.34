import { Entity } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * CTF judge entities (run.human-only — Phase 44, CTF-01).
 *
 * These entities live on the SHARED `run-human-electro` table
 * (`service: "run"`, `version: "1"`) alongside `Qr`/`Ctf`/`Qrstat` (see
 * `./qr.ts`) and `RunUser`. Unlike `Ctf`, the q.defcon.run resolver does NOT
 * read these rows, so there is NO `.mjs` mirror to keep byte-parity with — the
 * key shapes here are run.human-internal contracts, pinned by
 * `src/entities/__tests__/ctf-key-parity.test.ts`. (CtfScoreEvent, added in the
 * flag-types Slice 1a, likewise has NO resolver `.mjs` mirror — the resolver
 * never reads it; its keys are run.human-internal. CtfCode, added in the
 * flag-types Slice 3 wordlist work, likewise has NO resolver `.mjs` mirror — the
 * resolver never reads it; its keys are run.human-internal.)
 *
 * Schema only: no DB-mutating helpers live here. The judge (Phase 44-03) owns
 * the conditional-put / atomic-ADD orchestration behind its store seam.
 *
 *   CtfSolve   — one row per (challenge, user); the idempotency key. All solvers
 *                of a challenge share a partition (ordinal + solve list); each
 *                user is exactly one row (attribute_not_exists(sk) claim). gsi1
 *                resolves "all my solves".
 *   CtfPending — park-and-claim for unauth covert hits (Phase 46 consumes).
 *                Stores submittedFlagHash (a hash, NEVER the raw guess) + TTL.
 *   CtfAttempt — short-TTL per-(challenge, user) attempt counter for the
 *                rate-limit / attempt-cap gate (CTF-03 step 2).
 */

// ---------------------------------------------------------------------------
// CtfSolve — one row per (challenge, user); the idempotency key
// ---------------------------------------------------------------------------

export const CtfSolve = new Entity(
  {
    model: {
      entity: "CtfSolve",
      version: "1",
      service: "run",
    },
    attributes: {
      challenge: { type: "string", required: true },
      user: { type: "string", required: true },
      ordinal: { type: "number" }, // n - the gap-free solve order
      points: { type: "number" },
      firstBlood: { type: "boolean" },
      tierCeiling: { type: "number" }, // audit: ceiling in effect at solve time
      channel: { type: ["qr", "covert"] as const },
      solvedAt: { type: "string" }, // UTC-ISO
      createdAt: {
        type: "string",
        default: () => new Date().toISOString(),
        readOnly: true,
      },
      updatedAt: {
        type: "string",
        default: () => new Date().toISOString(),
        watch: "*",
        set: () => new Date().toISOString(),
      },
    },
    indexes: {
      // All solvers of a challenge share a partition; each user is one row.
      primary: {
        pk: { field: "pk", composite: ["challenge"] },
        sk: { field: "sk", composite: ["user"] },
      },
      // "all my solves" + leaderboard drill-in.
      byUser: {
        index: "gsi1pk-gsi1sk-index",
        pk: { field: "gsi1pk", composite: ["user"] },
        sk: { field: "gsi1sk", composite: ["challenge"] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

// ---------------------------------------------------------------------------
// CtfScoreEvent — append-only ledger for REPEATABLE flags (flag-types Slice 1a)
// ---------------------------------------------------------------------------
//
// One row per (challenge, user, bucket). `bucket` is the time-window token
// (floor of scoredAt to perPlayerIntervalHours, or the OTP period for tighter
// flags — see lib/ctf-flag-types.scoreBucket). Because the bucket lives in the
// sk, the once-per-window claim is a single conditional put: two solves in the
// same window collide on `attribute_not_exists(sk)` and the first writer wins
// (NO read-then-write race) — exactly like CtfSolve's idempotent claim, but
// per-window instead of once-ever. Static one-award flags keep using CtfSolve.
// byUser resolves "all my scoring events" for the perPlayerMax count path.
export const CtfScoreEvent = new Entity(
  {
    model: {
      entity: "CtfScoreEvent",
      version: "1",
      service: "run",
    },
    attributes: {
      challenge: { type: "string", required: true },
      user: { type: "string", required: true },
      // Time-window token; makes the sk once-per-window (see scoreBucket).
      bucket: { type: "string", required: true },
      points: { type: "number" },
      channel: { type: ["qr", "covert"] as const },
      scoredAt: { type: "string" }, // UTC-ISO
      tierCeiling: { type: "number" }, // audit: ceiling in effect at score time
      createdAt: {
        type: "string",
        default: () => new Date().toISOString(),
        readOnly: true,
      },
      updatedAt: {
        type: "string",
        default: () => new Date().toISOString(),
        watch: "*",
        set: () => new Date().toISOString(),
      },
    },
    indexes: {
      // All scoring events for a challenge share a partition; each (user, bucket)
      // is exactly one row (attribute_not_exists(sk) once-per-window claim).
      primary: {
        pk: { field: "pk", composite: ["challenge"] },
        sk: { field: "sk", composite: ["user", "bucket"] },
      },
      // "all my scoring events" — the perPlayerMax count path.
      byUser: {
        index: "gsi1pk-gsi1sk-index",
        pk: { field: "gsi1pk", composite: ["user"] },
        sk: { field: "gsi1sk", composite: ["challenge", "bucket"] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

// ---------------------------------------------------------------------------
// CtfCode — pool of single-use wordlist codes (flag-types Slice 3, CTFT-12)
// ---------------------------------------------------------------------------
//
// One row per (challenge, codeHash). Only the SALTED codeHash persists — the
// admin bulk-loads pre-hashed codes via the SAME salt scheme answers use
// (lib/ctf-hash), so a table read never hands over a redeemable plaintext code
// (there is deliberately NO `code`/plaintext attribute on this entity).
//
// Because the codeHash lives in the sk, a once-per-code single-use claim is a
// single DynamoDB conditional update on `attribute_not_exists(claimedBy)`: two
// concurrent claimers of the SAME code collide on that condition and EXACTLY one
// wins (no read-then-write race) — mirroring CtfSolve's idempotent claim, but
// keyed by the code rather than the user. The loser gets a non-solve
// indistinguishable from a wrong answer. `claimedBy`/`claimedAt` are ABSENT
// until the winning claim sets them (that absence IS the claim condition).
//
// Schema only: the atomic claim itself (the conditional patch) lands in the
// judge (56-02) behind its store seam. No gsi1 byUser index — the claim is by
// the exact (challenge, codeHash) key, so there is no per-user query path.
export const CtfCode = new Entity(
  {
    model: {
      entity: "CtfCode",
      version: "1",
      service: "run",
    },
    attributes: {
      challenge: { type: "string", required: true },
      // Salted SHA-256 hex of a code, produced by the SAME hashAnswer seam
      // answers use (lib/ctf-hash). Plaintext is NEVER an attribute here.
      codeHash: { type: "string", required: true },
      // The authUserId that won the single-use claim. ABSENT until claimed —
      // its absence is the `attribute_not_exists(claimedBy)` claim condition.
      claimedBy: { type: "string" },
      // UTC-ISO claim time. ABSENT until claimed.
      claimedAt: { type: "string" },
      createdAt: {
        type: "string",
        default: () => new Date().toISOString(),
        readOnly: true,
      },
    },
    indexes: {
      // All codes for a challenge share a partition; each code is one row.
      // The claim is a conditional update on attribute_not_exists(claimedBy).
      primary: {
        pk: { field: "pk", composite: ["challenge"] },
        sk: { field: "sk", composite: ["codeHash"] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

// ---------------------------------------------------------------------------
// CtfOtpClaim — global single-use claim for a SINGLE-USE OTP flag (Phase 65)
// ---------------------------------------------------------------------------
//
// One row per (challenge, codeHash). Used ONLY when an OTP flag sets
// `otp.singleUse` (first-come-first-served): the FIRST logged-in player to redeem
// a given rolling code wins globally; everyone else gets a non-solve.
//
// Unlike `CtfCode` (a PRE-LOADED pool claimed via patch-if-exists on
// `attribute_not_exists(claimedBy)`), there is NO pool here — the valid code is
// generated live by TOTP. So the claim is a CREATE-IF-ABSENT conditional put:
// `CtfOtpClaim.create({challenge, codeHash, claimedBy, ...})` adds
// `attribute_not_exists` on the key, so two concurrent claimers of the SAME code
// collide and EXACTLY one wins (no read-then-write race). `claimedBy` is therefore
// written by the WINNING create, not a later patch.
//
// `ttl` is a DynamoDB TTL (epoch seconds) so the consumed-code marker auto-expires
// just past the code's own validity window (verifyTotp rejects it by then anyway) —
// no cleanup job, no storage creep. The salted `codeHash` is the only code trace;
// plaintext is NEVER stored. Like CtfSolve/CtfScoreEvent/CtfCode this entity has NO
// resolver `.mjs` mirror — the resolver never reads it; single-use is judge-only.
// No gsi: the claim is by the exact (challenge, codeHash) key.
export const CtfOtpClaim = new Entity(
  {
    model: {
      entity: "CtfOtpClaim",
      version: "1",
      service: "run",
    },
    attributes: {
      challenge: { type: "string", required: true },
      // Salted SHA-256 hex of the rolling code (same hashAnswer seam answers use).
      // Plaintext is NEVER an attribute here.
      codeHash: { type: "string", required: true },
      // The authUserId that won the single-use claim — written by the winning
      // create-if-absent (its presence is what a later claimer's create collides on).
      claimedBy: { type: "string" },
      // UTC-ISO claim time.
      claimedAt: { type: "string" },
      // DynamoDB TTL epoch seconds (= now + period·(skew+2)); auto-expires the marker.
      ttl: { type: "number" },
      createdAt: {
        type: "string",
        default: () => new Date().toISOString(),
        readOnly: true,
      },
    },
    indexes: {
      // All claims for a challenge share a partition; each code is one row.
      // The claim is a create-if-absent conditional put on the (challenge, codeHash) key.
      primary: {
        pk: { field: "pk", composite: ["challenge"] },
        sk: { field: "sk", composite: ["codeHash"] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

// ---------------------------------------------------------------------------
// CtfPending — park-and-claim for unauth covert hits (Phase 46 consumes)
// ---------------------------------------------------------------------------

export const CtfPending = new Entity(
  {
    model: {
      entity: "CtfPending",
      version: "1",
      service: "run",
    },
    attributes: {
      nonce: { type: "string", required: true },
      challenge: { type: "string" },
      // A hash of the submitted guess — NEVER the raw guess (T-44-02).
      submittedFlagHash: { type: "string" },
      createdAt: {
        type: "string",
        default: () => new Date().toISOString(),
        readOnly: true,
      },
      ttl: { type: "number" }, // DynamoDB TTL epoch seconds (e.g. now + 30d)
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["nonce"] },
        sk: { field: "sk", composite: [] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

// ---------------------------------------------------------------------------
// CtfAttempt — short-TTL per-(challenge, user) attempt counter (CTF-03 step 2)
// ---------------------------------------------------------------------------

export const CtfAttempt = new Entity(
  {
    model: {
      entity: "CtfAttempt",
      version: "1",
      service: "run",
    },
    attributes: {
      challenge: { type: "string", required: true },
      user: { type: "string", required: true },
      count: { type: "number", default: () => 0 }, // atomic-ADD attempt counter
      expiresAt: { type: "number" },
      ttl: { type: "number" }, // DynamoDB TTL epoch seconds (= rateLimitWindow)
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["challenge"] },
        sk: { field: "sk", composite: ["user"] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

// ---------------------------------------------------------------------------
// Item types (hand-authored external contracts, mirroring RunUserItem style)
// ---------------------------------------------------------------------------

export type CtfSolveItem = {
  challenge: string;
  user: string;
  ordinal?: number;
  points?: number;
  firstBlood?: boolean;
  tierCeiling?: number;
  channel?: "qr" | "covert";
  solvedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CtfScoreEventItem = {
  challenge: string;
  user: string;
  bucket: string;
  points?: number;
  channel?: "qr" | "covert";
  scoredAt?: string;
  tierCeiling?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type CtfCodeItem = {
  challenge: string;
  codeHash: string;
  claimedBy?: string;
  claimedAt?: string;
  createdAt?: string;
};

export type CtfOtpClaimItem = {
  challenge: string;
  codeHash: string;
  claimedBy?: string;
  claimedAt?: string;
  ttl?: number;
  createdAt?: string;
};

export type CtfPendingItem = {
  nonce: string;
  challenge?: string;
  submittedFlagHash?: string;
  createdAt?: string;
  ttl?: number;
};

export type CtfAttemptItem = {
  challenge: string;
  user: string;
  count?: number;
  expiresAt?: number;
  ttl?: number;
};
