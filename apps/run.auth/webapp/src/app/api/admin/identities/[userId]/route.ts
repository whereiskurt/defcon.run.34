import { NextRequest } from "next/server";
import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin, type SessionLike } from "@/lib/admin-gate";
import { getAuthProfile } from "@/entities/auth-profile";
import { getAccountsForUser, getOidcSessionsForUser, deleteIdentity } from "@/entities/admin-identity";
import { resolveRunHuman } from "@/lib/runhuman-resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

async function gateOk(session: SessionLike): Promise<boolean> {
  const gate = requireAdmin(session);
  if (!gate.ok) return false;
  return revalidateAdmin(session?.user?.id);
}

/**
 * Per-identity drawer detail. Admin-only reveal: returns the FULL email
 * (unmasked, unlike the list route), all linked ACCOUNT# rows, live OIDC
 * Session rows, and a fail-soft resolve against run.human.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  if (!(await gateOk(session))) return NOT_FOUND();
  const { userId } = await params;

  const profile = await getAuthProfile(userId);
  if (!profile) return NOT_FOUND();

  const [accounts, oidcSessions, runHuman] = await Promise.all([
    getAccountsForUser(userId),
    getOidcSessionsForUser(userId),
    resolveRunHuman(userId),
  ]);

  return Response.json(
    {
      identity: {
        userId,
        displayName: profile.displayName ?? "",
        email: profile.email ?? null, // FULL email — reveal route, admin-only
        services: profile.services ?? [],
        lastProvider: profile.lastProvider ?? null,
        createdAt: profile.createdAt ?? null,
        lockedOut: profile.lockedOut ?? false,
        lockoutReason: profile.lockoutReason ?? null,
        lockedAt: profile.lockedAt ?? null,
        sessionVersion: profile.sessionVersion ?? 1,
      },
      accounts,
      oidcSessions,
      runHuman,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * Hard delete within run.auth ONLY (AuthProfile + ACCOUNT# rows + USER# row +
 * live OIDC Session rows for this sub). Does NOT cascade to run.human/bib —
 * that is a separate, not-yet-built phase.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  if (!(await gateOk(session))) return NOT_FOUND();
  const { userId } = await params;

  const profile = await getAuthProfile(userId);
  if (!profile) return NOT_FOUND();

  const result = await deleteIdentity(userId);
  return Response.json({ ok: true, ...result });
}
