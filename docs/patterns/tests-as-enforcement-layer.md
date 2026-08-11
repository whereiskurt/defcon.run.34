# Tests as an enforcement layer

**Use the test suite to enforce the contracts your type system and build can't
express — an architectural rule, a cross-boundary byte-for-byte agreement, a
"this channel carries no secret" boundary — by writing tests that read the source
tree itself and fail when the rule is broken, turning a review-time hope into a
CI-enforced fact.**

## Context

Some of the most important rules in a codebase are the ones no compiler checks:
"only this module is allowed to write that field," "these three copies of a function
must stay byte-identical," "the public channel must never reference the secret
payload," "this vendored file must not be silently reverted by the next upstream sync."
The type system can't state them; the build won't catch them. They live in a design
doc, a code comment, and a reviewer's memory — which means they rot. Six months later a
well-meaning change ("I'll just accrue the points here, it's simpler") reintroduces
exactly the thing the rule forbade, the reviewer who knew the rule has moved on, and it
ships green.

The insight is that a test does not have to test *behavior*. It can test the *source*.
A test that reads files off disk, greps for a forbidden shape, and fails on a match
turns an architectural rule into an executable static assertion that can't be forgotten.

## Forces

- **The rule is real but unexpressible in types.** "Single writer," "byte-identical
  copies," "no secret here" are true architectural constraints, but there is no type you
  can write that a violation fails to compile against.
- **Comments and docs don't enforce anything.** A rule written only in prose is a
  suggestion. The next author either doesn't read it or reads it and disagrees, and
  either way the code changes.
- **Some violations fail *soft*, so nothing goes red.** The worst regressions degrade
  silently — an empty result that a `len() > 0` gate quietly treats as "nothing to do,"
  a reverted directive that just makes a feature no-op. Soft failure means the normal
  test suite stays green while the feature is broken.
- **Duplication you chose not to unify still needs a contract.** Sometimes the right
  call is to duplicate logic across a boundary you won't merge (a Go service and a TS
  app; three app copies of a helper). The duplication is fine; the *drift* is the risk,
  and nothing structural prevents it.

## The pattern

Write tests whose subject is the source tree and the contracts across it. Four named
techniques recur.

**1 — The source-scanning invariant.** A unit test walks the source tree, reads every
non-test file, and fails if any file *other than the sanctioned one* contains a
forbidden write shape. "Only the rescore module writes the score field" becomes: grep
every file for a score-field write; assert the offender list is empty except for the one
allowed module. The architectural rule is now an executable assertion. A future "just
accrue it here" reintroduction turns the offender list non-empty and goes red in CI.
The test is a few lines of `readdir` + regex, and it can't rot the way a comment does.

```
   walk src/  →  for each non-test file  →  does it match the forbidden shape?
                                                      │
                          ┌───────────────────────────┴──────────┐
                          ▼                                       ▼
                 file is the sanctioned writer            any other file
                 → allowed, skip                          → push to offenders[]

                 assert offenders == []   (red the instant the rule is broken)
```

**2 — Parity / golden test instead of a shared package.** When you deliberately keep N
copies of a thing that must agree — two languages producing byte-identical keys, three
apps carrying an identical helper — don't reach for a shared package if unifying isn't
worth it. Instead lock the contract with a test: assert the copies are byte-identical to
each other, or that each matches a committed golden fixture. The *test*, not a build
system or a monorepo package, is the anti-drift mechanism. When this move recurs four or
more times across a codebase, that recurrence is itself the evidence it's a legitimate,
reusable technique rather than a hack.

**3 — Guard test that a sensitive path carries no secret.** When one channel must stay
free of a secret that a sibling channel legitimately carries (a covert path that reads
only `solved` + `points` while the visible path carries a reward payload), write a test
that reads the sensitive path's source files from disk and fails if any of them so much
as *reference* the secret token or the payload renderer. It enforces "this channel
carries no secrets" at **author time** — a future edit that leaks a reward import into a
covert module goes red before it ships. Have the same test also assert every guarded
file is *readable*, so a rename or move that would quietly skip the check fails loudly
instead.

**4 — Put the real guard OUTSIDE the vendor-sync blast radius.** When you customize
vendored code, an upstream re-sync can silently revert your change. If the reverted code
also fails *soft* — an "empty is valid" `len() > 0` gate that just no-ops when your data
vanishes — the regression ships green and can ship green *repeatedly*. Two fixes,
together:

