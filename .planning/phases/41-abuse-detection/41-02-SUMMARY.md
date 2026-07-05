---
phase: 41-abuse-detection
plan: 02
subsystem: detection-queries
tags: [athena, presto, trino, sql-template, sessionization, rate-limit, node-test, abuse-detection]

# Dependency graph
requires:
  - phase: 41-abuse-detection
    provides: "Plan 01 Glue table alb_access_logs column contract (client_ip, user_agent, request_verb, request_url, elb_status_code, time, day partition)"
provides:
  - "Q1 sustained-activity sessionization Athena template (AD-03) with placeholders {database},{table},{lookback_hours},{session_gap_min},{session_hours}"
  - "Q2 5-minute POST/request-rate outlier Athena template (AD-04) with placeholders {database},{table},{lookback_hours},{posts_per_5min},{requests_per_5min}"
  - "queries.test.mjs node:test placeholder-contract + IP/UA shape test (no third-party dep)"
  - "README documenting the closed placeholder-substitution contract for the Plan 04 handler"
affects: [41-04-handler, 41-05-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Parameterized Athena SQL as standalone .sql template files with {token} placeholders — the handler does a literal string replace of a CLOSED, test-asserted token set; no request-log field is ever interpolated into SQL text"
    - "node:test builtin shape test (no npm install) proves the placeholder set is closed and every finding surfaces IP + UA"
    - "Partition-prune-then-instant-filter window: day >= date_format(now - lookback, yyyy/MM/dd) AND from_iso8601_timestamp(time) >= now() - interval hour"

key-files:
  created:
    - infra/terraform/modules/abuse-detection/v1.0.0/lambda/queries/q1_sustained_activity.sql
    - infra/terraform/modules/abuse-detection/v1.0.0/lambda/queries/q2_rate_outlier.sql
    - infra/terraform/modules/abuse-detection/v1.0.0/lambda/queries/queries.test.mjs
    - infra/terraform/modules/abuse-detection/v1.0.0/lambda/queries/README.md
  modified: []

key-decisions:
  - "Sessionization via lag() gap detection + running sum() session-id, then max session span per client_ip — pure window functions, no self-join"
  - "5-min buckets via floor(to_unixtime(t)/300)*300 (fixed 300s boundary) rather than date_trunc, which has no native 5-min unit in Presto"
  - "top_paths via approx_most_frequent(10, request_url, 1000) — bounded-memory top-N without an extra grouped subquery"
  - "Result columns (user_agents, top_paths, method_mix) carry attacker-controlled strings as DATA only, never re-entering SQL — T-41-04 injection mitigated, T-41-11 disclosure accepted by design"

requirements-completed: [AD-03, AD-04]

coverage:
  - id: D1
    description: "Q1 sessionizes per client_ip and flags IPs whose max session span >= {session_hours}, returning client_ip + distinct user_agents + counts + top paths + status mix"
    requirement: "AD-03"
    verification:
      - kind: test
        ref: "queries.test.mjs#q1_sustained_activity.sql: documented placeholder set fully resolves / surfaces client_ip + user_agent"
        status: pass
      - kind: other
        ref: "grep gates: all 5 Q1 placeholders present, client_ip+user_agent present, day partition referenced, zero 'logs-alb-' literals"
        status: pass
      - kind: manual_procedural
        ref: "Semantic correctness (2h session flags; benign trickle does not) deferred to Plan 05 synthetic-partition deploy checkpoint — needs live Athena/Glue"
        status: unknown
    human_judgment: true
    rationale: "Structure/placeholder-contract/IP-UA gates prove the template is well-formed and injection-safe, but only a live Athena run against a synthetic ALB partition (Plan 05) proves the sessionization logic flags the intended cases. No automated test asserts query semantics here."
  - id: D2
    description: "Q2 buckets into 5-min windows per client_ip and flags peak POST-per-5min > {posts_per_5min} OR peak req-per-5min > {requests_per_5min}, surfacing client_ip + user_agents + method mix + peak window + top paths + 4xx/5xx ratio"
    requirement: "AD-04"
    verification:
      - kind: test
        ref: "queries.test.mjs#q2_rate_outlier.sql: placeholder set fully resolves / surfaces client_ip + user_agent / threshold-driven on {posts_per_5min}"
        status: pass
      - kind: other
        ref: "grep gates: all 5 Q2 placeholders present, request_verb present, 300s bucket present, client_ip+user_agent present, zero 'logs-alb-' literals"
        status: pass
      - kind: manual_procedural
        ref: "Semantic correctness (>30-POST/5min flags; trickle does not) deferred to Plan 05 synthetic-partition deploy checkpoint"
        status: unknown
    human_judgment: true
    rationale: "Same as D1 — shape/injection-safety gates pass, but peak-bucket threshold behavior is only provable against live Athena data in Plan 05."
  - id: D3
    description: "Placeholder-contract shape test proves each template's token set is closed and every template surfaces IP + UA, with zero third-party test dependencies"
    verification:
      - kind: test
        ref: "node --test lambda/queries/*.test.mjs — 7/7 pass; grep 'node:test' present; zero vitest/jest/mocha imports"
        status: pass
    human_judgment: false

# Metrics
duration: 5min
completed: 2026-07-05
status: complete
---

# Phase 41 Plan 02: Abuse-Detection Athena Query Templates Summary

**Two parameterized Athena (Presto/Trino) detection templates — Q1 sessionizes per client_ip via `lag()` gap detection to flag sustained sessions (AD-03), Q2 buckets into fixed 300s windows to flag POST/request-rate outliers (AD-04) — both keyed on client_ip and surfacing distinct user_agents, gated by a dependency-free `node:test` placeholder-contract shape test.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-05T22:05:23Z
- **Completed:** 2026-07-05T22:10:09Z
- **Tasks:** 3
- **Files created:** 4

## Accomplishments
- **Q1 (AD-03)** `q1_sustained_activity.sql`: parses ISO8601 `time`, partition-prunes on `day` then filters the exact `{lookback_hours}` instant window, computes per-`client_ip` session boundaries with `lag()` + a running `sum()` session id (gap > `{session_gap_min}` starts a new session), takes the MAX session span per IP, and flags spans `>= {session_hours} * 60` minutes. Returns `client_ip`, `array_agg(distinct user_agent)`, request count, first/last seen, `max_session_minutes`, `approx_most_frequent` top-10 paths, and 2xx/4xx/5xx status counts, ordered by span desc.
- **Q2 (AD-04)** `q2_rate_outlier.sql`: same windowing, buckets each request into fixed 5-minute windows via `floor(to_unixtime(event_time)/300)*300`, counts requests + POSTs per `(client_ip, bucket)`, takes the peak bucket per IP, and flags `peak_posts_5min > {posts_per_5min} OR peak_requests_5min > {requests_per_5min}`. Returns `client_ip`, distinct user_agents, `histogram(request_verb)` method mix, peak window + counts, top-10 paths, and a 4xx/5xx error ratio, ordered by `greatest(peak_posts, peak_requests)` desc.
- **Shape test** `queries.test.mjs` (node:test/node:assert only): substitutes each template's documented placeholder set and asserts zero residual `{...}` tokens (closed contract), asserts each declared placeholder is present, asserts both templates reference `client_ip` + `user_agent`, and asserts Q1/Q2 are distinct threshold-driven rules. 7/7 pass, no third-party dependency, no `npm install`.
- **README** documents the placeholder contract, the "literal replace, never interpolate a log field" injection guarantee (T-41-04), and that semantic correctness is validated at the Plan 05 deploy checkpoint (not CI).

## Task Commits

Each task was committed atomically:

1. **Task 1: Q1 sustained-activity template + README (AD-03)** — `e45007a2` (feat)
2. **Task 2: Q2 5-minute rate-outlier template (AD-04)** — `8f78e3f3` (feat)
3. **Task 3: placeholder-contract shape test (node:test)** — `738333cd` (test)

## Files Created/Modified
- `infra/terraform/modules/abuse-detection/v1.0.0/lambda/queries/q1_sustained_activity.sql` — AD-03 sessionization template.
- `infra/terraform/modules/abuse-detection/v1.0.0/lambda/queries/q2_rate_outlier.sql` — AD-04 5-min rate-outlier template.
- `infra/terraform/modules/abuse-detection/v1.0.0/lambda/queries/queries.test.mjs` — node:test placeholder-contract + IP/UA shape test (7 tests).
- `infra/terraform/modules/abuse-detection/v1.0.0/lambda/queries/README.md` — placeholder-contract doc + validation path.

## Decisions Made
- **Window-function sessionization** (`lag()` gap flag → running `sum()` session id → max span per IP) instead of a self-join — single scan, cheap, idiomatic Presto.
- **Fixed 300s bucket** via `floor(to_unixtime(t)/300)*300` because Presto's `date_trunc` has no 5-minute unit; keeps buckets aligned to absolute wall-clock 5-min boundaries.
- **`approx_most_frequent(10, request_url, 1000)`** for top paths — bounded memory, avoids a second grouped subquery per IP.
- **All attacker-controlled fields (UA/URL/verb) appear only as result DATA**, never in SQL text; only numeric/identifier placeholders are substituted. The shape test proves the substitution set is closed (T-41-04 mitigated).

## Deviations from Plan

### Tooling adjustments

**1. [Rule 3 - Blocker] Task 3 acceptance/verify command `node --test <dir>/` is not supported by Node's test runner (v22/v23)**
- **Found during:** Task 3 verification.
- **Issue:** The plan's Task 3 acceptance criterion and `<verify>` block use `node --test infra/.../lambda/queries/` (a bare directory positional). Node's built-in test runner (confirmed on both the environment default v22.1.0 and v23.6.0) does **not** treat a bare directory as a test-discovery root — it tries to `require` the directory as a module and fails with `MODULE_NOT_FOUND`. Directory recursion only happens with the **zero-arg** form (`node --test` from cwd); an explicit path must be a file or a glob.
- **Fix:** No change to the test (it is correct). Verified via the functionally-equivalent supported forms: `node --test infra/.../lambda/queries/*.test.mjs` (scoped glob) and `cd infra/.../lambda/queries && node --test` — both exit 0 with **7/7** tests passing. The grep gate (`node:test` present, zero `vitest`/`jest`/`mocha` imports) also passes.
- **Files modified:** none (verification-command form only).
- **Verification:** `node --test <dir>/*.test.mjs` → exit 0, 7 pass; `grep -q 'node:test'` → pass.
- **Commit:** covered by `738333cd` (commit message notes the invocation caveat).

**Total deviations:** 1 (tooling / verification-command form). **Impact:** none on shipped artifacts — the two SQL templates and the shape test are exactly as specified; only the literal CLI form in the acceptance criterion is incompatible with the installed Node test runner, and the equivalent scoped invocation proves the same contract.

## TDD Gate Compliance
Task 3 was marked `tdd="true"`, but its subject is a **contract/shape test over artifacts authored in Tasks 1-2** (the SQL templates are the "implementation" and precede the test). A strict RED-before-GREEN cycle does not apply: writing the test against the already-correct templates yields an immediate GREEN (7/7). The test is committed with a `test(...)` message; there is no separate failing-RED commit because there is no implementation to drive after it. This is validation-style TDD, consistent with the plan's intent (the test proves the templates' placeholder contract is closed).

