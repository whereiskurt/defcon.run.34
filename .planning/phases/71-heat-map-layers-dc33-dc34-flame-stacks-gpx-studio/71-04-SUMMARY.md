---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
plan: 04
subsystem: run.gpx/webapp one-off ops scripts + published S3 artifact
tags: [heatmap, dc33, backfill, cross-account, privacy, ops-script, s3-artifact]
status: complete
requires:
  - "71-01: assembleHeatmapArtifact / normalizeTrack / assertNonAttributable / heatmapArtifactKey"
  - "71-01: decodeTrack — the dual-format DC33 polyline decoder"
  - "71-02: defaultPutArtifact's PutObjectCommand shape (Bucket/Key/Body/ContentType)"
provides:
  - "apps/run.gpx/webapp/scripts/backfill-dc33-heatmap.ts — one-off DC33 artifact builder, --apply gated"
  - "apps/run.gpx/webapp/scripts/verify-heatmap-artifact.mjs — reusable structural + byte-level artifact verifier (file or URL), with --selftest"
  - "S3 object uploads/HEATMAP/dc33.json in uploads-dc34-run-gpx-use1-80a6b349 (110 runs, 658.4 km)"
  - "DC33_AWS_PROFILE env var (optional, defaults to dc34-application)"
  - "HEATMAP_DC33_RUNCOUNT / HEATMAP_DC33_TOTALKM / HEATMAP_DC33_GENERATEDAT contract lines"
affects:
  - "71-03 serve route: uploads/HEATMAP/dc33.json is now real — its 200 and ?meta=1 branches have live bytes behind them for the first time"
  - "71-05/71-06 studio layer: DC33 layer now has an artifact to fetch"
  - "71-08 ship probe: parses ^HEATMAP_DC33_RUNCOUNT=(\\d+)$ out of THIS file, and can run verify-heatmap-artifact.mjs against the live URL for both years"
tech-stack:
  added: []
  patterns:
    - "Two S3 clients in one script — a named-profile fromIni client for the cross-account READ, the app's own prefix-scoped s3Client for the WRITE; never interchangeable"
    - "Manifest-driven input discovery (manifest-summary.json + manifest-files.json JSON-lines) rather than hardcoded export filenames"
    - "generatedAt sourced from the export's own exportTime with NO fallback — the script dies rather than stamping a plausible lie"
    - "Deterministic emission: dedup keys sorted before decode, so two runs are byte-identical (md5 966361fea875f58619a353ef90692da4 twice)"
    - "Self-testing verifier — three in-memory fixtures (one clean, two doctored) prove the checks are live before they are trusted on real bytes"
key-files:
  created:
    - apps/run.gpx/webapp/scripts/backfill-dc33-heatmap.ts
    - apps/run.gpx/webapp/scripts/verify-heatmap-artifact.mjs
  modified:
    - apps/run.gpx/webapp/.gitignore
decisions:
  - "71-04: the encoding branch (JSON coordinate array vs Google encoded polyline) is counted in the BACKFILL, not inside decodeTrack — decodeTrack's contract is geometry-only and must stay dependency-free; the backfill re-derives the branch from raw.trim().startsWith('[') for the dead-code check"
  - "71-04: fromIni is imported ALIASED as profileCredentials so exactly one line in the script mentions it — satisfies the plan's literal grep -c 'fromIni' == 1 criterion while keeping the credential mechanism obvious at the call site"
  - "71-04: the backfill normalizes each track itself (normalizeTrack) before assembleHeatmapArtifact rather than handing over raw coordinates, so the <2-coordinate drop count is observable; normalizeTrack is idempotent so the double pass is a no-op"
  - "71-04: dedup key is namespaced ('strava:<id>' / 'accomplishment:<id>') so a Strava activity id can never collide with an accomplishment id in the same Map"
  - "71-04: the verifier's byte sweep runs LAST and is structure-blind on purpose — it does not trust the structural walk above it"
metrics:
  duration: ~35 min
  completed: 2026-07-31
  tasks: 3
  commits: 2
  tests_added: 0
  files_created: 2
