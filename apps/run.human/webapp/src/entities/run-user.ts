import { Entity } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";
import * as crypto from "crypto";
const { createHash, generateKeyPairSync } = crypto;
import * as qr from "qrcode";
import { ensureRunnerToken } from "./runner-token";

// Seed for MQTT credential generation (should be set in environment)
const creationSeed: string = process.env.RUN_USER_CREATION_SEED || "default-seed";
const REGION_SHORT = process.env.REGION_SHORT || "use1";
const siteDomain = process.env.SITE_DOMAIN || "defcon.run";

/**
 * RunUser Entity
 *
 * Stores user data for the run.human application.
 * This entity is created after successful OIDC authentication from auth.defcon.run.
 *
 * The profile data (name, picture, etc.) is retrieved from the auth service endpoint.
 * This table stores the userId, run-specific profile data, and unique identifiers for QR-based interactions.
 */
export const RunUser = new Entity(
  {
    model: {
      entity: "RunUser",
      version: "1",
      service: "run",
    },
    attributes: {
      // Primary identifier - Auth.js user ID (from auth.defcon.run)
      userId: {
        type: "string",
        required: true,
      },
      // Run-specific profile data (user can customize)
      displayName: {
        type: "string",
      },
      // Set true once the runner edits their display name with the profile
      // pencil. The bib-name sync refuses to overwrite a manually-claimed name
      // and stamps this false on each of its own writes. See lib/rabbit-name-sync.
      displayNameManual: {
        type: "boolean",
      },
      bio: {
        type: "string",
      },

      // Unique identifiers for QR-based interactions
      seed: {
        type: "string", // Random seed for hash generation
      },
      hash: {
        type: "string", // SHA256 hash for QR code lookup (derived from rsapubSHA + seed)
      },
      eqr: {
        type: "string", // QR code data URL
      },

      // RSA key pair hashes (for regeneration capability)
      rsapubSHA: {
        type: "string", // SHA256 hash of RSA public key
      },
      rsaprivSHA: {
        type: "string", // SHA256 hash of RSA private key
      },

      // MQTT credentials
      mqttUsername: {
        type: "string",
      },
      mqttPassword: {
        type: "string",
      },
      mqttUsertype: {
        type: ["rabbit", "admin", "wildhare", "og"] as const,
      },

      // Per-user Meshtastic ringtone (RTTTL). Optional override; when unset the
      // flasher falls back to a class default keyed off mqttUsertype. Set by an
      // admin from the run.human console; NOT a secret (device config, like
      // mqttUsertype). See run.flash config/meshtastic.ts resolveRingtone().
      ringtone: {
        type: "string",
      },

      // Meshtastic radios are now a first-class MeshRadio entity keyed by nodeId
      // (Phase 66 hard-switch, MRAD-04) — the embedded list attribute is retired.
      // See src/entities/mesh-radio.ts.

      // Denormalized check-in fields (actual check-ins stored in CheckIn entity)
      lastCheckInAt: {
        type: "number",
      },
      checkInCount: {
        type: "number",
        default: () => 0,
      },

      // CTF rollups (Phase 44, CTF-03). Atomic-`ADD` counters owned by the judge
      // (44-03); CtfSolve rows are the auditable source of truth (ctfScore can be
      // recomputed as sum(points)). Patterned on the checkInCount default-0 counter.
      ctfScore: {
        type: "number",
        default: () => 0,
      },
      ctfSolves: {
        type: "number",
        default: () => 0,
      },

      // Social-scan rollup (runner social QR). Atomic-ADD counter: +1 per
      // mutual-scan award (each side), +10 for the DC-jack egg. CtfScoreEvent
      // rows (challenges social-scan / jack-egg) are the auditable ledger.
      // Drives the relative rank bands rendered around the whoami QR.
      socialScore: {
        type: "number",
        default: () => 0,
      },

      // Leaderboard activity rollups (Phase 49, LDBR-02). Denormalized so the
      // leaderboard is a cheap scanAllRunUsers() sorted by activityScore, never
      // an accomplishment-wide scan. Written ONLY by updateRunUserActivityCounts
      // (below), called ONLY from createAccomplishment/deleteAccomplishment
      // (Plan 49-03). Default-zero / optional so pre-existing rows read cleanly.
      // NOTE: intentionally NOT `totalPoints` — the displayed total is
      // activityScore + ctfScore, and ctfScore/ctfSolves are owned by the CTF
      // judge worktree, which adds them to this SAME entity additively.
      activityScore: {
        type: "number",
        default: () => 0,
      },
      activityCounts: {
        type: "map",
        properties: {
          checkin: { type: "number", default: () => 0 },
          gpx: { type: "number", default: () => 0 },
          strava: { type: "number", default: () => 0 },
        },
        default: () => ({ checkin: 0, gpx: 0, strava: 0 }),
      },
      latestActivityAt: {
        type: "number",
      },

      // ── Derived score (points-consistency, 2026-07-30). Written ONLY by
      // lib/rescore.ts:rescoreUser — the single mutation point for ALL score
      // fields. score = runStreak + socialStreak + ctfStreak + flagPoints,
      // recomputed from ledgers (Accomplishment, CtfSolve, CtfScoreEvent)
      // against current Ctf config. activityScore/ctfScore/socialScore above
      // are LEGACY (frozen; socialScore still ticks as a cosmetic scan meter).
      score: {
        type: "number",
        default: () => 0,
      },
      scoreBreakdown: {
        type: "map",
        properties: {
          runStreak: { type: "number", default: () => 0 },
          socialStreak: { type: "number", default: () => 0 },
          ctfStreak: { type: "number", default: () => 0 },
          flagPoints: { type: "number", default: () => 0 },
        },
      },
      streakDays: {
        type: "map",
        properties: {
          run: { type: "number", default: () => 0 },
          social: { type: "number", default: () => 0 },
          ctf: { type: "number", default: () => 0 },
        },
      },
      rescoredAt: {
        type: "number",
      },

      // User preferences
      preferences: {
        type: "map",
        properties: {
          theme: { type: "string" }, // "dark" | "light" | "system"
          units: { type: "string" }, // "metric" | "imperial"
          privacyLevel: { type: "string" }, // "public" | "friends" | "private"
          checkinPreference: { type: "string" }, // "public" | "private"
          pinIcon: { type: "string" }, // pin-icons.ts catalog id (default "bunny")
          pinColor: { type: "string" }, // #rrggbb pin body color
        },
      },

      // Timestamps
      createdAt: {
        type: "number",
        default: () => Date.now(),
        readOnly: true,
      },
      updatedAt: {
        type: "number",
        default: () => Date.now(),
        watch: "*",
        set: () => Date.now(),
      },
      lastLoginAt: {
        type: "number",
      },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["userId"] },
        sk: { field: "sk", composite: [] },
      },
      // GSI for looking up users by their QR hash
      byHash: {
        index: "gsi1pk-gsi1sk-index",
        pk: { field: "gsi1pk", composite: ["hash"] },
        sk: { field: "gsi1sk", composite: ["userId"] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

/**
 * Get an existing user or create a new one if not found.
 * This is the primary entry point for user creation/retrieval.
 *
 * For new users:
 * - Generates a unique displayName (rabbit_XXXX)
 * - Generates RSA key pair and stores SHA256 hashes
 * - Creates seed and hash (from rsapubSHA + seed) for QR-based lookup
 * - Generates QR code data URL
 * - Generates MQTT credentials
 * - Sets default preferences
 */
export async function upsertRunUser(userId: string) {
  // First try to get existing user
  const existing = await getRunUser(userId);
  if (existing) {
    return existing;
  }

  // Generate unique identifiers for new user
  const displayName = `rabbit_${userId.slice(0, 4)}`;

  // Generate RSA key pair
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  const rsapub = publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64");
  const rsapriv = privateKey
    .export({ type: "pkcs8", format: "der" })
    .toString("base64");

  // Generate SHA256 hashes of the keys
  const rsapubSHA = createHash("sha256").update(rsapub).digest("hex");
  const rsaprivSHA = createHash("sha256").update(rsapriv).digest("hex");

  // Generate random seed and hash for QR code (using rsapubSHA for regeneration capability)
  const seed = crypto.randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(`${rsapubSHA}${seed}`).digest("hex");

  // Generate QR code data URL. Short region-agnostic form: the q.<domain>
  // resolver's `r` code owns the region splice (see lib/short-token.ts and
  // components/qr/buildQrPayload.ts — kept byte-identical by its guard test).
  const eqr = await qr.toDataURL(`https://q.${siteDomain}/r/${hash.slice(0, 16)}`, {
    errorCorrectionLevel: "H",
    width: 300,
  });

  // Generate MQTT credentials
  const mqttUsername = createHash("sha256")
    .update(userId + creationSeed)
    .digest("hex")
    .slice(0, 12)
    .toLowerCase();

  const mqttPassword = createHash("sha256")
    .update(mqttUsername + creationSeed)
    .digest("hex")
    .slice(0, 12)
    .toLowerCase();

  const newUser = {
    userId,
    displayName,
    seed,
    hash,
    eqr,
    rsapubSHA,
    rsaprivSHA,
    mqttUsername,
    mqttPassword,
    mqttUsertype: "rabbit" as const,
    preferences: {
      theme: "system",
      units: "metric",
      privacyLevel: "public",
      checkinPreference: "public",
    },
    lastLoginAt: Date.now(),
  };

  const result = await RunUser.create(newUser).go();

  // Mint the short-token → user mapping for the social QR (best-effort:
  // the internal user endpoint lazily ensures it on read too).
  try {
    await ensureRunnerToken(userId, hash);
  } catch (err) {
    console.error("[run-user] ensureRunnerToken at signup failed", err);
  }

  return result.data;
}

/**
 * Get a user by userId (returns null if not found)
 */
export async function getRunUser(userId: string) {
  const result = await RunUser.get({ userId }).go();
  return result.data;
}

/**
 * Scan every RunUser row for the admin reporting dashboard (Phase 43, ADMN-02).
 *
 * Full-table scan — acceptable at event scale (hundreds–low-thousands of rows)
 * per the phase decision. ElectroDB auto-filters the scan to the RunUser entity,
 * so no manual entity filter is required. Server-only; never import into a client
 * component. This is a read-only wrapper — it does NOT alter the entity schema.
 */
export async function scanAllRunUsers(): Promise<RunUserItem[]> {
  const result = await RunUser.scan.go({ pages: "all" });
  return result.data as RunUserItem[];
}

/**
 * Get a user by their QR hash (for scanning interactions)
 */
export async function getUserByHash(hash: string) {
  const result = await RunUser.query.byHash({ hash }).go();
  if (result.data.length === 0) {
    return null;
  }
  return result.data[0];
}

/**
 * Update user's last login timestamp
 */
export async function updateLastLogin(userId: string): Promise<void> {
  await RunUser.patch({ userId }).set({ lastLoginAt: Date.now() }).go();
}

/**
 * Update user profile data
 */
export async function updateRunUserProfile(
  userId: string,
  data: {
    displayName?: string;
    displayNameManual?: boolean;
    bio?: string;
    // Empty string clears the override (flasher then uses the class default);
    // ElectroDB `.set` rejects null for a string attr, so callers pass "".
    ringtone?: string;
    preferences?: {
      theme?: string;
      units?: string;
      privacyLevel?: string;
      checkinPreference?: string;
    };
  }
): Promise<void> {
  await RunUser.patch({ userId }).set(data).go();
}

/**
 * Pure delta helper for the leaderboard activity rollups (Phase 49, LDBR-02).
 *
 * Given an accomplishment source, its point value, and whether the accomplishment
 * is being created (increment) or deleted (decrement), returns the signed deltas
 * to apply to `activityScore` and the matching `activityCounts.<source>` entry.
 *
 * - `scoreDelta` is signed by `increment` and scaled by `pointsDelta`.
 * - `countDelta` is +1 (create) or -1 (delete) — one accomplishment is one count,
 *   regardless of how many points it is worth.
 * - `countKey` is always the passed source; it is never crossed.
 *
 * Pure and side-effect-free so it can be unit-tested without DynamoDB
 * (see run-user-activity.test.ts). The floor-at-0 clamp lives in the mutator
 * below, not here, because it depends on the persisted current value.
 */
export function activityDelta(
  source: "checkin" | "gpx" | "strava",
  pointsDelta: number,
  increment: boolean
): { scoreDelta: number; countKey: "checkin" | "gpx" | "strava"; countDelta: number } {
  const sign = increment ? 1 : -1;
  return {
    scoreDelta: sign * pointsDelta,
    countKey: source,
    countDelta: sign,
  };
}

/**
 * The SOLE writer of the leaderboard activity rollups (Phase 49, LDBR-02):
 * `activityScore`, `activityCounts`, and `latestActivityAt`.
 *
 * Called ONLY from `createAccomplishment` / `deleteAccomplishment` (Plan 49-03)
 * so the denormalized totals never drift from the Accomplishment table. Do NOT
 * patch these three fields anywhere else — the whole leaderboard is a cheap
 * `scanAllRunUsers()` sorted by `activityScore`, which is only trustworthy if
 * this is the single mutation point.
 *
 * Uses read-modify-write (not an atomic `add`/`subtract`) because a decrement
 * must never persist a negative score or count — DynamoDB atomic adds cannot
 * clamp, so the floor (DC33 `Math.max(0, …)`) is enforced here over the read
 * value, then written back in one patch.
 *
 * No caller is wired in this plan — the check-in / accomplishment write paths
 * that call it land in Plans 49-03 / 49-04.
 */
export async function updateRunUserActivityCounts(
  userId: string,
  {
    source,
    pointsDelta,
    completedAt,
    increment = true,
  }: {
    source: "checkin" | "gpx" | "strava";
    pointsDelta: number;
    completedAt: number;
    increment?: boolean;
  }
): Promise<void> {
  const { scoreDelta, countKey, countDelta } = activityDelta(
    source,
    pointsDelta,
    increment
  );

  const existing = await getRunUser(userId);
  const currentScore = existing?.activityScore ?? 0;
  const currentCounts = existing?.activityCounts ?? {};

  const nextScore = Math.max(0, currentScore + scoreDelta);
  const nextCount = Math.max(0, (currentCounts[countKey] ?? 0) + countDelta);

  const nextCounts = {
    checkin: currentCounts.checkin ?? 0,
    gpx: currentCounts.gpx ?? 0,
    strava: currentCounts.strava ?? 0,
    [countKey]: nextCount,
  };

  await RunUser.patch({ userId })
    .set({
      activityScore: nextScore,
      activityCounts: nextCounts,
      latestActivityAt: completedAt,
    })
    .go();
}

// Type definitions
export type RunUserItem = {
  userId: string;
  displayName?: string;
  displayNameManual?: boolean;
  bio?: string;
  seed?: string;
  hash?: string;
  eqr?: string;
  rsapubSHA?: string;
  rsaprivSHA?: string;
  mqttUsername?: string;
  mqttPassword?: string;
  mqttUsertype?: "rabbit" | "admin" | "wildhare" | "og";
  ringtone?: string;
  lastCheckInAt?: number;
  checkInCount?: number;
  // CTF rollups (Phase 44, CTF-03) — owned by the CTF judge worktree.
  ctfScore?: number;
  ctfSolves?: number;
  // Leaderboard activity rollups (Phase 49, LDBR-02) — default-zero / optional.
  activityScore?: number;
  activityCounts?: { checkin?: number; gpx?: number; strava?: number };
  latestActivityAt?: number;
  // Derived score (points-consistency, 2026-07-30) — written ONLY by
  // lib/rescore.ts:rescoreUser. See attribute comment above for the formula.
  score?: number;
  scoreBreakdown?: {
    runStreak?: number;
    socialStreak?: number;
    ctfStreak?: number;
    flagPoints?: number;
  };
  streakDays?: { run?: number; social?: number; ctf?: number };
  rescoredAt?: number;
  preferences?: {
    theme?: string;
    units?: string;
    privacyLevel?: string;
    checkinPreference?: string;
    pinIcon?: string;
    pinColor?: string;
  };
  createdAt?: number;
  updatedAt?: number;
  lastLoginAt?: number;
};