## Issues Encountered
None beyond the Node `--test` directory-argument limitation documented as Deviation 1. All grep gates, the shape test (7/7), and the plan-level verification pass.

## User Setup Required
None — pure SQL template + test authoring. Threshold wiring (`site.hcl`) and the Lambda handler that substitutes the placeholders arrive in Plans 04/05.

## Next Phase Readiness
- **Plan 04 (handler)** can now read these two templates and substitute the closed placeholder set: Q1 = `{database},{table},{lookback_hours},{session_gap_min},{session_hours}`; Q2 = `{database},{table},{lookback_hours},{posts_per_5min},{requests_per_5min}`.
- Column references are in lockstep with Plan 01's Glue table `alb_access_logs` (`client_ip`, `user_agent`, `request_verb`, `request_url`, `elb_status_code`, `time`, `day`).
- **Deferred (by design):** semantic correctness (2h session flags; >30-POST/5min flags; benign trickle does not) is validated against a synthetic ALB partition at the **Plan 05** deploy checkpoint — not in CI, which would require a live Athena/Glue catalog.

## Self-Check: PASSED
- All 4 created files present on disk.
- All 3 task commits present: `e45007a2`, `8f78e3f3`, `738333cd`.
- Both templates key on `client_ip` and surface `user_agent`; zero `logs-alb-` literals in either; `day` partition referenced in both.
- Shape test: 7/7 pass under `node --test <dir>/*.test.mjs` (v22.1.0 and v23.6.0); zero third-party test imports.

---
*Phase: 41-abuse-detection*
*Completed: 2026-07-05*