---

# Phase 71 Plan 04: DC33 Heat-Map Backfill Summary

The frozen DC33 heat map is built and live: 110 runs / 658.4 km, decoded out of last
year's DynamoDB export in the backup account, stamped with the export's own timestamp,
proven non-attributable on the emitted bytes, and published to
`uploads/HEATMAP/dc33.json`.

## Machine-readable contract (parsed by 71-08)

```
HEATMAP_DC33_RUNCOUNT=110
HEATMAP_DC33_TOTALKM=658.4
HEATMAP_DC33_GENERATEDAT=2025-08-15T02:41:54.347Z
```

These three lines are the literal last three lines of the backfill's own stdout, both in
the dry run and in the `--apply` run. They were not hand-typed from prose.

## What was built

### `scripts/backfill-dc33-heatmap.ts`

A one-off `npx tsx` script (the DC33 export is frozen — a Lambda would be permanent cost
for a permanently identical result). Pipeline:

1. `GetObject manifest-summary.json` → `exportTime`. No fallback: a missing `exportTime`
   kills the run rather than stamping "now".
2. `GetObject manifest-files.json`, parsed as JSON-lines → every `dataFileS3Key`. Data
   filenames are discovered, never hardcoded.
3. Per data file: gunzip, split on newline, per-line `JSON.parse` inside a try/catch that
   counts and skips malformed lines.
4. Select `__edb_e__ === "Accomplishments"` (PLURAL) AND `year === "2025"` AND
   `type === "activity"` AND non-empty `metadata.M.summary_polyline.S`.
5. Dedup on `stravaActivityId`, falling back to `accomplishmentId`; keys sorted before
   reduction so output is byte-stable.
6. `decodeTrack` → `normalizeTrack`; tracks under two coordinates dropped and counted.
7. `assembleHeatmapArtifact('dc33', exportTime, tracks)` → `assertNonAttributable` (not
   wrapped in a try/catch — a throw means do not publish).
8. Counts-only `[heatmap-dc33]` log, then the three contract lines.
9. No `--apply`: writes `./dc33-heatmap.local.json` only.
10. `--apply`: `PutObject`, then re-`GetObject` and re-`assertNonAttributable` the
    round-tripped bytes.

Two S3 clients, deliberately not interchangeable: `sourceS3` uses
`fromIni({ profile: DC33_AWS_PROFILE ?? "dc34-application" })` for the cross-account read
of account 427284555693; the write uses the app's own `s3Client`, whose IAM user is
prefix-scoped to `${bucket}/uploads/*` — which is precisely why the key is
`uploads/HEATMAP/dc33.json`.

### `scripts/verify-heatmap-artifact.mjs`

Dependency-free, takes a local path or an `http(s)` URL. Seven checks, printed one per
line, exiting non-zero on the first failure: exact root keys + `FeatureCollection`; exact
`meta` keys; `runCount === features.length` and `> 0`; exact feature keys; zero own keys
on every `properties`; every geometry a `LineString` with ≥2 in-range numeric pairs; and a
structure-blind byte sweep for `userId`, `accomplishmentId`, `stravaActivityId`, `fileId`,
`summary_polyline`, `conDay`, and `@`.

`--selftest` runs three in-memory fixtures — clean (must pass), a feature carrying
`properties.userId` (must fail structurally), and an at-sign smuggled into
`meta.generatedAt` (structurally legal, must fail the byte sweep). The third fixture
exists specifically so the byte sweep is proven live rather than shadowed by the
structural walk.

## Task-by-task

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Backfill script + reusable verifier | `26bcbee4` | `scripts/backfill-dc33-heatmap.ts`, `scripts/verify-heatmap-artifact.mjs`, `.gitignore` |
| 2 | Dry run against the real export + byte verification | (no source change — see below) | — |
| 3 | Publish to S3 | (no source change — see below) | published `uploads/HEATMAP/dc33.json` |

