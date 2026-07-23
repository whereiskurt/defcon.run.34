import { Entity } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";
import { shortTokenFromHash } from "@/lib/short-token";

/**
 * RunnerToken — short-token → runner mapping for the social QR.
 *
 * The runner QR encodes `https://q.<domain>/r/<token>` where token =
 * first 16 hex of RunUser.hash (see lib/short-token.ts). The resolver's `r`
 * Qr row forwards the token verbatim as `?p=<token>`; the /r scan route
 * resolves it here. One row per user, minted at signup, lazily ensured by
 * the internal user endpoint, and backfilled once for existing users.
 *
 * No GSI: lookup is always by token (pk). The full-hash path still uses
 * RunUser.byHash for legacy `?h=` links.
 */
export const RunnerToken = new Entity(
  {
    model: {
      entity: "RunnerToken",
      version: "1",
      service: "run",
    },
    attributes: {
      token: { type: "string", required: true },
      userId: { type: "string", required: true },
      hash: { type: "string", required: true },
      createdAt: {
        type: "string",
        default: () => new Date().toISOString(),
        readOnly: true,
      },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["token"] },
        sk: { field: "sk", composite: [] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

/**
 * Idempotently create the token row for a user. A pre-existing row owned by
 * the same user is fine; a row owned by ANOTHER user is a 16-hex prefix
 * collision (vanishingly unlikely) and fails loudly rather than mis-crediting
 * scans.
 */
export async function ensureRunnerToken(
  userId: string,
  hash: string
): Promise<string> {
  const token = shortTokenFromHash(hash);
  try {
    await RunnerToken.create({ token, userId, hash }).go();
  } catch {
    const existing = await RunnerToken.get({ token }).go();
    if (!existing.data) {
      throw new Error(`RunnerToken: create failed and row absent for ${token}`);
    }
    if (existing.data.userId !== userId) {
      throw new Error(
        `RunnerToken collision on ${token}: held by a different user`
      );
    }
  }
  return token;
}

export async function getRunnerByToken(
  token: string
): Promise<{ userId: string; hash: string } | null> {
  const result = await RunnerToken.get({ token }).go();
  if (!result.data) return null;
  return { userId: result.data.userId, hash: result.data.hash };
}
