import { Entity } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";
import * as crypto from "crypto";
const { createHash, generateKeyPairSync } = crypto;
import * as qr from "qrcode";

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

      // Meshtastic radio registrations
      meshtasticRadios: {
        type: "list",
        items: {
          type: "map",
          properties: {
            id: { type: "string" },
            nodeId: { type: "string" },
            privateKey: { type: "string" },
            publicKey: { type: "string" },
            impersonate: { type: "boolean" },
            verificationCode: { type: "string" },
            verified: { type: "boolean" },
            createdAt: { type: "number" },
            verifiedAt: { type: "number" },
            verificationAttempts: { type: "number" },
            resendAttempts: { type: "number" },
          },
        },
        default: () => [],
      },

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
        },
        default: () => ({ checkin: 0, gpx: 0 }),
      },
      latestActivityAt: {
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

  // Generate QR code data URL (includes region prefix for multi-region deployment)
  const eqr = await qr.toDataURL(`https://run.${siteDomain}/${REGION_SHORT}/r?h=${hash}`, {
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
  // ElectroDB infers meshtasticRadios map subfields as optional, whereas the
  // hand-authored RunUserItem marks them required; the rows are the same entity,
  // so reconcile to the declared external contract.
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
 * Update user's meshtastic radios
 */
export async function updateMeshtasticRadios(
  userId: string,
  radios: MeshtasticRadio[]
): Promise<void> {
  await RunUser.patch({ userId }).set({ meshtasticRadios: radios }).go();
}

// Type definitions
export type MeshtasticRadio = {
  id: string;
  nodeId: string;
  privateKey: string;
  publicKey?: string;
  impersonate?: boolean;
  verificationCode: string;
  verified: boolean;
  createdAt: number;
  verifiedAt?: number;
  verificationAttempts?: number;
  resendAttempts?: number;
};

/**
 * Sanitize radio data read from DynamoDB.
 *
 * DynamoDB with `convertEmptyValues: true` stores empty strings as NULL.
 * On read-back these become objects/null instead of strings, which causes
 * ElectroDB validation errors when the array is written back.
 */
export function sanitizeRadio(radio: MeshtasticRadio): MeshtasticRadio {
  return {
    id: radio.id || '',
    nodeId: radio.nodeId || '',
    privateKey: typeof radio.privateKey === 'string' ? radio.privateKey : '',
    publicKey: typeof radio.publicKey === 'string' ? radio.publicKey : '',
    impersonate: radio.impersonate ?? false,
    verificationCode: typeof radio.verificationCode === 'string' ? radio.verificationCode : '',
    verified: radio.verified ?? false,
    createdAt: radio.createdAt ?? Date.now(),
    verifiedAt: radio.verifiedAt,
    verificationAttempts: radio.verificationAttempts ?? 0,
    resendAttempts: radio.resendAttempts ?? 0,
  };
}

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
  meshtasticRadios?: MeshtasticRadio[];
  lastCheckInAt?: number;
  checkInCount?: number;
  // CTF rollups (Phase 44, CTF-03) — owned by the CTF judge worktree.
  ctfScore?: number;
  ctfSolves?: number;
  // Leaderboard activity rollups (Phase 49, LDBR-02) — default-zero / optional.
  activityScore?: number;
  activityCounts?: { checkin?: number; gpx?: number };
  latestActivityAt?: number;
  preferences?: {
    theme?: string;
    units?: string;
    privacyLevel?: string;
    checkinPreference?: string;
  };
  createdAt?: number;
  updatedAt?: number;
  lastLoginAt?: number;
};
