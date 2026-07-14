import { Entity } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * CTF judge entities (run.human-only — Phase 44, CTF-01).
 *
 * These three entities live on the SHARED `run-human-electro` table
 * (`service: "run"`, `version: "1"`) alongside `Qr`/`Ctf`/`Qrstat` (see
 * `./qr.ts`) and `RunUser`. Unlike `Ctf`, the q.defcon.run resolver does NOT
 * read these rows, so there is NO `.mjs` mirror to keep byte-parity with — the
 * key shapes here are run.human-internal contracts, pinned by
 * `src/entities/__tests__/ctf-key-parity.test.ts`.
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
      ordinal: { type: "number" }, // n — the gap-free solve order
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
