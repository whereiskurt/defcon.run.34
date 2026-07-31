---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
plan: 15
subsystem: published DC33 heat-map S3 artifact + machine-readable contract
status: complete
tags: [heatmap, dc33, data-quality, republish, s3-artifact, cloudfront, gap-closure, human-approved]
gap_closure: true
requirements: [HEAT-03]

dependency_graph:
  requires:
    - "71-04 — the frozen DC33 backfill script and the HEATMAP_DC33_* contract lines"
    - "71-10 — the degeneracy filter at assembleHeatmapArtifact and the tightened verifier"
    - "71-13 — the ordered CloudFront cache behaviour that made an invalidation mandatory"
  provides:
    - "uploads/HEATMAP/dc33.json republished with zero degenerate features (110 -> 90 runs)"
    - "HEATMAP_DC33_RUNCOUNT=90 — the single contract line, now matching the live artifact"
    - "WR-06 fully closed: 71-10 fixed the code, this plan reached the frozen object"
    - "Probe assertion 17 flips red -> green; assertion 5's dc33 leg flips to exit 0"
  affects:
    - "71-16 — re-runs the 19-assertion probe and should observe assertion 17's flip"
    - "71-08 probe assertion 6 — both sides (artifact + contract line) moved together, stays green"

tech_stack:
  added: []
  patterns:
    - "Rebuild through the repo's own source path, not the deployed builder — the local one-off script imports the working tree, so an undeployed fix still reaches production data"
    - "Set-equality proof over an aggregate invariant — the survivors were shown identical to the pre-rebuild non-degenerate set, not merely consistent in total"
    - "Publish, then invalidate, then re-derive on a proven cache Miss — never conclude from a cache-buster"
    - "In-place correction of a machine-parsed contract line, with the explanatory note shaped so it cannot form a second match"

key_files:
  created:
    - ".planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-15-SUMMARY.md"
  modified:
    - ".planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-04-SUMMARY.md"

decisions:
  - "71-15: the rebuild ran through the LOCAL npx tsx backfill, never the deployed heatmap-build-use1 Lambda — the Lambda is the dc34 builder and carries the pre-71-10 unfiltered code, so invoking it would have re-published the exact defect this plan removes"
  - "71-15: the correction note was placed ABOVE the fenced contract block and refers to the token only without an equals-and-digits tail, so the probe's anchored multiline parser still finds exactly one match"
  - "71-15: 71-04's run-evidence sections were left byte-untouched — they are the true record of the original 110-feature build; only the live-state contract and the frontmatter provides line were corrected"
  - "71-15: no user-facing copy was added about the count change (Kurt declined the offered CMS/studio variant); the phase record is the sole explanation"

metrics:
  duration: "~30m"
  completed: 2026-07-31
  tasks: 3
  commits: 1
  files_modified: 1
---

# Phase 71 Plan 15: DC33 Artifact Republish Summary

The live DC33 heat map no longer claims 110 runs. Twenty of its features were zero-length
lines at null island — polyline decode artefacts that drew nothing and measured nothing —
and the publicly-served count was inflated 22% because of them. The artifact was rebuilt
through plan 71-10's degeneracy filter and republished: **90 runs, 0 degenerate, the same
658.4 km, the same frozen timestamp.** The tightened verifier flipped from exit 1 to exit 0
against production.

## The before/after triple

| | Live (pre-rebuild) | Live (post-rebuild) | Movement |
|---|---|---|---|
| `runCount` | **110** | **90** | **−20** |
| `totalKm` | **658.4** | **658.4** | **0.0000%** |
| `generatedAt` | `2025-08-15T02:41:54.347Z` | `2025-08-15T02:41:54.347Z` | byte-identical |
| degenerate features | **20 of 110** (18.2%) | **0 of 90** | — |
| km per run | 5.99 | 7.32 | → the truthful value |
| bytes | 441,779 | 439,858 | −1,921 |
| verifier exit | **1** | **0** | red → green |

The dry run reproduced plan 71-10's measurement exactly before anything was published: 20
degenerate features at indices `0,1,2,3,4,5,6,7,8,9,11,12,13,15,18,19,20,21,23,24`, all
`[[0,0],[0,0]]`. Same count, same indices, independently re-derived.

## The approval

