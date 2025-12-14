import { Entity } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * RunUser Entity
 *
 * Stores user data for the run.human application.
 * This entity is created after successful OIDC authentication from auth.defcon.run.
 *
 * The profile data (name, picture, etc.) is retrieved from the auth service endpoint.
 * This table only stores the userId, services, and run-specific profile data.
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
      // Services the user has access to (copied from auth on login)
      services: {
        type: "list",
        items: { type: "string" },
      },
      // Run-specific profile data (user can customize)
      displayName: {
        type: "string",
      },
      bio: {
        type: "string",
      },
      // User preferences
      preferences: {
        type: "map",
        properties: {
          theme: { type: "string" }, // "dark" | "light" | "system"
          units: { type: "string" }, // "metric" | "imperial"
          privacyLevel: { type: "string" }, // "public" | "friends" | "private"
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
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

export async function upsertRunUser(
  userId: string,
  data: {
    services?: string[];
  }
): Promise<void> {
  // First try to get existing user
  const existing = await RunUser.get({ userId }).go();

  const now = Date.now();

  // Build update payload
  const payload: Record<string, unknown> = {
    userId,
    lastLoginAt: now,
  };

  // Update services if provided
  if (data.services) {
    payload.services = data.services;
  }

  // Set default preferences for new users
  if (!existing.data) {
    payload.preferences = {
      theme: "system",
      units: "metric",
      privacyLevel: "public",
    };
  }

  await RunUser.upsert(payload).go();
}

export async function getRunUser(userId: string) {
  const result = await RunUser.get({ userId }).go();
  return result.data;
}

export async function updateRunUserProfile(
  userId: string,
  data: {
    displayName?: string;
    bio?: string;
    preferences?: {
      theme?: string;
      units?: string;
      privacyLevel?: string;
    };
  }
): Promise<void> {
  await RunUser.patch({ userId })
    .set(data)
    .go();
}
