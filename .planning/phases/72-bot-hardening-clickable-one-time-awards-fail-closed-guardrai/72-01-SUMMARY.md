---
phase: 72-bot-hardening-clickable-one-time-awards-fail-closed-guardrai
plan: 01
subsystem: api
tags: [lambda, alb, qr-resolver, vitest, esm, routing, url-encoding]

# Dependency graph
requires:
  - phase: 47-qr-resolver
    provides: the parse-path / respond / resolve seam and its reserved-namespace convention (_flush, _og, ctf)
provides:
  - a fifth `award` ParseResult kind for `/a/<nonce>`, reserved before the redirect classification
  - `buildClaimHandoff({ nonce })` — a no-store 302 to the region-prefixed claim page
  - the `resolve` award branch: zero DynamoDB reads, zero log lines
  - a regression guard locking the eight live single-letter short codes b c d f g h p r
affects: [72-02 mint-by-challenge, 72-03 ricky lyric delivery, 72-05 resolver deploy + prod probe]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reserved lexical namespace intercepted before code lookup (award joins _flush/_og/ctf)"
    - "Silent branch as a log-hygiene enforcement mechanism (no log line = cannot leak the secret)"

key-files:
  created: []
  modified:
    - apps/run.qr/lambda/resolver/lib/parse-path.mjs
    - apps/run.qr/lambda/resolver/lib/respond.mjs
    - apps/run.qr/lambda/resolver/lib/resolve.mjs
    - apps/run.qr/lambda/resolver/tests/parse-path.test.mjs
    - apps/run.qr/lambda/resolver/tests/respond.test.mjs
    - apps/run.qr/lambda/resolver/tests/resolve.test.mjs

key-decisions:
  - "Reserved letter is the VERBATIM lowercase `a`; `/A/...` deliberately stays an ordinary redirect for code A, so the reservation surface is unambiguous and narrow."
  - "The award branch emits NO log line at all (ogimage precedent) rather than a nonce-free line: a silent branch structurally cannot regress the never-log-the-nonce rule, and the rollup aggregator recognises no such line type."
  - "The nonce is passed through encodeURIComponent even though the legitimate Crockford-base32 alphabet is encoding-invariant — it costs nothing on the happy path and blocks query-parameter smuggling into the claim page."
  - "parse-path performs no trim, casing or validation of the nonce; shape validation belongs to run.human's pending-row lookup, which simply misses on garbage."

patterns-established:
  - "Regression guard by enumeration: the eight live single-letter codes are asserted by name in both parse-path and resolve, so any future single-letter reservation fails loudly."

requirements-completed: [BOT-01]