Kurt approved at Task 1b's blocking gate on **2026-07-31**, after reviewing the full
contrast table. He was given the option of recording the 110 → 90 correction in CMS copy or
in the studio UI and **declined it** — the plain publish was chosen, so the count is simply
correct now with no in-product explanation. No user-facing copy was added. This summary is
the record.

Nothing was published before that reply. The dry run is the script's default; the publish
flag was passed exactly once, afterwards.

## Why the count could drop 20 without a single run being lost

The plan's stated cross-check was that `totalKm` should barely move, because a zero-length
line contributes zero kilometres. It did not move **at all** — 658.4 to 658.4, 0.0000%,
against a 1% tolerance.

That invariant was then strengthened into a direct proof. The pre-rebuild and post-rebuild
artifacts were both downloaded and their feature geometries compared as sets:

```
POST features absent from PRE (must be 0): 0
PRE non-degenerate set === POST set: true
```

The 90 published features are **exactly** the 90 non-degenerate features of the old
artifact — nothing added, nothing altered, nothing real removed. The 20 that vanished are
precisely the 20 that never moved. This is stronger than the aggregate distance check,
which could in principle be satisfied by coincidence; set equality cannot.

The upstream pipeline was identical across both runs, which rules out the alternative
explanation that the input changed: 4 files read, 730 lines parsed, 0 malformed, 112
accomplishments matched, 110 deduped, 110 decoded (5 JSON-array / 105 polyline), 0 dropped
for `<2 coords`. The entire delta arrives at the new filter and nowhere else.

## The Lambda trap, avoided

The application code carrying 71-10's filter is **not deployed** — production still serves
run.gpx v0.0.109, and plan 71-16 ships the release. That raised a real hazard: invoking the
deployed `heatmap-build-use1` Lambda to "rebuild" would have re-published the **old
unfiltered shape**, re-creating the defect while appearing to fix it.

It does not apply here, and the Lambda was never touched. `scripts/backfill-dc33-heatmap.ts`
is a local `npx tsx` one-off that imports `../src/lib/heatmap-artifact` **from the working
tree**, so it picks up the filter regardless of what is deployed. The dry run proved this
empirically before any write: the deployed code path yields 110, this yielded 90. (The
Lambda is also the **dc34** builder — wrong year as well as wrong code.)

The filter's presence in the working tree was confirmed by reading
`assembleHeatmapArtifact` before running anything, as the plan's dependency check requires.

## Task-by-task

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Dry run + characterisation | — (no repo files; scratch artifact is gitignored) | `dc33-heatmap.local.json` (untracked) |
| 1b | Blocking human approval | — | approval recorded above |
| 2 | Publish, contract line, invalidation, re-derive | `4a80157e` | `71-04-SUMMARY.md` |

## Run evidence

### Publish

The `--apply` run's own round-trip check passed and was not caught by anything:

```
[heatmap-dc33] published uploads/HEATMAP/dc33.json — round-trip ok, 439858 bytes read back
HEATMAP_DC33_RUNCOUNT=90
HEATMAP_DC33_TOTALKM=658.4
HEATMAP_DC33_GENERATEDAT=2025-08-15T02:41:54.347Z
```

Independent CLI confirmation (`aws s3api head-object`, not the script):

| Field | Value |
|---|---|
| Bucket | `uploads-dc34-run-gpx-use1-80a6b349` |
| Key | `uploads/HEATMAP/dc33.json` |
| ContentLength | `439858` |
| ETag | `"3f1878668c91fe2ac8b7fac2e5b632f9"` |
| VersionId | `_AdmFzLQkjVbkkkNgjIgikJGNze6EmZj` (was `3dkP1yTwGpmX2mOSll6JLCHkf3C1HT.W`) |
| ServerSideEncryption | `AES256` |
| LastModified | `2026-07-31T19:20:20+00:00` |

The ETag is byte-identical to the local `md5` of the emitted file and `ContentLength`
matches `wc -c` exactly. The published bytes are the verified bytes.

Credentials came from `/dc34/uploads/use1/run-gpx/{access_key_id,secret_access_key,
bucket_name,bucket_region}` via `--with-decryption`, into one command's environment only.
Values were never echoed — only lengths (`ak=20 sk=40`) — never written to disk, and a
guard aborted before any write if either came back short. The prefix-scoped IAM user is why
the key is `uploads/HEATMAP/dc33.json`; 71-04's zsh word-splitting landmine was avoided by
writing every flag literally.

