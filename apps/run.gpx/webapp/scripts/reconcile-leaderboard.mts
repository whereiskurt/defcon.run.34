/**
 * reconcile-leaderboard.mts (Task 10, leaderboard<->runs sync) — one-off,
 * idempotent, re-runnable OFFLINE sweep that reconciles EVERY run.human user's
 * gpx/strava leaderboard Accomplishment rows directly against DynamoDB.
 *
 * WHY this exists: `src/lib/gpx-reconcile.ts`'s `reconcileBestEffort` already
 * fires on every gpx mutation (confirm/delete/retag/import) and keeps a user's
 * rows converged AT THAT MOMENT. But it is event-driven — a runner who never
 * touches run.gpx again after a missed/failed push (network blip, deploy race,
 * a reconcile call that 500'd) has permanently stale rows no live event will
 * ever fix. This script is the offline backstop: it scans every GpxFile +
 * Accomplishment + ACCOUNT# row directly and converges the same way, for
 * EVERY user, once, from an operator's terminal.
 *
 * ── WHY the raw @aws-sdk clients and NOT the ElectroDB entities ─────────────
 * Same rationale as every prior run.human offline script (seed-ctf-otp.mts,
 * reset-ctf-user.mts, backfill-mesh-radios.mts): `entities/client.ts` imports
 * the ESM-only `@auth/dynamodb-adapter`, which a bare `tsx` CJS run cannot
 * `require()`. So Accomplishment/RunUser/authjs rows are read and written via
 * raw `DynamoDBDocument` calls, hand-composing the ElectroDB v3 key templates
 * (verified empirically against the live entities — see Task 10 report):
 *   RunUser        pk=$run#userid_<userId>            sk=$runuser_1
 *   Accomplishment pk=$run#userid_<userId>            sk=$accomplishment_1#accomplishmentid_<id>
 *                  gsi1pk=<pk>#type_activity           gsi1sk=$accomplishment_1#completedat_<n>
 *                  gsi2pk=<pk>#year_<year>             gsi2sk=$accomplishment_1#completedat_<n>
 * ElectroDB lowercases every composite KEY VALUE (not the stored attribute) —
 * replicated here via `.toLowerCase()` in the key builders below.
 * `parseTrack`/`decimatePolyline` ARE imported (relative path, this app) —
 * they are pure, single-file, entity-free helpers (LDBR-05), safe to reuse.
 *
 * ── What it does, per user ──────────────────────────────────────────────────
 * The "universe" is every OIDC sub that either (a) owns an active,
 * con-day-tagged GpxFile row, or (b) already owns a gpx/strava Accomplishment
 * row — so a user who deleted their last run (and now has ZERO live GpxFile
 * rows) still gets swept for orphaned Accomplishment rows. For each user:
 *   - diff existing gpx/strava Accomplishment rows against the live GpxFile
 *     run set (mirrors `diffAccomplishments` / `expectedAccomplishmentId` in
 *     src/lib/accomplishment-reconcile.ts, inline-copied here — pure, no I/O);
 *   - print `sub<8>… / <adapterId>: +N missing, -M orphans`;
 *   - with --apply: delete each orphan row + decrement the RunUser rollup
 *     (floor-at-0, read-modify-write, mirrors `updateRunUserActivityCounts` —
 *     but a decrement-only sweep never touches `latestActivityAt`, since there
 *     is no "latest activity" semantic for removing a stale row); create each
 *     missing row (S3 GetObject + parseTrack + decimatePolyline(pts,100) for
 *     the polyline; on ANY S3/parse failure, create the row WITHOUT a polyline
 *     rather than skip it, logging the failure) + increment the rollup,
 *     setting `latestActivityAt` to the accomplishment's `completedAt`.
 * A sub with no run.human ACCOUNT# mapping is reported + skipped (never
 * touched). Every write is get-first idempotent (mirrors
 * createAccomplishment/deleteAccomplishment) so a re-run is a safe no-op.
 *
 * SAFETY / hygiene:
 *   - DRY-RUN BY DEFAULT. Pass --apply to write. --help prints usage and
 *     exits 0 WITHOUT constructing any AWS client or touching the network.
 *   - NO hardcoded table-name/profile defaults — --gpx-table, --human-table,
 *     --auth-table, and (--profile-gpx + --profile-human, or a shared
 *     --profile) are ALL required, so a missing flag fails loud instead of
 *     silently resolving to the wrong account/table. --region defaults to
 *     us-east-1 (both accounts run there).
 *   - Standalone operator script: not imported by any app/request/build path.
 *
 * PROD RUN RECIPE (us-east-1, run AFTER the leaderboard<->runs sync deploy):
 *   cd apps/run.gpx/webapp
 *   # 1. dry-run — inspect the plan, writes nothing:
 *   npx tsx scripts/reconcile-leaderboard.mts \
 *     --gpx-table <run-gpx-electro table>   --human-table <run-human-electro table> \
 *     --auth-table <run-human-authjs table> --profile-gpx dc34-application --profile-human dc34-application
 *   # 2. commit the sweep (creates missing rows, removes orphans):
 *   npx tsx scripts/reconcile-leaderboard.mts ...same flags... --apply
 *   # 3. (optional) re-run --apply to prove idempotency — should report all 0/0.
 */
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

