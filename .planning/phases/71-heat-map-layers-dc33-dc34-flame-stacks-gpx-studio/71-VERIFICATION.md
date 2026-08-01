---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
verified: 2026-07-31T21:40:00Z
status: human_needed
score: 21/24 must-haves verified
behavior_unverified: 3
overrides_applied: 0
verifier_head: e06671ea
live_version: run.gpx v0.0.110 (ECS run-gpx-use1-dc34:200, image dc34-run-gpx-app:v0.0.110)
re_verification:
  previous_status: gaps_found
  previous_score: 18/24
  gaps_closed:
    - "Toggling 🔥 DC33 renders a legible stacked flame whose overlap visibly intensifies (SC-1 / D-13)"
    - "Live artifact fetches are CDN-cached (SC-4 second clause / HEAT-01)"
    - "The internal build route is not reachable from the public internet (71-08 T5 / CR-01)"
  gaps_remaining: []
  regressions: []
gaps: []
deferred: []
behavior_unverified_items:
  - truth: "The DC34 artifact regenerates on schedule — submitting a new run changes the artifact within ~an hour during the con. (ROADMAP SC-2, first clause; 71-07 T1)"
    test: "During 5-10 Aug 2026 run 71-08-probes/heatmap-probe.cjs unmodified across two consecutive hours and watch dc34 meta.generatedAt; separately submit a run tagged with a DC34 con-day and confirm runCount increases within one schedule interval."
    expected: "generatedAt moves hourly (not only at the 04:20 PT daily), and a newly submitted con-day run appears in the artifact within one interval."
    why_human: >-
      SUBSTANTIALLY UPGRADED since the prior verification, but not closed. The scheduled-fire
      half is now behaviourally PROVEN, not merely armed: CloudWatch shows an unattended
      EventBridge->Lambda->internal route->S3 build at 2026-07-31T11:00:36Z, which is 04:00 PT
      under the then-current daily cron and predates the 71-14 apply (18:28:03Z) — so it was a
      real schedule firing, not an operator invoke. What remains unobservable is (a) the hourly
      con-window cadence `cron(0 * 5-10 8 ? 2026)`, which cannot fire before 5 Aug, and (b) that
      a newly submitted run CHANGES the artifact, because 0 rows carry a conDay today. The
      currently-deployed daily `cron(20 4 * * ? *)` plus the 71-14 Lambda has also not yet had
      its own first unattended fire (next ~2026-08-01T11:20Z).
  - truth: "Every con-day-assigned, active, non-GLOBAL run with readable GPX geometry contributes exactly one LineString to the DC34 artifact — with no opt-in filter anywhere in the selection. (71-02 T1 / HEAT-02 / D-03)"
    test: "During the con, compare the DC34 artifact's runCount against a DynamoDB count of active, non-GLOBAL run-gpx-electro items with a conDay in CON_DAYS, including at least one run whose owner has includeInAggregate=false."
    expected: "Counts match, and the opted-OUT runner's run IS present in the artifact (that is the point of D-03)."
    why_human: >-
      The predicate is correct by inspection (`status=active AND exists(conDay) AND
      userId != GLOBAL`, narrowed to `conDay ∈ CON_DAYS`) and `includeInAggregate` is provably
      absent from the builder, and 79 unit tests now pin it (up from 51). But it has still never
      executed against a real con-day row — the live DC34 artifact is valid-but-empty
      (runCount 0), so selection, dedup and the S3 fan-out remain unexercised end-to-end.
  - truth: "A runner who left a heat layer on yesterday finds it on today, and the map camera does not move because of it. (71-05 T3)"
    test: "Toggle 🔥 DC33 on, reload gpx.defcon.run/use1/studio/app, and confirm the row is still checked, the orange geometry is present in the style, and the camera stays exactly where it was."
    expected: "Layer restored ON with no fitBounds and no recentre."
    why_human: >-
      Correct by inspection and now partially covered by proxy: Phase 70 regression assertion 16
      exercises the SAME restore mechanism (seeded route + check-in ids) and reports
      `camera before -0.1276,51.5074@9 after ...@9.000 moves=0`. But it seeds route/check-in ids,
      not heat ids, so the heat-map restore transition specifically is still unexercised. I
      re-confirmed the two structural safeguards: `loadMeta()` commits availability and restored
      visibility in ONE `heatmapState.set()`, and grep finds ZERO `fitBounds|flyTo|easeTo|
      setCenter|jumpTo` anywhere in heatmap-layer.ts.
