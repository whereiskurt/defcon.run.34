import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { getAuthUserEmail } from "@/entities/auth-user";
import { getUserQuotas, type QuotaInfo } from "@/lib/quota-client";
import { getRunUser, updateRunUserProfile } from "@/entities/run-user";
import { validateRingtone } from "@/lib/ringtone";

/**
 * GET /api/admin/users/[userId] — per-user drill-in detail (Phase 43 UX rework).
 *
 * Powers the admin console's user drawer. The users LIST is delivered
 * masked-only (no full emails cross the wire in bulk); this endpoint returns the
 * PII + live quota breakdown for exactly ONE user, and only when an operator
 * actively drills into that row. So a full email reaches the browser one user at
 * a time, behind the same gate as the list — never the whole table at once.
 *
 * ── Gate (non-disclosure, same contract as the list route) ──────────────────
 * Every denial → a BARE 404, never a 403/body. Three denial paths collapse to
 * 404: requireAdmin fails, missing session.user.authUserId, or revalidateAdmin
 * (LIVE fresh-claims, keyed by the OIDC sub — NOT the adapter id) fails.
 *
 * A quota-service outage does NOT fail the drawer: quotas degrade to [] so the
 * email + identity still render.
 *
 * Node runtime (AWS-SDK signing); force-dynamic (always live, never cached).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

/** Compact per-quota row for the drawer: used / limit derived client-side. */
type QuotaDetail = {
  quotaId: string;
  remaining: number;
  initialAmount: number;
  totalConsumed: number;
  consumptionCount: number;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
): Promise<Response> {
  // ── Gate (fail-closed; every denial → 404) ────────────────────────────────
  const session = await auth();
  if (!requireAdmin(session).ok) return NOT_FOUND();
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateAdmin(authUserId))) return NOT_FOUND();

  const { userId } = await params;
  if (!userId) return NOT_FOUND();

  // Full email (PII) for this one user; null if the authjs record is missing.
  const email = await getAuthUserEmail(userId);

  // Runner profile bits the drawer needs (ringtone editor prefill + class).
  const runUser = await getRunUser(userId);

  // Live quota breakdown. getUserQuotas THROWS by design on a service error —
  // catch so the drawer still shows identity/email when quotas are unavailable.
  let quotas: QuotaDetail[] = [];
  let quotaTier: string | null = null;
  try {
    const res = await getUserQuotas(userId);
    quotaTier = res.quotaTier;
    quotas = res.quotas.map((q: QuotaInfo) => ({
      quotaId: q.quotaId,
      remaining: q.remaining,
      initialAmount: q.initialAmount,
      totalConsumed: q.totalConsumed,
      consumptionCount: q.consumptionCount,
    }));
  } catch (error) {
    console.error(`[admin] getUserQuotas(${userId}) failed:`, error);
  }

  return Response.json(
    {
      userId,
      email,
      quotaTier,
      quotas,
      ringtone: runUser?.ringtone ?? null,
      mqttUsertype: runUser?.mqttUsertype ?? null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * PATCH /api/admin/users/[userId] — set or clear a runner's ringtone (RTTTL).
 *
 * Same non-disclosure gate as GET: every denial → bare 404. `revalidateAdmin`
 * (LIVE claims) denies a just-revoked admin inside the JWT staleness window.
 * Body: { ringtone: string | null } — null/empty clears (reverts to class
 * default). Invalid RTTTL → 400. On success → { ok: true, ringtone }.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
): Promise<Response> {
  const session = await auth();
  if (!requireAdmin(session).ok) return NOT_FOUND();
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateAdmin(authUserId))) return NOT_FOUND();

  const { userId } = await params;
  if (!userId) return NOT_FOUND();

  let body: { ringtone?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const raw = body.ringtone == null ? null : String(body.ringtone);
  const v = validateRingtone(raw);
  if (!v.ok) {
    return Response.json({ ok: false, error: v.reason }, { status: 400 });
  }

  // validateRingtone returns null for a clear; ElectroDB `.set` rejects null on
  // a string attr, so persist "" — the flasher treats empty as "class default".
  await updateRunUserProfile(userId, { ringtone: v.value ?? "" });
  return Response.json(
    { ok: true, ringtone: v.value },
    { headers: { "Cache-Control": "no-store" } }
  );
}
