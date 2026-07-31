---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
plan: 12
subsystem: verification-probe
tags: [probe, gap-closure, cdn, edge-block, regression-gate, heat-map]
status: complete

requires:
  - 71-08 probe (heatmap-probe.cjs, 13 assertions)
  - 71-VERIFICATION.md truths #6 and #24
  - 71-REVIEW.md WR-04, WR-06
  - 71-CONTEXT.md D-13
provides:
  - 19-assertion production probe with the two structural blind spots closed
  - transcript-gap-pre.txt — the pre-fix contrast baseline plan 71-16 compares against
  - assertion 16, a standing blast-radius regression gate for the 71-13 edge block
affects:
  - 71-13 (its edge marker + cache behaviour are now gated)
  - 71-14 (its de-collided schedule is now pinned by 13 and its invariant by 18)
  - 71-15 (its dc33 rebuild is now gated by 17)
  - 71-09 (its D-13 opacity is now gated by 19)
  - 71-16 (consumes this transcript as the contrast baseline)

tech-stack:
  added: []
  patterns:
    - "Behaviour over header presence: a cache assertion must observe a HIT, not a directive"
    - "Unforgeable discriminator: an edge-only marker header separates 'unreachable' from 'reached and rejected'"
    - "Negative regression gate: prove a control did NOT catch what must keep working"
    - "Fail-closed denominator set BEFORE the assertions exist, so an incomplete follow-up scores red"

key-files:
  created:
    - .planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-08-probes/transcript-gap-pre.txt
  modified:
    - .planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-08-probes/heatmap-probe.cjs

decisions:
  - "Assertion 8's forbidden-body sub-check is kept but labelled TRANSITIONAL in-code: 71-11 replaces the guard payload with a bare 404, after which the marker header is the sole discriminator"
  - "Assertion 18 pins the schedule-collision INVARIANT off the LIVE expressions while assertion 13 keeps pinning the literal — kept as two assertions, not merged"
  - "Assertion 19 was NOT folded into assertion 11: 11 is calendar-bound red, which would mask a paint regression"
  - "The three 71-08 screenshots the probe run overwrote were restored to their committed bytes; this plan's diff is scoped to its two declared files"

metrics:
  duration: 41m
  completed: 2026-07-31
  tasks: 3
  commits: 3
  files_changed: 2
  probe_score_pre_fix: 8/19
---

# Phase 71 Plan 12: Probe Gap Closure Summary

Extended the HEAT-06 production probe from 13 to 19 assertions so the two structural
failures that hid behind an 11/13 ship gate can now go red, and captured the pre-fix
transcript that makes the eventual post-fix run evidence rather than decoration.

## What Was Built

### Task 1 — assertions 1, 2 and 8 strengthened (commit `96cd4fd1`)

Both blind spots were failures of *predicate shape*, not of coverage. The probe asked the
wrong question and production answered it correctly.

**CR-03 / verification truth #6 — assertions 1 and 2.** The original predicate was "a
`cache-control` header containing `s-maxage` is PRESENT". It was present. The `/use1/*`
behaviour used `Managed-CachingDisabled`, so the origin directive was ignored outright and
every request was a miss. Header presence cannot distinguish a working cache from a
distribution that ignores the header. All three original sub-checks (200, JSON
content-type, `s-maxage` present) are **kept**; a CDN-behaviour sub-check is added on top:
four strictly sequential requests, every `x-cache` recorded in the transcript, and at least
one hit required *after the first*. Both the plain and refresh-hit spellings are accepted,
case-insensitively.

The sequencing is deliberate — parallel requests would race the edge's own fill and could
report a miss on all four even with a working cache, manufacturing a phantom failure.

**CR-01 / verification truth #24 — assertion 8.** The original predicate was "non-2xx". An
unreachable path and a request that traversed CloudFront, the ALB and Next.js before the
handler refused it produce the same status. Production was the second. The non-2xx
requirement is **kept**, and two sub-checks are added:

