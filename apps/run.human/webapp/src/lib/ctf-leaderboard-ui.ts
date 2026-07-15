/**
 * CTF leaderboard — client-safe pure helpers + shared row shape.
 *
 * CLIENT-SAFE: this module has NO entity/AWS-SDK imports, so it can be imported
 * from both the server page (`ctf-leaderboard.ts` re-exports the row type) and
 * the "use client" `CtfStandings` table. Mirrors the split the global board uses
 * (`leaderboard-data.ts` pure ↔ `leaderboard-ui.ts`). Keep it side-effect-free.
 */

/**
 * One enriched standings row. `ctfScore`/`ctfSolves` come from the RunUser
 * rollup; `firstBloods`/`qr`/`covert` are joined in from the aggregated
 * CtfSolve rows (0 when a runner has no solve rows in that bucket).
 */
export type EnrichedRow = {
  userId: string;
  displayName: string;
  ctfScore: number;
  ctfSolves: number;
  firstBloods: number;
  qr: number;
  covert: number;
};

/** The four sortable standings columns (all but `name` default to descending). */
export type SortKey = "score" | "solves" | "first" | "name";

/**
 * PURE. True when `displayName` is a real, user-set name — i.e. non-blank and
 * NOT the auto-generated `rabbit_…` default (any case). Ported verbatim from the
 * global board's `hasCustomName` (leaderboard-data.ts) so both boards agree on
 * what "named" means.
 */
export function hasCustomName(displayName?: string): boolean {
  const name = displayName?.trim() ?? "";
  return name.length > 0 && !name.toLowerCase().startsWith("rabbit_");
}

/**
 * PURE. Short, monospace-friendly id for an unnamed runner (first 8 chars +
 * ellipsis when longer). Admins still need to tell two nameless runners apart,
 * so we truncate rather than hide.
 */
export function shortId(userId: string): string {
  return userId.length > 8 ? `${userId.slice(0, 8)}…` : userId;
}

/**
 * PURE. The label to render for a row, plus whether it should read as muted
 * (unnamed / default). Named → the name; otherwise the short id, muted.
 */
export function rowLabel(row: { displayName: string; userId: string }): {
  text: string;
  muted: boolean;
} {
  return hasCustomName(row.displayName)
    ? { text: row.displayName, muted: false }
    : { text: shortId(row.userId), muted: true };
}

/**
 * PURE, non-mutating. Filter standings by an optional case-insensitive name/id
 * substring and an optional named-only flag. Both compose with AND. `q` matches
 * either the displayName OR the userId so an admin can search by either.
 */
export function filterStandings(
  rows: EnrichedRow[],
  opts: { q?: string; namedOnly?: boolean } = {}
): EnrichedRow[] {
  const q = opts.q?.trim().toLowerCase() ?? "";
  return rows.filter((r) => {
    if (opts.namedOnly && !hasCustomName(r.displayName)) return false;
    if (
      q &&
      !r.displayName.toLowerCase().includes(q) &&
      !r.userId.toLowerCase().includes(q)
    )
      return false;
    return true;
  });
}

/**
 * PURE, non-mutating. Sort standings by the chosen column. Numeric columns sort
 * descending (leaders first); `name` sorts A→Z by the rendered label
 * (case-insensitive) with named runners always above unnamed ones. Stable via a
 * userId tiebreak so equal rows keep a deterministic order.
 */
export function sortStandings(rows: EnrichedRow[], key: SortKey): EnrichedRow[] {
  const byId = (a: EnrichedRow, b: EnrichedRow) => a.userId.localeCompare(b.userId);
  const copy = [...rows];
  switch (key) {
    case "solves":
      return copy.sort((a, b) => b.ctfSolves - a.ctfSolves || byId(a, b));
    case "first":
      return copy.sort((a, b) => b.firstBloods - a.firstBloods || byId(a, b));
    case "name":
      return copy.sort((a, b) => {
        const an = hasCustomName(a.displayName) ? 0 : 1;
        const bn = hasCustomName(b.displayName) ? 0 : 1;
        if (an !== bn) return an - bn; // named block first
        return (
          rowLabel(a).text.toLowerCase().localeCompare(rowLabel(b).text.toLowerCase()) ||
          byId(a, b)
        );
      });
    case "score":
    default:
      return copy.sort((a, b) => b.ctfScore - a.ctfScore || byId(a, b));
  }
}
