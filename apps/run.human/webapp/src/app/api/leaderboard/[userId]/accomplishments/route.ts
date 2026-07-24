import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import {
  getAccomplishmentsByUser,
  type AccomplishmentItem,
} from "@/entities/accomplishment";
import { CtfSolve, CtfScoreEvent } from "@/entities/ctf";
import { listCtf } from "@/lib/qr-admin";
import { getCachedDrill } from "@/lib/leaderboard-drill-cache";
import { groupSocial, buildCtfLines, maskCtfLines } from "@/lib/leaderboard-drill";

/**
 * GET /api/leaderboard/[userId]/accomplishments — the (hidden) leaderboard's
 * lazy per-runner drill-down (LDBR-08). The Phase-52 accordion expands one row
 * and fetches this to render that runner's runs (incl. route polylines), plus
 * (Task 5) a social-scan day rollup and named CTF capture lines.
 *
 * A thin shell over already-shipped code: the exact admin gate from
 * `app/api/admin/users/route.ts`, the Phase-49 `getAccomplishmentsByUser`
 * reader, and the Task-3/4/5 drill assembly. The only real contract here is
 * the 404 non-disclosure + fresh-claims gate and the named privacy seams
 * (accomplishment privacy filter + covert-flag CTF masking).
 *
 * The whole assembled payload (accomplishments + social + ctf, UNMASKED) is
 * cached per-user via `getCachedDrill` (Task 3) — the reconcile route busts a
 * user's entry when their accomplishments change. CTF masking runs AFTER the
 * cache read, keyed to the REQUESTING viewer, never baked into the cached
 * value (a cache hit must not leak one viewer's unmask into another's).
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
 * request signing. Force-dynamic — the gate + params are per-request. HTTP
 * `Cache-Control: private, max-age=60` (Task 5) mirrors the in-memory
 * per-user drill cache's 60s TTL; freshness beyond a stale entry is owned by
 * `bustDrillCache` (the reconcile route), not the CDN — `private` because the
 * payload is per-runner and admin-only.
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

/**
 * Fan out the four reads (accomplishments, both CTF ledgers, the challenge
 * catalog) and assemble the UNMASKED drill payload — the value cached by
 * `getCachedDrill`. CTF masking is deliberately NOT done here; it depends on
 * the requesting viewer, not the (per-user, viewer-agnostic) cached data.
 */
async function loadDrill(userId: string) {
  const [accomplishments, solvesResult, eventsResult, ctfRows] =
    await Promise.all([
      getAccomplishmentsByUser(userId),
      CtfSolve.query.byUser({ user: userId }).go({ pages: "all" }),
      CtfScoreEvent.query.byUser({ user: userId }).go({ pages: "all" }),
      listCtf(),
    ]);

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

  // The Ctf entity has no separate display-name attribute — `challenge` IS
  // the human-facing name (see CtfForm.tsx "Challenge name" field, which
  // writes this same slug). The map still exists as the named seam
  // `buildCtfLines` expects, so a future name attribute needs no call-site
  // change: unknown/deleted challenges fall back to the raw slug either way.
  const names = new Map(ctfRows.map((c) => [c.challenge, c.challenge]));

  return {
    accomplishments: rows,
    social: groupSocial(eventsResult.data),
    ctf: buildCtfLines(solvesResult.data, eventsResult.data, names),
  };
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

  // ── Cached read → viewer-scoped CTF masking ────────────────────────────────
  const { userId } = await params;
  const data = await getCachedDrill(userId, () => loadDrill(userId));

  // The route is admin-gated today, so isAdmin is always true here — but we
  // still route through maskCtfLines (rather than skip it) so a future
  // launch-time gate relax to signed-in-viewer can't silently forget the
  // covert-flag mask.
  const isOwner = session?.user?.id === userId;
  const masked = {
    ...data,
    ctf: maskCtfLines(data.ctf, { isOwner, isAdmin: true }),
  };

  return Response.json(masked, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
