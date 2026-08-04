import { Entity } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * Social-scan entities (runner social QR).
 *
 * - SocialPair  — pair-day dedup gate: one row per unordered user pair per PT
 *                 day; conditional-create IS the idempotency claim.
 * - SocialQuota — scanner's daily successful-scan counter (cap 50/day).
 * - SocialEgg   — once-ever DC-jack egg claim per user.
 * - SocialBoard — score distribution as ADD-counter rows (one row per score
 *                 value, Qrstat-style), driving relative rank bands. Row
 *                 bucket = `score_<zero-padded>`; counts are best-effort and
 *                 clamped ≥0 on read.
 */

export const SocialPair = new Entity(
  {
    model: { entity: "SocialPair", version: "1", service: "run" },
    attributes: {
      pairKey: { type: "string", required: true }, // sorted "<idA>_<idB>"
      day: { type: "string", required: true }, // YYYY-MM-DD PT (social-day.ts)
      scannerId: { type: "string" },
      ownerId: { type: "string" },
      createdAt: {
        type: "string",
        default: () => new Date().toISOString(),
        readOnly: true,
      },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["pairKey"] },
        sk: { field: "sk", composite: ["day"] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

export const SocialQuota = new Entity(
  {
    model: { entity: "SocialQuota", version: "1", service: "run" },
    attributes: {
      userId: { type: "string", required: true },
      day: { type: "string", required: true },
      count: { type: "number", default: 0 },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["userId"] },
        sk: { field: "sk", composite: ["day"] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

export const SocialEgg = new Entity(
  {
    model: { entity: "SocialEgg", version: "1", service: "run" },
    attributes: {
      userId: { type: "string", required: true },
      claimedAt: {
        type: "string",
        default: () => new Date().toISOString(),
        readOnly: true,
      },
      via: { type: "string" }, // "hold" | "tap"
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["userId"] },
        sk: { field: "sk", composite: [] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

/**
 * Bib pickup pass — an operator (QR_ADMIN_GROUPS) has scanned this runner's bib
 * QR, so the runner's own self-scan may redeem the pickup award. Without a row
 * here a self-scan awards NOTHING, which is the whole point: the award is meant
 * to prove a volunteer handed over a bib, and before this gate existed a runner
 * could grant themselves 200 by scanning their own QR out of curiosity.
 *
 * DURABLE by design — no expiry. Bibs are primed in bulk the day before the con
 * and collected over the following days. Deliberately NO `ttl` attribute: TTL is
 * DISABLED on run-human-electro, so writing one would imply a cleanup that never
 * runs. One row per runner (put-overwritten on re-prime), so the row count is
 * bounded by the roster.
 *
 * NOT the once-ever gate — that is still `judgeSolve`/`hasScoreFor`. A re-primed
 * runner who already collected still gets the ordinary self-scan message.
 */
export const BibPickupPass = new Entity(
  {
    model: { entity: "BibPickupPass", version: "1", service: "run" },
    attributes: {
      userId: { type: "string", required: true }, // the RUNNER, not the operator
      grantedBy: { type: "string" }, // operator's userId — audit trail
      // NOT readOnly (unlike SocialEgg.claimedAt): re-priming refreshes it.
      grantedAt: {
        type: "string",
        default: () => new Date().toISOString(),
      },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["userId"] },
        sk: { field: "sk", composite: [] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

export const SocialBoard = new Entity(
  {
    model: { entity: "SocialBoard", version: "1", service: "run" },
    attributes: {
      boardId: { type: "string", required: true }, // fixed "social"
      bucket: { type: "string", required: true }, // "score_000012"
      count: { type: "number", default: 0 },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["boardId"] },
        sk: { field: "sk", composite: ["bucket"] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);
