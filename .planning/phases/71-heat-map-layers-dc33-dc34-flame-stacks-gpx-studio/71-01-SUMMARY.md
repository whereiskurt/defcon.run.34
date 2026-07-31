---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
plan: 01
subsystem: run.gpx/webapp lib
tags: [heatmap, geojson, polyline, privacy, pure-module, tdd]
status: complete
requires: []
provides:
  - "lib/heatmap-artifact.ts — HeatmapYear/HeatmapMeta/HeatmapFeature/HeatmapArtifact types"
  - "heatmapArtifactKey(year) → uploads/HEATMAP/{year}.json (the one key source of truth)"
  - "isHeatmapYear() allowlist for the public route's dynamic segment"
  - "trkptCoords / normalizeTrack / trackKm bounded geometry helpers"
  - "assembleHeatmapArtifact() — bare non-attributable FeatureCollection + embedded meta"
  - "assertNonAttributable() — the phase's single publish chokepoint (T-71-03)"
  - "lib/polyline-decode.ts — decodeTrack() dual-format DC33 decoder, MAX_POLYLINE_CHARS"
affects:
  - "71-02 builder: imports assembleHeatmapArtifact + assertNonAttributable + heatmapArtifactKey"
  - "71-03 serve route: imports isHeatmapYear + heatmapArtifactKey; deletes its local trkptCoords copy"
  - "71-04 backfill: imports decodeTrack + assembleHeatmapArtifact + assertNonAttributable"
  - "71-05 studio layer: consumes the served artifact shape"
tech-stack:
  added: []
  patterns:
    - "Dependency-free pure module (zero imports) so scripts/, route handlers and vitest share one contract"
    - "Reserved-sentinel S3 key segment (HEATMAP, like ROUTES/GLOBAL) under the IAM-scoped uploads/ prefix"
    - "Structural allowlist guard as a compensating privacy control, not a filter"
key-files:
  created:
    - apps/run.gpx/webapp/src/lib/heatmap-artifact.ts
    - apps/run.gpx/webapp/src/lib/heatmap-artifact.test.ts
    - apps/run.gpx/webapp/src/lib/polyline-decode.ts
    - apps/run.gpx/webapp/src/lib/polyline-decode.test.ts
  modified: []
decisions:
  - "Artifact meta is EMBEDDED on the FeatureCollection, not a sidecar — one atomic write, one fetch, stamp can never skew against its geometry (D-06, Claude's Discretion)"
  - "Encoded-polyline decoder ported (~60 lines with guards) rather than adding the Mapbox polyline npm package — one frozen consumer, no permanent supply-chain surface (T-71-SC)"
  - "The encoded decoder returns null (→ []) on an out-of-alphabet character or truncated chunk rather than salvaging a partial result, so 'null' and punctuation cannot decode into plausible coordinates"
  - "trkptCoords was hoisted byte-identically from aggregate/route.ts so 71-03 can delete its copy with zero behaviour change"
metrics:
  duration: ~15 min
  completed: 2026-07-30
  tasks: 2
  commits: 4
  tests_added: 36
  files_created: 4
---

# Phase 71 Plan 01: Heat-Map Artifact Contract & DC33 Polyline Decoder — Summary

Two dependency-free modules that settle the shape every other Phase 71 plan codes
against: the heat-map artifact contract (types, IAM-legal S3 key, bounded geometry
helpers, assembler, and the single non-attributability guard) plus a dual-format DC33
`summary_polyline` decoder — 36 new vitest cases, zero new npm dependencies.

## What Was Built

### Task 1 — `lib/heatmap-artifact.ts` (24 tests)

The phase's contract module. **Zero imports** by design, so the scheduled builder
(71-02), the public serve route (71-03), the one-off `scripts/` backfill (71-04) and
vitest can all use it without dragging in the ElectroDB entity config or the S3 client's
environment chain.

