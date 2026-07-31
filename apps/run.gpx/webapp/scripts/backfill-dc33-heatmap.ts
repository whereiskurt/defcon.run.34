/**
 * DC33 heat-map backfill (Phase 71, HEAT-03) — build `uploads/HEATMAP/dc33.json`.
 *
 * WHAT THIS PRODUCES: the frozen DC33 heat-map artifact — a GeoJSON
 * FeatureCollection of bare, zero-property LineStrings plus an embedded `meta`
 * block — assembled from last year's DynamoDB export and written to the
 * run-gpx uploads bucket, where `/api/gpx/public/heatmap/dc33` serves it.
 *
 * ONE-OFF, NOT A SCHEDULED JOB. The DC33 export is a finished snapshot taken
 * 2025-08-15 and will never change, so a Lambda or an EventBridge schedule
 * would be permanent cost for a permanently identical result. Run this by hand,
 * once. It is safe to re-run: the output is deterministic byte-for-byte.
 *
 * INVOCATION — from `apps/run.gpx/webapp`:
 *
 *   # dry run: writes ./dc33-heatmap.local.json, touches no bucket but the source
 *   npx tsx scripts/backfill-dc33-heatmap.ts
 *
 *   # publish: same artifact, plus PutObject + a re-read round-trip check
 *   S3_UPLOADS_BUCKET=... S3_UPLOADS_REGION=us-east-1 \
 *   S3_UPLOADS_ACCESS_KEY=... S3_UPLOADS_SECRET_KEY=... \
 *   npx tsx scripts/backfill-dc33-heatmap.ts --apply
 *
 *   DC33_AWS_PROFILE — optional, defaults to `dc34-application`. Names the
 *   local AWS profile used for the cross-account SOURCE read only.
 *
 * TWO CREDENTIAL MECHANISMS, DELIBERATELY. The READ is cross-account: the DC33
 * export lives in `s3://defcon.run.33.backup` in account 427284555693, where no
 * `S3_UPLOADS_*`-style key pair exists, so it authenticates with a named local
 * profile. The WRITE uses this app's OWN `s3Client`, whose IAM user is
 * prefix-scoped to `${bucket}/uploads/*` — which is exactly why the destination
 * key is `uploads/HEATMAP/dc33.json` and why a top-level `heatmap/` key would
 * AccessDeny. The two clients are NOT interchangeable; never route the write
 * through the source client.
 *
 * DC33 IS ACCOMPLISHMENT `year` 2025. DC33's own `api/heatmap/route.ts` derives
 * `defconNumber = year - 1992`, so 2025 → DC33. The export holds five con years
 * in one table; without the year filter the "DC33" artifact silently smuggles in
 * 2021-2024 runs.
 *
 * THE ENTITY DISCRIMINATOR IS THE PLURAL FORM. ElectroDB stamps `__edb_e__` with
 * `Accomplishments`, not `Accomplishment`. A filter written against the singular
 * matches zero rows and yields a silently empty artifact that still "succeeds".
 *
 * PRIVACY. This is the last point at which DC33 personal data could escape into
 * a public object. Nothing attributable is copied forward — the artifact carries
 * geometry and counts only — and `assertNonAttributable` runs immediately before
 * the write and again on the round-tripped object. A throw there means DO NOT
 * PUBLISH; it is deliberately not caught. `scripts/verify-heatmap-artifact.mjs`
 * re-checks the emitted bytes independently.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
// Cross-account READ credentials: a named profile out of ~/.aws/config.
import { fromIni as profileCredentials } from "@aws-sdk/credential-provider-ini";
import { gunzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { s3Client, BUCKET } from "../src/lib/s3-client";
import {
  assembleHeatmapArtifact,
  assertNonAttributable,
  heatmapArtifactKey,
  normalizeTrack,
} from "../src/lib/heatmap-artifact";
import { decodeTrack } from "../src/lib/polyline-decode";

/** The DC33 backup account's export bucket. Read-only; never written to. */
const SOURCE_BUCKET = "defcon.run.33.backup";
/** The 2025-08-15 export. NOT the earlier 08-09 one (71-CONTEXT.md). */
const SOURCE_PREFIX = "AWSDynamoDB/01755225714347-c2695bcb/";
/** DC33 = year - 1992 = 33. */
const DC33_YEAR = "2025";
/** PLURAL. See the header — the singular matches nothing. */
const DC33_ENTITY = "Accomplishments";
/** Only `activity` rows carry geometry (`social` / `meshctf` never do). */
const DC33_TYPE = "activity";

const SOURCE_REGION = "us-east-1";
const OUT_FILE = "dc33-heatmap.local.json";
const LOG = "[heatmap-dc33]";

/**
 * SOURCE client — cross-account, GetObject only, one bucket and one prefix.
 * Never lists the bucket root and has no write grant in that account (T-71-16).
 */
