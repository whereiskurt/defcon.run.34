import { dynamodbClient, DYNAMODB_TABLE } from "./client";

/**
 * Server-only reads against the run.human Auth.js DynamoDB-adapter table
 * (run-human-authjs) for the Phase 43 admin reporting dashboard.
 *
 * SECURITY: every export here returns FULL emails / OIDC subs and reads a
 * server-side table via dynamodbClient. These are PII building blocks — they
 * MUST NOT be imported into any client component. Masking / reveal gating lives
 * downstream in the admin-gated API/page (Plan 04). ProjectionExpression limits
 * each read to just the attributes we need.
 *
 * NAMESPACE bridge (see entities/bib.ts header for the full note):
 *   - run.human session.user.id = the Auth.js DynamoDB-adapter user id (uuid),
 *     stored as the authjs USER# record key and as RunUser.userId.
 *   - run.bib keys a Bib by the raw OIDC `sub`, stored here on the ACCOUNT#
 *     record as providerAccountId.
 * scanAccountSubs() emits the adapterUserId → OIDC-sub map that Plan 04 composes
 * with the Bib sub→runnerCode map to resolve bib codes with zero per-row fan-out.
 */

const OIDC_PROVIDER = "run.defcon.run";

/**
 * Fetch the full email for a run.human adapter userId from the authjs USER#
 * record, or null if the user / email is absent. Server-only.
 *
 * Key shape: the @auth/dynamodb-adapter default stores the user record at
 * pk = sk = `USER#{id}` (corroborated by the confirmed `USER#{id}` pk namespace
 * used by the adjacent ACCOUNT# read in entities/bib.ts). We do the direct get on
 * that key, then fall back to the adapter's GSI1 (GSI1PK = `USER#{id}`) in case a
 * live record's base sk ever differs — so a shape drift degrades to a second
 * lookup rather than a silent null.
 */
export async function getAuthUserEmail(userId: string): Promise<string | null> {
  const res = await dynamodbClient.get({
    TableName: DYNAMODB_TABLE,
    Key: { pk: `USER#${userId}`, sk: `USER#${userId}` },
    ProjectionExpression: "email",
  });
  const direct = res.Item?.email as string | undefined;
  if (direct) return direct;

  // Fallback: the adapter also indexes the user record on GSI1 by GSI1PK=USER#{id}.
  const gsi = await dynamodbClient.query({
    TableName: DYNAMODB_TABLE,
    IndexName: "GSI1",
    KeyConditionExpression: "#gsi1pk = :gsi1pk AND begins_with(#gsi1sk, :gsi1sk)",
    ExpressionAttributeNames: {
      "#gsi1pk": "GSI1PK",
      "#gsi1sk": "GSI1SK",
    },
    ExpressionAttributeValues: {
      ":gsi1pk": `USER#${userId}`,
      ":gsi1sk": `USER#${userId}`,
    },
    ProjectionExpression: "email",
    Limit: 1,
  });
  return (gsi.Items?.[0]?.email as string | undefined) ?? null;
}

/**
 * Resolve full emails for a list of adapter userIds → `userId → email|null` map.
 * Sequential gets (event scale is hundreds–low-thousands, and the caller resolves
 * only the rows it renders). Server-only. Centralizes the USER# key logic so Plan
 * 04 never re-derives it.
 */
export async function getAuthUserEmails(
  userIds: string[]
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const userId of userIds) {
    out[userId] = await getAuthUserEmail(userId);
  }
  return out;
}

/**
 * Scan the authjs table ONCE for this provider's ACCOUNT# records and build the
 * adapterUserId → OIDC-sub map. This is the fan-out-free bridge Plan 04 composes
 * with the Bib sub→runnerCode map (no per-user resolveOidcSub loop).
 *
 * ACCOUNT# record shape (from the adapter, confirmed in bib.ts / the internal
 * user route): base pk = `USER#{adapterUserId}`, sk = `ACCOUNT#{provider}#{sub}`,
 * with a `userId` attribute (adapter id) and `providerAccountId` attribute (sub).
 * Server-only read; does not alter any schema.
 */
/**
 * Resolve an OIDC subject to its Auth.js adapter userId via the accounts GSI1
 * (LDBR-06). Returns null when no account maps to the subject.
 *
 * Query shape (the canonical sub -> adapter-userId bridge): authjs table,
 * IndexName "GSI1", GSI1PK = `ACCOUNT#${OIDC_PROVIDER}`, GSI1SK =
 * `ACCOUNT#${sub}` -> `Items[0].userId`. This is the single home for that query:
 * the internal user route (GET + PATCH) and the internal accomplishment route
 * both call this helper instead of re-declaring it. Server-only (dynamodbClient);
 * never import into a client component.
 */
export async function getAdapterUserIdBySub(
  sub: string
): Promise<string | null> {
  const accountResult = await dynamodbClient.query({
    TableName: DYNAMODB_TABLE,
    IndexName: "GSI1",
    KeyConditionExpression: "#gsi1pk = :gsi1pk AND #gsi1sk = :gsi1sk",
    ExpressionAttributeNames: { "#gsi1pk": "GSI1PK", "#gsi1sk": "GSI1SK" },
    ExpressionAttributeValues: {
      ":gsi1pk": `ACCOUNT#${OIDC_PROVIDER}`,
      ":gsi1sk": `ACCOUNT#${sub}`,
    },
  });
  const adapterUserId = accountResult.Items?.[0]?.userId as string | undefined;
  return adapterUserId ?? null;
}

/**
 * Resolve a run.human Auth.js adapter userId to its OIDC subject — the reverse
 * direction of `getAdapterUserIdBySub` (LDBR-08 Task 7, admin per-user
 * Recalculate). Queries the base table directly (no GSI needed: the adapter
 * userId IS the base pk) — `pk = USER#{adapterUserId}`, `sk` begins with
 * `ACCOUNT#{OIDC_PROVIDER}#` — and reads `providerAccountId` (the sub) off the
 * first matching ACCOUNT# record. Returns null if no such account exists.
 * Server-only (dynamodbClient); never import into a client component.
 */
export async function getSubByAdapterUserId(
  adapterUserId: string
): Promise<string | null> {
  const res = await dynamodbClient.query({
    TableName: DYNAMODB_TABLE,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
    ExpressionAttributeValues: {
      ":pk": `USER#${adapterUserId}`,
      ":sk": `ACCOUNT#${OIDC_PROVIDER}#`,
    },
  });
  const sub = res.Items?.[0]?.providerAccountId as string | undefined;
  return sub ?? null;
}

export async function scanAccountSubs(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await dynamodbClient.scan({
      TableName: DYNAMODB_TABLE,
      FilterExpression: "begins_with(sk, :acct)",
      ExpressionAttributeValues: {
        ":acct": `ACCOUNT#${OIDC_PROVIDER}#`,
      },
      ProjectionExpression: "userId, providerAccountId",
      ExclusiveStartKey: lastKey,
    });
    for (const item of res.Items ?? []) {
      const adapterUserId = item.userId as string | undefined;
      const sub = item.providerAccountId as string | undefined;
      if (adapterUserId && sub) map[adapterUserId] = sub;
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return map;
}
