/**
 * Admin data-access for the auth identity dashboard. Reads the authjs adapter
 * table (USER#/ACCOUNT# rows) via the raw document client and the AuthProfile /
 * OIDCModel ElectroDB entities. Server-only.
 */
import { dynamodbClient, DYNAMODB_TABLE } from "./client";
import { AuthProfile } from "./auth-profile";
import { OIDCModel } from "./oidc-adapter";
import type { AccountRow, ProfileRow } from "@/lib/identity-report";

export type OidcSessionRow = { id: string; expiresAt: number | null };

/** Pure: fold raw authjs items into userId → AccountRow[] (ACCOUNT# rows only). */
export function groupAccountsByUser(items: Record<string, unknown>[]): Record<string, AccountRow[]> {
  const out: Record<string, AccountRow[]> = {};
  for (const it of items) {
    const sk = String(it.sk ?? "");
    if (!sk.startsWith("ACCOUNT#")) continue;
    const userId = String(it.userId ?? "");
    if (!userId) continue;
    (out[userId] ??= []).push({
      provider: String(it.provider ?? ""),
      providerAccountId: String(it.providerAccountId ?? ""),
      userId,
    });
  }
  return out;
}

/** Scan all AuthProfile rows → ProfileRow projection. */
export async function scanAuthProfiles(): Promise<ProfileRow[]> {
  const page = await AuthProfile.scan.go({ pages: "all" });
  return page.data.map((p) => ({
    userId: p.userId,
    displayName: p.displayName ?? null,
    email: p.email ?? null,
    services: p.services ?? [],
    lastProvider: p.lastProvider ?? null,
    createdAt: p.createdAt ?? null,
    lockedOut: p.lockedOut ?? false,
    github: p.github ?? null,
    discord: p.discord ?? null,
    strava: p.strava ?? null,
  }));
}

/** One full scan of ACCOUNT# rows across the authjs table. */
export async function scanAllAccounts(): Promise<AccountRow[]> {
  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await dynamodbClient.scan({
      TableName: DYNAMODB_TABLE,
      FilterExpression: "begins_with(sk, :acct)",
      ExpressionAttributeValues: { ":acct": "ACCOUNT#" },
      ProjectionExpression: "userId, provider, providerAccountId, sk",
      ExclusiveStartKey,
    });
    if (res.Items) items.push(...(res.Items as Record<string, unknown>[]));
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return Object.values(groupAccountsByUser(items)).flat();
}

/** ACCOUNT# rows for a single identity (drawer). */
export async function getAccountsForUser(userId: string): Promise<AccountRow[]> {
  const res = await dynamodbClient.query({
    TableName: DYNAMODB_TABLE,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :acct)",
    ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":acct": "ACCOUNT#" },
  });
  return (res.Items ?? []).map((it) => ({
    provider: String(it.provider ?? ""),
    providerAccountId: String(it.providerAccountId ?? ""),
    userId,
  }));
}

/** Live OIDC Session rows whose payload.accountId == this identity's sub. */
export async function getOidcSessionsForUser(accountId: string): Promise<OidcSessionRow[]> {
  const res = await OIDCModel.query.primary({ modelName: "Session" }).go({ pages: "all" });
  return res.data
    .filter((r: { payload?: Record<string, unknown> }) => r.payload?.accountId === accountId)
    .map((r: { id: string; expiresAt?: number }) => ({ id: r.id, expiresAt: r.expiresAt ?? null }));
}

/** Delete a single ACCOUNT# row (unlink one provider). */
export async function deleteAccountRow(userId: string, provider: string, providerAccountId: string): Promise<void> {
  await dynamodbClient.delete({
    TableName: DYNAMODB_TABLE,
    Key: { pk: `USER#${userId}`, sk: `ACCOUNT#${provider}#${providerAccountId}` },
  });
}

/**
 * Hard delete within run.auth ONLY: AuthProfile row + all ACCOUNT# rows + the
 * USER# row + any OIDC Session rows for this accountId. Does NOT touch
 * run.human/bib (cascade is a separate phase).
 */
export async function deleteIdentity(userId: string): Promise<{ deletedAccounts: number; deletedOidc: number }> {
  // 1. accounts
  const accounts = await getAccountsForUser(userId);
  for (const a of accounts) {
    await deleteAccountRow(userId, a.provider, a.providerAccountId);
  }
  // 2. USER# row
  await dynamodbClient.delete({
    TableName: DYNAMODB_TABLE,
    Key: { pk: `USER#${userId}`, sk: `USER#${userId}` },
  });
  // 3. OIDC sessions for this accountId
  const sessions = await getOidcSessionsForUser(userId);
  for (const s of sessions) {
    await OIDCModel.delete({ modelName: "Session", id: s.id }).go();
  }
  // 4. AuthProfile
  await AuthProfile.delete({ userId }).go();
  return { deletedAccounts: accounts.length, deletedOidc: sessions.length };
}
