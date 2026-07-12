import { NextRequest } from "next/server";
import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin, type SessionLike } from "@/lib/admin-gate";
import { AuthProfile, getAuthProfile } from "@/entities/auth-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

async function gateOk(session: SessionLike): Promise<boolean> {
  const gate = requireAdmin(session);
  if (!gate.ok) return false;
  return revalidateAdmin(session?.user?.id);
}

/**
 * Jail/release a run.auth identity from the admin console. SESSION-gated, mirroring
 * the sibling lock route. Jail dials up Altcha friction at login (see altcha-gate).
 * Bumps sessionVersion for parity with lock (kicks consuming-service sessions); note
 * that a warm oidc _session can still silent-SSO past the gate until it lapses.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  if (!(await gateOk(session))) return NOT_FOUND();

  const { userId } = await params;

  const body = await req.json().catch(() => null);
  const jailed = body?.jailed;
  const level = body?.level;
  const reason = body?.reason;
  if (typeof jailed !== "boolean") return new Response(null, { status: 400 });
  if (jailed && (typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > 5)) {
    return new Response(null, { status: 400 });
  }
  if (reason !== undefined && (typeof reason !== "string" || reason.length > 280)) {
    return new Response(null, { status: 400 });
  }

  const profile = await getAuthProfile(userId);
  if (!profile) return NOT_FOUND();
  const nextVersion = (profile.sessionVersion ?? 1) + 1;

  if (jailed) {
    await AuthProfile.update({ userId })
      .set({
        jailed: true,
        jailLevel: level,
        jailReason: reason || "Jailed by admin console",
        jailedAt: Date.now(),
        sessionVersion: nextVersion,
      })
      .go();
  } else {
    await AuthProfile.update({ userId })
      .set({ jailed: false, sessionVersion: nextVersion })
      .remove(["jailLevel", "jailReason", "jailedAt"])
      .go();
  }

  return Response.json({
    ok: true,
    jailed,
    jailLevel: jailed ? level : undefined,
    sessionVersion: nextVersion,
  });
}