| Export | Role |
|---|---|
| `HeatmapYear`, `HEATMAP_YEARS` | The two-value allowlist |
| `isHeatmapYear()` | Plain membership check — no regex, no normalisation — for the public route's dynamic segment |
| `heatmapArtifactKey()` | `uploads/HEATMAP/{year}.json`, the one source of truth for where the artifact lives |
| `MAX_TRACK_POINTS` / `MAX_RUNS` / `COORD_PRECISION` | 300 / 5000 / 5 — response-size bounds on an unauthenticated CDN route |
| `HeatmapMeta` / `HeatmapFeature` / `HeatmapArtifact` | The embedded-meta FeatureCollection shape |
| `trkptCoords()` | Hoisted byte-identically from `aggregate/route.ts` |
| `normalizeTrack()` | Finite + in-range filter → 5-dp rounding → even-stride decimation keeping first and last |
| `trackKm()` | Haversine over `[lon, lat]`, kilometres, R=6371 |
| `assembleHeatmapArtifact()` | Bare-geometry features (`properties: {}` and nothing else) + computed `meta` |
| `assertNonAttributable()` | The phase's single publish chokepoint |

`assertNonAttributable` is the substantive piece. HEAT-06 consciously removed the
`includeInAggregate` opt-in gate, so this structural guard **is** the compensating control
that keeps the widened data set publishable (T-71-03). It throws — naming the offending
path — when the root is not an object, when the root carries any key outside
`type`/`meta`/`features`, when `features` is not an array, when a feature carries any key
outside `type`/`properties`/`geometry`, when a feature's `properties` has one or more own
keys, when a geometry carries an extra key, or when a geometry is not a `LineString`.
Its doc comment states that no caller may catch-and-continue: a throw means *do not
publish*, not *publish anyway*.

### Task 2 — `lib/polyline-decode.ts` (12 tests)

`decodeTrack(raw)` — one entry point, never throws, always emits GeoJSON `[lon, lat]`,
returns `[]` for anything it cannot understand. Resolution order mirrors DC33's
`api/heatmap/route.ts`:

1. Reject non-strings, oversized input (`MAX_POLYLINE_CHARS = 200000`, T-71-01), and
   empty/whitespace-only strings.
2. A `[`-prefixed string is `JSON.parse`d in a try/catch and read as either two-number
   `[lat, lon]` arrays (the DC33 manual-upload shape) or `{lat, lng|lon}` objects. The
   parsed value is only ever **iterated as an array and read by fixed key** — never used
   as a lookup map, never spread into an accumulator — so a `__proto__` key smuggled
   through the export is inert (T-71-02, asserted by test).
3. Otherwise the ported Google encoded-polyline algorithm at precision 5.

The decoder **bails rather than salvages**: an out-of-alphabet character, a chunk whose
continuation bit runs off the end of the string, or a latitude with no matching longitude
returns `null` → `[]`. That is what makes `'null'` and `'~!@#$%^&*()'` return `[]` instead
of decoding into plausible-looking coordinates — worth calling out because a partial-result
decoder would have silently injected phantom geometry into the DC33 backfill.

## Verification

All plan-level and task-level acceptance criteria were run and pass:

| Check | Result |
|---|---|
| `npx vitest run src/lib/heatmap-artifact.test.ts` | 24 passed (plan required ≥14) |
| `npx vitest run src/lib/polyline-decode.test.ts` | 12 passed (plan required ≥8, incl. the canonical Google fixture) |
| `npm test` (whole suite) | 288 passed, 1 skipped, 33 files — no regression |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `grep -c "^import" heatmap-artifact.ts` | `0` (dependency-free) |
| `grep -c "^import" polyline-decode.ts` | `0` |
| `grep -c "uploads/HEATMAP/" heatmap-artifact.ts` | `2` |
| `grep -Ec "properties: *\{ *\}" heatmap-artifact.ts` | `1` |
| `grep -Ec "@mapbox/polyline\|require\(.polyline" polyline-decode.ts` | `0` |
| `grep -c "MAX_POLYLINE_CHARS" polyline-decode.ts` | `2` |
| `git diff --stat -- package.json package-lock.json` | empty — **no dependency added** |
| `trkptCoords` regex byte-identity vs `aggregate/route.ts:25` | `diff` produces no output |
| Deletions across all four commits | none |

**Node version note:** vitest in this app requires Node ≥22.12 — the default `v22.1.0`
fails config load with `ERR_REQUIRE_ESM` on `std-env`. All runs above used
`~/.nvm/versions/node/v22.12.0`. This matches the known `reference_node_version_for_bib_tests`
gotcha and applies to 71-02/03/04 as well.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Stray NUL/SOH control bytes in `polyline-decode.test.ts`**
- **Found during:** Task 2, immediately after the first (RED) commit
- **Issue:** Line 133 of the never-throws input sweep contained the raw bytes
  `0x00 0x01` inside a string literal instead of a space. Git's binary heuristic then
  classified a TypeScript source file as binary (`Bin 0 -> 4188 bytes` in `--stat`),
  which would have made the file undiffable and unreviewable in the PR.