coverage:
  - id: D1
    description: "GET q.defcon.run/a/<nonce> 302s to https://run.defcon.run/use1/ctf/claim?nonce=<nonce> with Cache-Control no-store"
    requirement: "BOT-01"
    verification:
      - kind: unit
        ref: "tests/resolve.test.mjs#resolve — award hand-off (/a/<nonce>) > 302s no-store to the claim page carrying the nonce"
        status: pass
      - kind: unit
        ref: "tests/respond.test.mjs#buildClaimHandoff > 302s no-store to the region-prefixed claim page with the nonce"
        status: pass
    human_judgment: false
  - id: D2
    description: "The award branch performs zero DynamoDB reads — a pure lexical rewrite that cannot fail, throttle, or add latency"
    requirement: "BOT-01"
    verification:
      - kind: unit
        ref: "tests/resolve.test.mjs#resolve — award hand-off (/a/<nonce>) > NEVER reads DynamoDB — getQr is not called"
        status: pass
      - kind: unit
        ref: "tests/resolve.test.mjs#resolve — award hand-off (/a/<nonce>) > still 302s when getQr would reject — the branch never awaits it"
        status: pass
      - kind: other
        ref: "sed -n '/case \"award\"/,/case \"redirect\"/p' lib/resolve.mjs | grep -c 'await\\|getQr'  → 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "No Qr short code can shadow /a/ — it is intercepted before the redirect branch, alongside _flush, _og and ctf"
    requirement: "BOT-01"
    verification:
      - kind: unit
        ref: "tests/parse-path.test.mjs#parsePath — award (reserved) > never returns the award namespace as a redirect code"
        status: pass
      - kind: other
        ref: "awk '/case \"award\"/{a=NR} /case \"redirect\"/{r=NR} END{exit !(a>0 && a<r)}' lib/resolve.mjs  → award 140 < redirect 144"
        status: pass
    human_judgment: false
  - id: D4
    description: "The eight already-live single-letter short codes b c d f g h p r still classify as redirect and still reach getQr"
    requirement: "BOT-01"
    verification:
      - kind: unit
        ref: "tests/parse-path.test.mjs#parsePath — live single-letter short codes (regression guard) (16 cases)"
        status: pass
      - kind: unit
        ref: "tests/resolve.test.mjs#resolve — live single-letter short codes (regression guard) (9 cases)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The nonce never appears in any emitted log line"
    requirement: "BOT-01"
    verification:
      - kind: unit
        ref: "tests/resolve.test.mjs#resolve — award hand-off (/a/<nonce>) > LOG HYGIENE: emits ZERO log lines"
        status: pass
      - kind: other
        ref: "grep -rn 'nonce' lib/logline.mjs  → no matches"
        status: pass
    human_judgment: false
  - id: D6
    description: "Live prod behaviour of the /a/ route and the eight single-letter codes after deploy"
    verification: []
    human_judgment: true
    rationale: "This plan is authoring + tests only. The Lambda is not deployed here — 72-05 owns the terragrunt apply and the mandatory live prod regression probe."

# Metrics
duration: 9min
completed: 2026-07-31
status: complete
---

# Phase 72 Plan 01: Reserved `/a/<nonce>` Award Namespace Summary

**The q.defcon.run resolver now hands off `/a/<nonce>` to the claim page as a pure lexical 302 — no DynamoDB read, no log line — cutting the award link from 79 characters to 35 while making the namespace un-shadowable by any operator-minted `Qr` code.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-07-31T21:15Z
- **Completed:** 2026-07-31T21:24Z
- **Tasks:** 3 of 3 (all TDD, RED→GREEN)
- **Files modified:** 6 (3 lib, 3 tests)

## Accomplishments

- **Fifth `ParseResult` kind.** `parsePath("/a/k7m3q9x2wr4t")` returns
  `{kind:"award", nonce:"k7m3q9x2wr4t", query:""}`. The branch sits after `ctf` and
  strictly before the redirect fallthrough, so the namespace cannot be shadowed. Bare
  `/a` degrades to `empty` (mirrors the `ctf` short-path rule). The nonce is carried
  verbatim — case kept, unlike a redirect code, which is uppercased.
- **`buildClaimHandoff({ nonce })`.** A no-store `302 Found` to
  `https://run.defcon.run/${DEFAULT_REGION}/ctf/claim?nonce=<encoded>`, built from the
  existing region constant rather than a literal, with no body. `encodeURIComponent`
  keeps a crafted segment like `x&admin=1` as one opaque parameter.
- **The `resolve` award branch.** `case "award"` returns `buildClaimHandoff` directly —
  no `await`, no `getQr`, no rules, no enrichment — and emits no log line at all.
- **Regression guard for the eight live codes.** `b c d f g h p r` are asserted by name
  in both `parse-path` (16 cases) and `resolve` (9 cases). This is the same class of
  check that caught the original `/c/` collision, now permanent.
- **Test suite grew 143 → 185 (+42), all green**, 10 files unchanged.

## Task Commits

Each task was committed atomically as a TDD pair (test → feat):

1. **Task 1: Add the award kind to parsePath** — `9fb3ffbc` (test, RED) → `0e8894d3` (feat, GREEN)
2. **Task 2: Add buildClaimHandoff to respond.mjs** — `49b4aa56` (test, RED) → `33805126` (feat, GREEN)
3. **Task 3: Wire the award branch into resolve** — `96dab06b` (test, RED) → `31e25882` (feat, GREEN)

No REFACTOR commits were needed — each GREEN implementation matched the surrounding
module idiom on the first pass.

