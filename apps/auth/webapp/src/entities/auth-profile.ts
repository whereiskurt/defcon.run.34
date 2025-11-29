import { Entity } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

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
      // Authorized services for this user
      // Default: ["auth", "run"] - all users can access auth and run services
      // Admin users might have: ["auth", "run", "gpx", "admin"]
      services: {
        type: "list",
        items: { type: "string" },
        default: ["auth", "run"],
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

/**
 * Create or update an AuthProfile from provider data
 */
export async function upsertAuthProfile(
  userId: string,
  provider: "discord" | "github" | "strava" | "email",
  data: {
    email?: string;
    discord?: DiscordProfile;
    github?: GithubProfile;
    strava?: StravaProfile;
    // Raw profile objects from OAuth providers (stored as-is for later use)
    discordProfile?: Record<string, unknown>;
    githubProfile?: Record<string, unknown>;
    stravaProfile?: Record<string, unknown>;
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