human_verification:
  - test: "Open https://gpx.defcon.run/use1/studio/app in a REAL browser on real hardware → Map Layers → turn OFF DEF CON 34 Routes / Rabbit Routes / User Check-ins → turn ON 🔥 DC33 — the classic → zoom to the Strip."
    expected: "A visible orange flame stack whose busy corridors (the Strip, LVCC Loop, Convention Center) read heavier than one-off spurs."
    why_human: >-
      KNOWN, DELIBERATELY-ACCEPTED RESIDUAL — not a discovery. 71-16 Task 5 was closed on
      evidence on 2026-07-31; Kurt chose "close it out" and did not report opening the studio.
      Every capture in this phase is headless Chromium on a software rasteriser, and D-13 is
      fundamentally a judgement about whether the stack reads as heat to a human eye. I have
      independently inspected shot-dc33-SHIPPED-0.70-detail.png myself and it IS legible with a
      real density gradient — but that is my read of a headless capture, not a human's read of
      real hardware.
  - test: "Confirm the DC33 hint bar in the live studio reads ~90 runs and ~658.4 km."
    expected: "Hint bar shows 90 runs / 658.4 km (down from the pre-fix 110 runs)."
    why_human: "71-16 Task 5 residual item 2, recorded as unperformed. The served meta is machine-verified at runCount 90 / totalKm 658.4; what is unconfirmed is the number a person sees in the UI."
  - test: "Spot-check a ghost claim link end to end (meshtk MESHTK_RUN_INTERNAL_URL → run.human /api/internal/ctf/mint)."
    expected: "The claim link mints and resolves normally — the CloudFront edge block did not widen onto the con-critical CTF flow."
    why_human: >-
      71-16 Task 5 residual item 3, recorded as unperformed. Probe assertion 16 (the blast-radius
      regression gate) is GREEN and I re-derived it myself — mint returns 405 and run.auth quota
      returns 401, NEITHER carrying x-dc34-edge-block — but a 405/401 proves only that the edge
      did not intercept, not that the full mint flow still works.
  - test: "During 5-10 Aug 2026 re-run 71-08-probes/heatmap-probe.cjs unmodified and confirm assertions 5 (dc34 leg) and 11 go green — including D-12's two-colour clause: 🔥 DC33 and 🔥 DC34 legible SIMULTANEOUSLY."
    expected: "19/19. dc34 meta.runCount > 0, dc34 feature count > 0, and both flame stacks render together in #ff8c00 and #ff0000."
    why_human: >-
      CALENDAR-BOUND, NOT A DEFECT. DEF CON 34 runs 2026-08-05..10 and today is 2026-07-31, so
      zero runs carry a conDay. 17/19 is the perfect pre-con score. The two-colour overlap that
      71-CONTEXT.md calls "the emotional core of the feature" has therefore still never been
      rendered and cannot be until the con. A dated re-probe todo already exists.
---

# Phase 71: Heat Map Layers — DC33 + DC34 Flame Stacks Verification Report

**Phase Goal:** Toggleable per-year heat-map layers in the gpx studio built from runners'
submitted runs, DC33-faithful "stacked flame" style — every run a translucent line
(DC34 `#ff0000`, DC33 `#ff8c00`, **70% opacity per D-13**, width 3) so overlap = heat; a
scheduled builder precomputes a per-year non-attributable S3 artifact hourly during the con;
DC33 built once from the DynamoDB export; served via `/api/gpx/public/heatmap/{dc33|dc34}`
with CDN caching; UI = a HEAT MAP section in the Phase 70 Map Layers dialog.

**Verified:** 2026-07-31T21:40:00Z
**Status:** human_needed
**Re-verification:** **Yes** — after gap closure (plans 71-09..71-16). Previous: `gaps_found` 18/24.
**Verifier HEAD:** `e06671ea` · **Live:** run.gpx **v0.0.110**, task def `run-gpx-use1-dc34:200`

---

## Verdict on the four things I was asked to be adversarial about

### 1. Did the paint contract actually ship? — **YES**

Source reads `HEAT_STROKE = { 'line-width': 3, 'line-opacity': 0.7 }` with
`dc33: '#ff8c00'` and `dc34: '#ff0000'` unchanged. That is necessary but not sufficient, so I
did not stop there. **I ran the probe myself** (byte-identical script, sha256 `0b294c08…`,
`git diff HEAD` empty) and assertion 19 read `line-opacity` **off the live Mapbox style
object**: `0.7`. Assertion 11's diagnostic line independently confirms the live colours —
`dc33 … line-color=#ff8c00`, `dc34 … line-color=#ff0000`.

I also opened `shot-dc33-SHIPPED-0.70-detail.png` and looked at it myself rather than
accepting the SUMMARY's description. It is legible, and the density gradient is real: the
S Las Vegas Blvd corridor is a visibly thick bundle of overlapping strokes, the LVCC Loop and
the Convention Center perimeter read as heavier closed loops, and one-off residential spurs
are thin single lines. Against the prior verification's `shot-dc33-SHIPPED-0.25-invisible.png`
— which was indistinguishable from a bare basemap — this is the difference between the
feature existing and not existing. **The headline gap is closed.**

The honest limit: this is a headless-swiftshader capture, and the on-hardware check
Task 5 asked for was NOT performed. See the human-verification section — that is a recorded,
accepted residual, not something I am discovering.

### 2. Does the non-attributability guard genuinely cover `meta`, `coordinates` contents and root `type`? — **YES, on both paths**

The prior verification's WR-01/WR-02 finding was that the docstring's claim outran the code.
It no longer does. `assertNonAttributable` now, in order: rejects a non-plain-object root;
rejects any root key outside `{type, meta, features}`; **requires `type === "FeatureCollection"`**;
requires `meta` to be a plain object and rejects any key outside
`{year, generatedAt, runCount, totalKm}`; and for every feature walks into
`geometry.coordinates` itself, requiring each element to be a 2-element array of two
**numbers**. All three named holes are real checks with real throws.

Coverage of the paths is complete and I re-derived it by grep rather than by reading the
SUMMARY. There are exactly **two writers** of `uploads/HEATMAP/*`:

