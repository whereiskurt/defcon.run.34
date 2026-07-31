---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
verified: 2026-07-31T04:50:20Z
status: gaps_found
score: 18/24 must-haves verified
behavior_unverified: 3
overrides_applied: 0
verifier_head: ed7eeeaa
live_version: run.gpx v0.0.109 (origin/main, Release PR #1132)
gaps:
  - truth: "Toggling 🔥 DC34 renders every submitted run as stacked translucent red lines whose overlap visibly intensifies on popular paths; 🔥 DC33 does the same in orange from last year's data; both simultaneously legible. (ROADMAP SC-1 / D-12 / 71-05 T1 / 71-08 T1)"
    status: failed
    reason: >-
      The phase's central user-visible promise does not hold on the live site. At the
      shipped D-02 paint values (#ff8c00, line-opacity 0.25, line-width 3) the DC33 stack
      is not faint — it is invisible. Verified by direct inspection of two controlled
      captures taken with identical camera, identical data, every non-heat layer hidden,
      at a measured 40-run hotspot: shot-dc33-SHIPPED-0.25-invisible.png is
      indistinguishable from a bare basemap, while shot-dc33-DIAG-0.70-legible.png shows a
      dense flame stack with a real density gradient (Strip / LVCC Loop / Convention Center
      visibly heavier than one-off spurs). DC34 contributes nothing at all because its
      artifact is empty. So "overlap = heat" is not observable for either year, and the two
      layers are never simultaneously legible. Probe assertion 11 FAILED post-deploy.
      Data and render path are both ruled out as causes (queryRenderedFeatures finds 36
      overlapping features under one screen pixel; a forced opacity-1 magenta render draws
      a correct network) — the defect is the locked paint value itself.
    artifacts:
      - path: "apps/run.gpx/gpx-studio/website/src/lib/components/map/heatmap-layer.ts"
        issue: "HEAT_STROKE line-opacity 0.25 at line-width 3 renders #ff8c00 below the perceptual floor over the Mapbox basemap; #ff8c00 also collides with the basemap's own orange road casings at any opacity"
    missing:
      - "Kurt's decision on the D-02 paint lock: raise DC33 opacity toward ~0.6-0.7, and/or re-pick DC33's colour for basemap contrast, and/or add a dark halo/casing under the line"
      - "Re-shoot the controlled visual evidence after re-tuning, and re-run the D-12 two-colour overlap check once DC34 has data"
  - truth: "Live artifact fetches are CDN-cached. (ROADMAP SC-4, second clause; phase goal names 'CDN caching' explicitly; HEAT-01 says 'CDN-cacheable')"
    status: failed
    reason: >-
      Independently re-derived: three back-to-back identical requests to
      /use1/api/gpx/public/heatmap/dc33?meta=1 each returned `x-cache: Miss from cloudfront`
      alongside `cache-control: public, s-maxage=900, stale-while-revalidate=900`. The
      /use1/* CloudFront behaviour uses Managed-CachingDisabled
      (4135ea2d-6df8-44a3-9df3-4b5a84be39ad), so the origin's s-maxage is ignored entirely.
      The route emits a cache header but no CDN caching occurs. Every unauthenticated GET
      costs the single run.gpx ECS task one S3 GetObject plus a 441 KB response body, with
      no cache, no rate limit and no auth — and MAX_RUNS=5000 permits the artifact to grow
      ~20x. This is the most plausible availability failure mode for the map during the con.
      The probe's assertions 1 and 2 assert only the presence of the header, so they cannot
      detect this.
    artifacts:
      - path: "apps/run.gpx/webapp/src/app/api/gpx/public/heatmap/[year]/route.ts"
        issue: "Comments size the route as 'CDN-absorbed' and 'each distinct query value is its own CDN cache entry'; neither is true in this deployment"
      - path: "infra/terraform/modules/cloudfront/v1.0.0/main.tf"
        issue: "No ordered_cache_behavior ahead of /{region}/* for the public heat-map path; the catch-all behaviour disables caching"
    missing:
      - "An ordered CloudFront cache behaviour for /{region}/api/gpx/public/heatmap/* with a real cache policy that includes the `meta` query string in the cache key"
      - "Until that lands, correct the 'CDN-cached' comments in the route and in heatmap-artifact.ts so no future surface is sized on the same false premise"
      - "Tighten `?meta=` to an exact `=== \"1\"` test before a real cache policy starts minting an entry per arbitrary query value (IN-02)"
  - truth: "The internal build route is not reachable from the public internet. (71-08 T5)"
    status: failed
    reason: >-
      Independently re-derived: `curl -X POST https://gpx.defcon.run/use1/api/gpx/internal/heatmap-build`
      from the open internet returns HTTP 403 with body {"error":"Forbidden"} — that body is
      the route handler's own line-29 response, so the request traversed CloudFront and the
      ALB and reached the Next.js process. The route IS reachable; it is merely rejected at
      the application layer. The module comment's claim that "no CloudFront behaviour maps
      /api/gpx/internal/*" and that "the shared-secret guard below is the second layer, not
      the only one" is false in this deployment: the shared secret is the ONLY control, it is
      compared with a short-circuiting `!==`, and there is no rate limit, lockout or audit
      log. Each authorized POST launches an unbounded GpxFile.scan({pages:"all"}) plus one S3
      GetObject per con-day run on a single-task service. Probe assertion 8 asserts only
      "non-2xx", which a 403 from the app's own guard satisfies identically to an
      unreachable path — so the probe could not distinguish the documented posture from the
      actual one. Note this exposure is INHERITED (api/gpx/internal/strava-sync makes the
      same false claim and is equally reachable); Phase 71 did not create it, but it
      restated it as a security control and shipped a probe that appeared to confirm it.
    artifacts:
      - path: "apps/run.gpx/webapp/src/app/api/gpx/internal/heatmap-build/route.ts"
        issue: "Header asserts a network-layer control that does not exist; secret compared non-constant-time; `??` fallback means an empty-string INTERNAL_SYNC_SECRET pins the route to a permanent silent 403 (IN-04)"
      - path: ".planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-08-probes/heatmap-probe.cjs"
        issue: "Assertion 8's 'non-2xx' predicate cannot distinguish 'unreachable' from 'reached and rejected'"
    missing:
      - "An actual network-layer block for /{region}/api/*/internal/* (CloudFront Function, WAF rule, or a higher-priority ALB listener rule returning 404) across the gpx and auth distributions — fixes both this route and strava-sync"
      - "timingSafeEqual comparison and a 404-not-403 response so the endpoint does not advertise itself"
      - "Correct the module comment so the next reader does not inherit the false posture"
      - "Strengthen probe assertion 8 to require that the response is NOT the app's own guard body"
behavior_unverified_items:
  - truth: "The DC34 artifact regenerates on schedule — submitting a new run changes the artifact within ~an hour during the con. (ROADMAP SC-2, first clause; 71-07 T1)"
    test: "During 5-10 Aug 2026, run 71-08-probes/heatmap-probe.cjs unmodified and watch dc34 meta.generatedAt across two consecutive hours; separately submit a run tagged with a DC34 con-day and confirm the artifact's runCount increases within ~an hour."
    expected: "generatedAt moves hourly (not just at the 04:00 PT daily), and a newly submitted con-day run appears in the artifact within one schedule interval."
    why_human: "Physically unobservable today. cron(0 * 5-10 8 ? 2026) cannot fire before 5 Aug 2026, and no scheduled invocation has occurred since the schedules were created at ~04:02Z today — the only build so far was a manual `aws lambda invoke`. The armed half IS proven (I independently confirmed both schedules ENABLED with the exact expressions and America/Los_Angeles), but the firing half is a wall-clock gap."
  - truth: "Every con-day-assigned, active, non-GLOBAL run with readable GPX geometry contributes exactly one LineString to the DC34 artifact — with no opt-in filter anywhere in the selection. (71-02 T1)"
    test: "During the con, compare the DC34 artifact's runCount against a DynamoDB count of active, non-GLOBAL run-gpx-electro items with a conDay in CON_DAYS, including at least one run whose owner has includeInAggregate=false."
    expected: "Counts match, and the opted-OUT runner's run is present in the artifact (that is the point of D-03)."
    why_human: "The selection predicate is correct by inspection and pinned by 51 passing unit tests, but it has never executed against a real con-day row: a DynamoDB scan of run-gpx-electro finds 0 of 133 items carrying a conDay attribute, and DEF CON 34 is 2026-08-05..10. The live DC34 artifact is valid-but-empty (runCount 0), so the selection, dedup and S3 fan-out paths are all unexercised end-to-end."
  - truth: "A runner who left a heat layer on yesterday finds it on today, and the map camera does not move because of it. (71-05 T3)"
    test: "Toggle 🔥 DC33 on, reload gpx.defcon.run/use1/studio/app, and confirm the row is still checked, the orange geometry is present in the style, and the camera stays exactly where it was."
    expected: "Layer restored ON with no fitBounds and no recentre."
    why_human: "A cross-session state-restore plus a camera invariant. The code is correct by inspection — loadMeta() commits availability and restored visibility in ONE atomic heatmapState.set(), and restore drives map.setLayoutProperty directly rather than the user-facing setter (the exact Phase 70 landmine) — but no test exercises the reload transition, and presence checks cannot see a fitBounds that does not happen."
human_verification:
  - test: "Look at 🔥 DC33 on a real (non-headless) browser at gpx.defcon.run/use1/studio/app, zoomed to the Strip, with the route/rabbit/check-in groups turned off."
    expected: "A visible orange flame stack whose busy corridors read heavier than one-off spurs."
    why_human: "All captures were headless Chromium on swiftshader. The 0.70 and 1.0 renders prove low-alpha blending works in that environment, so a pure headless artifact is unlikely — but confirming on real hardware before re-tuning a Kurt-locked value is cheap and forecloses a wrong fix."
  - test: "Decide the CR-02 endpoint-privacy question with the facts in front of you: the live DC33 artifact publishes each run's exact first and last coordinate at 5-decimal (~1.1 m) precision, unauthenticated, at a stable public URL, for runners who never opted in."
    expected: "An explicit call — trim ~200 m from each end, or drop COORD_PRECISION to 4 (~11 m) and trim only the terminal points, or accept the exposure knowingly."
    why_human: "D-03 (no opt-in gate) is user-locked and is NOT being re-litigated. The question is orthogonal and is a policy decision, not an executor fix: the compensating control that was accepted in exchange for dropping the gate proves 'no identifier fields', which is a different property from 'not re-identifiable'."
  - test: "Decide whether to re-run the DC33 backfill with a degeneracy filter before the con."
    expected: "A call on whether meta.runCount=110 may keep overstating the real run count."
    why_human: "Product-truth judgment, not a correctness bug — nothing crashes and privacy is unaffected."
---

# Phase 71: Heat Map Layers — DC33 + DC34 Flame Stacks Verification Report

**Phase Goal:** Toggleable per-year heat-map layers in the gpx studio built from runners' submitted runs, DC33-faithful "stacked flame" style — every run a translucent line so overlap = heat; a scheduled builder precomputes a per-year non-attributable S3 artifact hourly during the con; DC33 built once from the DynamoDB export; served via `/api/gpx/public/heatmap/{dc33|dc34}` with CDN caching; UI = a HEAT MAP section in the Phase 70 Map Layers dialog.

**Verified:** 2026-07-31T04:50:20Z
**Status:** gaps_found
**Re-verification:** No — initial verification
**Verifier HEAD:** `ed7eeeaa` · **Live:** run.gpx v0.0.109

---

## Verdict on the three questions posed

### 1. "so overlap = heat" and D-12's "dc33 and dc34 simultaneously" — is the central user-visible promise delivered?

**No.** This is the phase's headline gap and it is not a matter of interpretation.

The infrastructure behind the promise is genuinely built and genuinely working: 110 real
LineStrings are served, the layer class fetches and paints them, Mapbox reports 36 overlapping
features under a single screen pixel at the measured hotspot, and a forced opacity-1 magenta
render draws a dense, correctly-georeferenced network. Everything upstream of the final paint
value is real.

But the thing a runner actually sees is nothing. I compared the two controlled captures myself
— same camera, same data, every non-heat layer force-hidden, `z14.2` on a cell that 40 of the
110 runs pass through. `shot-dc33-SHIPPED-0.25-invisible.png` is visually identical to a bare
Mapbox basemap; I cannot find an orange stack anywhere in it. `shot-dc33-DIAG-0.70-legible.png`,
identical in every respect but `line-opacity`, is exactly the effect D-12 describes: the Strip
corridor, the LVCC Loop, the Convention Center and the Westgate all read, and busy corridors are
visibly heavier than one-off spurs. The difference between those two images is the difference
between the feature existing and not existing.

Compounding it, the D-12 "simultaneously" clause is doubly unmet: DC34 contributes zero
geometry (0 con-day runs exist yet), so even at a legible opacity there is currently only one
colour on the map. The two-colour overlap that the CONTEXT calls "the emotional core of the
feature" has never been rendered and cannot be until the con.

The DC34 half is a wall-clock gap and forgivable. The DC33 half is a live defect in what users
see today, on a Kurt-locked value, and is correctly escalated rather than silently fixed. But the
goal sentence "every run a translucent line ... so overlap = heat" is not true of the shipped
build.

### 2. Is the non-attributability control sound, given CR-02?

**It is sound for what it claims and unsound as the substitute it was accepted as.**

I verified the literal claim against the bytes production actually serves, not against source:
the live `dc33.json` has root keys exactly `[type, meta, features]`, meta keys exactly
`[year, generatedAt, runCount, totalKm]`, and across all 110 features the key sets are exactly
`[type, properties, geometry]` and `[type, coordinates]` with **zero** features carrying any
property. `assertNonAttributable` is called on genuinely every write path — grep finds exactly
two writers of `uploads/HEATMAP/*`, both invoke the guard immediately before `PutObject`
(`heatmap-build.ts:210` → `:212`; `backfill-dc33-heatmap.ts:289`, plus a second re-assert on the
round-tripped bytes at `:331`), neither wraps it in catch-and-continue, and the ordering plus the
throw-means-no-write behaviour are pinned by passing tests. ROADMAP SC-3 as written is met.

The problem is that SC-3's property is not the property the opt-in gate was protecting.
`normalizeTrack` decimates with a stride that **always preserves the first and last surviving
point** — by design, and documented as such — at `COORD_PRECISION = 5`, ~1.1 m. So every
published run keeps its exact start and end coordinate, unauthenticated, at a stable public URL,
for runners who never consented under this regime. The route's own comment defends the precision
on rendering grounds ("finer than a 3 px 25 %-opacity line can express") which is true for pixels
and irrelevant to anyone who reads the JSON. At a con where a meaningful fraction of runs start
at a hotel room door, a single runner on an otherwise-empty street is individually traceable from
this file with no identifier present anywhere in it. That is the 2018 Strava global-heatmap
failure mode exactly: the aggregate was anonymous, the endpoints were not.

So: the guard proves "no identifier fields". The risk created by dropping the opt-in gate is
re-identification from geometry. Those are different properties, and only the first is covered.
This is **not** a request to restore `includeInAggregate` — D-03 is locked and I am not proposing
to reverse it. It is a request for Kurt to decide on an endpoint-trim or a precision reduction,
both of which are one-line changes to a pure, fully-tested function. Routed to human decision,
not filed as a FAIL of SC-3.

Two secondary soundness notes, both real but lesser: the guard never inspects `meta`, never
inspects `geometry.coordinates` contents, and never runs on the serve path — so the standalone
`verify-heatmap-artifact.mjs` is stricter than the runtime control on the write path, which is
backwards (WR-01/WR-02). And the write-path guard is the *only* thing between a bad object and
the public internet, so any write that bypasses the two known writers (a manual `aws s3 cp`
during an incident, a restore from backup, a compromised `S3_UPLOADS_*` keypair) publishes
unchecked.

### 3. Is CDN caching — named explicitly in the phase goal — delivered?

**No.** Delivered as a header; not delivered as behaviour.

I re-derived this independently rather than trusting the review: three back-to-back identical
requests, all three `x-cache: Miss from cloudfront`, all three carrying
`cache-control: public, s-maxage=900, stale-while-revalidate=900`. The `/use1/*` behaviour uses
Managed-CachingDisabled, so the origin's `s-maxage` is ignored outright. The phase goal names
"with CDN caching"; HEAT-01 requires "CDN-cacheable"; SC-4 requires "live artifact fetches are
CDN-cached". Only the weakest of those three — "cacheable", in the sense that the bytes carry a
cache directive — is satisfied.

This matters beyond pedantry, because the route was *sized* on the false premise. Its bounds
(`MAX_TRACK_POINTS`, `MAX_RUNS = 5000`) are justified in-comment as appropriate for "an
UNAUTHENTICATED, CDN-cached public route". Without the cache, an unauthenticated client can loop
`GET /heatmap/dc33` and charge the single run.gpx ECS task an S3 GetObject plus 441 KB per hit —
growing to ~9 MB per hit at the permitted artifact size. Combined with CR-01 (the build endpoint
being internet-reachable and triggering an unbounded scan per authorized call), run.gpx's
availability during the con is the weakest link this phase leaves behind.

The probe cannot catch it: assertions 1 and 2 check that the header is present, which it is.

---

## Goal Achievement

### Observable Truths

| # | Truth | Source | Status | Evidence |
|---|-------|--------|--------|----------|
| 1 | Both flame stacks render, overlap visibly intensifies, both simultaneously legible | SC-1 / D-12 / 71-05 T1 / 71-08 T1 | ✗ FAILED | DC33 invisible at shipped 0.25 (controlled capture, all other layers hidden, 40-run hotspot); DC34 draws nothing (0 runs). Probe 11 FAILED. See verdict 1 |
| 2 | The "last calculated" stamp reflects the real `generatedAt` | SC-2 (2nd clause) | ✓ VERIFIED | Live `?meta=1` → `generatedAt 2026-07-31T04:02:14.036Z`; studio renders stamp "1m ago" + hint "Last built 7/31/2026, 12:02:14 AM · 0 runs · 0.0 km" (probe 7, 10) |
| 3 | The DC34 artifact regenerates on schedule; a new run changes it within ~an hour | SC-2 (1st clause) / 71-07 T1 | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Schedules armed + ENABLED (re-confirmed via `aws scheduler get-schedule`); Lambda→route proven by manual invoke (200, `{ok:true}`); but no scheduled fire has occurred and 0 of 133 rows carry `conDay`. Wall-clock gap → 5-10 Aug re-probe |
| 4 | No feature in either artifact carries any attributable property; the aggregate compliance comment matches shipped reality | SC-3 / 71-04 T3 | ✓ VERIFIED | Live bytes: 110 features, **0** with any property key; feature keys exactly `[type,properties,geometry]`, geom keys exactly `[type,coordinates]`, meta keys exactly the 4. Aggregate comment rewritten and honest. (See verdict 2 for the orthogonal CR-02 escalation) |
| 5 | Layers default off and cost nothing until toggled | SC-4 (1st clause) / 71-05 T2 | ✓ VERIFIED | Probe 12: `meta=2, bare-before=0`, one bare fetch only after toggling DC34. Code: `ensureGeometry` gated behind `setVisible` |
| 6 | Live artifact fetches are CDN-cached | SC-4 (2nd clause) / phase goal / HEAT-01 | ✗ FAILED | 3× back-to-back → 3× `Miss from cloudfront`. `/use1/*` = Managed-CachingDisabled. See verdict 3 |
| 7 | One shared non-attributability guard runs on every write path before the artifact leaves the process | 71-01 T1 | ✓ VERIFIED | Exactly 2 writers of `uploads/HEATMAP/*`; both call `assertNonAttributable` immediately before `PutObject` (`heatmap-build.ts:210→212`, `backfill:289` + re-assert `:331`); no catch-and-continue; ordering pinned by test |
| 8 | A DC33 `summary_polyline` in either historical encoding becomes GeoJSON `[lon,lat]` | 71-01 T2 | ✓ VERIFIED | `polyline-decode.ts` (147 lines, both `fromEncoded` and JSON-array paths); 51/51 tests pass across the 3 heatmap suites; zero new dependencies |
| 9 | The artifact S3 key comes from one helper, so serve/builder/backfill cannot disagree | 71-01 T3 | ✓ VERIFIED | `heatmapArtifactKey()` → `uploads/HEATMAP/{year}.json`, sole producer; the `uploads/` prefix constraint (IAM prefix-scoping) is documented at the call site and the live object serves correctly through it |
| 10 | Every con-day-assigned, active, non-GLOBAL run with geometry → exactly one LineString, with no opt-in filter anywhere | 71-02 T1 (HEAT-02 / D-03) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Predicate correct by inspection (`status=active AND exists(conDay) AND userId≠GLOBAL`, `conDay ∈ CON_DAYS`); `includeInAggregate` genuinely absent from the builder; dedup by `stravaActivityId` then `fileId`; tests pass. **Never executed against a real con-day row** — 0/133 rows have `conDay` |
| 11 | A rebuild writes one object and reports runCount/totalKm/generatedAt to its caller | 71-02 T2 | ✓ VERIFIED | Lambda invoke → `{ok:true, year:dc34, runCount:0, scanned:0, skipped:0}`; live dc34 artifact served with the matching fresh `generatedAt` |
| 12 | The internal build route rejects any request without the shared secret | 71-02 T3 | ✓ VERIFIED | Unauthenticated POST → 403. (Correct rejection; the *reachability* claim is separately FAILED at #24) |
| 13 | `GET /heatmap/<anything but dc33/dc34>` → 404; the segment never builds an S3 key | 71-03 T2 | ✓ VERIFIED | `/heatmap/dc32` → 404 (my own curl); `isHeatmapYear()` is a `.includes()` on a 2-literal array with no normalisation and precedes `heatmapArtifactKey()` |
| 14 | `?meta=1` returns only the meta block, so the stamp costs no geometry | 71-03 T3 | ✓ VERIFIED | 81 bytes, keys `[year, generatedAt, runCount, totalKm]`, HTTP 200 |
| 15 | A reader of the aggregate comment learns a second public surface exists, who decided it, when, and what control replaced the opt-in gate | 71-03 T4 / HEAT-06 | ✓ VERIFIED | `aggregate/route.ts:14-36` names the SUPERSEDED CLAIM, Phase 71/HEAT-06/2026-07-30, Kurt as decider, the structural compensating control, and a DO-NOT-restore warning. Does not re-assert exclusivity. Sibling notes present in `entities/gpx-file.ts` |
| 16 | One command produces the DC33 artifact from last year's export, with `generatedAt` = the export's own instant | 71-04 T1/T2 | ✓ VERIFIED | Live: `generatedAt 2025-08-15T02:41:54.347Z`, `runCount 110`, `totalKm 658.4`, 441 779 bytes. `backfill-dc33-heatmap.ts` (351 lines) + `verify-heatmap-artifact.mjs` (294 lines) both present |
| 17 | The DC33 run count leaves the phase as a machine-readable `HEATMAP_DC33_RUNCOUNT` line | 71-04 T4 | ✓ VERIFIED | Probe parsed 110 from 71-04-SUMMARY.md and compared it to the live artifact (assertion 6 PASS) |
| 18 | A restored heat layer survives a reload and the camera does not move because of it | 71-05 T3 | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `loadMeta()` commits availability + restored visibility in ONE `heatmapState.set()`; restore drives `map.setLayoutProperty` directly, never the user setter (the Phase 70 fitBounds landmine). Correct by inspection; no test exercises the reload transition or the absence of a camera move |
| 19 | Map Layers shows a HEAT MAP section with a DC34 row and a DC33 row, both off, swatches matching their map lines | 71-06 T1 / HEAT-05 | ✓ VERIFIED | Probe 9: section #4 of 4, rows `[🔥 DC34 — live \| 🔥 DC33 — the classic]`. Swatch reads `HEAT_PAINT[year]['line-color']` — cannot drift from the line |
| 20 | The header carries a relative stamp; hovering a row puts the exact timestamp + run count in the hint bar | 71-06 T2 / HEAT-05 | ✓ VERIFIED | Probe 10: stamp `"1m ago"`, hint `"Last built 7/31/2026, 12:02:14 AM · 0 runs · 0.0 km"`. Stamp goes through `count` (Section has no `trailing` prop — the planned landmine was respected) |
| 21 | The scheduler Lambda holds no DynamoDB and no S3 permission — one SSM read, one HTTP call | 71-07 T2 | ✓ VERIFIED | `iam.tf` actions are exactly `sts:AssumeRole`, `logs:CreateLogStream/PutLogEvents`, `xray:Put*`, `ssm:GetParameter`, `kms:Decrypt`, `lambda:InvokeFunction`. No `dynamodb:*`, no `s3:*`. (WR-08's over-scope is via the attached AWS-managed VPC policy, not the data plane) |
| 22 | The unit is validated by a scoped terragrunt run in CI; nothing applied from a workstation | 71-07 T3 | ✓ VERIFIED | terragrunt-apply run 30602871471, `modules=heatmap-scheduler`, "9 added, 0 changed, 0 destroyed" matching 71-07's recorded plan of 9. Release via buildpub 30602642562 → deploy.yml 30602859411 |
| 23 | Both DC34 schedules are installed and ENABLED with 71-07's exact expressions and timezone, and the wall-clock gap is written down as a residual | 71-08 T4 | ✓ VERIFIED | Re-derived independently: hourly `cron(0 * 5-10 8 ? 2026)` ENABLED, daily `cron(0 4 * * ? *)` ENABLED, both `America/Los_Angeles`. Residual filed as a dated 5-10 Aug re-probe todo |
| 24 | The internal build route is not reachable from the public internet | 71-08 T5 | ✗ FAILED | Public POST returns the handler's **own** `{"error":"Forbidden"}` body — the request reached Next.js. Reachable-and-rejected, not unreachable. See verdict 2's sibling and the gap entry |

**Score:** 18/24 truths verified (3 present but behavior-unverified, 3 failed)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/run.gpx/webapp/src/lib/heatmap-artifact.ts` | Year allowlist, S3 key, bounded geometry, assembler, guard | ✓ VERIFIED | 291 lines, dependency-free as designed, all 5 exports used by 3+ consumers |
| `apps/run.gpx/webapp/src/lib/polyline-decode.ts` | Dual-format DC33 decoder, zero new deps | ✓ VERIFIED | 147 lines; 0 new dependencies confirmed |
| `apps/run.gpx/webapp/src/lib/heatmap-build.ts` | Con-day scan without the opt-in predicate, dedup, bounded fan-out, guard-before-write | ✓ VERIFIED | 227 lines; wired to the internal route; guard at :210 precedes put at :212 |
| `apps/run.gpx/webapp/src/app/api/gpx/internal/heatmap-build/route.ts` | Secret-guarded POST | ⚠️ WIRED, POSTURE FALSE | 50 lines; guard works; the documented network layer does not exist (#24) |
| `apps/run.gpx/webapp/src/app/api/gpx/public/heatmap/[year]/route.ts` | Allowlisted year, `?meta=1`, CDN headers | ⚠️ WIRED, CACHE INEFFECTIVE | 104 lines; 200/404/meta all correct live; `s-maxage` ignored by the distribution (#6) |
| `apps/run.gpx/webapp/src/app/api/gpx/public/aggregate/route.ts` | HEAT-06 comment reconciliation + parser de-dup | ✓ VERIFIED | Comment rewritten; imports `trkptCoords` from `lib/heatmap-artifact` — one parser, not two |
| `apps/run.gpx/webapp/scripts/backfill-dc33-heatmap.ts` | One-off DC33 backfill | ✓ VERIFIED | 351 lines; output live and correct |
| `apps/run.gpx/webapp/scripts/verify-heatmap-artifact.mjs` | Self-testing artifact verifier | ⚠️ VERIFIED, TOO PERMISSIVE | 294 lines; runs in the probe; **certified an artifact where 18 % of features are degenerate** (WR-06) |
| `.../map/heatmap-layer.ts` | Two line layers, locked paint, lazy, both-visible | ⚠️ WIRED, OUTPUT INVISIBLE | 333 lines; all mechanics correct; the locked paint value renders nothing (#1) |
| `.../layer-control/HeatMap.svelte` | HEAT MAP section | ✓ VERIFIED | 88 lines; mounted in `LayerControl.svelte:530-531` under the availability guard |
| `.../stores/layer-visibility.ts`, `layer-section-collapse.ts` | Persisted ids + `SECTION.heatmap` | ✓ VERIFIED | 154 / 86 lines; both imported and used |
| `infra/terraform/modules/heatmap-scheduler/v1.0.0/*` | Thin invoker module | ✓ VERIFIED | main/iam/variables/outputs/lambda all present; applied in CI |
| `infra/.../us-east-1/heatmap-scheduler/terragrunt.hcl` | Live unit | ⚠️ VERIFIED, SCHEDULES COLLIDE | 135 lines; both schedules live and correct individually — but they coincide at 04:00 PT on all six con days (WR-04) |
| `71-08-probes/heatmap-probe.cjs` + pre/post transcripts | 13-assertion gate with contrast | ✓ VERIFIED | 2/13 pre-deploy → 11/13 post-deploy, same unmodified script (its only commit is Task 1's). Genuine evidence, with two blind spots noted (#6, #24) |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `heatmap-build.ts` / `backfill-dc33-heatmap.ts` | `assertNonAttributable` | Called immediately before `PutObject`, never caught | ✓ WIRED |
| `[year]/route.ts` | `heatmapArtifactKey()` | `isHeatmapYear()` narrows the segment BEFORE key construction | ✓ WIRED |
| `aggregate/route.ts` | `lib/heatmap-artifact.ts` | Imports `trkptCoords` — parser de-duplicated | ✓ WIRED |
| `HeatMap.svelte` | `heatmap-layer.ts` | `heatmapState`, `HEAT_PAINT`, `relativeStamp`, `HEAT_YEARS`; `layer.setVisible()` on toggle | ✓ WIRED |
| `LayerControl.svelte` | `HeatMap.svelte` | Mount at :530-531 gated on `$heatmapState.{dc33,dc34}.available` | ✓ WIRED |
| `heatmap-layer.ts` | `/api/gpx/public/heatmap` | `HEAT_BASE` built from `regionPrefix()` — not root-absolute | ✓ WIRED |
| EventBridge schedules | `heatmap-build-use1` Lambda | `lambda:InvokeFunction` + scheduler assume-role | ✓ WIRED |
| Lambda | internal build route | SSM secret + VPC attachment on `http_only`+`sshhttps` to the Cloud Map private name | ✓ WIRED (proven by a successful manual invoke returning `{ok:true}`) |
| Public heat-map path | CloudFront cache | No ordered behaviour; catch-all `/use1/*` = CachingDisabled | ✗ NOT WIRED |
| `/{region}/api/gpx/internal/*` | A network-layer block | None exists — CloudFront forwards POST to the ALB, ALB rule has no path patterns | ✗ NOT WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Produces real data | Status |
|----------|--------------|--------|--------------------|--------|
| `heatmap-layer.ts` dc33 | GeoJSON FeatureCollection | `GET /heatmap/dc33` → S3 `uploads/HEATMAP/dc33.json` | Yes — 110 features, 20 001 coords, 75 touching Vegas | ✓ FLOWING (to the style; **not to the screen** — see #1) |
| `heatmap-layer.ts` dc34 | GeoJSON FeatureCollection | `GET /heatmap/dc34` → S3 `uploads/HEATMAP/dc34.json` | No — `features: []`, `runCount: 0` | ⚠️ EMPTY BY CALENDAR (valid artifact; no source rows exist yet) |
| `HeatMap.svelte` stamp/hint | `$heatmapState[year]` | `?meta=1` probe at map load | Yes — real `generatedAt`/`runCount`/`totalKm` rendered | ✓ FLOWING |
| DC34 builder | `tracks[][]` | `GpxFile.scan` → S3 GPX → `trkptCoords` | Untested against real data — 0/133 rows have `conDay` | ⚠️ UNEXERCISED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Heatmap unit suites pass | `npx vitest run src/lib/heatmap-{artifact,build}.test.ts src/lib/polyline-decode.test.ts` (Node 22.12) | 3 files, **51/51 passed**, 329 ms | ✓ PASS |
| dc33 served + correct meta | `curl .../heatmap/dc33?meta=1` | 200 `{dc33, 2025-08-15T02:41:54.347Z, 110, 658.4}` | ✓ PASS |
| dc34 served + fresh meta | `curl .../heatmap/dc34?meta=1` | 200 `{dc34, 2026-07-31T04:02:14.036Z, 0, 0}` | ✓ PASS |
| Year allowlist holds | `curl .../heatmap/dc32` | 404 | ✓ PASS |
| Live bytes non-attributable | Fetch + walk all 110 features | 0 features with any property; key sets exact | ✓ PASS |
| CDN caching | 3× `curl -D-` on the same URL | 3× `Miss from cloudfront` | ✗ FAIL |
| Internal route unreachable | `curl -X POST .../internal/heatmap-build` | 403 with the **handler's own** body | ✗ FAIL |
| Schedules armed | `aws scheduler get-schedule` ×2 | Both ENABLED, exact expressions, `America/Los_Angeles` | ✓ PASS |
| Degenerate geometry | Walk live dc33 coordinates | **20/110** features are entirely identical-coordinate lines | ✗ FAIL (data quality) |
| DC33 legibility at shipped paint | Visual inspection of the two controlled captures | Shipped 0.25 indistinguishable from bare basemap; 0.70 legible | ✗ FAIL |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| `71-08-probes/heatmap-probe.cjs` | pre-deploy vs post-deploy, unmodified script | 2/13 → **11/13** | ⚠️ 11/13 — assertions 5 (dc34 leg) and 11 red, single root cause: no con-day runs exist |
| Phase 70 regression | `transcript-phase70-regression.txt` | 16/16 | ✓ PASS |

The pre/post contrast is genuine evidence, not decoration: the pre-deploy run failed 11 of the
13 assertions and the two that passed are annotated in the transcript as not-yet-meaningful.
The script's only commit is Task 1's — it was not softened after the fact, and no synthetic
data was injected (Kurt declined both).

### Requirements Coverage

| Req | Description | Status | Evidence |
|-----|-------------|--------|----------|
| HEAT-01 | Artifact format + public serve route; CDN-cacheable | ⚠️ PARTIAL | Format, allowlist, `?meta=1`, non-attributability all verified live. **CDN caching not delivered** (#6) |
| HEAT-02 | Scheduled DC34 builder, hourly during the con, no opt-in gate | ⚠️ PARTIAL | Builder, internal route, module, live unit and both ENABLED schedules verified. Strava-derived runs *are* covered (strava-sync materialises them as GpxFile S3 tracks — verified). End-to-end unexercised: 0 con-day rows (#3, #10) |
| HEAT-03 | DC33 one-off backfill, both encodings, frozen | ✓ SATISFIED | Live artifact with the honest export `generatedAt`; decoder tested on both shapes. Caveat: 20/110 degenerate features (WR-06) |
| HEAT-04 | `heatmap-layer.ts`, locked paint, lazy, simultaneous | ✗ BLOCKED | Every mechanic verified — lazy load, atomic restore, DC34-above-DC33 insertion, persisted ids. The user-visible outcome the requirement exists for is not achieved (#1) |
| HEAT-05 | HEAT MAP section, two rows, stamp, hint-bar detail, default off | ✓ SATISFIED | Probe 9, 10, 12 all PASS |
| HEAT-06 | Compliance reconciliation + ship via the standard flow | ✓ SATISFIED | Comment rewritten in `aggregate/route.ts` + sibling notes in `gpx-file.ts`; shipped buildpub → deploy.yml → scoped terragrunt-apply; probe extended with pre/post transcripts |

*Note:* `.planning/REQUIREMENTS.md` does not exist in this project (removed at the v1.9 milestone
close). Coverage was assessed against the ROADMAP requirement text and the plans' own
`must_haves`, as instructed. No orphaned requirements found — all six HEAT-* IDs are claimed by
at least one plan.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | `TBD` / `FIXME` / `XXX` / `HACK` / `PLACEHOLDER` | — | **None.** Scanned all 18 phase-modified source/infra files; zero debt markers. Completion is auditable |
| `heatmap-layer.ts` | 182-186, 213-217 | Availability derived from "meta fetch succeeded", and `isFeatureCollection` requires `features.length > 0` | ⚠️ Warning | WR-07: the DC34 row renders and its checkbox **latches ON** with no geometry, no feedback, and re-fetches the full artifact on every subsequent toggle. Live right now |
| `heatmap-artifact.ts` | 190-191 | `if (features.length >= MAX_RUNS) break;` then `runCount: features.length` | ⚠️ Warning | WR-05: silent truncation — a capped build reports exactly 5000 and reads as healthy |
| `heatmap-artifact.ts` | 123-143, 190-201 | No null-island / degeneracy filter | ⚠️ Warning | WR-06: 20/110 live features are `[[0,0],[0,0]]`; `runCount` 110 vs ~90 real runs, publicly served and rendered as "110 runs" |
| `terragrunt.hcl` | 118-128 | `cron(0 * 5-10 8 ...)` and `cron(0 4 * * ...)` both in PT | ⚠️ Warning | WR-04: guaranteed double build at 04:00 PT on every con day, with no `reserved_concurrent_executions`, no idempotency key and no lock |
| `heatmap-build/route.ts` | 43-50 | `export const maxDuration = 300` under `output: "standalone"` on ECS | ⚠️ Warning | WR-03: inert — the "CONTRACT WITH 71-07" binds nothing, and `lambda_timeout = 300` is *equal* not greater, so a slow build can be killed mid-flight and retried into itself twice |
| `[year]/route.ts`, `lambda/index.mjs` | 71/84/98, 26/33 | Raw SDK error objects and arbitrary response bodies logged | ⚠️ Warning | WR-09: undercuts the phase's own log-hygiene claim; an outsider can drive CloudWatch error volume on an uncached unauthenticated path |
| `heatmap-artifact.ts` | 214-291 | Guard never inspects `meta`, `coordinates` contents, or root `type` | ⚠️ Warning | WR-01: the standalone `.mjs` verifier is stricter than the runtime control on the write path — backwards |
| `[year]/route.ts` | 79-95 | `JSON.parse(body) as HeatmapArtifact`, no guard on the serve path | ⚠️ Warning | WR-02: any write bypassing the two known writers publishes unchecked; `{}` yields a 200 with an empty body |
| `heatmap-build.ts` | 160-162 | `\|\| (a.fileId < b.fileId ? -1 : 1)` returns 1 for equal elements | ℹ️ Info | IN-01: inconsistent comparator, harmless today |
| `[year]/route.ts` | 91 | `?meta=` truthiness test | ℹ️ Info | IN-02: `?meta=0` returns meta; matters once a real cache policy lands |
| `polyline-decode.ts` | 117 | Unreachable finite check | ℹ️ Info | IN-03: dead defensive code with the wrong recovery |
| `heatmap-build/route.ts` | 27 | `??` instead of `\|\|` on the secret | ℹ️ Info | IN-04: an empty-string secret pins the route to a permanent silent 403 and nothing pages |
| `heatmap-layer.ts` | 197-200, 323-332 | `remove()` leaves `heatmapState` stale; `whenStyleReady()` can never settle | ℹ️ Info | IN-05 |

**Toolchain (D-71-A..E):** eslint is broken in both packages, prettier has a pre-existing
baseline failure on `LayerControl.svelte`, and the svelte-check baseline is 26+4 env-dependent
rather than a flat 30. All five were proven pre-existing on a clean tree and are correctly
scoped out of this phase. Not counted against it.

### Deferred Items

None. There is no phase after 71 in this milestone, so no gap is addressable by later planned
work. The two calendar-bound items (truths #3 and #10) are routed to human verification with a
dated 5-10 Aug 2026 re-probe rather than deferred, and are tracked in
`.planning/todos/pending/2026-07-31-heatmap-dc33-paint-invisible-and-con-reprobe.md`.

---

## Gaps Summary

**The pipeline is real; the picture is not.**

Eighteen of twenty-four must-haves are verified against production bytes and live AWS state
rather than against SUMMARY prose, and several of them are verified more strictly than the phase
claimed: I walked all 110 live features myself, re-read the compliance comment, re-queried both
EventBridge schedules, and ran the three heatmap suites (51/51). The engineering underneath this
phase is careful and unusually well documented, the guard chokepoint genuinely has no bypass, the
year allowlist genuinely precedes key construction, and the pre/post probe contrast is honest
evidence rather than decoration.

But a heat map that draws nothing has not achieved its goal, and that is the state of the shipped
build. The single highest-value gap is one Kurt-locked number: at `line-opacity 0.25` the DC33
stack is invisible — not subtle, invisible — and the same geometry at 0.70 is exactly the effect
the ROADMAP describes. Everything else in the DC33 path works; only the last step, the one the
user actually sees, does not. The executor was right not to change a locked value unilaterally
and right to file it with reproducible evidence, but the goal sentence "every run a translucent
line ... so overlap = heat" is false of what is live today.

Two structural gaps travel with it, both confirmed by my own probes rather than inherited from
the review. **CDN caching, named explicitly in the phase goal, is not delivered** — three
consecutive identical requests all missed, because `/use1/*` disables caching outright, and the
route's size bounds were reasoned about on that false premise. **The "internal" build route is
reachable from the open internet** — the 403 that the probe accepted comes from the route's own
handler, so the documented network layer does not exist and a shared secret compared
non-constant-time is the sole control on an endpoint that launches an unbounded table scan per
call. Together those two are the phase's real availability exposure for con week, and neither is
visible to the 13-assertion probe as written.

Separately, and requiring a decision rather than a fix: the compensating control accepted in
exchange for dropping the opt-in gate proves the artifact carries *no identifier fields*, which
is not the same property as *not re-identifiable*. Decimation deliberately preserves every run's
exact start and end coordinate at ~1.1 m, published unauthenticated at a stable URL. D-03 stays
locked — this is not a request to restore the gate — but an endpoint trim or a precision drop is
a one-line change to a pure, fully-tested function, and Kurt should make that call before the con
rather than after.

Three truths are neither passed nor failed. The DC34 builder's selection, the hourly schedule's
firing, and the layer's cross-session restore are all correct by inspection and, for the first
two, physically unobservable before 5 August 2026. They are recorded as present-but-unexercised
so that the 18/24 headline cannot be misread as end-to-end proof, and so they survive into the
con re-probe rather than being quietly absorbed.

**Recommendation:** do not treat Phase 71 as complete. Take the paint decision and the two
infrastructure fixes (CloudFront cache behaviour for the public path; a real network block for
`/{region}/api/*/internal/*`, which fixes the inherited strava-sync exposure at the same time)
before DEF CON 34, then close the calendar-bound truths with the dated re-probe during 5-10
August.

---

_Verified: 2026-07-31T04:50:20Z_
_Verifier: Claude (gsd-verifier) — goal-backward, FORCE stance_
_Live verification performed against gpx.defcon.run (run.gpx v0.0.109) and us-east-1 AWS state_
