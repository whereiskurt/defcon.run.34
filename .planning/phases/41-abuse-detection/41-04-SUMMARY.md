---
phase: 41-abuse-detection
plan: 04
subsystem: detection-handler
tags: [lambda, esm, athena, sns, s3, dedup, escalation, fail-safe, node-test, aws-sdk-v3, abuse-detection]

# Dependency graph
requires:
  - phase: 41-abuse-detection
    provides: "Plan 02 Q1/Q2 Athena templates + closed placeholder contract (queries/*.sql)"
  - phase: 41-abuse-detection
    provides: "Plan 03 lambda.tf env-var contract (ATHENA/GLUE/RESULTS/SNS/QUERY_DIR + 7 thresholds) and handler=index.handler"
provides:
  - "abuse-detector handler index.mjs: runs Q1+Q2, builds findings, alerts once/utc-day + escalation, writes daily JSONL + digest, never throws"
  - "lib/finding.mjs buildFinding (allow-listed WAF/Impart seam fields, UA<=5/paths<=10 caps) + RULES"
  - "lib/athena.mjs loadTemplate/renderQuery(loud-on-mismatch)/runQuery(bounded poll) + lazy @aws-sdk/client-athena adapter"
  - "lib/dedup.mjs stateKey/readState/writeState/shouldAlert (once-per-utc-day + escalation) + lazy @aws-sdk/client-s3 adapter"
  - "finding.schema.json — the fixed WAF/Impart finding seam (JSON Schema, additionalProperties false)"
  - "index.test.mjs node:test suite (10 tests) — dedup, escalation, fail-safe, schema exactness, no third-party dep"