const sourceS3 = new S3Client({
  region: SOURCE_REGION,
  credentials: profileCredentials({
    profile: process.env.DC33_AWS_PROFILE ?? "dc34-application",
  }),
});

// ── DynamoDB-JSON readers ───────────────────────────────────────────────────
// Every attribute is read by a FIXED literal key path. Parsed values are never
// used as a lookup map and never spread into an accumulator, so a `__proto__`
// or `constructor` key smuggled through the export JSON is inert (T-71-18).

type DdbMap = Record<string, unknown>;

function asMap(v: unknown): DdbMap | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as DdbMap)
    : undefined;
}

/** Read attribute `key` as a DynamoDB string (`{"S": "..."}`). */
function attrS(item: DdbMap | undefined, key: string): string | undefined {
  const attr = asMap(item?.[key]);
  const v = attr?.["S"];
  return typeof v === "string" ? v : undefined;
}

/** Read attribute `key` as a DynamoDB number (`{"N": "..."}`) — still a string. */
function attrN(item: DdbMap | undefined, key: string): string | undefined {
  const attr = asMap(item?.[key]);
  const v = attr?.["N"];
  return typeof v === "string" ? v : undefined;
}

/** Read attribute `key` as a DynamoDB map (`{"M": {...}}`). */
function attrM(item: DdbMap | undefined, key: string): DdbMap | undefined {
  const attr = asMap(item?.[key]);
  return asMap(attr?.["M"]);
}

// ── S3 helpers ──────────────────────────────────────────────────────────────

async function getSourceBytes(key: string): Promise<Buffer> {
  const obj = await sourceS3.send(
    new GetObjectCommand({ Bucket: SOURCE_BUCKET, Key: key })
  );
  const bytes = await obj.Body?.transformToByteArray();
  if (!bytes) throw new Error(`empty body for s3://${SOURCE_BUCKET}/${key}`);
  return Buffer.from(bytes);
}

async function getSourceText(key: string): Promise<string> {
  return (await getSourceBytes(key)).toString("utf8");
}

// ── Pipeline ────────────────────────────────────────────────────────────────

/**
 * The export's own `exportTime` is the artifact's `generatedAt` — the honest
 * answer to "when was this data read". The day this script happens to run is
 * meaningless for a frozen snapshot, so there is no fallback: if the manifest
 * has no `exportTime`, the run dies rather than stamping a plausible lie.
 */
async function readExportTime(): Promise<string> {
  const raw = await getSourceText(`${SOURCE_PREFIX}manifest-summary.json`);
  const summary = asMap(JSON.parse(raw));
  const exportTime = summary?.["exportTime"];
  if (typeof exportTime !== "string" || exportTime.length === 0) {
    throw new Error("manifest-summary.json has no exportTime — refusing to guess");
  }
  return exportTime;
}

/**
 * Data-file keys come from `manifest-files.json` (JSON-lines, one object per
 * file carrying a `dataFileS3Key`). Discovered, never hardcoded: a hardcoded
 * filename list silently truncates the artifact if the export is ever re-taken.
 */
async function readDataFileKeys(): Promise<string[]> {
  const raw = await getSourceText(`${SOURCE_PREFIX}manifest-files.json`);
  const keys: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const entry = asMap(JSON.parse(trimmed));
    const key = entry?.["dataFileS3Key"];
    if (typeof key === "string" && key.length > 0) keys.push(key);
  }
  if (keys.length === 0) {
    throw new Error("manifest-files.json listed no dataFileS3Key entries");
  }
  return keys.sort();
}

type Candidate = { polyline: string };

type Selection = {
  filesRead: number;
  linesParsed: number;
  malformed: number;
  matched: number;
  candidates: Map<string, Candidate>;
};

async function selectCandidates(dataKeys: string[]): Promise<Selection> {
  const candidates = new Map<string, Candidate>();
  let linesParsed = 0;
  let malformed = 0;
  let matched = 0;

  for (const key of dataKeys) {
    const gz = await getSourceBytes(key);
    const text = gunzipSync(gz).toString("utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let row: DdbMap | undefined;
      try {
        row = asMap(JSON.parse(trimmed));
      } catch {
        // One corrupt line is one missing run, never a failed backfill (T-71-17).
        malformed++;
        continue;
      }
      linesParsed++;
      const item = asMap(row?.["Item"]);
      if (!item) continue;
      if (attrS(item, "__edb_e__") !== DC33_ENTITY) continue;
      if (attrN(item, "year") !== DC33_YEAR) continue;
      if (attrS(item, "type") !== DC33_TYPE) continue;
      const metadata = attrM(item, "metadata");
      const polyline = attrS(metadata, "summary_polyline");
      if (!polyline || polyline.length === 0) continue;
      matched++;
      // Same activity re-imported collapses to one run; fall back to the
      // accomplishment id when Strava never supplied an activity id.
      const stravaId = attrS(metadata, "stravaActivityId");
      const dedupKey =
        stravaId && stravaId.length > 0
          ? `strava:${stravaId}`
          : `accomplishment:${attrS(item, "accomplishmentId") ?? ""}`;
      if (!candidates.has(dedupKey)) candidates.set(dedupKey, { polyline });
    }
  }

  return {
    filesRead: dataKeys.length,
    linesParsed,
    malformed,
    matched,
    candidates,
  };
}