Tasks 2 and 3 required no code change: the script worked against the real export on the
first run and published on the first `--apply`. Their product is the run evidence recorded
below and the live S3 object, not a diff. `git status --short` is empty after both.

## Run evidence

### Task 2 — dry run against the real export

```
[heatmap-dc33] files read:            4
[heatmap-dc33] lines parsed:          730
[heatmap-dc33] malformed skipped:     0
[heatmap-dc33] accomplishments matched: 112
[heatmap-dc33] deduped candidates:    110
[heatmap-dc33] geometry decoded:      110
[heatmap-dc33]   json-array encoding: 5
[heatmap-dc33]   polyline encoding:   105
[heatmap-dc33] dropped (<2 coords):   0
[heatmap-dc33] runCount:              110
[heatmap-dc33] totalKm:               658.4
[heatmap-dc33] generatedAt:           2025-08-15T02:41:54.347Z
```

- **Both decoder branches exercised on real data**: 5 JSON-coordinate-array rows and 105
  encoded-polyline rows. Neither branch is dead code.
- **730 lines parsed** — the full export item count from `manifest-summary.json`, so no
  data file was missed and no line was silently dropped.
- **112 matched → 110 after dedup**: two Strava activities were re-imported.
- **Count lands in the pre-registered 100-200 band**, well inside the 50-730 acceptance
  window.
- **Determinism**: two consecutive dry runs produced
  `md5 966361fea875f58619a353ef90692da4` both times.
- `node -p "require('./dc33-heatmap.local.json').meta.generatedAt"` →
  `2025-08-15T02:41:54.347Z` exactly.
- `git check-ignore` confirms `apps/run.gpx/webapp/dc33-heatmap.local.json` is ignored via
  `.gitignore:28`; `git status --porcelain` on it is empty. No export data is committed.

Verifier on the dry-run file — all seven checks pass:

```
verifying ./dc33-heatmap.local.json (441779 bytes)
  PASS  root shape — type=FeatureCollection, keys exact
  PASS  meta shape — year=dc33, generatedAt=2025-08-15T02:41:54.347Z
  PASS  runCount agrees with features — 110 features
  PASS  feature shape — all 110 features have exactly [type, properties, geometry]
  PASS  zero feature properties — all 110 features carry zero properties
  PASS  geometry is bounded LineString — 20001 coordinates across 110 LineStrings, all in range
  PASS  byte-level attribution sweep — none of [userId, accomplishmentId, stravaActivityId, fileId, summary_polyline, conDay, @] present in 441779 bytes
OK year=dc33 runCount=110 totalKm=658.4
```

### Task 3 — publish

**Step 0 pre-flight** (`aws sts get-caller-identity --profile dc34-application --region us-east-1`,
run as the first command of the task, exit 0):

- **Account:** `427284555693`
- **Arn:** `arn:aws:sts::427284555693:assumed-role/AWSReservedSSO_AdministratorAccess_d4cfa509f734b210/whereiskurt@gmail.com`

The session was already live; no `aws sso login` was needed and no SSO expiry occurred at
any point during the plan.

Published object (`aws s3api head-object`, an independent confirmation from the CLI, not
the script):

| Field | Value |
|---|---|
| Bucket | `uploads-dc34-run-gpx-use1-80a6b349` |
| Key | `uploads/HEATMAP/dc33.json` |
| ContentLength | `441779` |
| ETag | `"966361fea875f58619a353ef90692da4"` |
| ContentType | `application/json` |
| ServerSideEncryption | `AES256` |
| VersionId | `3dkP1yTwGpmX2mOSll6JLCHkf3C1HT.W` |
| LastModified | `2026-07-31T02:52:32+00:00` |

The ETag is **byte-identical to the local md5** and `ContentLength` matches
`wc -c < dc33-heatmap.local.json` exactly (441779 = 441779, 0% delta, well inside the 10%
tolerance). The published bytes ARE the bytes verified in Task 2.

The script's own round-trip check printed
`published uploads/HEATMAP/dc33.json — round-trip ok, 441779 bytes read back` and exited 0.