import { parseTrack, decimatePolyline } from "../src/lib/gpx-accomplishment";

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`reconcile-leaderboard.mts — one-off offline leaderboard<->runs sweep

Reconciles EVERY run.human user's gpx/strava Accomplishment rows directly
against DynamoDB GpxFile rows, for users the event-driven per-save reconcile
can never reach again. DRY-RUN by default; pass --apply to write.

Usage:
  npx tsx scripts/reconcile-leaderboard.mts [options]

Required:
  --gpx-table <name>       GpxFile DynamoDB table (run.gpx account)
  --human-table <name>     Accomplishment + RunUser DynamoDB table (run-human-electro)
  --auth-table <name>      Auth.js ACCOUNT# DynamoDB table (run-human-authjs)
  --profile-gpx <name>     AWS profile for the gpx-table account (or --profile)
  --profile-human <name>   AWS profile for the human/auth-table account (or --profile)
  --profile <name>         shared AWS profile for both sides (use instead of the two above)

Optional:
  --region <name>          AWS region for all three tables (default: us-east-1)
  --apply                  write changes (default: dry-run, prints the plan only)
  --only-sub <sub>         limit the sweep to a single OIDC sub (debugging)
  --help, -h               print this usage and exit 0 (touches no AWS)

Output: one line per user — "sub<8>… / <adapterId>: +N missing, -M orphans" —
then a global summary and the list of subs with no run.human account mapping.
`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const APPLY = process.argv.includes("--apply");
const GPX_TABLE = argValue("--gpx-table");
const HUMAN_TABLE = argValue("--human-table");
const AUTH_TABLE = argValue("--auth-table");
const PROFILE_SHARED = argValue("--profile");
const PROFILE_GPX = argValue("--profile-gpx") || PROFILE_SHARED;
const PROFILE_HUMAN = argValue("--profile-human") || PROFILE_SHARED;
const REGION = argValue("--region") || "us-east-1";
const ONLY_SUB = argValue("--only-sub");

const missing: string[] = [];
if (!GPX_TABLE) missing.push("--gpx-table");
if (!HUMAN_TABLE) missing.push("--human-table");
if (!AUTH_TABLE) missing.push("--auth-table");
if (!PROFILE_GPX) missing.push("--profile-gpx (or --profile)");
if (!PROFILE_HUMAN) missing.push("--profile-human (or --profile)");
if (missing.length) {
  console.error(`Missing required flag(s): ${missing.join(", ")}\n`);
  printHelp();
  process.exit(2);
}

const OIDC_PROVIDER = "run.defcon.run";
const ACCOUNT_SK_PREFIX = `ACCOUNT#${OIDC_PROVIDER}#`;

// ─────────────────────────────────────────────────────────────────────────────
// Pure diff logic — inline copy of src/lib/accomplishment-reconcile.ts
// (run.human), kept independent so this script stays entity-free (Task 10
// brief: hand-mirror, never import app entity modules across the two apps).
// ─────────────────────────────────────────────────────────────────────────────

type ReconcileRun = {
  gpxFileId: string;
  source: "gpx" | "strava";
  stravaActivityId?: string;
};

/** `strava#<id>` when a strava run carries an activity id, else `gpx#<gpxFileId>`. */
export function expectedAccomplishmentId(run: ReconcileRun): string {
  if (run.source === "strava" && run.stravaActivityId) {
    return `strava#${run.stravaActivityId}`;
  }
  return `gpx#${run.gpxFileId}`;
}

