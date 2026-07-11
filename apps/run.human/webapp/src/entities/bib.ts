import { Entity } from "electrodb";
import { electroClient, ELECTRO_TABLE, dynamodbClient, DYNAMODB_TABLE } from "./client";

const OIDC_PROVIDER = "run.defcon.run";

/**
 * Read-only Bib reader (run.human side).
 *
 * The bib service (run.bib) owns the Bib entity and all writes to it. This is a
 * minimal, read-only mirror so the profile page can surface a runner's bib code
 * without a cross-service API call — the Bib record lives in the same shared
 * ElectroDB table (service "run").
 *
 * CRITICAL — the two services key users in DIFFERENT namespaces:
 *   - run.human's session.user.id is the Auth.js DynamoDB-ADAPTER user id
 *     (a uuid the adapter mints, stored as RunUser.userId).
 *   - run.bib has NO adapter; its session.user.id (= Bib.ownerSub) is the raw
 *     OIDC `sub`, stored in run.human's authjs accounts table as
 *     providerAccountId.
 * So a bib is keyed by the OIDC sub, NOT the adapter id. Looking a bib up by the
 * adapter id finds nothing. getRunnerCode() therefore resolves adapter id →
 * OIDC sub via the accounts table first (mirrors api/internal/user/[oidcSub],
 * in reverse), then reads the Bib by that sub.
 *
 * IMPORTANT: keep model.entity / version / service and the primary key config in
 * lockstep with apps/run.bib/webapp/src/entities/bib.ts. Only the attributes we
 * actually read are declared here; ElectroDB ignores the rest.
 */
export const Bib = new Entity(
  {
    model: {
      entity: "Bib",
      version: "1",
      service: "run",
    },
    attributes: {
      ownerSub: {
        type: "string",
        required: true,
      },
      runnerCode: {
        type: "string",
      },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["ownerSub"] },
        sk: { field: "sk", composite: [], template: "BIB" },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

/**
 * Resolve the OIDC sub (bib ownerSub namespace) for a run.human adapter userId
 * by reading the authjs accounts record. Returns null if no linked account.
 */
async function resolveOidcSub(adapterUserId: string): Promise<string | null> {
  const res = await dynamodbClient.query({
    TableName: DYNAMODB_TABLE,
    KeyConditionExpression: "pk = :p AND begins_with(sk, :s)",
    ExpressionAttributeValues: {
      ":p": `USER#${adapterUserId}`,
      ":s": `ACCOUNT#${OIDC_PROVIDER}#`,
    },
    ProjectionExpression: "providerAccountId",
    Limit: 1,
  });
  const account = res.Items?.[0];
  return (account?.providerAccountId as string | undefined) ?? null;
}

/**
 * Resolve the runner's bib code for a run.human adapter userId, or null if they
 * have no bib yet (the Bib record is created lazily on the bib service). Bridges
 * the adapter-id → OIDC-sub namespace gap (see file header).
 */
export async function getRunnerCode(adapterUserId: string): Promise<string | null> {
  const ownerSub = await resolveOidcSub(adapterUserId);
  if (!ownerSub) return null;
  const result = await Bib.get({ ownerSub }).go();
  return result.data?.runnerCode ?? null;
}
