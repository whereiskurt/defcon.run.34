/**
 * ensure-identity — provision a run.human identity for an OIDC subject that has
 * one on run.auth but never actually signed into run.human (Kurt 2026-07-18).
 *
 * WHY: a runner who only ever used bib.defcon.run authenticated through run.auth
 * (so a Bib row + ownerSub exist) but has NO run.human Auth.js account and NO
 * RunUser — so no social-QR hash, so a blank bib QR. This mints the missing
 * run.human identity so they get a real rabbit profile + social QR like everyone.
 *
 * SAFETY — reuse the SAME Auth.js adapter run.human's sign-in uses (never forge
 * DynamoDB records by hand):
 *   - dynamodbAdapter.createUser + linkAccount write the account with the exact
 *     GSI keys (`GSI1PK=ACCOUNT#run.defcon.run`, `GSI1SK=ACCOUNT#<sub>`) that
 *     getAdapterUserIdBySub queries AND that a later REAL SSO sign-in resolves
 *     via getUserByAccount. So when this runner eventually signs into
 *     run.defcon.run, Auth.js finds THIS account and reuses it — no duplicate,
 *     no orphaned RunUser.
 *   - upsertRunUser is idempotent (returns the existing RunUser, else generates
 *     the RSA keypair + seed + QR hash + mqtt creds) — the same call the jwt
 *     callback makes on a normal first login.
 *
 * OIDC_PROVIDER MUST equal the sign-in provider id and the constant in
 * entities/auth-user.ts — the read path, the write path, and real sign-in all
 * key off it, so a drift here would silently split identities.
 */

import { randomUUID } from "crypto";
import type { AdapterUser, AdapterAccount } from "@auth/core/adapters";
import { dynamodbAdapter } from "@/entities/client";
import { getAdapterUserIdBySub } from "@/entities/auth-user";
import { upsertRunUser } from "@/entities/run-user";

const OIDC_PROVIDER = "run.defcon.run";

export type EnsureIdentityResult = {
  /** The Auth.js adapter userId (== RunUser.userId, == session.user.id). */
  userId: string;
  /** True when this call created the account (false when it already existed). */
  created: boolean;
};

/**
 * Ensure an OIDC subject has a full run.human identity (Auth.js user + account +
 * RunUser). Idempotent: an already-linked sub just gets its RunUser ensured.
 * `email` is required to mint a new Auth.js user; `name` seeds the display name
 * (the caller passes the bib name so the profile isn't a bare rabbit_XXXX).
 */
export async function ensureRunHumanIdentity(
  sub: string,
  email: string,
  name?: string | null
): Promise<EnsureIdentityResult> {
  let userId = await getAdapterUserIdBySub(sub);
  let created = false;

  if (!userId) {
    const newUser: AdapterUser = {
      id: randomUUID(),
      email,
      emailVerified: null,
      name: name ?? null,
    };
    // Non-null: DynamoDBAdapter implements the full Adapter surface.
    const user = await dynamodbAdapter.createUser!(newUser);

    const account: AdapterAccount = {
      userId: user.id,
      type: "oidc",
      provider: OIDC_PROVIDER,
      providerAccountId: sub,
    };
    await dynamodbAdapter.linkAccount!(account);

    userId = user.id;
    created = true;
  }

  // Idempotent — creates the RunUser (+ QR hash) only if it doesn't exist yet.
  await upsertRunUser(userId);

  return { userId, created };
}