/** Same semantics as diffAccomplishments: checkin rows are NEVER orphaned. */
export function diffAccomplishments(
  existing: { accomplishmentId: string; source: string }[],
  runs: ReconcileRun[]
): { orphanIds: string[]; missingFileIds: string[] } {
  const expectedIds = new Set(runs.map(expectedAccomplishmentId));
  const existingIds = new Set(existing.map((row) => row.accomplishmentId));

  const orphanIds = existing
    .filter((row) => row.source === "gpx" || row.source === "strava")
    .filter((row) => !expectedIds.has(row.accomplishmentId))
    .map((row) => row.accomplishmentId);

  const missingFileIds = runs
    .filter((run) => !existingIds.has(expectedAccomplishmentId(run)))
    .map((run) => run.gpxFileId);

  return { orphanIds, missingFileIds };
}

/** Con-day-tagged runs carry no time-of-day — noon Pacific on that date is the
 * same synthetic completedAt gpx-reconcile.ts's live reconcile path produces. */
export function conDayCompletedAt(conDay: string): number {
  return Date.parse(`${conDay}T12:00:00-07:00`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure rollup math — mirrors run-user.ts's activityDelta + the floor-at-0
// clamp inside updateRunUserActivityCounts (LDBR-02), unit-testable without DDB.
// ─────────────────────────────────────────────────────────────────────────────

type ActivityCounts = { checkin: number; gpx: number; strava: number };

export function applyRollupDelta(
  current: { activityScore?: number; activityCounts?: Partial<ActivityCounts> } | null | undefined,
  source: "gpx" | "strava",
  pointsDelta: number,
  sign: 1 | -1
): { activityScore: number; activityCounts: ActivityCounts } {
  const currentScore = current?.activityScore ?? 0;
  const currentCounts = current?.activityCounts ?? {};
  const nextScore = Math.max(0, currentScore + sign * pointsDelta);
  const nextCount = Math.max(0, (currentCounts[source] ?? 0) + sign);
  return {
    activityScore: nextScore,
    activityCounts: {
      checkin: currentCounts.checkin ?? 0,
      gpx: currentCounts.gpx ?? 0,
      strava: currentCounts.strava ?? 0,
      [source]: nextCount,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ElectroDB v3 key composition (hand-mirrored, verified against the live
// entities' `.params()` output — see Task 10 report). ElectroDB lowercases
// every composite KEY VALUE; the stored attribute itself keeps its case.
// ─────────────────────────────────────────────────────────────────────────────

function runUserPk(adapterId: string): string {
  return `$run#userid_${adapterId.toLowerCase()}`;
}
const RUNUSER_SK = "$runuser_1"; // RunUser sk composite is empty — entity+version only.

function accomplishmentSk(accomplishmentId: string): string {
  return `$accomplishment_1#accomplishmentid_${accomplishmentId.toLowerCase()}`;
}
function accomplishmentGsi1Sk(completedAt: number): string {
  return `$accomplishment_1#completedat_${completedAt}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// I/O harness — raw DynamoDBDocument / S3 clients, one profile per account.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function makeDoc(profile: string): DynamoDBDocument {
  return DynamoDBDocument.from(
    new DynamoDB({ region: REGION, credentials: fromIni({ profile }) }),
    { marshallOptions: { removeUndefinedValues: true } }
  );
}

function makeS3(profile: string): S3Client {
  return new S3Client({ region: REGION, credentials: fromIni({ profile }) });
}

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
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

type GpxRunRow = {
  userId: string; // OIDC sub
  fileId: string;
  fileName: string;
  conDay: string;
  totalDistance?: number;
  totalElevation?: number;
  bucket: string;
  key: string;
  source?: string;
  stravaActivityId?: string;
};

/** Every active, con-day-tagged, non-GLOBAL GpxFile row across ALL users. */
async function scanGpxRuns(doc: DynamoDBDocument): Promise<GpxRunRow[]> {
  const rows = await scanAll(doc, GPX_TABLE!, {
    FilterExpression: "#e = :ge AND #st = :active AND attribute_exists(#cd) AND #uid <> :global",
    ExpressionAttributeNames: { "#e": "__edb_e__", "#st": "status", "#cd": "conDay", "#uid": "userId" },
    ExpressionAttributeValues: { ":ge": "GpxFile", ":active": "active", ":global": "GLOBAL" },
  });
  return rows as unknown as GpxRunRow[];
}

/** Every gpx/strava Accomplishment row across ALL users (checkin excluded —
 * out of this reconcile's authority, same as the live route). */
async function scanGpxSourcedAccomplishments(doc: DynamoDBDocument): Promise<Row[]> {
  return scanAll(doc, HUMAN_TABLE!, {
    FilterExpression: "#e = :e AND (#src = :gpx OR #src = :strava)",
    ExpressionAttributeNames: { "#e": "__edb_e__", "#src": "source" },
    ExpressionAttributeValues: { ":e": "Accomplishment", ":gpx": "gpx", ":strava": "strava" },
  });
}

/** sub -> adapter userId map, mirrors entities/auth-user.ts scanAccountSubs()
 * (reversed: that helper emits adapterId->sub; we need the other direction). */
async function scanSubToAdapter(doc: DynamoDBDocument): Promise<Map<string, string>> {
  const rows = await scanAll(doc, AUTH_TABLE!, {
    FilterExpression: "begins_with(sk, :acct)",
    ExpressionAttributeValues: { ":acct": ACCOUNT_SK_PREFIX },
    ProjectionExpression: "userId, providerAccountId",
  });
  const map = new Map<string, string>();
  for (const row of rows) {
    const adapterId = row.userId as string | undefined;
    const sub = row.providerAccountId as string | undefined;
    if (adapterId && sub) map.set(sub, adapterId);
  }
  return map;
}

async function getRunUserRollup(
  doc: DynamoDBDocument,
  adapterId: string
): Promise<{ activityScore?: number; activityCounts?: Partial<ActivityCounts> } | null> {
  const r = await doc.get({ TableName: HUMAN_TABLE!, Key: { pk: runUserPk(adapterId), sk: RUNUSER_SK } });
  return (r.Item as { activityScore?: number; activityCounts?: Partial<ActivityCounts> } | undefined) ?? null;
}

/** Read-modify-write bump of the RunUser rollup. `sign=1` (create) sets
 * latestActivityAt to the accomplishment's completedAt; `sign=-1` (delete)
 * NEVER touches latestActivityAt — there is no "latest activity" semantic for
 * removing a stale row (Task 10 brief, explicit deviation from the live
 * updateRunUserActivityCounts, which always stamps it). */
async function bumpRollup(
  doc: DynamoDBDocument,
  adapterId: string,
  source: "gpx" | "strava",
  pointsDelta: number,
  sign: 1 | -1,
  completedAtForCreate?: number
): Promise<boolean> {
  const existing = await getRunUserRollup(doc, adapterId);
  if (!existing) {
    console.log(`      ! RunUser row missing for adapterId=${adapterId} — rollup NOT applied`);
    return false;
  }
  const { activityScore, activityCounts } = applyRollupDelta(existing, source, pointsDelta, sign);
  const now = Date.now();
  const setParts = ["activityScore = :s", "activityCounts = :c", "updatedAt = :u"];
  const values: Record<string, unknown> = { ":s": activityScore, ":c": activityCounts, ":u": now };
  if (sign === 1 && completedAtForCreate !== undefined) {
    setParts.push("latestActivityAt = :l");
    values[":l"] = completedAtForCreate;
  }
  await doc.update({
    TableName: HUMAN_TABLE!,
    Key: { pk: runUserPk(adapterId), sk: RUNUSER_SK },
    UpdateExpression: `SET ${setParts.join(", ")}`,
    ExpressionAttributeValues: values,
    ConditionExpression: "attribute_exists(pk)",
  });
  return true;
}

/** Get-first idempotent delete (mirrors deleteAccomplishment: a missing row is
 * a no-op, never a second decrement). Deletes by the row's OWN pk/sk (read off
 * the scan) — zero key-composition risk on the delete path. */
async function deleteOrphanRow(
  doc: DynamoDBDocument,
  row: Row
): Promise<{ deleted: boolean; source?: "gpx" | "strava"; points?: number }> {
  const key = { pk: row.pk as string, sk: row.sk as string };
  const existing = await doc.get({ TableName: HUMAN_TABLE!, Key: key });
  if (!existing.Item) return { deleted: false };
  await doc.delete({ TableName: HUMAN_TABLE!, Key: key });
  const metadata = existing.Item.metadata as { points?: number } | undefined;
  return { deleted: true, source: existing.Item.source as "gpx" | "strava", points: metadata?.points ?? 0 };
}

/** S3 GetObject + parseTrack. Returns null on ANY failure (missing object,
 * network error, unparseable body) — the caller creates the row anyway,
 * WITHOUT a polyline, never skipping it (Task 10 brief). */
async function loadTrack(
  s3: S3Client,
  bucket: string,
  key: string
): Promise<{ points: [number, number][]; distance: number; elevation: number } | null> {
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const text = (await obj.Body?.transformToString()) ?? "";
    if (!text) return null;
    return parseTrack(text);
  } catch {
    return null;
  }
}

/** Get-first idempotent create (mirrors createAccomplishment's deterministic-id
 * short-circuit: a replayed create lands on the same sk, so we no-op rather
 * than double-write). Builds the FULL ElectroDB-parity item (markers + both
 * GSIs) so an app-side read hydrates it identically to a route-written row. */
async function createMissingRow(
  doc: DynamoDBDocument,
  s3: S3Client,
  adapterId: string,
  run: GpxRunRow
): Promise<{ created: boolean; completedAt?: number; source?: "gpx" | "strava" }> {
  const source: "gpx" | "strava" = run.source === "strava" ? "strava" : "gpx";
  const accomplishmentId = expectedAccomplishmentId({
    gpxFileId: run.fileId,
    source,
    stravaActivityId: run.stravaActivityId,
  });
  const key = { pk: runUserPk(adapterId), sk: accomplishmentSk(accomplishmentId) };

  const existing = await doc.get({ TableName: HUMAN_TABLE!, Key: key });
  if (existing.Item) return { created: false };

  const track = await loadTrack(s3, run.bucket, run.key);
  if (!track) {
    console.log(
      `      ! S3/parse failed for gpxFileId=${run.fileId} (bucket=${run.bucket} key=${run.key}) — creating WITHOUT polyline`
    );
  }
  const polyline = track ? decimatePolyline(track.points, 100) : undefined;
  const distance = track?.distance ?? run.totalDistance;
  const elevation = track?.elevation ?? run.totalElevation;

  const completedAt = conDayCompletedAt(run.conDay);
  const year = new Date(completedAt).getUTCFullYear();
  const now = Date.now();

  const item: Row = {
    userId: adapterId,
    accomplishmentId,
    type: "activity",
    source,
    name: run.fileName,
    completedAt,
    year,
    isPrivate: false,
    metadata: {
      points: 1,
      ...(polyline ? { polyline } : {}),
      ...(distance !== undefined ? { distance } : {}),
      ...(elevation !== undefined ? { elevation } : {}),
      ...(source === "gpx" ? { gpxFileId: run.fileId } : {}),
      ...(source === "strava" && run.stravaActivityId ? { stravaActivityId: run.stravaActivityId } : {}),
    },
    createdAt: now,
    updatedAt: now,
    pk: key.pk,
    sk: key.sk,
    gsi1pk: `${key.pk}#type_activity`,
    gsi1sk: accomplishmentGsi1Sk(completedAt),
    gsi2pk: `${key.pk}#year_${year}`,
    gsi2sk: accomplishmentGsi1Sk(completedAt),
    __edb_e__: "Accomplishment",
    __edb_v__: "1",
  };

  await doc.put({ TableName: HUMAN_TABLE!, Item: item, ConditionExpression: "attribute_not_exists(pk)" });
  return { created: true, completedAt, source };
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(
    `gpx-table=${GPX_TABLE} human-table=${HUMAN_TABLE} auth-table=${AUTH_TABLE} region=${REGION} ` +
      `profile-gpx=${PROFILE_GPX} profile-human=${PROFILE_HUMAN} mode=${APPLY ? "APPLY" : "DRY-RUN"}\n`
  );

  const gpxDoc = makeDoc(PROFILE_GPX!);
  const humanDoc = makeDoc(PROFILE_HUMAN!);
  const s3 = makeS3(PROFILE_GPX!);

  console.log("Scanning GpxFile (gpx account)...");
  const gpxRows = await scanGpxRuns(gpxDoc);
  console.log(`  ${gpxRows.length} active/con-day-tagged/non-GLOBAL run(s).`);

  console.log("Scanning Accomplishment (gpx/strava source, run.human account)...");
  const accRows = await scanGpxSourcedAccomplishments(humanDoc);
  console.log(`  ${accRows.length} existing gpx/strava accomplishment row(s).`);

  console.log("Scanning authjs ACCOUNT# rows (run.human account)...");
  const subToAdapter = await scanSubToAdapter(humanDoc);
  console.log(`  ${subToAdapter.size} sub -> adapter mapping(s).\n`);

  const adapterToSub = new Map<string, string>();
  for (const [sub, adapterId] of subToAdapter) adapterToSub.set(adapterId, sub);

  const runsBySub = new Map<string, GpxRunRow[]>();
  for (const row of gpxRows) {
    const list = runsBySub.get(row.userId) ?? [];
    list.push(row);
    runsBySub.set(row.userId, list);
  }

  const existingByAdapter = new Map<string, Row[]>();
  const orphanedAdapterIds: string[] = []; // accomplishment rows whose adapterId has no ACCOUNT# record
  for (const row of accRows) {
    const adapterId = row.userId as string;
    if (!adapterToSub.has(adapterId)) {
      if (!orphanedAdapterIds.includes(adapterId)) orphanedAdapterIds.push(adapterId);
    }
    const list = existingByAdapter.get(adapterId) ?? [];
    list.push(row);
    existingByAdapter.set(adapterId, list);
  }

  const universe = new Set<string>(runsBySub.keys());
  for (const adapterId of existingByAdapter.keys()) {
    const sub = adapterToSub.get(adapterId);
    if (sub) universe.add(sub);
  }

  const subs = ONLY_SUB ? [ONLY_SUB] : [...universe].sort();

  const noMapping: string[] = [];
  const totals = { users: 0, missingCreated: 0, orphansRemoved: 0, s3Failures: 0 };

  for (const sub of subs) {
    const adapterId = subToAdapter.get(sub);
    if (!adapterId) {
      noMapping.push(sub);
      continue;
    }
    totals.users++;

    const runs: ReconcileRun[] = (runsBySub.get(sub) ?? []).map((r) => ({
      gpxFileId: r.fileId,
      source: r.source === "strava" ? "strava" : "gpx",
      stravaActivityId: r.stravaActivityId,
    }));
    const existing = (existingByAdapter.get(adapterId) ?? []).map((r) => ({
      accomplishmentId: r.accomplishmentId as string,
      source: r.source as string,
    }));

    const { orphanIds, missingFileIds } = diffAccomplishments(existing, runs);
    console.log(
      `${sub.slice(0, 8)}… / ${adapterId}: +${missingFileIds.length} missing, -${orphanIds.length} orphans`
    );

    if (!APPLY) continue;

    const existingById = new Map((existingByAdapter.get(adapterId) ?? []).map((r) => [r.accomplishmentId as string, r]));
    for (const orphanId of orphanIds) {
      const row = existingById.get(orphanId);
      if (!row) continue;
      try {
        const del = await deleteOrphanRow(humanDoc, row);
        if (del.deleted && del.source) {
          await bumpRollup(humanDoc, adapterId, del.source, del.points ?? 0, -1);
          totals.orphansRemoved++;
          console.log(`   - deleted ${orphanId}`);
        }
      } catch (e) {
        console.log(`   ! delete failed for ${orphanId}: ${(e as Error).message}`);
      }
    }

    const runByFileId = new Map((runsBySub.get(sub) ?? []).map((r) => [r.fileId, r]));
    for (const fileId of missingFileIds) {
      const run = runByFileId.get(fileId);
      if (!run) continue;
      try {
        const created = await createMissingRow(humanDoc, s3, adapterId, run);
        if (created.created && created.completedAt !== undefined && created.source) {
          await bumpRollup(humanDoc, adapterId, created.source, 1, 1, created.completedAt);
          totals.missingCreated++;
          console.log(`   + created ${expectedAccomplishmentId({ gpxFileId: fileId, source: created.source })}`);
        }
      } catch (e) {
        console.log(`   ! create failed for ${fileId}: ${(e as Error).message}`);
      }
    }
  }

  console.log(
    `\n${APPLY ? "Applied" : "DRY-RUN"}: ${totals.users} user(s) processed, ` +
      `${totals.missingCreated} row(s) ${APPLY ? "created" : "would be created"}, ` +
      `${totals.orphansRemoved} row(s) ${APPLY ? "removed" : "would be removed"}.`
  );
  if (!APPLY) {
    console.log("Re-run with --apply to write.");
  }

  if (noMapping.length) {
    console.log(`\n${noMapping.length} sub(s) with NO run.human account mapping (skipped):`);
    for (const sub of noMapping) console.log(`  ${sub}`);
  }
  if (orphanedAdapterIds.length) {
    console.log(
      `\n${orphanedAdapterIds.length} adapterId(s) own gpx/strava accomplishment rows but have NO ACCOUNT# record (data-integrity anomaly, skipped):`
    );
    for (const adapterId of orphanedAdapterIds) console.log(`  ${adapterId}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