type Decoded = {
  tracks: [number, number][][];
  jsonArrayForm: number;
  encodedForm: number;
  dropped: number;
};

/**
 * Decode in SORTED dedup-key order so two runs emit byte-identical files.
 *
 * The encoding branch is recorded here rather than inside `decodeTrack` (which
 * deliberately returns geometry only): DC33 stored `summary_polyline` either as
 * a Google encoded polyline (Strava imports) or as a JSON coordinate array
 * (manual uploads), and a zero count on either side means that branch is dead
 * code that never saw real data.
 */
function decodeAll(candidates: Map<string, Candidate>): Decoded {
  const tracks: [number, number][][] = [];
  let jsonArrayForm = 0;
  let encodedForm = 0;
  let dropped = 0;

  for (const dedupKey of [...candidates.keys()].sort()) {
    const raw = candidates.get(dedupKey)!.polyline;
    const coords = normalizeTrack(decodeTrack(raw));
    if (coords.length < 2) {
      dropped++;
      continue;
    }
    if (raw.trim().startsWith("[")) jsonArrayForm++;
    else encodedForm++;
    tracks.push(coords);
  }

  return { tracks, jsonArrayForm, encodedForm, dropped };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const exportTime = await readExportTime();
  const dataKeys = await readDataFileKeys();
  const selection = await selectCandidates(dataKeys);
  const decoded = decodeAll(selection.candidates);

  const artifact = assembleHeatmapArtifact("dc33", exportTime, decoded.tracks);

  // THE CHOKEPOINT (T-71-15). Immediately before the bytes leave this process,
  // never wrapped in a try/catch: a throw means "do not publish".
  assertNonAttributable(artifact);

  const body = JSON.stringify(artifact);

  // Counts only — no user ids, no accomplishment ids, no polyline text.
  console.log(`${LOG} files read:            ${selection.filesRead}`);
  console.log(`${LOG} lines parsed:          ${selection.linesParsed}`);
  console.log(`${LOG} malformed skipped:     ${selection.malformed}`);
  console.log(`${LOG} accomplishments matched: ${selection.matched}`);
  console.log(`${LOG} deduped candidates:    ${selection.candidates.size}`);
  console.log(`${LOG} geometry decoded:      ${decoded.tracks.length}`);
  console.log(`${LOG}   json-array encoding: ${decoded.jsonArrayForm}`);
  console.log(`${LOG}   polyline encoding:   ${decoded.encodedForm}`);
  console.log(`${LOG} dropped (<2 coords):   ${decoded.dropped}`);
  console.log(`${LOG} runCount:              ${artifact.meta.runCount}`);
  console.log(`${LOG} totalKm:               ${artifact.meta.totalKm}`);
  console.log(`${LOG} generatedAt:           ${artifact.meta.generatedAt}`);

  // A DC33 artifact with no runs is a bug, not an empty set.
  if (artifact.meta.runCount === 0) {
    throw new Error("zero features — the filter is wrong; refusing to emit");
  }

  const outPath = resolve(process.cwd(), OUT_FILE);
  writeFileSync(outPath, body);
  console.log(`${LOG} wrote ${body.length} bytes to ${outPath}`);

  if (apply) {
    const key = heatmapArtifactKey("dc33");
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: "application/json",
      })
    );
    const readBack = await s3Client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key })
    );
    const roundTripped = (await readBack.Body?.transformToString()) ?? "";
    // Re-assert on what the bucket actually holds, not on what we meant to send.
    assertNonAttributable(JSON.parse(roundTripped));
    console.log(
      `${LOG} published ${key} — round-trip ok, ${roundTripped.length} bytes read back`
    );
  } else {
    console.log(`${LOG} dry run — pass --apply to publish`);
  }

  // Machine-readable contract, NOT decoration. 71-08's production probe parses
  // `^HEATMAP_DC33_RUNCOUNT=(\d+)$` out of 71-04-SUMMARY.md to check the LIVE
  // artifact against what this run actually built, and FAILS when the line is
  // missing or unparseable. Keep these three lines last, bare, one per line.
  console.log(`HEATMAP_DC33_RUNCOUNT=${artifact.meta.runCount}`);
  console.log(`HEATMAP_DC33_TOTALKM=${artifact.meta.totalKm}`);
  console.log(`HEATMAP_DC33_GENERATEDAT=${artifact.meta.generatedAt}`);
}

main().catch((err) => {
  console.error(`${LOG} FAILED:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