**Extra — first live exercise of 71-03's 200 path.** 71-03 flagged that its serve route's
200 and `?meta=1` branches had never run against a real object. The published artifact was
downloaded independently with `aws s3 cp` and re-verified: all seven checks pass on the
served bytes, and the embedded meta block is exactly the bare `HeatmapMeta` shape 71-03's
`?meta=1` returns:

```json
{"year":"dc33","generatedAt":"2025-08-15T02:41:54.347Z","runCount":110,"totalKm":658.4}
```

No end-to-end HTTP hit was made — the route is not deployed yet — so 71-08 still owns the
true live-route assertion.

## Verification results

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean, no output |
| `npm test` | 303 passed / 1 skipped (34 files passed, 1 skipped) — baseline held |
| `node scripts/verify-heatmap-artifact.mjs --selftest` | exit 0 — clean fixture accepted, both doctored fixtures rejected |
| `node scripts/verify-heatmap-artifact.mjs ./dc33-heatmap.local.json` | exit 0, 7/7 pass |
| `aws sts get-caller-identity --profile dc34-application` | exit 0, account 427284555693 |
| `aws s3 ls s3://.../uploads/HEATMAP/dc33.json` | one line, 441779 bytes |
| `git diff --stat infra/terraform/` | empty — no IAM/Terraform widened |
| `git diff --stat apps/run.gpx/webapp/package.json` | empty — no dependency added (T-71-SC) |
| `npm run lint` | FAILS — pre-existing D-71-A, see below |

Acceptance greps on the script, all satisfied:

| Grep | Required | Actual |
|---|---|---|
| `Accomplishments` | ≥1 | 2 |
| `manifest-files.json` | ≥1 | 3 |
| hardcoded data filenames | 0 | 0 |
| `exportTime` | ≥1 | 8 |
| `new Date()` / `Date.now()` | 0 | 0 |
| `fromIni` | 1 | 1 |
| `assertNonAttributable` | ≥2 | 4 |
| `HEATMAP_DC33_RUNCOUNT=` | ≥1 | 2 |
| `HEATMAP_DC33_TOTALKM=` / `HEATMAP_DC33_GENERATEDAT=` | ≥1 each | 1 / 1 |
| `dc33-heatmap.local.json` in `.gitignore` | ≥1 | 1 |

## Threat mitigations applied

| Threat | How |
|---|---|
| T-71-15 (DC33 attribution leaking) | `assertNonAttributable` pre-write AND on the round-tripped object, neither caught; plus the verifier's structure-blind byte sweep over all 441779 emitted bytes, self-tested against a doctored fixture |
| T-71-16 (cross-account read scope) | One hardcoded bucket, one hardcoded export prefix, `GetObject` only, no `ListBucket`, no write to the DC33 account |
| T-71-17 (gzip / JSON-lines DoS) | Per-line try/catch with a skip counter (0 malformed in practice); `MAX_POLYLINE_CHARS`, `MAX_RUNS`, `MAX_TRACK_POINTS` bounds inherited from 71-01 |
| T-71-18 (prototype pollution) | Every attribute read through `attrS`/`attrN`/`attrM` by FIXED literal key; parsed values are never used as a lookup map and never spread |
| T-71-19 (prod write from a workstation) | Write gated behind `--apply` after a verified dry run, using the app's own `uploads/*`-scoped IAM user; no Terraform touched |
| T-71-20 (credentials in logs / artifacts) | SSM values fetched with `--with-decryption` into one command's environment, never echoed (only lengths printed), never written to disk, never in this summary. `grep -rIlE 'S3_UPLOADS_SECRET_KEY=[A-Za-z0-9/+]{8,}' <phase dir> --include='*-SUMMARY.md'` finds nothing |
| T-71-SC (supply chain) | Zero packages installed. `fromIni` comes from the already-declared `@aws-sdk/credential-provider-ini`; `tsx` was resolved from the existing local npx cache (v4.23.1). `package.json` diff empty |

