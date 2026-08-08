import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { isGpxAdmin } from "@/lib/gpx-admin";
import { AUTO_CON_DAYS, CON_TZ_OFFSET_HOURS } from "@/lib/con-days";
import { backfillConDayTags } from "@/lib/strava-sync";

/**
 * POST /api/gpx/admin/con-day-backfill — recover `conDay` on Strava rows the
 * unattended sweep imported UNTAGGED. Non-admins get 404 (non-disclosure),
 * matching the sibling admin surfaces.
 *
 * WHY A ONE-OFF ENDPOINT RATHER THAN A SCRIPT: the work needs run.auth's
 * internal token endpoint, the ElectroDB entity layer, AND the pure tag rule.
 * All three already exist inside the app; a standalone script would have to
 * re-plumb the internal secret and re-implement the decision, which is exactly
 * how a backfill ends up disagreeing with live behaviour.
 *
 * ── Guard rails ─────────────────────────────────────────────────────────────
 * DRY RUN BY DEFAULT. `{"confirm": true}` in the body is what writes. The dry
 * pass makes the same Strava calls and reports the identical tally, so the
 * numbers can be checked before anything is touched.
 *
 * `since` (epoch-ms, default the FIRST auto-tag day, con-local) bounds the scan.
 * An activity that HAPPENED on an auto-tag day cannot have been imported before
 * it, so earlier rows are excluded with no API call — on the 2026-08-07 backlog
 * that ruled out 188 of 240 rows for free.
 *
 * IT IS DERIVED FROM `AUTO_CON_DAYS`, NOT TYPED IN. It was hard-coded to Aug 6
 * while that list started at Aug 6; widening the list to the whole con window
 * (Kurt, 2026-08-08) without moving this would have left the newly-taggable
 * Aug 5 rows permanently outside the scan — the backfill would report a clean
 * zero while the runs it exists to recover sat just past the bound.
 *
 * Idempotent: only rows with no `conDay` are considered, so re-running after a
 * write finds nothing left to do.
 *
 * maxDuration extended: one Strava round-trip per candidate row, sequential to
 * stay friendly to the rate limit (~52 calls on the first real pass).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Midnight con-local (PDT, UTC-7) on the first auto-tag day. Derived so the
 * bound can never lag the list — see the `since` note in the header.
 */
const DEFAULT_SINCE = Date.parse(
  `${[...AUTO_CON_DAYS].sort()[0]}T${String(-CON_TZ_OFFSET_HOURS).padStart(2, "0")}:00:00Z`
);

export async function POST(request: Request) {
  const session = await auth();
  // Same cast idiom as the sibling admin routes — `services` rides on the
  // session but is not on next-auth's User type.
  const services = (session?.user as { services?: string[] } | undefined)?.services ?? [];
  if (!session?.user?.id || !isGpxAdmin(services)) {
    return new NextResponse(null, { status: 404 });
  }

  let body: { confirm?: boolean; since?: number; limit?: number } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // No body is fine — it just means a dry run with the defaults.
  }

  const result = await backfillConDayTags({
    dryRun: body.confirm !== true,
    since: typeof body.since === "number" ? body.since : DEFAULT_SINCE,
    ...(typeof body.limit === "number" ? { limit: body.limit } : {}),
  });

  return NextResponse.json(result);
}