- `heatmap-build.ts:295` `assertNonAttributable(artifact)` → `:297` `putArtifact(...)` — adjacent, no try/catch that continues.
- `backfill-dc33-heatmap.ts:289`, plus a second re-assert on the round-tripped bytes at `:331`.

And the **serve path now runs the same guard on the way OUT** —
`[year]/route.ts:137`, inside a `catch` that returns 500 and refuses to serve. That was
WR-02's whole point and it is wired.

I then proved it against the bytes production actually serves, not against source. Fetching
the live `dc33` artifact and walking it myself: root keys exactly `features,meta,type`; meta
keys exactly the four; **90 features, 0 carrying any property, 0 unexpected feature keys, 0
unexpected geometry keys, 0 malformed coordinate pairs**. The standalone verifier's
`--selftest` also now passes four cases including a doctored degenerate fixture it must
reject — so the verifier that certifies the artifact can no longer go vacuous.

D-14 is recorded in the code at `normalizeTrack` (`heatmap-artifact.ts:125-149`) in blunt
terms — "ACCEPTED RISK … DO NOT 'FIX' THIS" — naming Kurt, the date, and the fact that
"no identifier FIELDS" is a different property from "not re-identifiable from geometry".
That is exactly what the gap plan promised and it forecloses a future drive-by "fix". Coord
precision measured on the live bytes is max 5 decimals, unchanged, as D-14 requires.

### 3. Is the internal build route blocked at the edge, in both spellings, for all three routes — without catching the two public-HTTPS internal paths? — **YES, all six blocked, neither collateral path caught**

This was the prior verification's most serious finding: a public POST returned the *handler's
own* `{"error":"Forbidden"}` body, proving the request reached Next.js. I re-probed every
combination myself from the open internet:

| Path | Region-prefixed | No-region |
|---|---|---|
| `/api/gpx/internal/heatmap-build` | 404 + `x-dc34-edge-block: 1` | 404 + `x-dc34-edge-block: 1` |
| `/api/gpx/internal/strava-sync` | 404 + `x-dc34-edge-block: 1` | 404 + `x-dc34-edge-block: 1` |
| `/api/gpx/internal/reconcile` | 404 + `x-dc34-edge-block: 1` | 404 + `x-dc34-edge-block: 1` |

`ls apps/run.gpx/webapp/src/app/api/gpx/internal/` returns exactly those three directories, so
the family is covered exhaustively. The body is **empty** — the marker header is one a
CloudFront Function can emit and the Next.js handler cannot, which is precisely the
discrimination the old "non-2xx" predicate lacked. The inherited `strava-sync` exposure is
closed as a side effect, as 71-13 intended.

**Blast radius, checked independently rather than assumed:**

| Path that legitimately travels over public HTTPS | Result | Marker |
|---|---|---|
| run.human meshtk claim-link mint `/use1/api/internal/ctf/mint` | 405 | **absent** |
| run.auth internal quota family | 401 (probe) / 404 (my raw curl) | **absent** |
| gpx public heat-map artifact | 200 | absent |

Neither carries the marker, so neither was intercepted. The Terraform confirms why this is
structural and not luck: both new behaviours are gated `each.key == "gpx"` and scoped to the
`/api/gpx/internal/*` prefix, with a long comment naming `MESHTK_RUN_INTERNAL_URL` as the
reason not to widen. Behaviour ordering is correct in source — the two internal blocks
(lines 620, 652) and the heat-map behaviour (line 687) all precede the `/{region}/*` ALB
wildcard (line 710).

The application half hardened too, so the edge is not the only control: `timingSafeEqual`
replaces the short-circuiting `!==`, every denial is a bare **404** rather than a
self-advertising 403, `||` replaces `??` so an empty-string secret falls back instead of
pinning the route dead, and a wholly-unconfigured secret logs loudly once.

### 4. Does the DC33 artifact have 0 degenerate features and a served `runCount` of 90? — **YES, both, measured on the live bytes**

I fetched `https://gpx.defcon.run/use1/api/gpx/public/heatmap/dc33` and computed it myself
rather than reading the probe's answer:

```
meta: {"year":"dc33","generatedAt":"2025-08-15T02:41:54.347Z","runCount":90,"totalKm":658.4}
features: 90   features w/ any property: 0   degenerate features: 0   bytes: 439858
```

`meta.runCount` **90** equals the actual feature count. `generatedAt` is byte-identical to the
frozen export instant, as the plan required. `totalKm` is **unchanged at 658.4** — which is the
cross-check that mattered: a zero-length line contributes zero kilometres, so the 20 removed
features being junk is *proved* by the distance not moving. The single
`HEATMAP_DC33_RUNCOUNT=90` line in `71-04-SUMMARY.md` is unique in that file (the only other
occurrence is a same-valued copy in `71-15-SUMMARY.md`, which the probe does not parse), so
assertion 6's fail-closed exact-match parse still holds.

And CDN caching — the third prior gap — is delivered as **behaviour**, not a header. Four
back-to-back requests: `Miss`, then `Hit`, `Hit`, `Hit` (`age: 2`). Assertion 14 additionally
proves the cache key separates the bare artifact (439 858 B) from `?meta=1` (86 B), both
served from the edge — so the `meta`-whitelisting policy is doing its job and the two are not
colliding into one entry.

