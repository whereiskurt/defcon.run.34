---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
plan: 03
subsystem: run.gpx/webapp public API + compliance comments
tags: [heatmap, public-route, cdn-cache, allowlist, privacy, heat-06, comments-only]
status: complete
requires:
  - "71-01: isHeatmapYear / heatmapArtifactKey / HeatmapArtifact / trkptCoords in lib/heatmap-artifact.ts"
  - "71-02: lib/heatmap-build.ts (referenced by the reconciled comments; writes the object this route reads)"
provides:
  - "GET /api/gpx/public/heatmap/[year] — serves the precomputed S3 artifact, unauthenticated, CDN-cached"
  - "?meta=1 — meta-only projection (year, generatedAt, runCount, totalKm) for cheap availability + 'last calculated' stamp"
  - "CACHE_SECONDS = 900 on the serve route (s-maxage + stale-while-revalidate)"
  - "One trkptCoords parser shared by aggregate/route.ts and lib/heatmap-artifact.ts"
  - "HEAT-06 first half: the codebase tells one story about what may be published"
affects:
  - "71-05 heatmap-layer.ts: fetches this route (full artifact on first enable)"
  - "71-06 HEAT MAP dialog section: calls ?meta=1 at map load for availability + the stamp"
  - "71-08 live verification: probes /api/gpx/public/heatmap/dc32 → 404 and dc33/dc34 → 200"
tech-stack:
  added: []
  patterns:
    - "Next 16 dynamic segment: interface RouteParams { params: Promise<{ year: string }> } with awaited params (routes/[id]/route.ts idiom)"
    - "Allowlist-before-key-construction — the untrusted segment is narrowed to a union type before any S3 key exists"
    - "Per-query-value CDN cache entry (public/checkins/route.ts idiom) rather than a second route for meta"
    - "Missing artifact → 404, corrupt artifact → 500: absence and breakage get different codes"
key-files:
  created:
    - apps/run.gpx/webapp/src/app/api/gpx/public/heatmap/[year]/route.ts
  modified:
    - apps/run.gpx/webapp/src/app/api/gpx/public/aggregate/route.ts
    - apps/run.gpx/webapp/src/entities/gpx-file.ts
decisions:
  - "71-03: a missing artifact returns 404 rather than 500 — an unbuilt year is absent, not broken; the studio hides the row either way and nobody gets paged. A corrupt-but-present object still returns 500 because that IS a server fault."
  - "71-03: an empty S3 body is treated as a missing artifact (404), not a parse failure — JSON.parse('') would otherwise turn a truncated write into a 500."
  - "71-03: the allowlist check is the FIRST statement after awaiting params, inside the outer try — so an unknown year costs one string comparison and never reaches S3 (confirmed in the dev log: dc32 and a traversal probe produced no S3 call at all)."
  - "71-03: CACHE_HEADERS hoisted to a module const so the full-artifact and ?meta=1 responses cannot drift apart in cache policy."
  - "71-03: the superseded exclusivity claim is deleted, not softened — the rewrite states in past tense what the comment used to assert and why it is false, so a future reader sees the reversal rather than a comment that quietly changed its mind."
  - "71-03: gpx-file.ts's three comments each got an EXEMPT SURFACE / SCOPE block naming the date, the surface, and lib/heatmap-build.ts — the includeInAggregate one carries an explicit do-not-reintroduce-this-predicate warning, matching the one 71-02 put at the builder's selection block from the other side."
metrics:
  duration: ~25 min
  completed: 2026-07-31
  tasks: 3
  commits: 3
  tests_added: 0
  files_created: 1
  files_modified: 2
---

# Phase 71 Plan 03: Public Heat-Map Serve Route & Compliance Reconciliation Summary

The public, unauthenticated `/api/gpx/public/heatmap/[year]` route that serves the
precomputed S3 artifact (plus its `?meta=1` projection), the collapse of a duplicated GPX
coordinate parser, and the HEAT-06 comment reconciliation that stops the codebase asserting
a compliance model its own shipped builder ignores.

## What Was Built

### Task 1 — `api/gpx/public/heatmap/[year]/route.ts` (new, 104 lines)

`GET /api/gpx/public/heatmap/{dc33|dc34}` → the whole `HeatmapArtifact`;
`?meta=1` → the `meta` block alone. Order of operations inside `GET`:

1. `await params`
2. `isHeatmapYear(year)` — anything else is an immediate 404, **before** an S3 key exists
3. `GetObjectCommand` on `heatmapArtifactKey(year)` → `transformToString()`
4. `JSON.parse` in its own try/catch
5. `?meta` projection or the full artifact, both with the same `CACHE_HEADERS`

