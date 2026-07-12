import { NextRequest } from "next/server";
import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin, type SessionLike } from "@/lib/admin-gate";
import { AuthProfile, getAuthProfile } from "@/entities/auth-profile";
import { deleteAccountRow } from "@/entities/admin-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });
const PROVIDER_MAPS = ["github", "discord", "strava"] as const;

async function gateOk(session: SessionLike): Promise<boolean> {
  const gate = requireAdmin(session);
  if (!gate.ok) return false;
  return revalidateAdmin(session?.user?.id);
}

/**
 * Unlink one OAuth provider from a run.auth identity: deletes the single
 * ACCOUNT# row and clears the matching denormalised AuthProfile provider map
 * (github/discord/strava only — linkedin/email have no map to clear).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  if (!(await gateOk(session))) return NOT_FOUND();

  const { userId } = await params;

  const body = await req.json().catch(() => null);
  const provider = body?.provider;
  const providerAccountId = body?.providerAccountId;
  if (
    typeof provider !== "string" ||
    !provider ||
    typeof providerAccountId !== "string" ||
    !providerAccountId
  ) {
    return new Response(null, { status: 400 });
  }

  const profile = await getAuthProfile(userId);
  if (!profile) return NOT_FOUND();

  await deleteAccountRow(userId, provider, providerAccountId);

  if ((PROVIDER_MAPS as readonly string[]).includes(provider)) {
    await AuthProfile.update({ userId }).remove([provider as (typeof PROVIDER_MAPS)[number]]).go();
  }

  return Response.json({ ok: true });
}
