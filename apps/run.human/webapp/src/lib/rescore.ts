/**
 * rescoreUser — the ONLY code path that writes RunUser score fields
 * (enforced by scoring-write-invariant.test.ts). Loads the user's full
 * ledger, values it with the pure engine, writes the result in one patch.
 * Idempotent; last-write-wins (a concurrent rescore computes the same or
 * newer truth). SERVER-ONLY.
 */
import { RunUser } from "@/entities/run-user";
import { getAccomplishmentsByUser } from "@/entities/accomplishment";
import { CtfSolve, CtfScoreEvent } from "@/entities/ctf";
import { listCtf } from "@/lib/qr-admin";
import {
  computeUserScore,
  type EngineCtfConfig,
  type UserScore,
} from "./scoring-engine";

export async function rescoreUser(userId: string): Promise<UserScore> {
  const [accomplishments, solvesResult, eventsResult, ctfRows] =
    await Promise.all([
      getAccomplishmentsByUser(userId),
      CtfSolve.query.byUser({ user: userId }).go({ pages: "all" }),
      CtfScoreEvent.query.byUser({ user: userId }).go({ pages: "all" }),
      listCtf(),
    ]);

  const configs = new Map<string, EngineCtfConfig>(
    ctfRows.map((r) => [r.challenge, r as EngineCtfConfig]),
  );

  const result = computeUserScore({
    accomplishments: accomplishments.map((a) => ({
      source: a.source,
      completedAt: a.completedAt,
    })),
    solves: solvesResult.data.map((s) => ({
      challenge: s.challenge,
      ordinal: s.ordinal,
      solvedAt: s.solvedAt,
    })),
    events: eventsResult.data.map((e) => ({
      challenge: e.challenge,
      bucket: e.bucket,
      ordinal: (e as { ordinal?: number; points?: number }).ordinal,
      points: (e as { ordinal?: number; points?: number }).points,
      scoredAt: e.scoredAt,
    })),
    configs,
  });

  await RunUser.patch({ userId })
    .set({
      score: result.score,
      scoreBreakdown: result.breakdown,
      streakDays: result.days,
      activityCounts: {
        checkin: result.counts.checkin,
        gpx: result.counts.gpx,
        strava: result.counts.strava,
      },
      ctfSolves: result.counts.solves,
      ...(result.latestActivityAt !== undefined
        ? { latestActivityAt: result.latestActivityAt }
        : {}),
      rescoredAt: Date.now(),
    })
    .go();

  return result;
}

/** Fire-and-forget wrapper: a scoring hiccup must never fail the user action. */
export async function rescoreBestEffort(userId: string): Promise<void> {
  try {
    await rescoreUser(userId);
  } catch (err) {
    console.error(`[rescore] failed for ${userId}`, err);
  }
}