`CACHE_SECONDS = 900`, longer than the aggregate route's 600 because the object is
precomputed and rebuilt at most hourly, so a staler edge copy costs nothing in freshness
and buys full CDN absorption of repeat load. No `auth()`, no cookie read, no session
lookup — the absence is the entire "public route" mechanism here, and it is also why a
shared CDN entry has no per-user variation to leak.

Failure taxonomy: S3 error or empty body → `{ error: "Not found" }` 404 (an unbuilt year
is absent, and the studio hides the row); parse failure or anything else → generic
`{ error: "Failed to load heatmap" }` 500. The S3 error, the bucket name and the key are
logged on the `[heatmap]` tag server-side only and never reach the caller.

### Task 2 — one parser instead of two

Deleted the local `trkptCoords` from `aggregate/route.ts` and imported the byte-identical
function 71-01 hoisted into `lib/heatmap-artifact.ts`. The call site, the `scan.where`
predicate, `MAX_ROUTES`, the response shape and the cache headers are untouched — the diff
is exactly one added import and one removed function. `gpx-accomplishment.ts` and
`scripts/import-dc33.ts` keep their variants: they carry extra behaviour (elevation
capture, bounds) and unifying them is out of this phase's scope.

### Task 3 — HEAT-06: the compliance comments now match the shipped decision

**`aggregate/route.ts`** — the sentence "This is the only public surface permitted for
Strava-derived routes (per the compliance model)" is gone. In its place, a dated
SUPERSEDED CLAIM block records that Phase 71 added a second non-attributable public
surface, that the heat map sources every con-day-assigned run with geometry and applies no
owner opt-in filter, that `includeInAggregate` gates the aggregate route and nothing else,
that Kurt made the call on 2026-07-30 with the superseded sentence in front of him, and
that the compensating control is structural — `assertNonAttributable()` refusing
publication — rather than consent-based. It closes with an explicit DO NOT "restore" an
opt-in predicate warning, and the pre-existing NOTE about precomputing to an S3 artifact is
kept and extended to say Phase 71 did exactly that. The first paragraph's description of
what this route actually does is unchanged.

**`entities/gpx-file.ts`** — `source`, `publicShareEligible` and `includeInAggregate` each
gained an EXEMPT SURFACE / SCOPE paragraph naming the Phase 71 heat map, the 2026-07-30
date, why the flag's attribution concern is not engaged by a zero-property LineString, and
`lib/heatmap-build.ts` so the next reader can check the selection themselves. The
`includeInAggregate` note carries the do-not-reintroduce warning from the entity side,
pairing with the one 71-02 placed at the builder's selection block.

No executable line changed in either file.

## Verification Performed

| Check | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | PASS |
| `npm test` | 303 passed / 1 skipped — identical to the pre-plan baseline |
| `npm run build` | PASS; route table lists `/api/gpx/public/heatmap/[year]` |
| `heatmap/dc32` on dev :3003 | **404**, and the dev log shows **no S3 call** — the allowlist fired, not a bucket miss |
| `heatmap/..%2F..%2Fetc` on dev :3003 | 404, again with no S3 call (T-71-10) |
| `heatmap/dc33`, `heatmap/dc34`, `dc34?meta=1` | 404 via the S3-error path (no artifact and no local S3 credentials) — the plan's accepted outcome |
| `grep -Ec 'auth\(\)\|from "@/config/auth"\|cookies\(\)'` on the new route | 0 |
| `grep -Ec '[$][{]year[}]'` on the new route | 0 — the raw segment is never interpolated |
| `isHeatmapYear` line number < `heatmapArtifactKey` line number | 5 < 6 (imports) and 58 < 65 (allowlist call before key call) |
| `grep -c 's-maxage='` on the new route | 1 |
| `grep -c 'function trkptCoords'` / `grep -c 'trkptCoords'` in aggregate | 0 / 2 (import + call site) |
| `grep -c 'only public surface'` in aggregate | 0 |
| `grep -Ec 'sole public surface\|only surface permitted\|only permitted public'` | 0 |
| `2026-07-30` / `assertNonAttributable` / `heatmap` in aggregate | 2 / 1 / 4 |
| `Phase 71` / `heatmap-build` in `gpx-file.ts` | 3 / 3 |
| Task 3 full assertion chain | prints `HEAT06_COMMENTS_ONLY_OK`, exit 0 |
| `git diff --stat` on `package.json` / `package-lock.json` | empty (T-71-SC) |
| Deleted files across the three commits | none |

### The comments-only gate was observed RED before it was trusted