### CloudFront invalidation

| Field | Value |
|---|---|
| Distribution | `E1D1R5LJNFGRLE` (`gpx.defcon.run`, Deployed) |
| Invalidation id | **`IAX573OYBXW9L50YLMZ319H9GS`** |
| Path | `/use1/api/gpx/public/heatmap/*` |
| Created | `2026-07-31T19:20:37Z` |
| Status | **Completed** (confirmed by `get-invalidation` before probing) |

This was mandatory, not defensive: 71-13 put a real ordered cache behaviour in front of this
path at `s-maxage=900, stale-while-revalidate=900`, so the old bytes would otherwise have
been served publicly for up to 15 minutes after a successful publish.

Success was **not** inferred from a cache-busting query. Both post-invalidation fetches
returned `x-cache: Miss from cloudfront` — genuine origin reads on the canonical URL — and
three subsequent fetches returned `Hit from cloudfront` while still serving `runCount: 90`,
proving the edge has re-warmed with the corrected bytes rather than merely being bypassed.

### Live re-derivation

```
$ node scripts/verify-heatmap-artifact.mjs https://gpx.defcon.run/use1/api/gpx/public/heatmap/dc33
verifying ... (439858 bytes)
  PASS  root shape — type=FeatureCollection, keys exact
  PASS  meta shape — year=dc33, generatedAt=2025-08-15T02:41:54.347Z
  PASS  runCount agrees with features — 90 features
  PASS  feature shape — all 90 features have exactly [type, properties, geometry]
  PASS  zero feature properties — all 90 features carry zero properties
  PASS  geometry is bounded LineString — 19961 coordinates across 90 LineStrings, all in range, 0 degenerate
  PASS  byte-level attribution sweep — none of [...] present in 439858 bytes
OK year=dc33 runCount=90 totalKm=658.4
EXIT=0
```

`?meta=1` live: `{"year":"dc33","generatedAt":"2025-08-15T02:41:54.347Z","runCount":90,"totalKm":658.4}`

An independent walk of the live features — not trusting the verifier — found **0 of 90**
degenerate.

## The contract line

Changed **in place** from 110 to 90. The probe's parser is anchored multiline
(`/^HEATMAP_DC33_RUNCOUNT=(\d+)$/gm`) and **fails closed** on two differing values, so the
dated correction note above the fenced block was written to refer to the token only in
prose, never at a line start followed by an equals sign and digits.

Verified by replaying the probe's exact parser against the edited file:

```
count of contract lines: 1
value: HEATMAP_DC33_RUNCOUNT=90
probe parser returns: 90 (hits=1)
```

`HEATMAP_DC33_TOTALKM` and `HEATMAP_DC33_GENERATEDAT` remain at one line each, unchanged in
value.

71-04's **run-evidence sections were deliberately left byte-untouched** — they are the true
historical record of a build that really did produce 110, and rewriting them would falsify
the record. Only the live-state claims were corrected: the contract line and the frontmatter
`provides` entry, both of which describe the object as it exists now. The note says so
explicitly.

## Verification results

| # | Gate | Result |
|---|------|--------|
| 1 | Node >= 22.12 for every script invocation | `v22.12.0` via `nvm use 22.12.0` |
| 2 | Verifier vs live DC33, **before** | **exit 1** — `FAIL features[0] is degenerate: all 2 coordinates are [0, 0]` |
| 3 | Verifier vs live DC33, **after** | **exit 0**, 7/7 pass, `0 degenerate` |
| 4 | Verifier `--selftest` first | exit 0 — four fixtures, so the pass is not vacuous |
| 5 | Dry-run artifact | exit 0, 7/7 |
| 6 | Exactly one contract line, matching live | **1**, value `90` == live `runCount` 90 |
| 7 | CloudFront invalidation | `IAX573OYBXW9L50YLMZ319H9GS` — **Completed** |
| 8 | `generatedAt` byte-identical | **true** |
| 9 | `totalKm` within 1% | **0.0000%** |
| 10 | Independent degenerate walk on live | **0 of 90** |
| 11 | Scratch file untracked | `git status --porcelain \| grep -c dc33-heatmap.local.json` → **0** |
| 12 | No file deletions in the commit | `git diff --diff-filter=D HEAD~1 HEAD` → empty |