---

## Goal Achievement

### Observable Truths

| # | Truth | Source | Status | Evidence |
|---|-------|--------|--------|----------|
| 1 | Toggling a year renders stacked translucent lines whose overlap visibly intensifies on popular paths | SC-1 / D-13 / 71-05 T1 | ✓ **VERIFIED** *(was FAILED)* | Live map `line-opacity=0.7` read off the style (my probe run, assertion 19); colours `#ff8c00`/`#ff0000` live; width 3. I inspected `shot-dc33-SHIPPED-0.70-detail.png` myself — legible stack, Strip/LVCC/Convention Center visibly heavier than spurs. *(D-12's two-colour "simultaneously" clause is calendar-bound → human verification)* |
| 2 | The "last calculated" stamp reflects the real `generatedAt` | SC-2 (2nd clause) | ✓ VERIFIED | Live `?meta=1` → `2026-07-31T18:32:03.294Z`; studio renders `"2h ago"` + `"Last built 7/31/2026, 2:32:03 PM · 0 runs · 0.0 km · no runs yet — this layer fills in during the con"` (probe 7, 10) |
| 3 | The DC34 artifact regenerates on schedule; a new run changes it within ~an hour | SC-2 (1st clause) / 71-07 T1 | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | **Upgraded:** a REAL unattended scheduled fire is now on the record — CloudWatch `11:00:36Z` = 04:00 PT under the then-current daily cron, 7h before the 71-14 apply. Both schedules ENABLED and now de-collided (minutes 0 vs 20). Hourly con cadence + the run→artifact clause remain wall-clock gaps |
| 4 | No feature in either artifact carries any attributable property; the compliance comment matches shipped reality | SC-3 / 71-04 T3 | ✓ VERIFIED | Live bytes walked by me: 90 features, **0** with any property; key sets exact. Guard widened to `meta` + `coordinates` + root `type` (WR-01) |
| 5 | Layers default off and cost nothing until toggled | SC-4 (1st clause) / 71-05 T2 | ✓ VERIFIED | Probe 12: `meta=2, bare-before=0`, one bare fetch only after toggling DC34 |
| 6 | Live artifact fetches are CDN-cached | SC-4 (2nd) / phase goal / HEAT-01 | ✓ **VERIFIED** *(was FAILED)* | My own 4× curl: `Miss, Hit, Hit, Hit` (`age: 2`). Probe 1 & 2: `edge-hits=3/3` both years. Probe 14: cache key separates bare (439 858 B) from `?meta=1` (86 B) |
| 7 | One shared non-attributability guard runs on every write path before the artifact leaves the process | 71-01 T1 | ✓ VERIFIED | Exactly 2 writers of `uploads/HEATMAP/*`; guard adjacent to `PutObject` in both (`heatmap-build.ts:295→297`; `backfill:289` + re-assert `:331`). **Now also on the serve path** (`[year]/route.ts:137` → 500) |
| 8 | A DC33 `summary_polyline` in either historical encoding becomes GeoJSON `[lon,lat]` | 71-01 T2 | ✓ VERIFIED | `polyline-decode.ts`, both paths; **79/79** tests pass across 4 suites (was 51/51 across 3); zero new dependencies |
| 9 | The artifact S3 key comes from one helper | 71-01 T3 | ✓ VERIFIED | `heatmapArtifactKey()` → `uploads/HEATMAP/{year}.json`, sole producer, used by serve + both writers |
| 10 | Every con-day-assigned, active, non-GLOBAL run with geometry → exactly one LineString, with no opt-in filter | 71-02 T1 / HEAT-02 / D-03 | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Predicate re-read: `eq(status,"active") AND exists(conDay) AND ne(userId,"GLOBAL")`, narrowed to `CON_DAY_DATES`. `includeInAggregate` appears ONLY in comments, never as a predicate. Never executed against a real con-day row |
| 11 | A rebuild writes one object and reports runCount/totalKm/generatedAt to its caller | 71-02 T2 | ✓ VERIFIED | CloudWatch: 4 successful builds, e.g. `{"ok":true,"year":"dc34","generatedAt":"2026-07-31T11:00:36.080Z","runCount":0,...}` |
| 12 | The internal build route rejects any request without the shared secret | 71-02 T3 / CR-01 app half | ✓ VERIFIED | `timingSafeEqual` (was short-circuiting `!==`), bare **404** (was self-advertising 403), `\|\|` fallback (was `??`, IN-04), loud log on unconfigured secret |
| 13 | `GET /heatmap/<anything but dc33/dc34>` → 404; the segment never builds an S3 key | 71-03 T2 | ✓ VERIFIED | My curl: `/heatmap/dc32` → 404. `isHeatmapYear()` precedes `heatmapArtifactKey()` |
| 14 | `?meta=1` returns only the meta block | 71-03 T3 | ✓ VERIFIED | 81 bytes, 4 keys, HTTP 200. **Now exact-equality** — my `?meta=0` returns the FULL artifact (IN-02 fixed; also the v0.0.110 behavioural sentinel) |
| 15 | A reader of the aggregate comment learns a second public surface exists, who decided it, when, and what control replaced the opt-in gate | 71-03 T4 / HEAT-06 | ✓ VERIFIED | `aggregate/route.ts:14-36` names the SUPERSEDED CLAIM, HEAT-06, 2026-07-30, Kurt, the structural control and a DO-NOT-restore warning |
| 16 | One command produces the DC33 artifact from last year's export, with `generatedAt` = the export's own instant | 71-04 T1/T2 + 71-15 | ✓ VERIFIED | Live: `generatedAt 2025-08-15T02:41:54.347Z` (byte-identical), `runCount` **90**, `totalKm` **658.4** unchanged, 439 858 B |
| 17 | The DC33 run count leaves the phase as a machine-readable `HEATMAP_DC33_RUNCOUNT` line | 71-04 T4 / 71-15 | ✓ VERIFIED | Exactly one such line in `71-04-SUMMARY.md` = 90; probe 6 parsed 90 and matched live |
| 18 | A restored heat layer survives a reload and the camera does not move because of it | 71-05 T3 | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Single atomic `heatmapState.set()`; grep finds ZERO `fitBounds\|flyTo\|easeTo\|setCenter\|jumpTo` in the file. Phase 70 assertion 16 exercises the same mechanism at `moves=0` but seeds route/check-in ids, not heat ids |
| 19 | Map Layers shows a HEAT MAP section with a DC34 row and a DC33 row, both off, swatches matching their map lines | 71-06 T1 / HEAT-05 | ✓ VERIFIED | Probe 9: section #5 of 5, rows `[🔥 DC34 — live \| 🔥 DC33 — the classic]`. Swatch reads `HEAT_PAINT[year]['line-color']` |
| 20 | The header carries a relative stamp; hovering a row puts the exact timestamp + run count in the hint bar | 71-06 T2 / HEAT-05 | ✓ VERIFIED | Probe 10, now including WR-07's `"no runs yet — this layer fills in during the con"` for an empty year |
| 21 | The scheduler Lambda holds no DynamoDB and no S3 permission | 71-07 T2 | ✓ VERIFIED | `grep -E "dynamodb\|s3:" iam.tf` → **none**. Both trust policies now carry `aws:SourceAccount` (WR-08) |
| 22 | The unit is validated by a scoped terragrunt run in CI; nothing applied from a workstation | 71-07 T3 / 71-13 / 71-14 | ✓ VERIFIED | `gh run view`: 30654859050 (cloudfront) **success**, 30655157386 (scheduler) **success** — both "🏗️ Infra: Terragrunt Apply". buildpub 30659716961 **success**, deploy 30660029251 **success**. No local apply |
| 23 | Both DC34 schedules are installed and ENABLED with the exact expressions and timezone | 71-08 T4 / 71-14 | ✓ VERIFIED | Live: hourly `cron(0 * 5-10 8 ? 2026)` ENABLED, daily `cron(20 4 * * ? *)` ENABLED, both `America/Los_Angeles`. **De-collided** (WR-04) — probe 18 |
| 24 | The internal build route is not reachable from the public internet | 71-08 T5 / CR-01 | ✓ **VERIFIED** *(was FAILED)* | My own curls: all **3** internal routes × **2** spellings → 404 + `x-dc34-edge-block: 1`, **empty body**. Probe 8 + 15 confirm. Blast radius clean (probe 16, re-derived by me) |

**Score:** **21/24 truths verified** (3 present but behavior-unverified, **0 failed**). Previous: 18/24 with 3 failed.

### Deferred Items

None. There is no phase after 71 in this milestone, so no gap is addressable by later planned
work. The calendar-bound items are routed to human verification with a dated 5-10 Aug 2026
re-probe, which already exists as a todo.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/run.gpx/webapp/src/lib/heatmap-artifact.ts` | Year allowlist, S3 key, bounded geometry, assembler, widened guard, degeneracy filter, D-14 note | ✓ VERIFIED | Guard now checks root `type`, `meta` keys and coordinate contents; assembler drops never-moving tracks; D-14 recorded at `normalizeTrack` |
| `apps/run.gpx/webapp/src/lib/polyline-decode.ts` | Dual-format DC33 decoder, zero new deps | ✓ VERIFIED | Unchanged; covered by the 79-test suite |
| `apps/run.gpx/webapp/src/lib/heatmap-build.ts` | Con-day scan without the opt-in predicate, dedup, real deadline, loud truncation | ✓ VERIFIED | `BUILD_BUDGET_MS = 240_000` enforced in the chunk loop and aborts WITHOUT publishing; `MAX_RUNS` cap now logs; comparator returns 0 for equals (IN-01) |
| `.../api/gpx/internal/heatmap-build/route.ts` | Secret-guarded POST, honest posture | ✓ **VERIFIED** *(was WIRED, POSTURE FALSE)* | `timingSafeEqual`, bare 404, `\|\|` fallback; the false network claim is replaced by a measured account naming 71-13; the inert `maxDuration` export is deleted with a written reason |
| `.../api/gpx/public/heatmap/[year]/route.ts` | Allowlisted year, exact `?meta=1`, real CDN caching, serve-path guard | ✓ **VERIFIED** *(was WIRED, CACHE INEFFECTIVE)* | Edge hits observed; guard on the way out; no raw SDK error object reaches a log line |
| `.../api/gpx/public/aggregate/route.ts` | HEAT-06 comment reconciliation | ✓ VERIFIED | Honest, dated, names the decider and the compensating control |
| `.../scripts/backfill-dc33-heatmap.ts` | One-off DC33 backfill | ✓ VERIFIED | Republished through the degeneracy filter: 110 → 90, `generatedAt`/`totalKm` preserved |
| `.../scripts/verify-heatmap-artifact.mjs` | Self-testing artifact verifier | ✓ **VERIFIED** *(was TOO PERMISSIVE)* | I ran `--selftest`: clean fixture passes; property-carrying, `@`-smuggling and **degenerate** fixtures are all rejected |
| `.../map/heatmap-layer.ts` | Two line layers, D-13 paint, lazy, both-visible | ✓ **VERIFIED** *(was OUTPUT INVISIBLE)* | `line-opacity 0.7`; empty-but-valid year latches `built` (WR-07); `remove()` blanks the store, `whenStyleReady()` settles (IN-05); zero camera-moving calls |
| `.../layer-control/HeatMap.svelte` | HEAT MAP section | ✓ VERIFIED | Mounted at `LayerControl.svelte:531`; "no runs yet" wording live |
| `infra/terraform/modules/cloudfront/v1.0.0/main.tf` | Heat-map cache policy + gpx-scoped edge block | ✓ VERIFIED | `aws_cloudfront_cache_policy.heatmap_artifact` whitelists exactly `meta`; `aws_cloudfront_function.internal_block` emits the marked 404; both behaviours authored ahead of the `/{region}/*` wildcard |
| `infra/.../heatmap-scheduler/*` + live unit | Thin invoker, de-collided schedules, increasing timeout chain | ✓ **VERIFIED** *(was SCHEDULES COLLIDE)* | daily 04:00 → **04:20** PT; `lambda_timeout` 300 → **420** > fetch **300** > builder **240**; `aws:SourceAccount` on both trusts |
| `71-08-probes/heatmap-probe.cjs` + transcripts | 19-assertion gate with contrast | ✓ VERIFIED | `TOTAL = 19` fixed literal, no skip helper. Last commit is 71-12's — **71-16 did not touch it**, so the pre/post contrast is honest. sha256 `0b294c08…` matches STATE.md |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `heatmap-build.ts` / `backfill-dc33-heatmap.ts` | `assertNonAttributable` | Adjacent to `PutObject`, never caught-and-continued | ✓ WIRED |
| `[year]/route.ts` | `assertNonAttributable` | Serve-path guard → 500 on failure (WR-02) | ✓ **WIRED (new)** |
| `[year]/route.ts` | `heatmapArtifactKey()` | `isHeatmapYear()` narrows the segment BEFORE key construction | ✓ WIRED |
| `aggregate/route.ts` | `lib/heatmap-artifact.ts` | Imports `trkptCoords` — one parser | ✓ WIRED |
| `HeatMap.svelte` | `heatmap-layer.ts` | `heatmapState`, `HEAT_PAINT`, `relativeStamp`, `HEAT_YEARS` | ✓ WIRED |
| `LayerControl.svelte` | `HeatMap.svelte` | Mount at `:531` under the availability guard | ✓ WIRED |
| EventBridge schedules | `heatmap-build-use1` Lambda | Scheduler assume-role + `lambda:InvokeFunction` | ✓ WIRED — **and observed firing unattended** |
| Lambda | internal build route | SSM secret + VPC attachment; fetch bounded at 300 s | ✓ WIRED |
| Public heat-map path | CloudFront cache | `aws_cloudfront_cache_policy.heatmap_artifact` on a dedicated ordered behaviour | ✓ **WIRED (was NOT WIRED)** |
| `/api/gpx/internal/*` (both spellings) | Edge block | `aws_cloudfront_function.internal_block` → marked 404 | ✓ **WIRED (was NOT WIRED)** |
| Edge block | run.human / run.auth internal paths | Gated `each.key == "gpx"` + gpx-only prefix | ✓ **CORRECTLY NOT WIRED** (blast radius clean) |

### Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Produces real data | Status |
|----------|--------------|--------|--------------------|--------|
| `heatmap-layer.ts` dc33 | GeoJSON FeatureCollection | `GET /heatmap/dc33` → S3 `uploads/HEATMAP/dc33.json` | Yes — 90 features, 0 degenerate | ✓ FLOWING **to the screen** (opacity 0.7, capture inspected) |
| `heatmap-layer.ts` dc34 | GeoJSON FeatureCollection | `GET /heatmap/dc34` → S3 | No — `features: []`, `runCount: 0` | ⚠️ EMPTY BY CALENDAR (valid artifact; no source rows exist before 5 Aug) |
| `HeatMap.svelte` stamp/hint | `$heatmapState[year]` | `?meta=1` probe at map load | Yes — real `generatedAt`/`runCount`/`totalKm` + the empty-year explainer | ✓ FLOWING |
| DC34 builder | `tracks[][]` | `GpxFile.scan` → S3 GPX → `trkptCoords` | Untested against real data — 0 rows carry `conDay` | ⚠️ UNEXERCISED (calendar) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Heatmap + internal-route suites pass | `npx vitest run heatmap-{artifact,build}.test.ts polyline-decode.test.ts internal/heatmap-build/route.test.ts` (Node 22.12) | 4 files, **79/79 passed**, 441 ms | ✓ PASS |
| Artifact verifier rejects what it must | `node scripts/verify-heatmap-artifact.mjs --selftest` | clean PASS; property / `@` / **degenerate** fixtures all rejected | ✓ PASS |
| dc33 served + correct meta | `curl .../heatmap/dc33?meta=1` | `{dc33, 2025-08-15T02:41:54.347Z, 90, 658.4}` | ✓ PASS |
| CDN caching (behaviour, not header) | 4× `curl -D-` same URL | `Miss, Hit, Hit, Hit` (`age: 2`) | ✓ PASS |
| `?meta=0` exact-match (v0.0.110 sentinel) | `curl .../dc33?meta=0` | Full 439 858 B artifact, not the meta projection | ✓ PASS |
| Year allowlist holds | `curl .../heatmap/dc32` | 404 | ✓ PASS |
| Live bytes non-attributable | Fetch + walk all 90 features myself | 0 properties, exact key sets, 0 malformed coords, 0 degenerate | ✓ PASS |
| Edge block, all 3 routes × 2 spellings | 6× `curl -X POST` | 6/6 → 404 + `x-dc34-edge-block: 1` | ✓ PASS |
| Blast radius | `curl` mint + quota | 405 / 401, **neither** marked | ✓ PASS |
| Schedules armed + de-collided | `aws scheduler get-schedule` ×2 | ENABLED, minutes 0 vs 20, `America/Los_Angeles` | ✓ PASS |
| Scheduled fire actually occurred | `aws logs filter-log-events /aws/lambda/heatmap-build-use1` | `11:00:36Z` build = 04:00 PT, 7h before the 71-14 apply | ✓ PASS |
| Live version | `aws ecs describe-task-definition run-gpx-use1-dc34:200` | image `dc34-run-gpx-app:v0.0.110`, running 1/1 | ✓ PASS |
| DC33 legibility at shipped paint | Direct inspection of `shot-dc33-SHIPPED-0.70-detail.png` | Legible stack, real density gradient | ✓ PASS *(headless capture — see human verification)* |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| `71-08-probes/heatmap-probe.cjs` | `MAPBOX_TOKEN=$(aws ssm get-parameter … --with-decryption) node heatmap-probe.cjs` — **run by me, not read from the transcript** | **17/19** | ⚠️ 17/19 — assertion 5 (dc34 leg) and 11 red, single calendar root cause |
| Same script, pre-fix baseline | `transcript-gap-pre.txt` | 8/19 | — |
| Phase 70 dialog-shell regression | `transcript-phase70-regression-gap.txt` | **16/16** | ✓ PASS |

The **8/19 → 17/19** contrast is produced by a byte-identical script: its last commit is
71-12's, `git diff HEAD` is empty, and sha256 `0b294c08…` matches the recorded value.
Eleven assertions flipped red→green. Assertion 16 — the blast-radius regression gate — was
green before AND after, which is the correct shape for a regression gate.

**The two remaining reds are calendar-bound, not defects.** Assertion 5's dc34 leg fails
`meta.runCount is 0, expected > 0` and assertion 11 fails on dc34 having 0 features. DEF CON 34
runs 2026-08-05..10; today is 2026-07-31, so no run carries a `conDay`. The dc33 legs of both
pass. **17/19 is the perfect pre-con score.** No synthetic data was injected, the verifier was
not softened, and the DC34 row was not hidden — all three were explicit plan prohibitions and
all three were honoured.

### Requirements Coverage

| Req | Description | Status | Evidence |
|-----|-------------|--------|----------|
| HEAT-01 | Artifact format + public serve route; CDN-cacheable | ✓ **SATISFIED** *(was PARTIAL)* | Format, allowlist, exact `?meta=1`, non-attributability verified on live bytes; **CDN caching now delivered as behaviour** (edge hits, key separation) |
| HEAT-02 | Scheduled DC34 builder, hourly during the con, no opt-in gate | ✓ SATISFIED *(calendar residual)* | Builder, hardened route, module, de-collided schedules, strictly-increasing timeout chain, and a REAL unattended scheduled build all verified. End-to-end with con-day data is wall-clock-bound (truths #3, #10) |
| HEAT-03 | DC33 one-off backfill, both encodings, frozen | ✓ SATISFIED | Republished: 90 runs, **0 degenerate**, `generatedAt` and `totalKm` preserved; verifier now rejects degeneracy |
| HEAT-04 | `heatmap-layer.ts`, locked paint, lazy, simultaneous | ✓ **SATISFIED** *(was BLOCKED)* | `line-opacity 0.7` read off the live map; capture shows a legible stack. The two-colour *simultaneous* view awaits DC34 data |
| HEAT-05 | HEAT MAP section, two rows, stamp, hint detail, default off | ✓ SATISFIED | Probe 9, 10, 12 PASS, now including the empty-year explainer |
| HEAT-06 | Compliance reconciliation + ship via the standard flow | ✓ SATISFIED | Comment honest; shipped buildpub → deploy.yml with `invalidate_cache=true`; two scoped CI terragrunt applies; probe extended 13 → 19 with a strengthened predicate set |

*Note:* `.planning/REQUIREMENTS.md` does not exist in this project (removed at the v1.9
milestone close). Coverage assessed against ROADMAP requirement text and the plans'
`must_haves`. No orphaned requirements — all six HEAT-* IDs are claimed by at least one plan.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | `TBD` / `FIXME` / `XXX` | — | **None.** Scanned every phase-modified source and infra file; zero debt markers. Completion is auditable |
| — | — | `TODO` / `HACK` / `PLACEHOLDER` / "coming soon" | — | **None** |
| `apps/run.gpx/webapp/VERSION` | 1 | Branch reads `v0.0.109`; `origin/main` reads `v0.0.110` | ℹ️ Info | **Not a defect.** buildpub runs `version.sh` from the dispatched ref and CI cut/merged Release PR #1147 on `main`; this branch has simply not re-synced. I verified every gap-closure source and infra file on this branch is **byte-identical to `origin/main`**, and the only commit `main` has that the branch lacks is the Release PR itself |
| `lambda/index.mjs` | 65 | Non-2xx branch logs `body.slice(0, 500)` | ℹ️ Info | WR-09's success path is fixed (status + byte count only); the error branch keeps a truncated body with a written diagnostic rationale. Acceptable |
| `heatmap-layer.ts` | 219 | `isFeatureCollection` no longer requires `features.length > 0` | ℹ️ Info | Deliberate WR-07 fix, documented: the structural gate (type literal + array check) is intact; only the liveness check was relaxed |

**Toolchain (D-71-A..E):** eslint broken in both packages, a pre-existing prettier failure on
`LayerControl.svelte`, and a 26+4 rather than flat-30 svelte-check baseline. All five were
proven pre-existing on a clean tree and remain correctly scoped out of this phase.

---

## Gaps Summary

**All three gaps from the prior verification are closed, and I verified each one against
production myself rather than against the SUMMARY.**

The headline gap was one number. At `line-opacity 0.25` the DC33 stack was invisible; at
D-13's 0.70 it is a legible flame stack with a real density gradient, and I confirmed that
two ways — the probe reads `0.7` off the live Mapbox style object, and I opened the controlled
capture and looked at it. The Strip corridor is a thick overlapping bundle, the LVCC Loop and
Convention Center read as heavy closed loops, and one-off spurs are thin. "Overlap = heat" is
now true of the shipped build for DC33.

The two structural gaps are closed as *behaviour*, not as headers or comments. CDN caching:
four back-to-back requests go `Miss, Hit, Hit, Hit`, and the cache key correctly separates the
439 KB artifact from the 86-byte `?meta=1` projection, so the route's size bounds are no longer
reasoned on a false premise. The internal-route exposure: all three gpx internal routes, in
both the region-prefixed and no-region spellings, now return a 404 with an **empty body** and
an `x-dc34-edge-block` marker the application cannot produce — six for six — and the inherited
`strava-sync` exposure went with it. Critically, the block did **not** widen: neither
run.human's meshtk claim-link mint nor run.auth's quota family carries the marker, and the
Terraform gates both new behaviours on `each.key == "gpx"` with a comment naming exactly why.
The application layer hardened underneath the edge as well — `timingSafeEqual`, a
non-disclosing 404, and a `||` fallback that can no longer pin the endpoint dead.

Two things improved beyond what was asked. The non-attributability guard now genuinely does
what its docstring always claimed — it inspects `meta`, the root `type`, and the contents of
`geometry.coordinates` — and it runs on the **serve** path as well as both write paths, so an
object written by anything other than the two known builders cannot be echoed to the internet.
And the DC33 artifact was republished through the new degeneracy filter: 90 features, zero
degenerate, with `totalKm` unchanged at 658.4, which is the cross-check proving the 20 removed
features really were junk rather than data.

One truth also quietly upgraded on its own. The prior verification recorded the DC34 schedule
as "armed but never fired". CloudWatch now shows an **unattended scheduled build at
2026-07-31T11:00:36Z** — 04:00 PT under the then-current daily cron, seven hours before the
71-14 apply that moved it. That is EventBridge → Lambda → internal route → builder → S3
executing end-to-end with no operator in the loop. What remains unobservable is only the
hourly con-window cadence and the run→artifact data path, both of which need 5 August.

**What is left is not defect work.** Three truths are present-and-wired but behaviourally
unexercised, all for the same reason: DEF CON 34 has not happened. Four human items remain,
and three of them are the residual visual checks from 71-16 Task 5 — which Kurt closed on
evidence on 2026-07-31 with the on-hardware browser check explicitly **not performed**. That
is a known, deliberately-accepted gap, recorded plainly in `71-16-SUMMARY.md`, and I am
reporting it rather than discovering it. The D-13 opacity call and the D-14 / HEAT-06
compliance reversal are user-locked and were not re-litigated.

**Recommendation:** Phase 71's goal is achieved for everything observable before the con.
Treat it as complete pending the end-of-phase human checkpoint. Before 2026-08-05, spend ten
minutes on the three Task 5 visual items — particularly the ghost claim-link spot-check, since
a silent break there would only surface during the con. Then run the dated 5-10 Aug re-probe
to close assertions 5 and 11 and the D-12 two-colour view.

---

_Verified: 2026-07-31T21:40:00Z_
_Verifier: Claude (gsd-verifier) — goal-backward, FORCE stance, re-verification after gap closure_
_Live verification performed against gpx.defcon.run (run.gpx v0.0.110) and us-east-1 AWS state; the 19-assertion probe was executed by the verifier, not read from a transcript_
