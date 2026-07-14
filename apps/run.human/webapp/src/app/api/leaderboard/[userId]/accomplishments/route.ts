import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import {
  getAccomplishmentsByUser,
  type AccomplishmentItem,
} from "@/entities/accomplishment";

/**
 * GET /api/leaderboard/[userId]/accomplishments — the (hidden) leaderboard's
 * lazy per-runner drill-down (LDBR-08). The Phase-52 accordion expands one row
 * and fetches this to render that runner's runs (incl. route polylines).
 *
 * A thin shell over already-shipped code: the exact admin gate from
 * `app/api/admin/users/route.ts` and the Phase-49 `getAccomplishmentsByUser`
 * reader. The only real contract here is the 404 non-disclosure + fresh-claims
 * gate and the named privacy seam.
 *
 * ── Gate (T-51-03 / T-51-04, non-disclosure) ────────────────────────────────
 * Every denial returns a BARE 404 `Response` — never a 403/401, never a body
 * that advertises the route. Three denial paths all collapse to 404:
 *   1. requireAdmin fails (no session / not an admin group),
 *   2. session.user.authUserId (the OIDC sub) is missing,
 *   3. revalidateAdmin(authUserId) fails the live fresh-claims check.
 *
 * IDENTIFIER LANDMINE (Phase 43): revalidateAdmin MUST be called with
 * `session.user.authUserId` (the auth.defcon.run OIDC sub) — NOT
 * `session.user.id`, the Auth.js DynamoDB-adapter local uuid. The run.auth
 * validate endpoint is keyed by the OIDC sub; the adapter id silently fails the
 * claims lookup and 404s a real admin.
 *
 * Node runtime — the ElectroDB/AWS-SDK query pipeline needs Node crypto for
 * request signing. Force-dynamic — always a live read, never cached.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

/**
 * PRIVACY HOOK (spec §9 — LOCKED "mark the hook point"). Today an identity
 * no-op: the leaderboard is ADMIN-ONLY, so an admin sees every run.
 *
 * AT LAUNCH, when the gate relaxes from admin-only to signed-in, this is where
 * the launch-time privacy filter slots in — it will drop OTHER runners'
 * `isPrivate` check-ins and any share-ineligible GPX so a signed-in viewer only
 * sees runs that runner has agreed to expose. Named + called explicitly (not
 * buried in a comment) so the seam is obvious and the debt is not lost.
 */
function applyPrivacyFilter(
  items: AccomplishmentItem[]
): AccomplishmentItem[] {
  // no-op passthrough for the admin-only surface — see block comment above.
  return items;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  // ── Gate ──────────────────────────────────────────────────────────────────
  const session = await auth();
  const gate = requireAdmin(session);
  if (!gate.ok) return NOT_FOUND();

  // Fresh-claims revalidation keyed by the OIDC sub (NOT the adapter id).
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateAdmin(authUserId))) return NOT_FOUND();

  // ── Read → (privacy seam) → shape ──────────────────────────────────────────
  const { userId } = await params;
  const accomplishments = await getAccomplishmentsByUser(userId);
  const visible = applyPrivacyFilter(accomplishments);

  // Keep `metadata` whole so `metadata.polyline` survives for the Phase-52
  // PolylineRenderer (SC #4).
  const rows = visible.map((a) => ({
    type: a.type,
    source: a.source,
    name: a.name,
    description: a.description,
    completedAt: a.completedAt,
    year: a.year,
    metadata: a.metadata,
  }));

  return Response.json(
    { accomplishments: rows },
    { headers: { "Cache-Control": "no-store" } }
  );
}