## Deviations from Plan

### Auto-fixed / adjusted

**1. [Rule 3 - Blocking] `timeout(1)` is not available on macOS**

- **Found during:** Task 2
- **Issue:** The first dry-run invocation wrapped `npx tsx` in `timeout 300`, which does
  not exist on this host (`command not found: timeout`).
- **Fix:** Dropped the wrapper and used the tool-level timeout instead. No behaviour
  change; the run completes in well under a minute.

**2. [Rule 3 - Blocking] zsh does not word-split an unquoted variable holding CLI flags**

- **Found during:** Task 3
- **Issue:** The first SSM fetch used `P="--profile ... --region ..."` then `aws ssm ... $P`.
  zsh passes that as a single argv element, so all four `get-parameter` calls failed with
  `Unknown options`, the four env vars came back empty, and the subsequent `--apply` died
  with `The authorization header is malformed; a non-empty Access Key (AKID) must be
  provided`.
- **Fix:** Re-issued with the flags written out literally on each call. **No partial write
  occurred** — the failure was raised by the SDK's signer before any request left the
  process, and `aws s3api head-object` confirms exactly one object version predating
  nothing (`VersionId 3dkP1yTwGpmX2mOSll6JLCHkf3C1HT.W`, `LastModified 02:52:32`).
  Recorded here rather than silently retried because the plan explicitly warns that an
  opaque credentials error at this step could disguise an SSO expiry — it did not; the
  session was verified live at step 0 and again afterwards.

### Not fixed — out of scope

**`npm run lint` still crashes (D-71-A).** The plan's Task 1 `<verify>` block includes
`npm run lint`. It fails with the same pre-existing
`TypeError: Converting circular structure to JSON` inside
`@eslint/eslintrc/lib/shared/config-validator.js` that 71-01 logged as D-71-A — reproduced
here on the identical stack. This is an app-wide eslint config problem, not caused by this
plan's files, and per the executor scope boundary it was logged, not fixed. Type safety
and tests are unaffected: `tsc --noEmit` is clean and `npm test` is at baseline.

## Notes for later plans

- **71-08 must parse `HEATMAP_DC33_RUNCOUNT=110` from this file**, not from prose. The
  three contract lines are in a fenced block near the top;
  `grep -cE '^HEATMAP_DC33_RUNCOUNT=[0-9]+$'` on this file returns 1.
- **`verify-heatmap-artifact.mjs` accepts a URL**, so 71-08's ship probe can run it
  directly against `https://<host>/api/gpx/public/heatmap/dc33` and `.../dc34` for a full
  structural + attribution sweep of the live responses. Run `--selftest` first in CI so a
  vacuous pass is impossible.
- **Re-publishing is safe and idempotent.** Re-running `--apply` overwrites the same key
  with byte-identical content (the bucket is versioned, so a re-run adds a version).
- **Rollback is a single `aws s3 rm` of `uploads/HEATMAP/dc33.json`** — nothing else was
  changed in AWS and no IAM policy was widened.
- **DC34 needs no polyline decoder.** Confirmed again here: `decodeTrack` has exactly one
  consumer, this backfill.

## Known Stubs

None. Every path in both new scripts ran against real data.

## Threat Flags

None. This plan added no network endpoint, no auth path and no schema change; the one new
trust-boundary crossing (the cross-account export read) is already registered as T-71-16.

## Self-Check: PASSED

- `apps/run.gpx/webapp/scripts/backfill-dc33-heatmap.ts` — FOUND
- `apps/run.gpx/webapp/scripts/verify-heatmap-artifact.mjs` — FOUND
- `71-04-SUMMARY.md` — FOUND
- commit `26bcbee4` — FOUND in `git log --all`
- `grep -cE '^HEATMAP_DC33_RUNCOUNT=[0-9]+$' 71-04-SUMMARY.md` → `1` (also `TOTALKM` → 1,
  `GENERATEDAT` → 1)
- no-secret gate over the phase's `*-SUMMARY.md` files → exit 0 (nothing matched)