- **Fix:** Stripped control bytes to a plain space; audited the other three new files
  for the same defect (all clean, `0` matches for `[\x00-\x08\x0b\x0c\x0e-\x1f]`).
- **Files modified:** `apps/run.gpx/webapp/src/lib/polyline-decode.test.ts`
- **Commit:** `114c76a1` (the RED commit was amended so the repo never carries a
  binary-flagged source file; the commit was local and unpushed)

### Plan/criteria conflicts resolved

**2. `@mapbox/polyline` doc-comment vs. the grep acceptance criterion**
- Task 2's `<action>` mandates a doc comment noting that adding `@mapbox/polyline` was
  declined, while its `<acceptance_criteria>` requires
  `grep -Ec "@mapbox/polyline|require\(.polyline"` to return `0`. Written literally, the
  two cannot both hold.
- **Resolution:** the criterion's intent is "no actual usage", and the authoritative
  no-dependency proof is the empty `package.json`/`package-lock.json` diff. The doc
  comment keeps the rationale but names the package as "the Mapbox `polyline` npm
  package" — fully readable to a maintainer, and both the criterion and the plan's
  documentation requirement are satisfied without obfuscation.

**3. Dependency count in the doc comment**
- Plan text said run.gpx/webapp has 12 runtime dependencies; the measured value is 13.
  The comment records the measured figure.

### Discretionary decisions (all pre-authorised by the plan)

- Embedded `meta` (not a sidecar) — implemented as specified in the grounding section.
- `polyline-decode.ts` imports nothing at all rather than importing constants from
  `heatmap-artifact.ts`. The plan permitted that import; it turned out to be unnecessary
  and omitting it keeps both modules independently importable.

## Deferred Issues

One out-of-scope, pre-existing problem was logged, not fixed — see
`.planning/phases/71-.../deferred-items.md`:

- **D-71-A:** `npx eslint` crashes on config load in `apps/run.gpx/webapp`
  (`TypeError: Converting circular structure to JSON`, `property 'react' closes the
  circle`). Reproduced on untouched `src/lib/con-days.ts` before any Phase 71 file
  existed. `npm run lint` is non-functional app-wide; `tsc` and `npm test` are unaffected.

## Known Stubs

None. Both modules are complete and fully exercised; nothing returns a hardcoded empty
or placeholder value.

## Threat Flags

None. No new network endpoint, auth path, file access pattern, or schema change at a
trust boundary was introduced — both files are pure in-process functions. The threats the
plan enumerated are addressed in code and asserted by tests:

| Threat | Status |
|---|---|
| T-71-01 (DoS via oversized polyline) | `MAX_POLYLINE_CHARS` + `MAX_TRACK_POINTS` + `MAX_RUNS`, all tested |
| T-71-02 (prototype pollution via export JSON) | Fixed-key reads only; `__proto__` inertness asserted |
| T-71-03 (attributable data reaching a public object) | `assertNonAttributable` implemented; throws on all six enumerated shapes |
| T-71-SC (supply chain) | Zero packages installed; empty lockfile diff enforces it |

## Notes for Later Plans

- **71-02 / 71-04 must call `assertNonAttributable(artifact)` immediately before the
  `PutObject`, and must not wrap it in a try/catch that continues.** It is the only
  compensating control for HEAT-06 dropping the opt-in gate.
- **71-03 should delete `trkptCoords` from `aggregate/route.ts` and import it from
  `@/lib/heatmap-artifact`** — the regex was hoisted byte-identically and verified by
  `diff`, so this is a pure de-duplication with no behaviour change.
- **Never hand-build the S3 key.** Call `heatmapArtifactKey()`. The `uploads/` prefix is
  an IAM hard requirement (`s3-uploads/v1.0.0/iam.tf` scopes the run.gpx user to
  `${bucket}/uploads/*`); a top-level `heatmap/` key AccessDenies at runtime.
- **Run tests under Node ≥22.12** (`nvm use 22.12.0`).

## Self-Check: PASSED

All four created files exist on disk; all four commit hashes (`f6d7c0a7`, `b4ed1bf3`,
`114c76a1`, `5cceb5c9`) resolve in `git log`.
