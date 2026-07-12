import { Entity } from "electrodb";
import { randomBytes } from "crypto";
import { electroClient, ELECTRO_TABLE } from "./client";

const DEFAULT_SERVICES = ["auth", "run", "strava", "gpxstudio", "flash"];

/**
 * Generate a random displayName like "rabbit_A1B2"
 */
function generateDisplayName(): string {
  const hex = randomBytes(2).toString("hex").toUpperCase();
  return `rabbit_${hex}`;
}

/**
 * AuthProfile Entity
 *
 * Stores cached user profile information from OAuth providers.
 * This entity is managed by the OIDC provider code and populated
 * after successful Auth.js authentication.
 *
 * The profile caches data from:
 * - Discord: id, username, globalName, avatarUrl, discriminator
 * - GitHub: id, login, name, avatarUrl, email
 * - Strava: id, username, firstName, lastName, profileMedium
 * - LinkedIn: id (sub), name, givenName, familyName, picture, email
 * - Email: just the email address (no profile data)
 */
export const AuthProfile = new Entity(
  {
    model: {
      entity: "AuthProfile",
      version: "1",
      service: "oidc",
    },
    attributes: {
      // Primary identifier - Auth.js user ID
      userId: {
        type: "string",
        required: true,
      },
      // Generated displayName (e.g., "rabbit_A1B2")
      // Created on first login, never changes
      displayName: {
        type: "string",
      },
      // Primary email address
      email: {
        type: "string",
      },
      emailVerified: {
        type: "boolean",
        default: false,
      },
      // Display name (computed from best available source)
      name: {
        type: "string",
      },
      // Profile picture URL (computed from best available source)
      picture: {
        type: "string",
      },
      // Last provider used to login
      lastProvider: {
        type: "string",
        // "discord" | "github" | "strava" | "email"
      },
      // Discord profile data
      discord: {
        type: "map",
        properties: {
          id: { type: "string" },
          username: { type: "string" },
          globalName: { type: "string" },
          discriminator: { type: "string" },
          avatarUrl: { type: "string" },
          email: { type: "string" },
          linkedAt: { type: "number" },
        },
      },
      // GitHub profile data
      github: {
        type: "map",
        properties: {
          id: { type: "number" },
          login: { type: "string" },
          name: { type: "string" },
          avatarUrl: { type: "string" },
          email: { type: "string" },
          linkedAt: { type: "number" },
        },
      },
      // Strava profile data
      strava: {
        type: "map",
        properties: {
          id: { type: "number" },
          username: { type: "string" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          profileMedium: { type: "string" },
          city: { type: "string" },
          state: { type: "string" },
          country: { type: "string" },
          linkedAt: { type: "number" },
        },
      },
      // LinkedIn profile data (Sign In with LinkedIn using OpenID Connect)
      linkedin: {
        type: "map",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          givenName: { type: "string" },
          familyName: { type: "string" },
          picture: { type: "string" },
          email: { type: "string" },
          linkedAt: { type: "number" },
        },
      },
      // Raw profile data from OAuth providers (stored for later use)
      // These contain the complete profile response from each provider
      discordProfile: {
        type: "any",
      },
      githubProfile: {
        type: "any",
      },
      stravaProfile: {
        type: "any",
      },
      linkedinProfile: {
        type: "any",
      },
      // Authorized services for this user
      // Default: ["auth", "run"] - all users can access auth and run services
      // Admin users might have: ["auth", "run", "gpx", "admin"]
      services: {
        type: "list",
        items: { type: "string" },
      },
      // User's personal Mapbox public token for GPX Studio
      // If set, this takes precedence over the system default token
      mapboxPublicToken: {
        type: "string",
      },
      // Session invalidation fields
      // Increment sessionVersion to invalidate all existing sessions
      sessionVersion: {
        type: "number",
        default: 1,
      },
      // User's quota tier - determines quota limits
      // - zero: Blocked users with no quota access
      // - upload: Standard users with normal limits
      // - admin: Administrators with elevated limits
      quotaTier: {
        type: "string",
        default: "upload",
        // Enum: "zero" | "upload" | "admin"
      },
      // Lock user out completely - prevents new logins and invalidates sessions
      lockedOut: {
        type: "boolean",
        default: false,
      },
      // Optional: reason for lockout (for admin reference)
      lockoutReason: {
        type: "string",
      },
      // Optional: when the lockout was applied
      lockedAt: {
        type: "number",
      },
      // Jail: punitive per-user Altcha friction (separate from lockedOut).
      // Toggled from the admin identity console; dials PoW difficulty AND solve count.
      jailed: {
        type: "boolean",
        default: false,
      },
      // Jail severity 1..5 (meaningful only when jailed)
      jailLevel: {
        type: "number",
      },
      // Admin note for why the user was jailed
      jailReason: {
        type: "string",
      },
      // When the jail was applied
      jailedAt: {
        type: "number",
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
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["userId"] },
        sk: { field: "sk", composite: [] },
      },
      byEmail: {
        index: "gsi1pk-gsi1sk-index",
        pk: { field: "gsi1pk", composite: ["email"] },
        sk: { field: "gsi1sk", composite: [] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

/**
 * Helper type for provider-specific profile data
 */
export type DiscordProfile = {
  id: string;
  username: string;
  globalName?: string;
  discriminator?: string;
  avatarUrl?: string;
  email?: string;
};

export type GithubProfile = {
  id: number;
  login: string;
  name?: string;
  avatarUrl?: string;
  email?: string;
};

export type StravaProfile = {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  profileMedium?: string;
  city?: string;
  state?: string;
  country?: string;
};

export type LinkedInProfile = {
  id: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
  email?: string;
};

/**
 * Create or update an AuthProfile from provider data
 */
export async function upsertAuthProfile(
  userId: string,
  provider: "discord" | "github" | "strava" | "linkedin" | "email",
  data: {
    email?: string;
    discord?: DiscordProfile;
    github?: GithubProfile;
    strava?: StravaProfile;
    linkedin?: LinkedInProfile;
    // Raw profile objects from OAuth providers (stored as-is for later use)
    discordProfile?: Record<string, unknown>;
    githubProfile?: Record<string, unknown>;
    stravaProfile?: Record<string, unknown>;
    linkedinProfile?: Record<string, unknown>;
  }
): Promise<void> {
  // First try to get existing profile
  const existing = await AuthProfile.get({ userId }).go();

  // Compute best display name and picture
  let name: string | undefined;
  let picture: string | undefined;

  if (provider === "discord" && data.discord) {
    name = data.discord.globalName || data.discord.username;
    picture = data.discord.avatarUrl;
  } else if (provider === "github" && data.github) {
    name = data.github.name || data.github.login;
    picture = data.github.avatarUrl;
  } else if (provider === "strava" && data.strava) {
    name = data.strava.firstName
      ? `${data.strava.firstName} ${data.strava.lastName || ""}`.trim()
      : data.strava.username;
    picture = data.strava.profileMedium;
  } else if (provider === "linkedin" && data.linkedin) {
    name = data.linkedin.name
      || (data.linkedin.givenName
        ? `${data.linkedin.givenName} ${data.linkedin.familyName || ""}`.trim()
        : undefined);
    picture = data.linkedin.picture;
  }

  // Use existing values if new ones aren't available
  if (existing.data) {
    name = name || existing.data.name;
    picture = picture || existing.data.picture;
  }

  const now = Date.now();

  // Build update payload
  const payload: Record<string, any> = {
    userId,
    lastProvider: provider,
    // Preserve existing services, or use default if this is a new profile
    ...(!existing.data ? { services: DEFAULT_SERVICES } : {}),
    // Generate displayName only on first login (new profile)
    ...(!existing.data ? { displayName: generateDisplayName() } : {}),
    ...(data.email ? { email: data.email, emailVerified: true } : {}),
    ...(name ? { name } : {}),
    ...(picture ? { picture } : {}),
  };

  // Add provider-specific data with linkedAt timestamp
  if (data.discord) {
    payload.discord = { ...data.discord, linkedAt: now };
  }
  if (data.github) {
    payload.github = { ...data.github, linkedAt: now };
  }
  if (data.strava) {
    payload.strava = { ...data.strava, linkedAt: now };
  }
  if (data.linkedin) {
    payload.linkedin = { ...data.linkedin, linkedAt: now };
  }

  // Store raw profile data for later use
  if (data.discordProfile) {
    payload.discordProfile = data.discordProfile;
  }
  if (data.githubProfile) {
    payload.githubProfile = data.githubProfile;
  }
  if (data.stravaProfile) {
    payload.stravaProfile = data.stravaProfile;
  }
  if (data.linkedinProfile) {
    payload.linkedinProfile = data.linkedinProfile;
  }

  await AuthProfile.upsert(payload).go();
}

/**
 * Get an AuthProfile by user ID
 */
export async function getAuthProfile(userId: string) {
  const result = await AuthProfile.get({ userId }).go();
  return result.data;
}

/**
 * Get an AuthProfile by email
 */
export async function getAuthProfileByEmail(email: string) {
  const result = await AuthProfile.query.byEmail({ email }).go();
  return result.data?.[0];
}