- **Place the authoritative guard where the sync can't reach it.** A build-time
  assertion in a monorepo-only build file (a `Dockerfile` step) lives outside the
  vendored tree that gets clobbered. An in-tree test living *inside* that same tree is
  only a *secondary* net — it's exactly as clobberable as the thing it guards.
- **Treat silent-degradation gates as bugs.** A gate that no-ops on empty input hides
  the regression. Assert *non-empty* instead: make "I got nothing" fail loudly rather
  than pass quietly.

## Key moves

- **Test the source, not just the behavior.** The subject of the test can be the file
  tree. `readFileSync` + a regex over the repo is a first-class testing technique for
  rules the type system can't hold.
- **An empty offender list is the assertion.** Frame source-scanning invariants as
  "collect every violation, assert the set is empty." The failure message can then name
  the offending file, which is exactly what the next author needs.
- **Assert readability alongside the rule.** A guard that silently reads zero files
  passes vacuously. Always assert the files it's supposed to guard actually exist and are
  non-empty, so a move/rename can't disarm it.
- **Choose the guard's location by its blast radius.** The most durable guard is the one
  the likeliest destructive event (a vendor sync, a directory replace) *cannot touch*.
  Ask "what would silently revert this?" and put the guard outside that thing's reach.
- **Recurrence is a signal.** When the same locking move shows up four-plus times, stop
  treating each as a one-off and name it — that's how it becomes a reusable move instead
  of scattered cleverness.

## Traps

- **The soft-fail gate that ships green.** A `len() > 0` check that no-ops on empty is
  the canonical silent regression: the data disappeared, the gate shrugged, nothing went
  red. If empty means broken, assert non-empty.
- **An in-tree guard inside the blast radius.** A test that guards vendored code but
  lives *in* the vendored tree gets reverted together with the thing it guards. It feels
  like protection and provides none against the exact event it's for. The real guard
  must live somewhere the revert can't reach.
- **A regex too loose or too tight.** A source-scanning invariant is only as good as its
  pattern. Too loose and it flags legitimate code (false red, and people learn to ignore
  it); too tight and the forbidden shape slips through a spelling it didn't anticipate.
  Pin it to the exact write shapes and revisit when the API surface changes.
- **A guard that can be silently skipped.** If the file list is hardcoded and a guarded
  file gets renamed, the test may pass by simply not checking it. Assert-readable turns
  that into a failure.

## When not to use it

- If the type system *can* express the rule, use the type system — a source-grep test is
  strictly worse than a constraint the compiler enforces.
- If the duplication should really be unified, unify it. A parity test is for
  duplication you've deliberately chosen to keep; it is not an excuse to avoid the shared
  package when the shared package is the right answer.
- If the rule is trivial, local, and self-evident from one file, a whole-tree scan is
  over-engineering — the value is in rules that span many files or many people over time.

## As built (defcon.run 34)

- **Source-scanning invariant:**
  `apps/run.human/webapp/src/lib/__tests__/scoring-write-invariant.test.ts` — walks
  `src/`, skips test files and the schema definition, and fails if any file other than
  `lib/rescore.ts` patches a `RunUser` score field (or accrues `ctfScore`). The
  executable form of the single-writer rule from
  [frozen-history-recomputed-value-ledger.md](./frozen-history-recomputed-value-ledger.md).
- **Parity / golden tests** (the move recurs across boundaries deliberately left
  un-unified): three byte-identical helper copies locked by a parity test in
  `docs/superpowers/specs/2026-07-03-oidc-silent-sso-design.md`; a Go↔TypeScript
  byte-identical key parity test in
  `docs/superpowers/specs/2026-07-25-radio-otp-device-verification-design.md`;
  golden-JSON-per-kind record shape in
  `docs/superpowers/specs/2026-08-04-mqtt-records-capture-design.md` ("They share call
  sites, never a format").
- **Covert-channel no-secret guard:**
  `apps/run.human/webapp/src/lib/__tests__/ctf-reward-covert-invariant.test.ts` (and
  siblings matching `ctf-*covert-invariant.test.ts`) — reads each covert source file
  from disk, asserts it's readable, and asserts it references no reward token.
- **Guard outside the vendor-sync blast radius:**
  `apps/run.mqtt/meshtk/internal/app/fleet/gpx_routes_test.go` (header) — documents that
  a vendor-sync reverted a `go:embed` directive, a `len()>0` gate failed soft, and the
  same regression shipped green twice; the authoritative guard is a build-time assertion
  in `Dockerfile.meshtk` (monorepo-only), with this in-tree test called out explicitly as
  a secondary net because it, too, lives under `internal/`.
