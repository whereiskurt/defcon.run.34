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

## proxy→mosquitto socket dies mid-session, dropping the client (`broken pipe`)

- **Found during:** 68-08 Task 3, reading the Android UAT telemetry on `run-mqtt-use1-dc34:116`
  (meshtk `v0.0.73`), log stream `meshtk/run-mqtt-meshtk/17a91e1151984604a3783db2d78687b5`.
- **Symptom:** the proxy decides `ALLOW` on a real client PUBLISH, then fails to relay it
  because the proxy→broker socket is already closed, and drops the client connection. The
  phone re-CONNECTs within seconds:

  ```
  20:16:57Z level=error failed to write to backend: write tcp 127.0.0.1:38104->127.0.0.1:1884: write: broken pipe
  20:16:59Z action=MQTT5_CONNECT   (reconnect 2s later)
  20:19:08Z level=error failed to write to backend: write tcp 127.0.0.1:42922->127.0.0.1:1884: write: broken pipe
  20:19:12Z action=MQTT5_CONNECT   (reconnect 4s later)
  ```

  Two occurrences in ~36 minutes of real Android publishing (~65s POSITION_APP cadence).
- **Why out of scope for 68-08:** this is the proxy↔broker socket, not the client↔proxy
  session, and it is **not** a regression from 68-06/68-07. The `failed to write to backend`
  path predates this phase and is shared with the 3.1.1 loop (`writeToBackend` and the
  `default` relay arm both surface it); dropping the client on a dead backend is the correct
  and pre-existing behaviour. On the same stream `timeout` = 0, `EOF` = 0, `panic` = 0,
  `MQTT5_PUBLISH_HEADER_FAIL` = 0, and the only two `level=error` lines are the two above.
- **Consequence:** part of the residual Android reconnect churn is attributable here rather
  than to CR-02. CR-02's own symptom (`"Username required for MQTT"`) is **zero** across the
  whole task lifetime. The remaining reconnects carry no proxy-side error, Block or violation
  at all, so they are client- or network-side — the phone re-establishes on its own every
  ~1–5 minutes when idle.
- **Suggested investigation (separate item):** why does mosquitto close the proxy's backend
  socket mid-session? First hypotheses to test, in order: (1) mosquitto's keepalive timeout on
  the **re-encoded** CONNECT — the proxy forwards the client's KeepAlive, so a client that
  relies on the proxy for liveness rather than sending its own PINGREQ would be timed out
  broker-side while the client↔proxy leg looks healthy; (2) mosquitto's
  `max_keepalive`/`persistent_client_expiration` interaction with the swapped `public`
  identity; (3) a duplicate-client-id takeover — the Android app reuses one client id
  (`…-fdcc313a`) across reconnects, so a new CONNECT with the same id makes mosquitto evict
  the previous session, and the evicted session's socket is exactly the one that then breaks.
  Hypothesis (3) fits the 2–4s reconnect latency best and would make this a *consequence* of
  reconnect churn rather than a cause — worth settling before any code change.
- **Would benefit from:** a `writeToBackend` failure that closes the client connection should
  log at a level and with enough context (client id, username) to be greppable per-session;
  today it logs only the TCP 4-tuple, so correlating it to a client requires matching
  timestamps against `MQTT5_CONNECT` lines by hand.