Run with the diff assertion alone, so no build or test failure could be mistaken for the
gate firing:

| State of `gpx-file.ts` | Exit code |
|---|---|
| clean tree (baseline) | **0** |
| `const _heat06GateProbe = 1;` appended | **1** |
| probe removed | **0** |

The gate distinguishes an executable line from a comment line, which is precisely the
property Task 3 depends on.

## Deviations from Plan

### Auto-fixed / adjusted

**1. [Rule 2 - Missing critical handling] Empty S3 body treated as a missing artifact**
- **Found during:** Task 1
- **Issue:** the plan's step 3 covers "any S3 error" but `obj.Body?.transformToString()`
  can resolve to `undefined` (no body) without throwing, and a `JSON.parse(undefined)`
  would then surface a truncated or zero-byte write as a 500 rather than as absence.
- **Fix:** an explicit `if (!body)` → logged 404, alongside the S3-error 404.
- **Commit:** e9803880

**2. [Wording, to satisfy an acceptance criterion] Two comment phrasings adjusted**
- **Found during:** Task 1 self-check
- **Issue:** the module comment originally said "no `auth()` call", which tripped the
  `grep -Ec 'auth\(\)...' == 0` criterion, and an inline comment named
  `heatmapArtifactKey()` on a line above the allowlist, which muddied the
  allowlist-precedes-key-construction ordering criterion.
- **Fix:** reworded to "no session lookup" and "the key helper below". No behaviour change.
- **Commit:** e9803880

**3. [Housekeeping] Build artifacts kept out of the commits**
- `tsconfig.tsbuildinfo` (tracked, rewritten by every `tsc`) and `next-env.d.ts` (flips
  between `./.next/dev/types/routes.d.ts` and `./.next/types/routes.d.ts` depending on
  whether `dev` or `build` ran last) were `git restore`d before each staging step. Neither
  appears in any commit.

Nothing else deviated. No architectural (Rule 4) decisions arose.

## Known Gaps / Notes for Later Plans

- **The 200 path is not locally proven.** The dev environment has no S3 credentials and no
  local MinIO, so every artifact read returned the 404 branch. The full-artifact and
  `?meta=1` 200 responses are exercised for the first time by 71-04 (which writes the DC33
  object) and confirmed live by 71-08's probes. The plan explicitly accepted a 404 here;
  the load-bearing local evidence — `dc32` 404ing *without touching S3* — was obtained.
- **`?meta=1` contract for 71-06:** the meta response is the bare `HeatmapMeta` object
  (`{ year, generatedAt, runCount, totalKm }`), **not** wrapped in `{ meta: ... }`.
- **Availability signalling for 71-05/71-06:** any non-ok status means "unavailable, hide
  the row". A year with no artifact returns 404, so a `?meta=1` probe is a complete
  availability check on its own.
- **No unit tests were added** — the plan specifies none for this route, and its logic is
  three guards over an S3 read. 71-08's live probes are the coverage.

## Threat Mitigations Applied

| Threat | Disposition | How |
|---|---|---|
| T-71-10 tampering via `[year]` → S3 key | mitigated | `isHeatmapYear()` narrows to a union before any key exists; verified `dc32` and a percent-encoded traversal both 404 with zero S3 calls in the dev log |
| T-71-11 DoS on an unauthenticated route | mitigated | one S3 GET + one parse per request, size bounded upstream by `MAX_RUNS`/`MAX_TRACK_POINTS`/`COORD_PRECISION`, `s-maxage=900` lets CloudFront absorb repeats |
| T-71-12 info disclosure via errors | mitigated | fixed generic messages on every failure path; S3 error, bucket and key logged server-side only |
| T-71-13 cache poisoning / shared-cache leak | mitigated | no cookie, no session lookup, so no per-user variation exists; `?meta=1` is its own cache entry |
| T-71-14 repudiation of the superseded comment | mitigated | the decision, its owner, its date and its compensating control are now recorded in the source, auditable without the planning artifacts |
| T-71-SC supply chain | mitigated | zero packages installed; `package.json` and `package-lock.json` diffs empty |

## Self-Check: PASSED

- `apps/run.gpx/webapp/src/app/api/gpx/public/heatmap/[year]/route.ts` — FOUND
- `apps/run.gpx/webapp/src/app/api/gpx/public/aggregate/route.ts` — FOUND (modified)
- `apps/run.gpx/webapp/src/entities/gpx-file.ts` — FOUND (modified)
- Commit `e9803880` — FOUND
- Commit `62496f31` — FOUND
- Commit `eb7a7881` — FOUND
