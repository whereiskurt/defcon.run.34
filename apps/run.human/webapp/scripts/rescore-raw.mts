/**
 * rescore-raw.mts — raw-SDK mirror of `src/lib/rescore.ts:rescoreUser`, for the
 * standalone operator reset scripts.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The points-consistency migration (2026-07-30) made `rescoreUser` the SOLE
 * writer of RunUser score fields, and froze the legacy `activityScore` /
 * `ctfScore` attributes at 0 (nothing writes them; scoring-write-invariant
 * enforces it). The reset scripts predate that and only zeroed `ctfScore`, so
 * after they ran the player KEPT every point — the derived `score` /
 * `scoreBreakdown` were left untouched. The reset was cosmetic.
 *
 * The scripts cannot import `rescoreUser` itself: it pulls in the ElectroDB
 * entities, which import the ESM-only @auth/dynamodb-adapter that a standalone
 * `tsx` run cannot require. But `src/lib/scoring-engine` is PURE (its whole
 * transitive set — ctf-scoring, con-days, cluster-config — imports nothing), so
 * we re-read the REMAINING ledger with the raw client and value it with the
 * REAL engine. No formula is duplicated here; a scoring change stays in one place.
 *
 * ── WHY NOT JUST WRITE ZEROS ────────────────────────────────────────────────
 * `reset-all-scores.mts` may hand-write a zeroed score because it wipes the
 * ENTIRE ledger for EVERY user. These scripts wipe ONE slice of ONE user, so a
 * blanket zero would silently strip that runner's legitimate run streak and
 * cluster bonus. We recompute from what SURVIVES instead.
 */
import type { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import {
  computeUserScore,
  type EngineCtfConfig,
  type UserScore,
} from "../src/lib/scoring-engine";
import { DEFAULT_CLUSTER_CONFIG } from "../src/lib/cluster-config";

type Row = Record<string, any>;

async function scanAll(
  doc: DynamoDBDocument,
  table: string,
  params: Record<string, unknown>
): Promise<Row[]> {
  const items: Row[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await doc.scan({ TableName: table, ExclusiveStartKey, ...params });
    items.push(...((r.Items as Row[]) || []));
    ExclusiveStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return items;
}

/** Rows of one entity belonging to one user. `user` is a DDB reserved word. */
function byUser(entity: string, userId: string, userAttr: "userId" | "user") {
  return userAttr === "user"
    ? {
        FilterExpression: "#e = :ent AND #u = :user",
        ExpressionAttributeNames: { "#e": "__edb_e__", "#u": "user" },
        ExpressionAttributeValues: { ":ent": entity, ":user": userId },
      }
    : {
        FilterExpression: "#e = :ent AND userId = :u",
        ExpressionAttributeNames: { "#e": "__edb_e__" },
        ExpressionAttributeValues: { ":ent": entity, ":u": userId },
      };
}

/**
 * Re-derive one user's score from whatever ledger rows REMAIN and (unless
 * dry-run) write the same field set `rescoreUser` writes. Returns the computed
 * score either way so a dry-run can print what it WOULD write.
 *
 * Mirrors rescoreUser's field list exactly: score, scoreBreakdown, streakDays,
 * ctfSolves, rescoredAt. It deliberately does NOT touch the frozen legacy
 * `ctfScore` — writing that back would resurrect a field the invariant test
 * forbids anything from accruing.
 */
export async function rescoreUserRaw(
  doc: DynamoDBDocument,
  table: string,
  userId: string,
  opts: { confirm: boolean }
): Promise<UserScore> {
  const [runUsers, accomplishments, solves, events, ctfRows, awards, cfgRows] =
    await Promise.all([
      scanAll(doc, table, byUser("RunUser", userId, "userId")),
      scanAll(doc, table, byUser("Accomplishment", userId, "userId")),
      scanAll(doc, table, byUser("CtfSolve", userId, "user")),
      scanAll(doc, table, byUser("CtfScoreEvent", userId, "user")),
      scanAll(doc, table, {
        FilterExpression: "#e = :ent",
        ExpressionAttributeNames: { "#e": "__edb_e__" },
        ExpressionAttributeValues: { ":ent": "Ctf" },
      }),
      scanAll(doc, table, byUser("ClusterAward", userId, "userId")),
      scanAll(doc, table, {
        FilterExpression: "#e = :ent",
        ExpressionAttributeNames: { "#e": "__edb_e__" },
        ExpressionAttributeValues: { ":ent": "ClusterConfig" },
      }),
    ]);

  const configs = new Map<string, EngineCtfConfig>(
    ctfRows.map((r) => [r.challenge as string, r as EngineCtfConfig])
  );

  const result = computeUserScore({
    accomplishments: accomplishments.map((a) => ({
      source: a.source,
      completedAt: a.completedAt,
    })),
    solves: solves.map((s) => ({
      challenge: s.challenge,
      ordinal: s.ordinal,
      solvedAt: s.solvedAt,
    })),
    events: events.map((e) => ({
      challenge: e.challenge,
      bucket: e.bucket,
      ordinal: e.ordinal,
      points: e.points,
      scoredAt: e.scoredAt,
    })),
    configs,
    clusterAwards: awards.map((a) => ({ points: a.points ?? 0, startAt: a.startAt })),
    clusterCap:
      (cfgRows[0]?.maxPerUserPerDay as number | undefined) ??
      DEFAULT_CLUSTER_CONFIG.maxPerUserPerDay,
  });

  if (!opts.confirm) return result;

  const ru = runUsers[0];
  if (!ru) throw new Error(`No RunUser row for ${userId} — refusing to write a score.`);

  await doc.update({
    TableName: table,
    Key: { pk: ru.pk, sk: ru.sk },
    UpdateExpression:
      "SET #score = :s, scoreBreakdown = :b, streakDays = :d, ctfSolves = :n, " +
      "rescoredAt = :r, updatedAt = :ua",
    ExpressionAttributeNames: { "#score": "score" },
    ExpressionAttributeValues: {
      ":s": result.score,
      ":b": result.breakdown,
      ":d": result.days,
      ":n": result.counts.solves,
      ":r": Date.now(),
      ":ua": Date.now(),
    },
  });

  return result;
}
