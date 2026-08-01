import {
  getAccomplishmentsByUser,
  type AccomplishmentItem,
} from "@/entities/accomplishment";
import { CtfSolve, CtfScoreEvent } from "@/entities/ctf";
import { getCheckInsByUser } from "@/entities/checkin";
import { listCtf } from "@/lib/qr-admin";
import {
  groupSocial,
  buildCtfLines,
  injectCheckinLocations,
} from "@/lib/leaderboard-drill";

/**
 * The per-runner drill assembly, lifted verbatim out of
 * `app/api/leaderboard/[userId]/accomplishments/route.ts` so BOTH drill
 * surfaces share one loader:
 *   - the admin board's lazy per-row expand (that route), and
 *   - `GET /api/leaderboard/me`, the self-scoped "Your standing" modal.
 *
 * Behaviour is unchanged by the move — this is an extraction, not a rewrite.
 * The value returned here is the UNMASKED payload; CTF masking is deliberately
 * NOT done here because it depends on the requesting viewer, not the (per-user,
 * viewer-agnostic) cached data. Callers mask AFTER the cache read.
 */

/**
 * PRIVACY HOOK (spec §9 — LOCKED "mark the hook point"). Today an identity
 * no-op: the full board is ADMIN-ONLY, so an admin sees every run, and the
 * self-scoped `/me` caller is by construction looking at their own runs.
 *
 * AT LAUNCH, when the FULL board's gate relaxes from admin-only to signed-in,
 * this is where the launch-time privacy filter slots in — it will drop OTHER
 * runners' `isPrivate` check-ins and any share-ineligible GPX so a signed-in
 * viewer only sees runs that runner has agreed to expose. Named + called
 * explicitly (not buried in a comment) so the seam is obvious and the debt is
 * not lost.
 */
function applyPrivacyFilter(items: AccomplishmentItem[]): AccomplishmentItem[] {
  // no-op passthrough for the admin-only surface — see block comment above.
  return items;
}

/**
 * Fan out the five reads (accomplishments, both CTF ledgers, the challenge
 * catalog, check-ins) and assemble the UNMASKED drill payload — the value
 * cached by `getCachedDrill`.
 */
export async function loadDrill(userId: string) {
  const [accomplishments, solvesResult, eventsResult, ctfRows, checkins] =
    await Promise.all([
      getAccomplishmentsByUser(userId),
      CtfSolve.query.byUser({ user: userId }).go({ pages: "all" }),
      CtfScoreEvent.query.byUser({ user: userId }).go({ pages: "all" }),
      listCtf(),
      // Location join for PUBLIC check-ins (pin-map thumbnails). 200 covers
      // any realistic per-runner check-in count; a miss just means no map.
      getCheckInsByUser(userId, 200),
    ]);

  const visible = applyPrivacyFilter(accomplishments);

  // Keep `metadata` whole so `metadata.polyline` survives for the Phase-52
  // PolylineRenderer (SC #4). Public check-ins gain a single-point polyline
  // (their averaged coordinates) via the join below; private ones never do —
  // viewer-independent, so the cached value stays shareable.
  const rows = injectCheckinLocations(
    visible.map((a) => ({
      type: a.type,
      source: a.source,
      name: a.name,
      description: a.description,
      completedAt: a.completedAt,
      year: a.year,
      metadata: a.metadata,
    })),
    checkins.data
  );

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

/** The assembled (unmasked) drill payload shape. */
export type DrillPayload = Awaited<ReturnType<typeof loadDrill>>;
