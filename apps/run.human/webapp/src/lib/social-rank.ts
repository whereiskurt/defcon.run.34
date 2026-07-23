import { SocialBoard } from "@/entities/social";

/**
 * Relative social rank: percentile bands over the socialScore distribution.
 *
 * The distribution lives as SocialBoard ADD-counter rows (one per score
 * value). Bands are RELATIVE — a runner's flair decays as the field
 * out-scans them. LEADER = holder(s) of the current max score.
 *
 * Everything here is best-effort: rank rendering must never block or break
 * the page, so reads fail to null and writes swallow errors loudly.
 */

export type BandTier =
  | "none" // socialScore 0
  | "entered" // scored, bottom half (or board unavailable)
  | "top50"
  | "top25"
  | "top10"
  | "top5"
  | "leader";

export type Band = {
  tier: BandTier;
  /** Human label, e.g. "TOP 10%" / "LEADER" / "ON THE BOARD" */
  label: string;
  /** Scored-user population the band was computed against (0 if unknown). */
  total: number;
};

export type BoardCounts = Map<number, number>; // score -> user count (clamped ≥0)

export function pairKey(a: string, b: string): string {
  return [a, b].sort().join("_");
}

const BOARD_ID = "social";
const PAD = 6;

export function scoreBucket(score: number): string {
  return `score_${String(score).padStart(PAD, "0")}`;
}

export function parseScoreBucket(bucket: string): number | null {
  const m = /^score_(\d+)$/.exec(bucket);
  return m ? Number(m[1]) : null;
}

const TIER_LABEL: Record<BandTier, string> = {
  none: "UNRANKED",
  entered: "ON THE BOARD",
  top50: "TOP 50%",
  top25: "TOP 25%",
  top10: "TOP 10%",
  top5: "TOP 5%",
  leader: "LEADER",
};

/** Pure band math over a score distribution. */
export function computeBand(score: number, counts: BoardCounts | null): Band {
  if (score <= 0) return { tier: "none", label: TIER_LABEL.none, total: 0 };
  if (!counts || counts.size === 0) {
    return { tier: "entered", label: TIER_LABEL.entered, total: 0 };
  }

  let total = 0;
  let above = 0;
  let max = 0;
  for (const [s, c] of counts) {
    if (s <= 0 || c <= 0) continue;
    total += c;
    if (s > score) above += c;
    if (s > max) max = s;
  }
  if (total === 0) return { tier: "entered", label: TIER_LABEL.entered, total: 0 };

  if (score >= max) return { tier: "leader", label: TIER_LABEL.leader, total };
  const fracAbove = above / total;
  const tier: BandTier =
    fracAbove < 0.05
      ? "top5"
      : fracAbove < 0.1
        ? "top10"
        : fracAbove < 0.25
          ? "top25"
          : fracAbove < 0.5
            ? "top50"
            : "entered";
  return { tier, label: TIER_LABEL[tier], total };
}

/**
 * Record a user's score moving old→new: decrement the old bucket (when they
 * were already on the board), increment the new one. ADD semantics upsert
 * missing rows. Best-effort — logs and swallows failures.
 */
export async function applyScoreDelta(
  oldScore: number,
  newScore: number
): Promise<void> {
  try {
    const ops: Promise<unknown>[] = [
      SocialBoard.update({ boardId: BOARD_ID, bucket: scoreBucket(newScore) })
        .add({ count: 1 })
        .go(),
    ];
    if (oldScore > 0) {
      ops.push(
        SocialBoard.update({ boardId: BOARD_ID, bucket: scoreBucket(oldScore) })
          .add({ count: -1 })
          .go()
      );
    }
    await Promise.all(ops);
  } catch (err) {
    console.error("[social-rank] applyScoreDelta failed", err);
  }
}

/** Load the full distribution (paged). Fail-null. */
export async function loadBoardCounts(): Promise<BoardCounts | null> {
  try {
    const counts: BoardCounts = new Map();
    let cursor: string | undefined;
    do {
      const page: {
        data: Array<{ bucket: string; count?: number }>;
        cursor?: string | null;
      } = await SocialBoard.query
        .primary({ boardId: BOARD_ID })
        .go({ cursor, pages: 1 });
      for (const row of page.data) {
        const score = parseScoreBucket(row.bucket);
        if (score === null) continue;
        counts.set(score, Math.max(0, row.count ?? 0));
      }
      cursor = page.cursor ?? undefined;
    } while (cursor);
    return counts;
  } catch (err) {
    console.error("[social-rank] loadBoardCounts failed", err);
    return null;
  }
}

let boardCache: { at: number; counts: BoardCounts | null } | null = null;
const BOARD_CACHE_MS = 60_000;

export async function getBoardCached(): Promise<BoardCounts | null> {
  const now = Date.now();
  if (boardCache && now - boardCache.at < BOARD_CACHE_MS) {
    return boardCache.counts;
  }
  const counts = await loadBoardCounts();
  boardCache = { at: now, counts };
  return counts;
}

/** Test seam. */
export function __resetBoardCache(): void {
  boardCache = null;
}
