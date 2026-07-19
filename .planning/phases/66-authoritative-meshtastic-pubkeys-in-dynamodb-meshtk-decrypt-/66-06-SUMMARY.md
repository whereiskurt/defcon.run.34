# Plan 66-06 SUMMARY — meshtk `internal/keycache`

**Status:** COMPLETE (built, tested green). STOPPED before plan 66-07 (no decryptPKI swap, no deploy).
**Repo:** `~/working/meshtk` (separate repo — NOT `apps/run.mqtt/meshtk`).
**Branch:** `feat/authoritative-pubkey-keycache`
**Commits:**
- `5d2ab41` feat(keycache): authoritative MeshRadio pubkey resolver via GetItem
- `f020b2b` test(keycache): ported credcache table-tests + Go key-parity test

## What was built

A new `internal/keycache` package mirroring `internal/credcache`'s `CacheAuthenticator`
(Otter v2 cache + singleflight dedup + negative caching + circuit breaker), with the ONE
deliberate divergence: **direct `GetItem`, never `Scan`**.

### Files added (meshtk)
| File | Role |
|------|------|
| `internal/keycache/types.go` | `ErrNotFound`; `Key{ NodeID, NodeNum uint32, PubKeyHex `dynamodbav:"publicKey"`, Negative }`; `KeyStore.Fetch(ctx, nodeNum uint32)` |
| `internal/keycache/cache.go` | Otter v2 wrapper retyped to `*Key`, keyed by canonical nodeId string (verbatim credcache shape: Get/Set/SetWithTTL/Delete/Stats/Entries/Close) |
| `internal/keycache/store.go` | `DynamoDBStore` with `DynamoDBAPI{ GetItem }`; `NodeIDFromNum`, `meshRadioKey`, `Fetch`; constructors `NewDynamoDBStore` / `NewDynamoDBStoreWithClient` |
| `internal/keycache/resolver.go` | `KeyResolver` (=credcache `CacheAuthenticator`): `Resolve(ctx, nodeNum) (hex, ok, err)`, `fetchWithSingleflight`, `IsDegraded`/`recordFailure`/`recordSuccess` verbatim, options `WithFailureThreshold/WithCooldownDuration/WithNegativeTTL`; one shared process-wide instance documented |
| `internal/keycache/resolver_test.go` | cache-hit / miss-then-fetch / negative-cache / singleflight-collapse / circuit-breaker-open (+ recovery, reset, cache-hit-during-degraded) with a fake `KeyStore` recording call counts |
| `internal/keycache/store_test.go` | fake `GetItem` client: composed key + ProjectionExpression assertions, known-node, empty-Item and nil-Item → `ErrNotFound`, error propagation, publicKey unmarshal |
| `internal/keycache/key_parity_test.go` | Go twin of run.human's `mesh-radio-key-parity.test.ts` (L1) |

### File changed (meshtk)
- `pkg/config/config.go` — added `KeyCacheConfig` sibling to `CredCacheConfig`
  (`TTLSecs default 90`, `NegativeTTLSecs 60`, `TableName run-human-electro`,
  `TableRegion us-east-1`, `Fallback default "nodes.json"`) + `Config.Server.KeyCache`.
  Per 66-06 scope only — the decrypt/reply swap and server wiring are plan 66-07.

## Composed-key parity confirmation (landmine L1)

`meshRadioKey(nodeNum=0x433d1cec)` composes, asserted by `key_parity_test.go` + `store_test.go`:

```
pk = "$run#nodeid_!433d1cec"
sk = "$meshradio_1"
```

- `NodeIDFromNum` = `fmt.Sprintf("!%08x", nodeNum)` → canonical, pad-8, lowercase.
  Leading-zero nodeNums verified to pad (`0x00000abc` → `!00000abc`) — landmine L2.
- `Fetch` projects `publicKey, nodeNum`; `publicKey` is already `0x` hex → returned
  straight in `Key.PubKeyHex` for `ParseHexKey` (verified by `TestStoreUnmarshalsPublicKey`).

This is the Go side of the parity lock; the run.human TS twin `mesh-radio-key-parity.test.ts`
is a monorepo plan (66-01/66-03) — the header comment cross-references it.

## Load-bounding behaviors proven (Success Criterion #2)

`TestResolve_*`: cache-hit makes 0 store calls; unknown sender makes exactly 1 store call
then serves 5 repeats from the negative entry (0 further calls); 20 concurrent misses for
one node collapse to exactly 1 `Fetch`; circuit breaker opens after threshold failures and
short-circuits without hitting the store, recovers after cooldown, and cache hits still
succeed while degraded.

## Quality gates (run for real)

```
$ cd ~/working/meshtk && go build ./...            # BUILD_OK (whole module)
$ go vet ./internal/keycache/...                   # VET_OK (clean)
$ go test ./internal/keycache/... -count=1
ok  	github.com/whereiskurt/meshtk/internal/keycache	0.443s   # 18/18 PASS
$ grep -c 'GetItem' internal/keycache/store.go     # 6
$ grep -v '^\s*//' internal/keycache/store.go | grep -c 'ScanInput'   # 0
```

## Deviations
- None material. TTL default set to **90s** (mid 60–120s band). Cache `MaxSizeMB`
  defaulted to 16 (vs credcache 64) — a small keyspace of node pubkeys; adjustable via config.
- The `Key` struct also carries `dynamodbav:"nodeId"`; `Fetch` always re-stamps
  `NodeID`/`NodeNum` from the requested `nodeNum` so a legacy row missing `nodeNum`
  still caches under the canonical key.

## Not done (deliberately — plan 66-07)
- No `decryptPKI` / `fleet/cmd.go` swap off `FetchPublicKeyFromDefcon`.
- No server wiring (`NewServer` build of cache+store+resolver), no `Fallback` branch logic.
- No deploy.