- the response must carry `x-dc34-edge-block: 1`, a header only the CloudFront function
  from 71-13 can emit. This is the real discriminator and is sufficient alone — the
  application cannot forge it.
- the body must not contain the guard's own payload. This one is **explicitly labelled
  TRANSITIONAL in-code**: 71-11 replaces that rejection with a bare 404 carrying no handler
  body, after which this sub-check can no longer go red on its own. The comment names the
  transition so a future reader does not miscount these as two independent controls.

The label was rewritten to state what is proven — *refused at the edge and never reaches
the application* — rather than merely that the status is not a success.

`TOTAL` was set to the fixed literal **19** in this task, before assertions 14-19 existed,
so an incomplete Task 2 would score red rather than pass against a shrunken denominator
(T-71-12-02).

### Task 2 — assertions 14-19 (commit `f6aeb9ac`)

| # | What it proves | Turns green from |
|---|----------------|------------------|
| 14 | The CDN cache key separates the bare artifact from `?meta=1`, compared on responses that both **HIT** the edge | 71-13 |
| 15 | All three gpx internal routes (`heatmap-build`, `strava-sync`, `reconcile`) are blocked at the edge in **both** the region-prefixed and no-region form — 6 paths, each reported on its own line so a partial block is diagnosable | 71-13 |
| 16 | **REGRESSION GATE** — the edge block did NOT catch run.human's meshtk claim-link mint or run.auth's quota family | already green; must stay green |
| 17 | Zero degenerate features in the live dc33 artifact | 71-15 |
| 18 | The two DC34 schedules' **live** minute fields differ, so they can never fire in the same minute | 71-14 |
| 19 | The live dc33 layer paints at the D-13 `line-opacity` | 71-09 |

**Assertion 14's hit requirement is load-bearing.** Without it the predicate ("both 200,
one small, bodies differ") is satisfied *today*, with CDN caching entirely absent — it
would read identically whether the cache policy is correct, wrong, or missing. Only by
comparing two responses that were both served *from* the edge does it actually test that
the query-string whitelist separates the entries rather than collapsing them into one. A
policy that ignored query strings would serve one body for the other URL: a silent
correctness bug no header check can see.

**Assertion 16 is the most important of the six and is a negation.** It requires the marker
to be **ABSENT**, which is what distinguishes it from a copy of assertion 15. It exists
because the naive shape of the 71-13 fix — block every `/api/internal/*` family across every
distribution — would silently kill a con-critical CTF flow: meshtk reaches run.human's
single-use flag-claim mint over **public HTTPS** (the comment on `MESHTK_RUN_INTERNAL_URL`
in `run.mqtt/service.hcl` says so in as many words), guarded by a shared secret rather than
by unreachability. It uses GET, never POST, so no mint endpoint is poked.

Assertion 13's `SCHEDULES` constant was moved forward to 71-14's de-collided daily
expression `cron(20 4 * * ? *)`; the hourly expression is untouched. This is a
strengthening, not a renumbering — 13 now pins the fixed literal and goes red until 71-14
applies, while 18 pins the durable invariant off the live expressions so a future
expression change cannot silently reintroduce the collision. Both are kept.

Assertion 13's schedule documents are cached in a module-scoped map that assertion 18
reads, so a name 13 could not read stays absent for 18 and 18 fails closed with it.

### Task 3 — the pre-fix contrast transcript (commit `64958740`)

Run against production with nothing from 71-09..71-15 deployed. Independently confirmed
the deployment is unchanged since 71-08: ECS service `run-gpx-use1`, task definition
`run-gpx-use1-dc34:199`, image `dc34-run-gpx-app:v0.0.109`.

## Pre-Fix Score: **8/19**

This is the number plan 71-16 compares its post-deploy run against, using the
byte-identical script.

