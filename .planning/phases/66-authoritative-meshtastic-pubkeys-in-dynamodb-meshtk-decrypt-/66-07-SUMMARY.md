# Phase 66 — Plan 07 SUMMARY: meshtk decrypt firewall (keycache swap)

**Repo:** `~/working/meshtk` (branch `feat/authoritative-pubkey-keycache`) — NOT the monorepo `apps/run.mqtt/meshtk`.
**Commits (atomic):**
- `f8ebb83` feat(mqtt): resolve decrypt/reply pubkeys via authoritative keycache
- `ed6699a` test(mqtt): security-regression for keycache pubkey resolution
- (builds on 66-06 `5d2ab41` + `f020b2b`, which added `internal/keycache` and the `KeyCacheConfig`/`Server.KeyCache` struct)

## Both pubkey call sites swapped (landmine L4)
1. **Decrypt** — `internal/mqtt/crypto.go` `decryptPKI` (was `:55`): `FetchPublicKeyFromDefcon(packet.GetFrom())` → `c.resolveSenderPubKey(packet.GetFrom())`. Returned error still flows into `mqtt.go` `nackHandler` (`:165-171`), no new NACK plumbing.
2. **Reply-encrypt** — `internal/app/fleet/cmd.go` `sendPKIReply` (was `:223`): `FetchPublicKeyFromDefcon(from)` → `n.MqttClient[toFleetIdx].ResolveSenderPubKey(from)` (exported wrapper; recipient key for `PublishPKIMessage`).

Both go through ONE decision point, `resolveSenderPubKey` (`internal/mqtt/crypto.go`). `ParseHexKey` / X25519 / AES-CCM (V6) unchanged — only the key SOURCE changed.

## Server / fleet wiring (one fleet-wide resolver)
- `buildKeyResolver(c)` in `internal/app/fleet/cmd.go` builds ONE `*keycache.KeyResolver` (`keycache.NewCache` → `keycache.NewDynamoDBStore` → `keycache.NewKeyResolver` with `WithNegativeTTL`), mirroring `server/cmd.go`'s credcache construction. Called once in `NewFleets`; stored on `FleetCmd.KeyResolver`.
- In `Simulate`, each `NewMqttClient` is followed by `mqttClient.SetKeyResolver(f.KeyResolver, f.Config.Server.KeyCache.Fallback)` — all ~34 in-process clients share the ONE resolver (never per-client, never per-packet).
- `MqttClient` gained `keyResolver`, `keyFallback`, and a `nodesFeedFn` test seam. A **nil** resolver (the `nodeinfo` utility command, or a store that failed to build) preserves the legacy `FetchPublicKeyFromDefcon` feed path — fleet degrades rather than refusing to boot.

## Fallback flag (default stays nodes.json — no flip)
`Server.KeyCache.Fallback` — `pkg/config/config.go` default `"nodes.json"`; `pkg/config/meshtk.yaml` gains a `KeyCache:` block (TTL 90s, MaxSizeMB 16, NegativeTTLSecs 60, `Fallback: "nodes.json"`).
- **hit** → authoritative 0x hex from DDB MeshRadio.
- **miss/degraded + `nodes.json`** → `FetchPublicKeyFromDefcon` (bring-up), logs `"...nodes.json fallback used (enrollment-coverage)"`.
- **miss/degraded + `none`** → returns `keycache.ErrNotFound`-wrapped error → existing `nackHandler`, logs `"...fallback=none, NACKing (enrollment-coverage)"`.
Every fallback/miss is logged (never key material). The `none` path is fully implemented + unit-tested; **the flip to `none` is a deploy-time op, NOT done here.**

## Security-regression test (Success Criterion #3)
`internal/mqtt/crypto_test.go` — fake `keycache.KeyStore` + feed spy, no DDB/network:
- **A** keycache hit → DDB key, feed never consulted (even under `nodes.json`).
- **B (regression)** under `fallback=none`, a bogus feed key never wins: keycache hit returns the real key; keycache miss returns an error (→ NACK) instead of the poisoned feed key. A NODEINFO injection on the broker cannot change decrypt behavior.
- **C** `nodes.json` miss falls through to feed + logs.
- **D** `none` miss errors + logs, feed never consulted.
- Nil resolver → legacy feed path.

## Quality gates (green)
```
$ cd ~/working/meshtk && go build ./... && go vet ./internal/mqtt/... ./internal/app/... && go test ./internal/keycache/... ./internal/mqtt/... ./internal/app/...
ok  	github.com/whereiskurt/meshtk/internal/keycache	(cached)
ok  	github.com/whereiskurt/meshtk/internal/mqtt	0.517s
?   	github.com/whereiskurt/meshtk/internal/app	[no test files]
?   	github.com/whereiskurt/meshtk/internal/app/fleet	[no test files]
?   	github.com/whereiskurt/meshtk/internal/app/nodeinfo	[no test files]
ok  	github.com/whereiskurt/meshtk/internal/app/server	0.340s
```
Targeted: `go test ./internal/mqtt/... -run 'ResolveSenderPubKey|Fallback|Regression' -count=1 -v` → all PASS (incl. both regression subtests).

## STOP — deploy-time (out of plan scope)
Write + backfill `MeshRadio` rows BEFORE flipping `Server.KeyCache.Fallback` to `none`. No deploy performed.