## Files Created/Modified

- `apps/run.qr/lambda/resolver/lib/parse-path.mjs` — award branch after `ctf`, before the
  redirect fallthrough; `ParseResult` union and module head inventory both extended; head
  comment now records that interception order is load-bearing for `/a/` specifically.
- `apps/run.qr/lambda/resolver/lib/respond.mjs` — new exported `buildClaimHandoff`
  immediately after `buildCtfHandoff`; module stays pure (no env, no I/O, no AWS SDK).
- `apps/run.qr/lambda/resolver/lib/resolve.mjs` — `case "award"` above `case "redirect"`;
  flow diagram names the award kind and its no-read property; both load-bearing properties
  (never throws, no side effects) untouched.
- `apps/run.qr/lambda/resolver/tests/parse-path.test.mjs` — +23 tests (7 award, 16 guard).
- `apps/run.qr/lambda/resolver/tests/respond.test.mjs` — +4 tests.
- `apps/run.qr/lambda/resolver/tests/resolve.test.mjs` — +15 tests (6 award, 9 guard).

## Decisions Made

1. **Silence over a nonce-free log line.** The plan allowed either; the branch emits
   nothing, following the `ogimage` precedent. Rationale recorded in the branch comment:
   the rollup aggregator (`apps/run.qr/lambda/rollup/lib/aggregate.mjs`) recognises a
   fixed set of line types and this adds none, and a branch that logs nothing cannot
   regress the never-log-the-nonce rule under future edits. No analytics are lost —
   redemption is audited downstream as a `CtfSolve` row in run.human (threat register
   T-72-06, disposition `accept`).
2. **The reservation is on the verbatim lowercase `a` only.** `/A/xyz` remains an
   ordinary redirect for code `A`, asserted explicitly so the reserved surface is exactly
   one string rather than a case-insensitive class.
3. **Encode the nonce despite an encoding-invariant alphabet.** Crockford base32
   lowercase passes through `encodeURIComponent` untouched, so this is free on the happy
   path and is purely a query-injection stop (T-72-02).

## Deviations from Plan

None — plan executed exactly as written. All three tasks, their behaviors, and every
acceptance criterion were implemented as specified.

Two observations worth recording (neither changed the work):

- **TDD RED semantics on guard tests.** The regression-guard cases (`b c d f g h p r`)
  and the bare-`/a` case pass *before* implementation by design — they characterize
  behavior that must not change, not new behavior. The genuinely new assertions failed
  correctly at each RED gate: 6/7 in Task 1, 4/4 in Task 2, 3/6 in Task 3 (in Task 3 the
  no-DynamoDB and zero-log assertions pass trivially while the kind falls through to
  `default:` → 404, and become meaningful only once the branch exists). This is not the
  "test passed unexpectedly" failure mode.
- **Worktree branch namespace.** Commits were made on `worktree-rickyaward`, a dedicated
  per-worktree branch. It is outside the `worktree-agent-*` allow-list pattern in the
  executor protocol but satisfies its intent: HEAD is on an isolated non-protected branch
  (the deny-list check for `main`/`master`/`develop`/`trunk`/`release/*` passes).

## Issues Encountered