| # | Verdict | Observation | Expected green from |
|---|---------|-------------|---------------------|
| 1 | **FAIL** | 4 sequential requests, 4× `Miss from cloudfront`, `edge-hits=0/3` | 71-13 |
| 2 | **FAIL** | same, on the 441 779-byte dc33 artifact | 71-13 |
| 3 | PASS | dc32 → 404, allowlist holds | — |
| 4 | PASS | `?meta=1` dc34 = 81 bytes, exact key set | — |
| 5 | **FAIL** | **both** legs now red — dc34 `runCount is 0` (calendar-bound) and dc33 `features[0] is degenerate` | dc33 leg: 71-15; dc34 leg: 5 Aug 2026 |
| 6 | PASS | served dc33 meta matches 71-04 exactly | — |
| 7 | PASS | dc34 artifact 5.99 h old — the scheduled path is producing | — |
| 8 | **FAIL** | no marker header **and** body is `{"error":"Forbidden"}` — reached Next.js | 71-13 (+71-11) |
| 9 | PASS | Heat Map section, rows `[🔥 DC34 — live \| 🔥 DC33 — the classic]` | — |
| 10 | PASS | stamp `"5h ago"`, hint carries runs + year | — |
| 11 | **FAIL** | dc34 layer absent — calendar-bound, dc34 has 0 features | 5 Aug 2026 |
| 12 | PASS | default-off + lazy-load, measured from the network log | — |
| 13 | **FAIL** | live daily is the top-of-hour spelling, probe pins `cron(20 4 * * ? *)` | 71-14 |
| 14 | **FAIL** | neither URL ever served from the edge, so the cache key is untestable | 71-13 |
| 15 | **FAIL** | all 6 gpx internal paths lack the marker (403 region-prefixed, 404 no-region) | 71-13 |
| 16 | **PASS** | mint → 405, quota → 401, **neither carries the marker** | must STAY green |
| 17 | **FAIL** | **20 of 110** dc33 features degenerate, first at index 0 = `[[0,0],[0,0]]` | 71-15 |
| 18 | **FAIL** | both live minute fields are `"0"` — they collide once per con day | 71-14 |
| 19 | **FAIL** | live `line-opacity` = **0.25**, D-13 requires **0.7** | 71-09 |

**Assertion 16 is GREEN pre-fix**, as the plan's verification step 4 requires. No
already-broken production path was found; the plan set proceeds.

Two independent confirmations of prior-wave findings fell out of this run:

- **17 reproduced WR-06 exactly** — 20 of 110, all at null island, `meta.runCount=110`
  still served publicly. 71-10's measurement was correct.
- **assertion 5's dc33 leg newly went red.** It was green in the 71-08 post-deploy run.
  Nothing about production changed; 71-10 taught `verify-heatmap-artifact.mjs` to reject
  degenerate geometry, and the probe shells out to the repo's copy of that verifier. This
  is the tightened verifier catching the artifact it previously certified — exactly the
  third consequence WR-06 named. It is a strengthening landing, not a regression.

## Deviations from Plan

None affecting behaviour. One operational note:

**[Operational] The probe run overwrote three of 71-08's committed screenshots.**
`shot-dc34-only.png`, `shot-dc33-only.png` and `shot-both-layers.png` are written by
assertion 11's `parkAndShoot` helper on every run. The plan forbids touching the screenshot
helpers and declares only two modified files, so the three were restored to their committed
bytes with per-file `git checkout --` after the run. 71-08's visual evidence is intact and
this plan's diff contains exactly its two declared files. Plan 71-16 should expect the same
and decide deliberately whether its post-deploy shots supersede them.

**Incidental observation, not acted on:** assertion 9 now reports the Heat Map section as
`#5 of 5`; the 71-08 post-deploy run reported `#4 of 4`. The deployed image is byte-identical
(`v0.0.109`, task def 199), so a fifth Map Layers section is appearing from data rather than
code. Assertion 9 asserts the section's presence and its two rows, not its ordinal, so it
still passes. Out of scope for this plan — recorded here so 71-16 is not surprised by it.

## Prohibitions Honoured

- **No renumbering, deletion or weakening.** The whole-plan diff is 437 insertions / 18
  deletions. Every one of the 18 deleted lines is a docstring line, `const TOTAL = 13`, the
  old daily cron literal, the `httpPost` resolve line (now additionally returning headers),
  or an assertion 1/2/8 label or note line replaced by a stricter form. No predicate was
  loosened; all thirteen original assertion numbers still carry both a `pass` and a `bad`.
