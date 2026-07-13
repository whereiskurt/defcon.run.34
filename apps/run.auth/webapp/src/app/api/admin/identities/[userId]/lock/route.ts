import { NextRequest } from "next/server";
import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin, type SessionLike } from "@/lib/admin-gate";
import { AuthProfile, getAuthProfile } from "@/entities/auth-profile";
import { revokeOidcSessions } from "@/entities/admin-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

async function gateOk(session: SessionLike): Promise<boolean> {
  const gate = requireAdmin(session);
  if (!gate.ok) return false;
  return revalidateAdmin(session?.user?.id);
}

/**
 * Lock/unlock a run.auth identity from the admin console. SESSION-gated
 * (unlike the internal-secret `admin/user/[userId]/lock` route this mirrors).
 * Reuses the exact same lockout mechanics: bump sessionVersion, set/clear
 * lockedOut, and (on lock) actively delete the identity's live OIDC Session
 * rows so the IdP SSO sessions die immediately — bumping sessionVersion alone
 * does NOT evict a warm session (nothing re-checks it), so without this the
 * "revoked immediately" promise was false.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  if (!(await gateOk(session))) return NOT_FOUND();

  const { userId } = await params;

  const body = await req.json().catch(() => null);
  const locked = body?.locked;
  const reason = body?.reason;
  if (typeof locked !== "boolean") return new Response(null, { status: 400 });
  if (reason !== undefined && (typeof reason !== "string" || reason.length > 280)) {
    return new Response(null, { status: 400 });
  }

  const profile = await getAuthProfile(userId);
  if (!profile) return NOT_FOUND();
  const nextVersion = (profile.sessionVersion ?? 1) + 1;

  let revokedSessions = 0;
  if (locked) {
    await AuthProfile.update({ userId })
      .set({
        lockedOut: true,
        sessionVersion: nextVersion,
        lockoutReason: reason || "Locked by admin console",
        lockedAt: Date.now(),
      })
      .go();
    // Actually evict the live IdP SSO sessions (best-effort — a revoke failure
    // must not undo the lock the admin just applied).
    try {
      revokedSessions = await revokeOidcSessions(userId);
    } catch (err) {
      console.error("[admin] lock: revokeOidcSessions FAILED", { userId, err });
    }
  } else {
    await AuthProfile.update({ userId })
      .set({ lockedOut: false, sessionVersion: nextVersion })
      .remove(["lockoutReason", "lockedAt"])
      .go();
  }

  return Response.json({ ok: true, lockedOut: locked, sessionVersion: nextVersion, revokedSessions });
}