affects: [41-05-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy descriptor-adapter seam: real @aws-sdk/* loaded via `await import()` inside makeXAdapter() only when no fake is injected — the source references the SDK (grep + runtime satisfied) but importing a unit never requires it, so the whole suite runs with zero @aws-sdk installed and no npm install (T-41-SC)"
    - "createHandler(injected) dependency-injects {athena,s3,sns,env,now,queryDir}; production `handler = createHandler()` lazily builds+caches real adapters (cold-start amortized)"
    - "Fail-safe orchestration: every AWS touchpoint wrapped so the handler NEVER throws — a query failure logs+continues (retry next cron), a dedup writeState failure still counts the alert (dup email beats a miss), a top-level guard returns a summary instead of rejecting"
    - "buildFinding constructs a fresh object literal with EXACTLY the schema fields — an allow-list that structurally prevents any extra Athena column from leaking into email/JSONL"

key-files:
  created:
    - infra/terraform/modules/abuse-detection/v1.0.0/lambda/index.mjs
    - infra/terraform/modules/abuse-detection/v1.0.0/lambda/lib/athena.mjs
    - infra/terraform/modules/abuse-detection/v1.0.0/lambda/lib/finding.mjs
    - infra/terraform/modules/abuse-detection/v1.0.0/lambda/lib/dedup.mjs
    - infra/terraform/modules/abuse-detection/v1.0.0/lambda/finding.schema.json
    - infra/terraform/modules/abuse-detection/v1.0.0/lambda/index.test.mjs
  modified: []

key-decisions:
  - "Descriptor-adapter seam (send({op,...})) instead of passing raw SDK clients into the lib units — lets runQuery/readState/writeState be driven by fakes with no @aws-sdk present, while the real adapters map descriptors to SDK Commands behind a lazy import"
  - "renderQuery throws on any residual {token} so a template/param mismatch fails in CI, never producing a malformed live query (T-41-13)"
  - "findings.jsonl append is read-append-put — correct and boring for a serial 30-min cron writing a handful of offenders/night; documented inline"
  - "buildFinding normalizes BOTH Q1 (request_count/first_seen/last_seen) and Q2 (peak_requests_5min/peak_5min_bucket) rows into the one seam via field fallbacks; count/peak_5min/window default sensibly per rule"

requirements-completed: [AD-05, AD-06, AD-07]

coverage:
  - id: D1
    description: "Handler runs Q1+Q2 in the workgroup over LOOKBACK_HOURS, builds a finding per flagged IP, and never throws on Athena failure (AD-05)"
    requirement: "AD-05"
    verification:
      - kind: test
        ref: "index.test.mjs#Athena failure does NOT throw — handler resolves with zero alerts (schedule survives, T-41-08)"
        status: pass
      - kind: test
        ref: "index.test.mjs#a newly flagged IP publishes exactly one SNS alert (proves Q1 rows -> findings -> alert path end to end with mocked Athena)"
        status: pass
      - kind: manual_procedural
        ref: "Live Athena over a synthetic ALB partition (real query success + row shape) deferred to Plan 05 deploy checkpoint"
        status: unknown
    human_judgment: true
    rationale: "Mocked-adapter tests prove the orchestration, fail-safe, and row->finding mapping; only a live Athena run (Plan 05) proves the real GetQueryResults serialization parses and the queries return the intended rows."
  - id: D2
    description: "Newly flagged IP alerts once; already-alerted IP (same ip#utc-date) does not re-alert unless it crosses escalation_multiplier x prior count (AD-06)"
    requirement: "AD-06"
    verification:
      - kind: test
        ref: "index.test.mjs#a newly flagged IP publishes exactly one SNS alert; a same-day re-run does not"
        status: pass
      - kind: test
        ref: "index.test.mjs#an IP crossing ESCALATION_MULTIPLIER x its prior count re-alerts"
        status: pass
      - kind: test
        ref: "index.test.mjs#shouldAlert: null prev -> alert; equal count -> skip; escalation -> re-alert"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every finding appended to abuse/YYYY-MM-DD/findings.jsonl in the fixed schema; a dedup-store write failure still sends the alert (AD-07 + fail-safe)"
    requirement: "AD-07"
    verification:
      - kind: test
        ref: "index.test.mjs#every finding written to the daily JSONL carries client_ip AND user_agents"
        status: pass
      - kind: test
        ref: "index.test.mjs#dedup writeState failure is fail-safe: the SNS alert still went out"
        status: pass
      - kind: test
        ref: "index.test.mjs#buildFinding emits EXACTLY the schema field set — no extra keys leak"
        status: pass
    human_judgment: false
  - id: D4
    description: "Finding seam is a fixed allow-list; attacker-controlled UA/URL strings are count- and length-capped (T-41-07)"
    verification:
      - kind: test
        ref: "index.test.mjs#buildFinding caps user_agents (<=5) and top_paths (<=10) so nothing unbounded leaks (T-41-07)"
        status: pass
      - kind: other
        ref: "finding.schema.json additionalProperties:false; buildFinding constructs a fresh literal (grep)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Template/param mismatch fails loudly, never producing a malformed live query (T-41-13)"
    verification:
      - kind: test
        ref: "index.test.mjs#renderQuery throws LOUDLY on a template/param mismatch + resolves real Q1/Q2 with zero residual"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-07-05
status: complete
---

# Phase 41 Plan 04: Abuse-Detector Handler + Logic Units Summary

**A fail-safe ESM Lambda handler that runs the two Plan 02 Athena detections over the last `LOOKBACK_HOURS`, normalizes each flagged IP into a fixed allow-listed finding seam, appends findings to the daily `findings.jsonl`, alerts once-per-UTC-day-per-IP (with escalation re-alerting) to the reused Phase 40 SNS topic, and emits a once-a-day digest — never throwing, proven by a 10-test `node:test` suite that injects fake AWS adapters so it runs with zero `@aws-sdk` packages installed.**

## Performance

- **Duration:** ~12 min
- **Tasks:** 3
- **Files created:** 6
- **Tests:** 17/17 pass under `node --test` (10 new handler/logic tests + 7 Plan 02 query tests)

## Accomplishments
- **`lib/finding.mjs` (AD-07 seam):** `buildFinding(rule, row, now)` maps a Q1 or Q2 Athena row into an object with EXACTLY the 9 seam fields (`ts, rule, client_ip, user_agents, count, window, peak_5min, top_paths, status_mix`) by constructing a fresh literal — no extra column can leak. UA capped to 5, top_paths to 10, each string length-bounded (T-41-07). Exports `RULES`. Tolerant `parseList` handles Presto array `[a, b]` and map `{k=v}` serializations.
- **`lib/athena.mjs` (AD-05):** `loadTemplate` (fs), `renderQuery` (literal `{token}` replace; **throws on any residual token** so a mismatch fails in CI — T-41-13), `runQuery` (StartQueryExecution → bounded poll → GetQueryResults → rows keyed by column name; FAILED/CANCELLED/timeout throw for the handler to catch). Drives Athena through an injected descriptor adapter; `makeAthenaAdapter()` lazily loads runtime `@aws-sdk/client-athena`.
- **`lib/dedup.mjs` (AD-06):** `stateKey(prefix, ip, utcDate)`, `readState` (null on NoSuchKey, else `{count, ts}`), `writeState`, `shouldAlert` (null→alert, count-not-crossed→skip, `count >= prior*multiplier`→re-alert). `makeS3Adapter()` lazily loads `@aws-sdk/client-s3`. `isNotFound` shared with the handler.
- **`finding.schema.json`:** JSON Schema documenting the WAF/Impart seam (`additionalProperties:false`, all 9 fields typed + enum on `rule`). Documentation of the seam a later phase consumes; not read at runtime.
- **`index.mjs` (orchestration):** `createHandler(injected)` reads the Plan 03 env-var contract, renders + runs both queries (a failing query logs+continues), appends every finding to `s3://{RESULTS_BUCKET}/{REPORT_PREFIX}{YYYY-MM-DD}/findings.jsonl`, alerts per new offender with dedup+escalation to `SNS_TOPIC_ARN` (writeState failure still counts the alert), and publishes a digest when `now.getUTCHours() === DIGEST_HOUR_UTC` (quiet-night line when empty). A top-level guard means the function returns a summary rather than ever throwing (design 5 / T-41-08). `export const handler = createHandler()`.
- **`index.test.mjs`:** 10 `node:test`/`node:assert` tests covering dedup once/day, escalation re-alert, Athena-failure-no-throw, writeState-failure fail-safe, finding-schema exactness, UA/path caps, `shouldAlert` unit, `renderQuery` loud-mismatch, and JSONL identifiers — all with injected fake adapters, no third-party dependency, no `npm install`.

## Task Commits

1. **Task 1: finding schema + Athena runner + dedup/escalation units** — `298bfee4` (feat)
2. **Task 2: handler index.mjs (orchestration, fail-safe)** — `6b0d140d` (feat)
3. **Task 3: node:test unit suite** — `4fb60089` (test)

## Files Created
- `.../lambda/index.mjs` — abuse-detector handler (fail-safe orchestration).
- `.../lambda/lib/athena.mjs` — loadTemplate / renderQuery / runQuery + lazy Athena adapter.
- `.../lambda/lib/finding.mjs` — buildFinding (allow-listed seam) + RULES.
- `.../lambda/lib/dedup.mjs` — stateKey / readState / writeState / shouldAlert + lazy S3 adapter.
- `.../lambda/finding.schema.json` — the WAF/Impart finding seam (JSON Schema).
- `.../lambda/index.test.mjs` — node:test suite (10 tests).

## Decisions Made
- **Lazy descriptor-adapter seam** over passing raw SDK clients into the units — the only way to satisfy "no npm install" + "tests pass under `node --test`" when `@aws-sdk/client-athena`/`-s3`/`-sns` are not resolvable locally (runtime-provided only). See Deviation 1.
- **read-append-put for findings.jsonl** — the nightly volume is tiny and the cron is serial, so a naive rewrite is correct and boring; documented inline.
- **buildFinding normalizes both rule shapes** into one seam via field fallbacks (`count = request_count ?? peak_requests_5min`, `window` from first/last-seen or the peak bucket), so the downstream consumer sees a uniform record regardless of which detection fired.

## Deviations from Plan

### Blocker workarounds

**1. [Rule 3 - Blocker] `@aws-sdk/*` not resolvable locally → lazy descriptor-adapter seam instead of module-scope raw SDK clients**
- **Found during:** Task 3 (pre-flight), confirmed before writing tests.
- **Issue:** The plan's Task 1/3 acceptance criteria require `node --test .../lambda/` to pass, and the tests import `index.mjs`. But `@aws-sdk/client-athena`, `@aws-sdk/client-s3`, and `@aws-sdk/client-sns` are **not installed / not resolvable** from the lambda dir (they are provided only by the Lambda runtime, and `npm install` is forbidden by design — T-41-SC). Static top-level `import` of those clients (or `new AthenaClient({})` at module scope) would throw `ERR_MODULE_NOT_FOUND` at import time, before any test runs.
- **Fix:** Kept the plan's unit signatures but added the small index.mjs seam the plan explicitly permits: each unit drives AWS through an injected adapter exposing `send({ op, ... })`. The REAL adapters (`makeAthenaAdapter`/`makeS3Adapter`/`makeSnsAdapter`) load the SDK via `await import("@aws-sdk/...")` **lazily**, only when no fake is injected. Tests inject fake adapters, so the real SDK is never imported and the suite runs SDK-free. The `@aws-sdk/*` specifiers still appear in source (grep gates + runtime both satisfied). `createHandler()` caches the built real adapters at module scope (cold-start amortized), preserving the plan's reuse intent.
- **Files modified:** all three lib units + index.mjs (as authored).
- **Verification:** `node --test` → 17/17 pass with zero `@aws-sdk` installed; `node --check index.mjs` → 0; all Task 1/2/3 grep gates pass.
- **Commit:** covered by `298bfee4`, `6b0d140d`, `4fb60089`.

**2. [Rule 3 - Blocker] `node --test <dir>/` (bare directory) unsupported on this Node — inherited from Plan 02**
- **Found during:** Task 3 verification.
- **Issue:** The acceptance/verify commands use `node --test .../lambda/` (bare directory positional), which Node's built-in runner (v22.1.0 here) does not treat as a discovery root (Plan 02 SUMMARY deviation 1).
- **Fix:** No change to tests. Verified via the equivalent zero-arg form `cd .../lambda && node --test`, which recurses and runs BOTH `index.test.mjs` and `queries/queries.test.mjs` — 17/17 pass.
- **Files modified:** none (verification-command form only).
- **Commit:** n/a.

**Total deviations:** 2 (both Rule 3 blockers — SDK-absent seam + Node `--test` dir form). **Impact:** none on shipped behavior — the handler, lib units, schema, and tests match the plan's intent; the seam is the sanctioned "small seam in index.mjs" and keeps the phase clear of any package-legitimacy gate.

## TDD Gate Compliance
Tasks 1 and 3 are marked `tdd="true"`, but the plan structures the tests as Task 3 (after the Task 1 units and Task 2 handler), i.e. validation-style TDD (same pattern as Plan 02): the implementation is the subject and the suite proves its contracts, yielding an immediate GREEN. There is no separate failing-RED commit because the units precede the test by the plan's own task ordering. Task 3 is committed with a `test(...)` message. All behaviors in the `<behavior>` blocks are asserted and pass (17/17).

## Issues Encountered
None beyond the two documented Rule 3 blockers. All Task 1/2/3 acceptance grep gates, `node --check`, and the full `node --test` suite pass.

## User Setup Required
None — pure handler + test authoring. Threshold values (`site.hcl` `abuse_detection` block) and the live network/ALB-bucket/SNS wiring + the real Athena→SNS→JSONL end-to-end verification arrive at the **Plan 05** deploy checkpoint.

## Next Phase Readiness
- **Plan 05 (wiring/deploy):** the handler reads the exact Plan 03 env-var names; `data.archive_file.detector` now packages real handler code (`index.handler`). The scoped `terragrunt plan`/`apply` + synthetic-partition burst → SNS email → `findings.jsonl` verification is the Plan 05 checkpoint (deferred by design — needs live Athena/Glue/SNS).
- **Deferred (by design):** real query-result serialization parsing and query semantics are only provable against live Athena (Plan 05); mocked tests prove orchestration, dedup/escalation, fail-safe, and the seam shape here.

## Self-Check: PASSED
- All 6 created files present on disk.
- All 3 task commits present: `298bfee4`, `6b0d140d`, `4fb60089`.
- `node --check index.mjs` exit 0; full suite 17/17 pass under `node --test` with zero `@aws-sdk` installed; zero `vitest`/`jest`/`mocha` imports.
- `finding.schema.json` valid JSON with `additionalProperties:false`; `buildFinding` key set equals the schema property set (asserted by test).

---
*Phase: 41-abuse-detection*
*Completed: 2026-07-05*