`--selftest` was run before trusting the verifier on real bytes, per 71-04's own guidance,
so a green result cannot be a vacuously-passing check.

## Threat model dispositions

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-71-15-01 | mitigate | **done** — unwrapped round-trip non-attributability assertion, tightened verifier re-run against the live URL, and the whole publication gated on a blocking human review of the measured diff |
| T-71-15-02 | mitigate | **done** — same `assembleHeatmapArtifact` as the guarded path; live bytes independently re-walked; set equality proves nothing was widened or invented |
| T-71-15-03 | mitigate | **done** — approval recorded here, and the in-place note carries the date, the reason and the invariants |
| T-71-15-04 | mitigate | **done** — `generatedAt` compared byte-for-byte pre and post, unchanged |
| T-71-15-05 | mitigate | **done** — explicit invalidation created and waited to `Completed`; re-derivation performed on a proven cache `Miss` |

Also held from 71-04: the cross-account source read stayed read-only (`GetObject` only, no
write to account 427284555693), no Terraform was touched, no IAM was widened, no dependency
was added, and **no local `terragrunt apply` was run** (AGENTS.md Essential Rule 4).

## Deviations from Plan

None — plan executed exactly as written. No auto-fixes were required and no architectural
decisions arose.

Two elective accuracy edits, both inside the plan's `<files>` scope and neither affecting
the parsed contract:

- 71-04's frontmatter `provides` entry still described the live object as "110 runs"; it now
  reads 90 with a pointer to the correction note. Left stale it would have been a false
  statement about production.
- The sentence under the contract block was extended by one parenthetical noting the
  run-count value was re-taken from the republish's stdout, preserving that block's
  "not hand-typed from prose" property.

## Notes for 71-16

- **Probe assertion 17 should flip red → green.** It counts degenerate DC33 features
  directly; it was red because 20 of 110 were degenerate, and the live artifact now reports
  `0 of 90`. That flip is attributable to this plan and is the cleanest single observable of
  it.
- **Assertion 5's dc33 leg flips to exit 0**, but **assertion 5 as a whole stays red** — it
  requires exit 0 for *both* years, and the dc34 leg still fails on `meta.runCount is 0,
  expected > 0` (confirmed live during this plan). That is calendar-bound: zero con-day runs
  exist until 5 Aug 2026. Per 71-10, do **not** soften that liveness check to turn it green.
- **Assertion 6 stays green.** It cross-checks the served `runCount` against the contract
  line in 71-04. Both sides moved together in this plan; had only one been updated it would
  have gone red.
- **`?meta=0` still returns the 86-byte meta projection.** 71-10's exact-match fix is source
  only and undeployed. Unchanged by this plan, flips with the 71-16 release. Do not chase it.
- **The DC34 artifact was not touched.** Its scheduled builder is out of this plan's scope by
  prohibition.
- **Rollback**, if ever needed, is the previous S3 version
  `3dkP1yTwGpmX2mOSll6JLCHkf3C1HT.W` on a versioned bucket, plus reverting the contract line
  and a fresh invalidation. Nothing else in AWS changed.

## Known Stubs

None. No placeholder values, no unwired data sources, no TODO markers introduced. Every
path exercised ran against real production data.

## Threat Flags

None. This plan added no network endpoint, no auth path and no schema change. The two
trust-boundary crossings it exercises — the cross-account export read and the prefix-scoped
production write — are already registered as T-71-16 and T-71-19 from plan 71-04, and both
behaved as documented.

## Self-Check: PASSED

- `71-15-SUMMARY.md` — FOUND
- `71-04-SUMMARY.md` — FOUND, `grep -cE '^HEATMAP_DC33_RUNCOUNT=[0-9]+$'` → `1`, value `90`
- commit `4a80157e` — FOUND in `git log --all`
- live artifact `uploads/HEATMAP/dc33.json` — FOUND, ETag `3f1878668c91fe2ac8b7fac2e5b632f9`,
  VersionId `_AdmFzLQkjVbkkkNgjIgikJGNze6EmZj`
- CloudFront invalidation `IAX573OYBXW9L50YLMZ319H9GS` — FOUND, status `Completed`
- no secret values present in this file (only credential lengths)
