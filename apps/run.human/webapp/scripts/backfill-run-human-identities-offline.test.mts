/**
 * Offline operator backfill (GATED — skipped unless BACKFILL_MODE is set, so the
 * normal suite / CI never runs it). Run explicitly via vitest.
 *
 * Provisions run.human identities for named bib-only runners, fully offline,
 * against PROD via the SSO profile (default cred chain / AWS_PROFILE) — NOT the
 * local .env (that points at localhost:8888 dev DynamoDB).
 *
 * Reuses the REAL code with correct schema/values, pointed at prod via an SSO
 * client: the Auth.js adapter is constructed on the SSO client, and the real
 * RunUser entity + upsertRunUser are re-pointed with ElectroDB's setClient().
 * upsertRunUser's constants resolve correctly with no .env: REGION_SHORT→"use1",
 * SITE_DOMAIN→"defcon.run", creationSeed→"default-seed" (verified: prod uses the
 * default-seed fallback — an existing RunUser's mqttUsername matches it).
 *
 *   BACKFILL_MODE=dryrun  AWS_PROFILE=dc34-application vitest run <thisfile>   # reads only
 *   BACKFILL_MODE=confirm AWS_PROFILE=dc34-application vitest run <thisfile>   # writes PROD
 *   BACKFILL_SUB=<sub> ...                                                      # one runner
 */
import { describe, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const MODE = process.env.BACKFILL_MODE || "dryrun";
const ONLY_SUB = process.env.BACKFILL_SUB;
const REGION = "us-east-1";
const AUTHJS_TABLE = "run-human-authjs";
const ELECTRO_TABLE = "run-human-electro";
const AUTH_ELECTRO_TABLE = "run-auth-electro";
const OIDC_PROVIDER = "run.defcon.run";

// SSO/default-chain client (AWS_PROFILE) — reaches PROD; used for BOTH reads and writes.
const sso = DynamoDBDocument.from(new DynamoDB({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

type Row = Record<string, any>;
async function scanAll(table: string, params: Record<string, unknown>): Promise<Row[]> {
  const items: Row[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await sso.scan({ TableName: table, ExclusiveStartKey, ...params });
    items.push(...((r.Items as Row[]) || []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

describe.skipIf(!process.env.BACKFILL_MODE)("offline backfill (named bib-only runners → PROD via SSO)", () => {
  it("provisions run.human identities", async () => {
    const accounts = await scanAll(AUTHJS_TABLE, {
      FilterExpression: "begins_with(sk, :a)",
      ExpressionAttributeValues: { ":a": `ACCOUNT#${OIDC_PROVIDER}#` },
      ProjectionExpression: "providerAccountId",
    });
    const have = new Set(accounts.map((a) => a.providerAccountId).filter(Boolean));

    const bibs = await scanAll(ELECTRO_TABLE, {
      FilterExpression: "#e = :b",
      ExpressionAttributeNames: { "#e": "__edb_e__" },
      ExpressionAttributeValues: { ":b": "Bib" },
    });

    const profiles = await scanAll(AUTH_ELECTRO_TABLE, {
      FilterExpression: "#e = :p",
      ExpressionAttributeNames: { "#e": "__edb_e__" },
      ExpressionAttributeValues: { ":p": "AuthProfile" },
    });
    const emailBySub = new Map<string, string>();
    for (const p of profiles) if (p.userId && p.email) emailBySub.set(p.userId, p.email);

    const cands = bibs
      .filter((b) => typeof b.ownerSub === "string" && b.ownerSub.length > 0)
      .filter((b) => typeof b.nameOnBib === "string" && b.nameOnBib.trim().length > 0) // NAMED ONLY
      .filter((b) => !have.has(b.ownerSub))
      .filter((b) => !ONLY_SUB || b.ownerSub === ONLY_SUB)
      .map((b) => ({
        sub: b.ownerSub as string,
        name: (b.nameOnBib as string).trim(),
        runnerCode: b.runnerCode as string,
        email: emailBySub.get(b.ownerSub as string) ?? null,
      }));

    console.log(`\nMODE=${MODE}  target=PROD(${REGION})  named bib-only candidates: ${cands.length}`);
    for (const c of cands) {
      console.log(`  ${c.runnerCode}  name="${c.name}"  email=${c.email ?? "(MISSING)"}  sub=${c.sub}`);
    }

    if (MODE !== "confirm") {
      console.log(`\nDRY-RUN — no writes. Set BACKFILL_MODE=confirm to provision.`);
      return;
    }

    // Real code, pointed at prod via SSO: adapter on the SSO client + the real
    // RunUser entity re-pointed with setClient (correct ElectroDB keys + values).
    const { DynamoDBAdapter } = await import("@auth/dynamodb-adapter");
    const adapter = DynamoDBAdapter(sso, { tableName: AUTHJS_TABLE });
    const { RunUser, upsertRunUser } = await import("@/entities/run-user");
    (RunUser as any).setClient(sso);

    const writable = cands.filter((c) => c.email);
    const skipped = cands.length - writable.length;
    let ok = 0;
    let fail = 0;
    for (const c of writable) {
      try {
        const user = await adapter.createUser!({
          id: randomUUID(),
          email: c.email as string,
          emailVerified: null,
          name: c.name,
        } as any);
        await adapter.linkAccount!({
          userId: user.id,
          type: "oidc",
          provider: OIDC_PROVIDER,
          providerAccountId: c.sub,
        } as any);
        const ru = await upsertRunUser(user.id);
        console.log(`  ✅ ${c.runnerCode}  userId=${user.id}  hash=${ru?.hash?.slice(0, 12)}…`);
        ok++;
      } catch (e) {
        console.log(`  ⚠️  ${c.runnerCode}  ${(e as Error).message}`);
        fail++;
      }
    }
    console.log(`\nDone: ${ok} provisioned, ${fail} failed, ${skipped} skipped (no email).`);
  }, 600_000);
});
