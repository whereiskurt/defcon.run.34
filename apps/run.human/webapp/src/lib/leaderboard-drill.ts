/**
 * Pure assembly for the leaderboard's per-user drill (Task 5): rolls a
 * runner's social-scan ledger into per-day lines and their CTF ledger
 * (CtfSolve ∪ CtfScoreEvent) into named, sorted lines, with a masking pass
 * for covert flags viewed by anyone but the owner/an admin.
 *
 * No I/O here — the route (accomplishments/route.ts) owns the entity reads
 * and the `getCachedDrill` wiring; this module only shapes already-fetched
 * rows so it stays trivially unit-testable.
 */

export type SocialDayLine = { day: string; count: number; points: number };

export type CtfLine = {
  challenge: string;
  name: string;
  points: number;
  channel?: "qr" | "covert";
  at?: string;
};

type SocialEventLike = {
  challenge: string;
  bucket: string;
  points?: number;
  scoredAt?: string;
};

/**
 * Split a runner's CtfScoreEvent rows into social-scan day rollups + the
 * jack-egg one-off. `social-scan` buckets are `"<day>#<pairKey>"` — grouping
 * key is the day half (`bucket.split("#")[0]`); count/points are summed per
 * day. `jack-egg` buckets are the sentinel `"once"` (at most one row per
 * user) and surface as a standalone `egg` line rather than a day. Days sort
 * descending (most recent first). Any other challenge is ignored — this
 * function only ever sees the social ledger.
 */
export function groupSocial(events: SocialEventLike[]): {
  days: SocialDayLine[];
  egg: { points: number; at?: string } | null;
} {
  const byDay = new Map<string, { count: number; points: number }>();
  let egg: { points: number; at?: string } | null = null;

  for (const e of events) {
    if (e.challenge === "jack-egg") {
      egg = { points: e.points ?? 0, at: e.scoredAt };
      continue;
    }
    if (e.challenge !== "social-scan") continue;

    const day = e.bucket.split("#")[0];
    const cur = byDay.get(day) ?? { count: 0, points: 0 };
    cur.count += 1;
    cur.points += e.points ?? 0;
    byDay.set(day, cur);
  }

  const days = [...byDay.entries()]
    .map(([day, v]) => ({ day, count: v.count, points: v.points }))
    .sort((a, b) => b.day.localeCompare(a.day));

  return { days, egg };
}

type SolveLike = {
  challenge: string;
  points?: number;
  channel?: "qr" | "covert";
  solvedAt?: string;
};

type ScoreEventLike = {
  challenge: string;
  points?: number;
  channel?: "qr" | "covert";
  scoredAt?: string;
};

const SOCIAL_LEDGER_CHALLENGES = new Set(["social-scan", "jack-egg"]);

/**
 * Union a runner's CtfSolve rows with their CtfScoreEvent rows (the
 * repeatable-flag ledger; the social-scan/jack-egg rows sharing that ledger
 * are excluded here — `groupSocial` owns those) into one list of named,
 * time-sorted lines. `name` resolves via `names` (built by the caller from
 * `listCtf()`), falling back to the raw challenge slug when the challenge is
 * unknown (deleted/renamed). Sorted descending by `at` (solvedAt/scoredAt).
 */
export function buildCtfLines(
  solves: SolveLike[],
  events: ScoreEventLike[],
  names: Map<string, string>
): CtfLine[] {
  const fromSolves: CtfLine[] = solves.map((s) => ({
    challenge: s.challenge,
    name: names.get(s.challenge) ?? s.challenge,
    points: s.points ?? 0,
    channel: s.channel,
    at: s.solvedAt,
  }));

  const fromEvents: CtfLine[] = events
    .filter((e) => !SOCIAL_LEDGER_CHALLENGES.has(e.challenge))
    .map((e) => ({
      challenge: e.challenge,
      name: names.get(e.challenge) ?? e.challenge,
      points: e.points ?? 0,
      channel: e.channel,
      at: e.scoredAt,
    }));

  return [...fromSolves, ...fromEvents].sort((a, b) =>
    (b.at ?? "").localeCompare(a.at ?? "")
  );
}

/**
 * Mask a covert-channel line's `name` behind a generic "Covert flag" label
 * for anyone but the solve's own runner or an admin viewer. `qr`-channel
 * lines (and lines with no channel) are never masked. Non-mutating.
 */
export function maskCtfLines(
  lines: CtfLine[],
  viewer: { isOwner: boolean; isAdmin: boolean }
): CtfLine[] {
  if (viewer.isOwner || viewer.isAdmin) return lines;
  return lines.map((l) =>
    l.channel === "covert" ? { ...l, name: "Covert flag" } : l
  );
}

/** The narrow CheckIn-row shape `injectCheckinLocations` reads. */
export type CheckinLocationRow = {
  checkInId?: string;
  latitude?: number;
  longitude?: number;
  isPrivate?: boolean;
};

/** The narrow accomplishment-row shape `injectCheckinLocations` transforms.
 *  `polyline` items are loose (`lat?/lng?`) to match ElectroDB's inferred
 *  metadata type — this function only length-checks existing polylines. */
type LocatableRow = {
  source: string;
  metadata?: {
    checkInId?: string;
    polyline?: { lat?: number; lng?: number }[];
    [k: string]: unknown;
  };
};

/**
 * Give PUBLIC check-in accomplishments a single-point "polyline" (their
 * averaged coordinates) so the drill can render a pin-map thumbnail.
 *
 * Rules (all misses pass the row through untouched — never dropped):
 *  - only `source:"checkin"` rows are considered;
 *  - a row that already carries a polyline keeps it;
 *  - the joined CheckIn must exist, have finite lat/lng, and be NOT private —
 *    `isPrivate:true` check-ins never expose their location, for any viewer
 *    (viewer-independent by design: the result is cacheable in the shared
 *    per-user drill cache).
 * Non-mutating.
 */
export function injectCheckinLocations<T extends LocatableRow>(
  rows: T[],
  checkins: CheckinLocationRow[]
): T[] {
  const byId = new Map(
    checkins
      .filter((c): c is CheckinLocationRow & { checkInId: string } => !!c.checkInId)
      .map((c) => [c.checkInId, c])
  );
  return rows.map((row) => {
    if (row.source !== "checkin") return row;
    if (row.metadata?.polyline?.length) return row;
    const id = row.metadata?.checkInId;
    const c = id ? byId.get(id) : undefined;
    if (
      !c ||
      c.isPrivate === true ||
      !Number.isFinite(c.latitude) ||
      !Number.isFinite(c.longitude)
    ) {
      return row;
    }
    return {
      ...row,
      metadata: {
        ...row.metadata,
        polyline: [{ lat: c.latitude as number, lng: c.longitude as number }],
      },
    };
  });
}