**`npx vitest` resolved a broken cached binary.** One test invocation ran with the shell
cwd at the repo root rather than the resolver directory, so `npx` fell back to
`~/.npm/_npx/...` instead of the local install and died with
`Cannot find native binding … @rolldown/binding-darwin-arm64`. Not a code problem and no
`npm install` was run (per the orchestrator's constraint). Fixed by invoking
`./node_modules/.bin/vitest` from an explicit `cd` into
`apps/run.qr/lambda/resolver` for every subsequent run.

## Verification

All plan-level verification steps executed and passing:

1. **Full suite:** `./node_modules/.bin/vitest run` → **10 test files, 185 tests, 0
   failures** (baseline was 10 files / 143 tests).
   Per file: `parse-path` 49, `respond` 16, `resolve` 37.
2. **Branch ordering:**
   `awk '/case "award"/{a=NR} /case "redirect"/{r=NR} END{exit !(a>0 && a<r)}' lib/resolve.mjs`
   → award at line 140, redirect at line 144. **PASS.**
3. **Award branch body is read-free:**
   `sed -n '/case "award"/,/case "redirect"/p' lib/resolve.mjs | grep -c 'await\|getQr'`
   → **0**.
4. **Log hygiene:** `grep -rn 'nonce' lib/logline.mjs` → no matches. The log builders
   still structurally cannot carry a nonce.
5. **Acceptance greps:** `grep -c 'kind: "award"' lib/parse-path.mjs` → 2;
   `grep -c 'export function buildClaimHandoff' lib/respond.mjs` → 1.
6. **Module purity:** the only `process.env`/`import` match in `respond.mjs` is the
   doc-comment sentence asserting the absence.

## Threat Mitigations Applied

Every `mitigate` disposition in the plan's register landed with a test:

| Threat ID | Mitigation | Assertion |
|-----------|-----------|-----------|
| T-72-01 (spoofing) | Reserved check precedes redirect classification | `parse-path` "never returns the award namespace as a redirect code" + the awk ordering check |
| T-72-02 (tampering) | `encodeURIComponent` on the nonce | `respond` "percent-encodes a nonce so it cannot inject a second query parameter" |
| T-72-03 (info disclosure) | Branch emits no log line | `resolve` "LOG HYGIENE: emits ZERO log lines" |
| T-72-04 (DoS) | No DynamoDB read | `resolve` "NEVER reads DynamoDB — getQr is not called" |
| T-72-05 (EoP) | `transfer` — resolver holds no authority | Out of scope by design; enforcement is run.human `claimPending` + `judgeSolve` |
| T-72-06 (repudiation) | `accept` — deliberate | Documented in the branch comment |

No new security-relevant surface was introduced beyond the register, so there are no
threat flags to raise.

## Known Stubs

None. Every branch is fully wired; no placeholder values, TODOs, or unwired data paths
were introduced (`grep -nE 'TODO|FIXME|placeholder|coming soon|not available'` over all
six changed files returns nothing).

## User Setup Required

None — no new env vars, no new files, no new dependencies, no external service
configuration.

## Next Phase Readiness

**Ready.** The resolver contract that downstream plans depend on is now fixed:

- **72-02** (mint-by-challenge) can emit `https://q.defcon.run/a/<nonce>` knowing the
  route resolves, and should keep the nonce alphabet to Crockford base32 lowercase so
  the encoded and raw forms stay identical.
- **72-03** (ricky delivery) can put that URL in the award DM at 35 characters, well
  under the 200-char `chatHardLimit`.
- **72-05** owns deployment. **Nothing here is deployed** — no terragrunt, no AWS calls
  were made. 72-05 must run the mandatory live prod regression probe:
  `q.defcon.run/a/probe` → 302 to the claim page, **and** re-probe that
  `b c d f g h p r` still 302 to their existing destinations.

**Concern to carry forward:** the claim-page side must lowercase the incoming `?nonce`
query parameter before lookup (72-02 Task 3 owns this, tracked as its own task). The
resolver deliberately does not normalize case — that decision is now locked in by the
`/a/AbC` test, so the normalization has to happen downstream.

## Self-Check: PASSED

Artifacts verified present on disk:

- `apps/run.qr/lambda/resolver/lib/parse-path.mjs` — FOUND
- `apps/run.qr/lambda/resolver/lib/respond.mjs` — FOUND
- `apps/run.qr/lambda/resolver/lib/resolve.mjs` — FOUND
- `apps/run.qr/lambda/resolver/tests/parse-path.test.mjs` — FOUND
- `apps/run.qr/lambda/resolver/tests/respond.test.mjs` — FOUND
- `apps/run.qr/lambda/resolver/tests/resolve.test.mjs` — FOUND

Commits verified in `git log`: `9fb3ffbc`, `0e8894d3`, `49b4aa56`, `33805126`,
`96dab06b`, `31e25882` — all FOUND.

---
*Phase: 72-bot-hardening-clickable-one-time-awards-fail-closed-guardrai*
*Completed: 2026-07-31*