- **No skip helper.** `grep -cE "function skip|SKIP"` = 0.
- **No synthetic con-day data.** Assertions 5 (dc34 leg) and 11 are left red and untouched.
  0 of 133 rows carry a `conDay`; the con is 2026-08-05..10.
- **No permissive flag to `verify-heatmap-artifact.mjs`.** Assertion 5 shells out unchanged.
- **Probe not modified after the run.** The byte-identical-script property is what makes
  the pre/post contrast evidence.

## Acceptance Criteria

All Task 1 and Task 2 greps verified against the file:

```
const TOTAL = 19          → 1        x-dc34-edge-block        → 2
FORBIDDEN_GUARD_BODY      → 3        x-cache                  → 6
function skip|SKIP        → 0        run.defcon.run           → 1
auth.defcon.run           → 1        strava-sync / reconcile  → 1 / 1
0\.7                      → 2        cron(20 4 * * ? *)       → 1
cron(0 4 * * ? *)         → 0        cron(0 * 5-10 8 ? 2026)  → 1
pass(14..19,) / bad(14..19,)         → ≥1 each, every number
node --check                         → exit 0
```

Task 3: `transcript-gap-pre.txt` exists, contains `RESULT: 8/19` (< 19), assertion 16 is
PASS, assertions 1/2/8/13/15/17/18/19 are all FAIL, `grep -c "pk\."` = 0 across the whole
probes directory, and the `git sha` header reads `f6aeb9ac`.

## Threat Mitigations Applied

| Threat | Disposition | How |
|--------|-------------|-----|
| T-71-12-01 mapbox token leaking into a committed transcript | mitigated | Token read from env into process memory only, never printed, never written. Verified: `grep -rl 'pk\.eyJ'` over the probes directory returns 0 files, and `grep -c "pk\."` on the transcript returns 0 |
| T-71-12-02 probe softened after the fact | mitigated | `TOTAL` fixed at 19 in Task 1 before the new assertions existed; the transcript is committed unchanged; 71-16 re-runs the byte-identical script |
| T-71-12-03 POSTing live internal endpoints | accepted | All 6 POSTs unauthenticated and rejected (403/404). Assertion 16 deliberately uses GET so no mint endpoint is exercised |
| T-71-12-04 assertion 8 accepting an app rejection as an edge block | mitigated | Marker header is CloudFront-only and unforgeable by the application; the transitional body check is labelled as such so it is not miscounted as a second control |

## Commits

| Commit | Task | Message |
|--------|------|---------|
| `96cd4fd1` | 1 | strengthen probe assertions 1, 2 and 8; TOTAL 13 → 19 |
| `f6aeb9ac` | 2 | add probe assertions 14-19 incl. the blast-radius regression gate |
| `64958740` | 3 | record the pre-fix contrast transcript — 8/19 |

## For Plan 71-16

Re-run with the **unmodified** script and the same SSM read (the decryption flag is
load-bearing). Compare against `transcript-gap-pre.txt`:

- **Must flip to green:** 1, 2, 8, 13, 14, 15, 17, 18, 19.
- **Must STAY green:** 16 — a red 16 means the edge block is too wide and must be narrowed
  immediately, outranking every other result in the run.
- **Expected to stay red until 5-10 Aug 2026:** 11, and assertion 5's dc34 leg. Assertion
  5's dc33 leg should flip green once 71-15 republishes.
- A perfect run before the con is therefore **17/19**, not 19/19.

## Self-Check: PASSED

- `.planning/.../71-08-probes/heatmap-probe.cjs` — FOUND (1182 lines, `node --check` exit 0)
- `.planning/.../71-08-probes/transcript-gap-pre.txt` — FOUND (`RESULT: 8/19`)
- commit `96cd4fd1` — FOUND
- commit `f6aeb9ac` — FOUND
- commit `64958740` — FOUND
