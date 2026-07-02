import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { config } from "@/config";

/**
 * Strava token access for the internal sync endpoint (v1.7 Phase 31b).
 *
 * NextAuth's @auth/dynamodb-adapter stores each linked account as an item carrying
 * `provider`, `providerAccountId` (Strava athlete id), `userId`, and the OAuth token
 * fields (`access_token`, `refresh_token`, `expires_at` in unix seconds). This module
 * lists the Strava accounts, refreshes any expired access token (Strava ROTATES the
 * refresh token, so the new pair is persisted back), and returns fresh access tokens.
 *
 * Only ever called by the secret-guarded internal endpoint — never a user path.
 */

const client = DynamoDBDocument.from(
  new DynamoDB({
    ...(config.dynamodb.endpoint ? { endpoint: config.dynamodb.endpoint } : {}),
    region: config.dynamodb.region,
    credentials: config.dynamodb.credentials,
  }),
  { marshallOptions: { removeUndefinedValues: true } }
);

const TABLE = config.dynamodb.tableName;
const REFRESH_SKEW_SECONDS = 300; // refresh a little early

export type StravaUserToken = {
  userId: string;
  athleteId: string;
  accessToken: string;
};

type AccountItem = {
  pk: string;
  sk: string;
  userId: string;
  provider: string;
  providerAccountId: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
};

async function refreshStravaToken(item: AccountItem): Promise<string | null> {
  if (!item.refresh_token) return item.access_token ?? null;

  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.providers.strava.clientId,
      client_secret: config.providers.strava.clientSecret,
      grant_type: "refresh_token",
      refresh_token: item.refresh_token,
    }),
  });
  if (!res.ok) {
    console.error(`[strava-tokens] refresh failed for ${item.userId}: ${res.status}`);
    return null;
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };

  // Persist the rotated pair back onto the account item.
  await client.update({
    TableName: TABLE,
    Key: { pk: item.pk, sk: item.sk },
    UpdateExpression:
      "SET access_token = :a, refresh_token = :r, expires_at = :e",
    ExpressionAttributeValues: {
      ":a": data.access_token,
      ":r": data.refresh_token,
      ":e": data.expires_at,
    },
  });
  return data.access_token;
}

/**
 * Return a fresh access token for every Strava-linked user. Infrequent, internal-only —
 * a filtered Scan is fine (mirrors the admin-scan pattern elsewhere).
 */
export async function listStravaUserTokens(): Promise<StravaUserToken[]> {
  const tokens: StravaUserToken[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const page = await client.scan({
      TableName: TABLE,
      FilterExpression: "provider = :p",
      ExpressionAttributeValues: { ":p": "strava" },
      ExclusiveStartKey,
    });
    ExclusiveStartKey = page.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;

    for (const raw of page.Items ?? []) {
      const item = raw as AccountItem;
      if (!item.providerAccountId || !item.userId) continue;

      const now = Math.floor(Date.now() / 1000);
      let accessToken = item.access_token ?? null;
      if (!accessToken || (item.expires_at ?? 0) <= now + REFRESH_SKEW_SECONDS) {
        accessToken = await refreshStravaToken(item);
      }
      if (accessToken) {
        tokens.push({
          userId: item.userId,
          athleteId: item.providerAccountId,
          accessToken,
        });
      }
    }
  } while (ExclusiveStartKey);

  return tokens;
}
