# Deferred Items — Phase 68

Out-of-scope discoveries logged during execution. Not fixed here.

## `internal/credcache` — flaky `TestSingleflight_DeduplicatesConcurrentFetches`

- **Found during:** 68-06 (upstream `/Users/khundeck/working/meshtk`), running the plan's
  `go test ./...` gate.
- **Symptom:** `auth_test.go:289: store.Fetch called 2 times, want exactly 1 (singleflight dedup)`.
  Fails intermittently — roughly 3 in 12 isolated runs, more often under parallel load.
- **Why out of scope:** confirmed pre-existing on a clean `main` worktree (3/12 failures there
  too), and `go list -deps ./internal/credcache` shows the package has **zero** meshtk
  dependencies, so nothing in phase 68 can reach it. Fixing a timing-sensitive singleflight test
  in an unrelated package would put untested risk into a hotfix release.
- **Consequence:** `go test ./...` from the meshtk repo root is not reliably green. Use
  `go test ./internal/app/server/ -count=N` (and `-race`) as the phase-68 gate; both are stable.
- **Suggested fix (separate item):** the test almost certainly races the singleflight window —
  it needs a deterministic barrier (block the fake store's `Fetch` until all callers have
  entered) rather than relying on goroutine scheduling.
