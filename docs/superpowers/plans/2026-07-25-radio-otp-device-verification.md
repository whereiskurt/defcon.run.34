# Radio OTP Device Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the manual-add radio verification code to the physical Meshtastic device as a PKI-encrypted DM, via a DDB queue written by run.human and drained by a meshtk poller.

**Architecture:** run.human's add/resend routes upsert a `MeshOtpPending` item into the shared `run-human-electro` table under a constant partition. The meshtk ghosts/fleet process polls that partition every 20 s, resolves the device pubkey (user-supplied → authoritative DDB → observed NODEINFO), and sends a PKI DM from `!dc340001` "DEF CON 34 MeshMap" on the **sender's own** gateway PKI topic. On success it deletes the queue item and stamps `codeSentAt` on the MeshRadio row so the UI can show honest delivery state.

**Tech Stack:** Next.js 16 + ElectroDB (run.human), Go + paho MQTT + aws-sdk-go-v2 (meshtk upstream at `~/working/meshtk`).

**Spec:** `docs/superpowers/specs/2026-07-25-radio-otp-device-verification-design.md`

## Global Constraints

- meshtk code changes go to `~/working/meshtk` (github.com/whereiskurt/meshtk, branch off `main`, PR there) — NEVER edit `apps/run.mqtt/meshtk` directly; that path must be a symlink to `~/working/meshtk` at build time (this worktree currently holds a STALE COPY — Task 7 fixes it).
- Cross-language DDB keys are byte-locked contracts: queue pk `"$run#queue_otp"`, queue sk `"$meshotppending_1#nodeid_<nodeId>"`, MeshRadio pk `"$run#nodeid_<nodeId>"`, sk `"$meshradio_1"`. Parity tests on BOTH sides use fixture nodeId `!433d1cec` (nodeNum 1128455404).
- PKI DMs MUST publish on the SENDER's gateway topic (`msh/US/2/e/PKI/!<sender>`), never the recipient's — recipients ignore their own gateway topic as self-echo (Phase 66 field bug).
- run.human vitest needs Node ≥22.12 (`nvm use 22.12.0`).
- Deploy ONLY via `deploy.yml` GitHub Actions; local tooling builds+pushes only. ECR tags immutable — release must bump VERSION (release-all `--pr` does this).
- Use `/bin/rm` in shell chains (aliased `rm` prompts).
- The `MeshRadio.codeSentAt` stamp from Go MUST use `ConditionExpression attribute_exists(pk)` — a bare UpdateItem would mint an orphan half-row if the radio was deleted mid-flight.

---

### Task 1: run.human `MeshOtpPending` entity + key parity lock

**Files:**
- Create: `apps/run.human/webapp/src/entities/mesh-otp-pending.ts`
- Test: `apps/run.human/webapp/src/entities/__tests__/mesh-otp-pending-key-parity.test.ts` (put it wherever `mesh-radio-key-parity.test.ts` lives — locate with `grep -r "mesh-radio-key-parity" apps/run.human/webapp/src`; mirror its structure and assertion style)

**Interfaces:**
- Produces: `enqueueOtp(input: {nodeId: string; nodeNum: number; code: string; publicKey?: string; userId: string}): Promise<void>` and `meshOtpPendingKeyFor(nodeId: string): {pk: string; sk: string}` — Task 2 imports `enqueueOtp`; Go Task 4 mirrors the key strings.

- [ ] **Step 1: Write the failing parity test**

```ts
import { describe, it, expect } from "vitest";
import { meshOtpPendingKeyFor } from "../mesh-otp-pending";

describe("MeshOtpPending key parity (LOCKED cross-language contract)", () => {
  it("composes the exact queue pk/sk meshtk's otpqueue package expects", () => {
    const { pk, sk } = meshOtpPendingKeyFor("!433d1cec");
    expect(pk).toBe("$run#queue_otp");
    expect(sk).toBe("$meshotppending_1#nodeid_!433d1cec");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.human/webapp && nvm use 22.12.0 && npx vitest run src/entities/__tests__/mesh-otp-pending-key-parity.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the entity**

```ts
import { Entity, type EntityItem } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * MeshOtpPending — delivery queue for manual-add radio verification codes.
 *
 * run.human enqueues on add/resend; the meshtk ghosts poller (internal/otpqueue)
 * Queries the single constant partition, PKI-DMs the code to the device, then
 * deletes the item. Key strings are a LOCKED cross-language contract
 * (mesh-otp-pending-key-parity.test.ts ↔ meshtk otpqueue key_parity_test.go):
 *   pk = "$run#queue_otp"
 *   sk = "$meshotppending_1#nodeid_<nodeId>"   (nodeId already lowercase pad-8)
 * The live table has DDB TTL DISABLED; the poller reaps items older than 24 h.
 */
export const MeshOtpPending = new Entity(
  {
    model: { entity: "MeshOtpPending", version: "1", service: "run" },
    attributes: {
      // Constant partition discriminator — the only value is "otp".
      queue: { type: ["otp"] as const, required: true, default: "otp" },
      nodeId: { type: "string", required: true },
      nodeNum: { type: "number", required: true },
      code: { type: "string", required: true },
      // 0x-hex X25519 pubkey when the user supplied one at add time.
      publicKey: { type: "string" },
      userId: { type: "string", required: true },
      attempts: { type: "number", default: 0 },
      createdAt: { type: "number", default: () => Date.now() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["queue"] },
        sk: { field: "sk", composite: ["nodeId"] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

export type MeshOtpPendingItem = EntityItem<typeof MeshOtpPending>;

export async function enqueueOtp(input: {
  nodeId: string;
  nodeNum: number;
  code: string;
  publicKey?: string;
  userId: string;
}): Promise<void> {
  await MeshOtpPending.upsert({
    queue: "otp",
    nodeId: input.nodeId,
    nodeNum: input.nodeNum,
    code: input.code,
    ...(input.publicKey ? { publicKey: input.publicKey } : {}),
    userId: input.userId,
    attempts: 0,
    createdAt: Date.now(),
  }).go();
}

/** Exact DynamoDB key for a queue item — exists for the parity test. */
export function meshOtpPendingKeyFor(nodeId: string): { pk: string; sk: string } {
  const key = MeshOtpPending.conversions.fromComposite.toKeys({
    queue: "otp",
    nodeId,
  }) as { pk: string; sk: string };
  return { pk: key.pk, sk: key.sk };
}
```

Note: `mesh-radio.ts:283` has a `meshRadioKeyFor` doing the same conversion — copy its exact ElectroDB conversion call if it differs from the above.

- [ ] **Step 4: Run test to verify it passes**

Run: same vitest command. Expected: PASS. If the composed strings differ (ElectroDB label casing), STOP and update BOTH the test AND Task 4's Go constants to whatever ElectroDB actually emits — the contract is "whatever ElectroDB writes", not the guess.

- [ ] **Step 5: Commit**

```bash
git add apps/run.human/webapp/src/entities/mesh-otp-pending.ts apps/run.human/webapp/src/entities/__tests__/mesh-otp-pending-key-parity.test.ts
git commit -m "feat(human): MeshOtpPending queue entity with locked key parity"
```

---

### Task 2: run.human wire add/resend to enqueue + `codeSentAt`

**Files:**
- Modify: `apps/run.human/webapp/src/entities/mesh-radio.ts` (attributes block ~line 54-120; helpers at bottom)
- Modify: `apps/run.human/webapp/src/app/api/meshtastic-radios/route.ts:195-215` (POST, after `upsertMeshRadio`)
- Modify: `apps/run.human/webapp/src/app/api/meshtastic-radios/resend/route.ts:52-68`

**Interfaces:**
- Consumes: `enqueueOtp` from Task 1.
- Produces: `MeshRadio.codeSentAt?: number` attribute (meshtk writes it, GET returns it, UI Task 3 reads it); `clearCodeSentAt(nodeId: string)` helper.

- [ ] **Step 1: Add `codeSentAt` attribute to MeshRadio**

In `mesh-radio.ts` attributes, after `resendAttempts`:

```ts
      // Epoch ms when meshtk last PKI-DM'd the current verification code to the
      // device (written by the Go poller via a guarded UpdateItem). Cleared by
      // the resend route so the UI flips back to "waiting" until the new code
      // lands. Absent = not yet delivered.
      codeSentAt: {
        type: "number",
      },
```

And add a helper next to `patchMeshRadio`:

```ts
/** Resend rotates the code; drop the stale delivery stamp so the UI shows
 *  "waiting" until meshtk re-sends. */
export async function clearCodeSentAt(nodeId: string) {
  await MeshRadio.patch({ nodeId }).remove(["codeSentAt"]).go();
}
```

- [ ] **Step 2: Enqueue on add (POST)**

In `route.ts` POST, import `enqueueOtp` from `@/entities/mesh-otp-pending`, then after the `upsertMeshRadio` call succeeds (before building `safeRadio`):

```ts
    // Queue delivery: meshtk's poller PKI-DMs this code to the device.
    // Best-effort — a queue write failure must not roll back the add.
    try {
      await enqueueOtp({
        nodeId: canonicalNodeId,
        nodeNum: canonicalNodeNum,
        code: verificationCode,
        ...(publicKeyHex ? { publicKey: publicKeyHex } : {}),
        userId: session.user.id,
      });
    } catch (e) {
      console.error('[Meshtastic] OTP enqueue failed (code stays resendable):', e);
    }
```

- [ ] **Step 3: Enqueue + clear stamp on resend**

In `resend/route.ts`, import `enqueueOtp` and `clearCodeSentAt`; the existing `patchMeshRadio` call sets the new code — after it:

```ts
    await clearCodeSentAt(canonicalNodeId);
    try {
      await enqueueOtp({
        nodeId: canonicalNodeId,
        nodeNum: radio.nodeNum,
        code: newVerificationCode,
        ...(radio.publicKey ? { publicKey: radio.publicKey } : {}),
        userId: session.user.id,
      });
    } catch (e) {
      console.error('[Meshtastic] OTP re-enqueue failed:', e);
    }
```

- [ ] **Step 4: Verify `codeSentAt` reaches the client**

Confirm `toClientRadio` (route.ts:82-85) only strips `verificationCode` — `codeSentAt` flows through untouched. No change needed; just check.

- [ ] **Step 5: Typecheck + full entity tests**

Run: `cd apps/run.human/webapp && npx tsc --noEmit && npx vitest run src/entities`
Expected: clean typecheck; all entity tests (incl. both parity suites) PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/run.human/webapp/src/entities/mesh-radio.ts apps/run.human/webapp/src/app/api/meshtastic-radios/route.ts apps/run.human/webapp/src/app/api/meshtastic-radios/resend/route.ts
git commit -m "feat(human): enqueue OTP delivery on radio add/resend, add codeSentAt"
```

---

### Task 3: run.human UI — honest delivery state

**Files:**
- Modify: `apps/run.human/webapp/src/components/profile/MeshtasticRadios.tsx` (interface ~line 40-46; unverified card ~line 718-735; resend handler ~line 245-275)

**Interfaces:**
- Consumes: `codeSentAt?: number` on the radio objects returned by GET.

- [ ] **Step 1: Add `codeSentAt` to the radio interface**

In the `interface` block (near line 40-46), after `resendAttempts?: number;` add:

```ts
  codeSentAt?: number;
```

- [ ] **Step 2: Make the unverified card honest**

Replace the static "A verification code was sent to your radio. Enter it below." copy (~line 721) with:

```tsx
                          {radio.codeSentAt ? (
                            <>Code sent {new Date(radio.codeSentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — check your radio, then enter it below.</>
                          ) : (
                            <>Waiting to reach your radio on the mesh — make sure it's powered on and connected. The code will be sent as a direct message from "DEF CON 34 MeshMap".</>
                          )}
```

Keep the surrounding attempts-remaining span untouched.

- [ ] **Step 3: Clear local `codeSentAt` on successful resend**

In the resend success path (~line 264-268 where `resendAttempts` local state updates), also drop the stamp so the card flips back to "waiting":

```ts
          ? { ...r, resendAttempts: 3 - (data.resendsRemaining || 0), codeSentAt: undefined }
```

- [ ] **Step 4: Build**

Run: `cd apps/run.human/webapp && npm run build`
Expected: clean build. (Poll-refresh of the radios list already exists via the fetch on mount/actions; no new polling added — YAGNI.)

- [ ] **Step 5: Commit**

```bash
git add apps/run.human/webapp/src/components/profile/MeshtasticRadios.tsx
git commit -m "feat(human): show real OTP delivery state on unverified radio cards"
```

---

### Task 4: meshtk `internal/otpqueue` store (in `~/working/meshtk`)

**Files (all under `~/working/meshtk`):**
- Create: `internal/otpqueue/types.go`, `internal/otpqueue/store.go`
- Test: `internal/otpqueue/key_parity_test.go`, `internal/otpqueue/store_test.go`

Branch first: `cd ~/working/meshtk && git checkout -b feat/otp-delivery main`

**Interfaces:**
- Consumes: aws-sdk-go-v2 dynamodb (same deps as `internal/keycache/store.go` — mirror its construction incl. `NewDynamoDBStore(tableName, region, endpoint)` and the endpoint override for local dev).
- Produces (Task 6 consumes):

```go
type Item struct {
    NodeID    string // "!433d1cec"
    NodeNum   uint32
    Code      string
    PublicKey string // "0x…" or ""
    UserID    string
    Attempts  int
    CreatedAt int64 // epoch ms (run.human Date.now())
}
type Store interface {
    List(ctx context.Context) ([]Item, error)
    Delete(ctx context.Context, nodeID string) error
    BumpAttempts(ctx context.Context, nodeID string, attempts int) error
    MarkRadioCodeSent(ctx context.Context, nodeNum uint32, sentAtMs int64) error
}
```

- [ ] **Step 1: Write the failing key-parity test**

```go
package otpqueue

import "testing"

// LOCKED cross-language contract with run.human's
// mesh-otp-pending-key-parity.test.ts — same fixture, byte-identical strings.
func TestQueueKeyParity(t *testing.T) {
    pk, skPrefix := queuePK, queueSKPrefix
    if pk != "$run#queue_otp" {
        t.Fatalf("queue pk drifted: %q", pk)
    }
    if got := queueSK("!433d1cec"); got != "$meshotppending_1#nodeid_!433d1cec" {
        t.Fatalf("queue sk drifted: %q", got)
    }
    if skPrefix != "$meshotppending_1#nodeid_" {
        t.Fatalf("sk prefix drifted: %q", skPrefix)
    }
}

func TestMeshRadioKeyParity(t *testing.T) {
    k := meshRadioKey(1128455404) // 0x433d1cec
    if k.PK != "$run#nodeid_!433d1cec" || k.SK != "$meshradio_1" {
        t.Fatalf("MeshRadio key drifted: %+v", k)
    }
}
```

(If Task 1's Step 4 revealed different ElectroDB strings, use those.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/working/meshtk && go test ./internal/otpqueue/`
Expected: FAIL (undefined symbols)

- [ ] **Step 3: Implement types.go + store.go**

`types.go`: the `Item` + `Store` declarations above, plus:

```go
const (
    queuePK       = "$run#queue_otp"
    queueSKPrefix = "$meshotppending_1#nodeid_"
    // Items older than this are reaped unsent (live table has DDB TTL disabled).
    MaxAgeMs = 24 * 60 * 60 * 1000
    // Give up after this many failed publish attempts.
    MaxAttempts = 10
)

func queueSK(nodeID string) string { return queueSKPrefix + nodeID }

type radioKey struct{ PK, SK string }

func meshRadioKey(nodeNum uint32) radioKey {
    return radioKey{PK: fmt.Sprintf("$run#nodeid_!%08x", nodeNum), SK: "$meshradio_1"}
}
```

`store.go`: `DynamoDBStore` mirroring `keycache.NewDynamoDBStore` construction (table/region/endpoint). Methods:
- `List`: `Query` with `KeyConditionExpression: "pk = :pk AND begins_with(sk, :skp)"`, unmarshal `nodeId→NodeID, nodeNum→NodeNum, code→Code, publicKey→PublicKey, userId→UserID, attempts→Attempts, createdAt→CreatedAt` via `attributevalue` struct tags (`dynamodbav:"nodeId"` etc.). Single page is fine (queue is tiny); follow `LastEvaluatedKey` in a loop anyway — it's 4 lines.
- `Delete`: `DeleteItem` on `{pk: queuePK, sk: queueSK(nodeID)}`.
- `BumpAttempts`: `UpdateItem` `SET attempts = :a` on the queue key.
- `MarkRadioCodeSent`: `UpdateItem` `SET codeSentAt = :t` on `meshRadioKey(nodeNum)` **with `ConditionExpression: "attribute_exists(pk)"`**; swallow `ConditionalCheckFailedException` (radio deleted mid-flight — not an error), propagate everything else.

- [ ] **Step 4: Write store_test.go with a fake DynamoDBAPI**

Mirror `internal/credcache/store_test.go`'s fake-client pattern. Cover: List unmarshals a realistic ElectroDB item (include `__edb_e__`/`__edb_v__` noise attributes — they must be ignored), Delete composes the right key, MarkRadioCodeSent sends the condition expression and swallows the conditional-check failure.

- [ ] **Step 5: Run tests**

Run: `go test ./internal/otpqueue/`
Expected: PASS

- [ ] **Step 6: Commit (upstream repo)**

```bash
cd ~/working/meshtk && git add internal/otpqueue && git commit -m "feat(otpqueue): DDB store for radio-verification OTP delivery queue"
```

---

### Task 5: meshtk `ObservedPubKey` getter on MqttClient

**Files (under `~/working/meshtk`):**
- Modify: `internal/mqtt/node.go` (or `mqtt.go` — wherever the client's NodeDB lives; find it via the callers of `Node.UpdateUser`, which stores the NODEINFO `pubkey []byte`)
- Test: `internal/mqtt/observed_pubkey_test.go`

**Interfaces:**
- Produces: `func (c *MqttClient) ObservedPubKey(nodeNum uint32) (string, bool)` — returns `"0x" + hex` of the pubkey observed via NODEINFO for that node, `false` if the node is unknown or keyless. Task 6 uses it as the last resolution fallback.

- [ ] **Step 1: Locate the node DB field** — grep `UpdateUser(` callers in `internal/mqtt/`; note the map field (`nodeNum → *Node`) and its mutex, and the Node field the pubkey lands in.

- [ ] **Step 2: Write the failing test** — construct a client (or just the node DB) with a Node whose pubkey is 32 known bytes; assert `ObservedPubKey` returns the `0x`-hex string and `true`; assert unknown node returns `"", false`; assert a node with empty pubkey returns `"", false`.

- [ ] **Step 3: Implement** — read under the same lock the packet path uses; `hex.EncodeToString`; prefix `0x`.

- [ ] **Step 4: Run** `go test ./internal/mqtt/ -run ObservedPubKey` — PASS, then full `go test ./internal/mqtt/` — no regressions.

- [ ] **Step 5: Commit** `git add -A internal/mqtt && git commit -m "feat(mqtt): expose NODEINFO-observed pubkey lookup"`

---

### Task 6: meshtk OTP poller in the fleet

**Files (under `~/working/meshtk`):**
- Create: `internal/app/fleet/otpsend.go`
- Test: `internal/app/fleet/otpsend_test.go`
- Modify: `internal/app/fleet/cmd.go` — in `Simulate`, after the fleet MQTT clients connect and `KeyResolver` is built, start the poller goroutine.

**Interfaces:**
- Consumes: `otpqueue.Store`/`Item` (Task 4), `MqttClient.ObservedPubKey` (Task 5), existing `MqttClient.ResolveSenderPubKey/ParseHexKey/BuildPKIMessage/PublishEnvelopeBytes`, `Config.NodeInfo` (ClientId `!dc340001`, `Topic`, `PKI.PrivateKey`), `Config.KeyCache` (TableName/TableRegion/DynamoDBEndpoint — reuse for the queue store).
- Produces: `(n *FleetCmd) startOtpPoller(ctx context.Context, store otpqueue.Store, pollEvery time.Duration)`.

- [ ] **Step 1: Write failing unit tests** using a fake `otpqueue.Store` and a small seam interface so tests don't need a live MqttClient:

```go
// otpSendDeps is the seam the poller uses; prod wiring adapts FleetCmd+MqttClient[0].
type otpSendDeps interface {
    ResolvePubKeyHex(item otpqueue.Item) (string, bool)
    SendCode(toNodeNum uint32, code string) error
    NowMs() int64
}
```

Tests (table-driven, one `processOtpQueue(deps, store)` pass per case):
1. Item older than `otpqueue.MaxAgeMs` → `Delete` called, no send.
2. No pubkey resolvable → nothing called; item survives.
3. Pubkey resolves, send succeeds → `SendCode` then `Delete` then `MarkRadioCodeSent(nodeNum, now)` in that order.
4. Send fails → `BumpAttempts(nodeID, attempts+1)`, item survives.
5. `Attempts >= otpqueue.MaxAttempts` → `Delete`, no send, error logged.

- [ ] **Step 2: Run to verify failure** — `go test ./internal/app/fleet/ -run Otp` → FAIL.

- [ ] **Step 3: Implement `otpsend.go`**

Core pieces (exact behaviors; adapt names to file):

```go
// pkiTopicFor derives the SENDER's gateway PKI topic from the NodeInfo channel
// topic: "msh/US/2/e/dc.run" + sender !dc340001 -> "msh/US/2/e/PKI/!dc340001".
// Publishing on the sender's own gateway topic is REQUIRED: devices drop
// messages arriving on their own gateway topic as self-echo (Phase 66 bug).
func pkiTopicFor(nodeInfoTopic string, sender uint32) string {
    base := nodeInfoTopic
    if i := strings.LastIndex(base, "/"); i >= 0 {
        base = base[:i]
    }
    return fmt.Sprintf("%s/PKI/!%08x", base, sender)
}

func parseNodeID(id string) (uint32, error) {
    v, err := strconv.ParseUint(strings.TrimPrefix(id, "!"), 16, 32)
    return uint32(v), err
}
```

- Resolution order in the prod `ResolvePubKeyHex`: `item.PublicKey` if non-empty → `MqttClient[0].ResolveSenderPubKey(item.NodeNum)` → `MqttClient[0].ObservedPubKey(item.NodeNum)`; return `false` when all miss.
- Prod `SendCode`: payload `fmt.Sprintf("run.defcon.run radio verification code: %s", code)`; sender num from `parseNodeID(Config.NodeInfo.ClientId)`; sender priv from `MqttClient[0].ParseHexKey(Config.NodeInfo.PKI.PrivateKey)`; recipient pub via `ParseHexKey(resolvedHex)`; `BuildPKIMessage(sender, to, meshtastic.PortNum_TEXT_MESSAGE_APP, payload, priv, pub)` then `PublishEnvelopeBytes(pkiTopicFor(...), envelope)`. Build fresh per send — each queue item is sent exactly once (delete-on-success), so packet-id dedup concerns don't apply.
- `startOtpPoller`: `time.Ticker(pollEvery)` loop calling `processOtpQueue`; every iteration logs a one-line summary ONLY when it did something (`sent=N waiting=N reaped=N failed=N`). Recover-and-log on panic — the poller must never take down the ghosts.

- [ ] **Step 4: Wire into `Simulate`** (after KeyResolver/log line "keycache: authoritative pubkey resolver ready"):

```go
    if store := buildOtpStore(c); store != nil && len(f.MqttClient) > 0 {
        go f.startOtpPoller(ctx, store, 20*time.Second)
    }
```

`buildOtpStore` mirrors `buildKeyResolver`'s config handling (`c.KeyCache.TableName/TableRegion/DynamoDBEndpoint`); returns nil + warn log on construction failure. If `Simulate` has no `ctx`, use `context.Background()` — the process lifetime IS the loop lifetime.

- [ ] **Step 5: Run** `go test ./internal/app/fleet/ && go test ./...` — all PASS, then `go build ./...`.

- [ ] **Step 6: Commit** `git add -A internal/app/fleet && git commit -m "feat(fleet): OTP delivery poller — PKI-DM radio verification codes from the map node"`

---

### Task 7: meshtk PR + worktree symlink restore

- [ ] **Step 1: Push + PR the upstream repo**

```bash
cd ~/working/meshtk && go test ./... && git push -u origin feat/otp-delivery
gh pr create --repo whereiskurt/meshtk --title "feat: radio-verification OTP delivery (queue poller + PKI DM from map node)" --body "..."
```

Merge it (autonomous delivery authorized 2026-07-25), then `git checkout main && git pull`.

- [ ] **Step 2: Restore the symlink in the defcon worktree** — `apps/run.mqtt/meshtk` is currently a STALE untracked copy (predates claimlink work; left by an interrupted build trap):

```bash
cd /Users/khundeck/working/defcon.run.34 && /bin/rm -rf apps/run.mqtt/meshtk && ln -s ~/working/meshtk apps/run.mqtt/meshtk && ls -l apps/run.mqtt/ | grep meshtk
```

Expected: symlink → `/Users/khundeck/working/meshtk`. `git status` must show the untracked `apps/run.mqtt/meshtk/...` noise GONE.

---

### Task 8: defcon PR, release, deploy, live MFA test to !7573fe10

- [ ] **Step 1: Push branch + PR**

```bash
cd /Users/khundeck/working/defcon.run.34 && git push -u origin feat/radio-otp-device-verify
gh pr create --title "feat(human+mqtt): deliver radio verification OTP to device via mesh DM" --body "..."
```

Merge after CI green (autonomous delivery authorized), then `git checkout main-tracking...` — actually: release from a branch cut off updated origin/main.

- [ ] **Step 2: Release images** (env.local.sh already present at worktree root — verified `TF_VAR_profile_prefix="dc34"`):

```bash
./apps/release-all.sh --apps run.human,run.mqtt --pr
```

(Check the script's `--apps` separator convention first — `grep -n "apps" apps/release-all.sh | head` — use spaces vs comma per what it parses.)

- [ ] **Step 3: Deploy via CI**

```bash
gh workflow run deploy.yml -f region=us-east-1 -f pr_number=<ReleasePR#> -f invalidate_cache=true
gh run watch <run-id>
```

- [ ] **Step 4: Verify live**

```bash
curl -s https://run.defcon.run/use1/ | grep -oE 'v0\.0\.[0-9]+'   # human version rolled
# ghosts container picked up the poller:
aws logs filter-log-events --log-group-name /ecs/run-mqtt-ghosts-run-mqtt-use1-dc34 --filter-pattern '"otp"' --start-time <deploy-time>
```

- [ ] **Step 5: Send !7573fe10 its MFA (the user-requested live test)**

`!7573fe10` (Shannon_Overwatch, nodeNum 1970535952) is online and its NODEINFO pubkey was observed 08:50 UTC. Check for an existing MeshRadio row:

```bash
aws dynamodb get-item --table-name run-human-electro --key '{"pk":{"S":"$run#nodeid_!7573fe10"},"sk":{"S":"$meshradio_1"}}' --region us-east-1
```

- Row exists & unverified: enqueue its CURRENT `verificationCode` by writing the queue item directly (attributes exactly as Task 1's entity writes them, incl. `__edb_e__: "MeshOtpPending"`, `__edb_v__: "1"`). Poller delivers within 20 s.
- No row / verified: Kurt manual-adds (or re-adds) `!7573fe10` at run.defcon.run → whoami → radios; the normal flow enqueues; DM from "DEF CON 34 MeshMap" arrives; Kurt enters the code; card flips verified.

Confirm in ghosts logs: `sent=1`, and the meshtk proxy log shows the PKI publish on `msh/US/2/e/PKI/!dc340001`. Report to Kurt for the on-device confirmation.

---

## Self-Review Notes

- Spec coverage: queue entity (T1), add/resend enqueue + codeSentAt (T2), honest UI (T3), Go store + parity (T4), pubkey fallback chain incl. observed NODEINFO (T5), poller + PKI send from map node (T6), repo/sync rules (T7), release/deploy/UAT incl. the !7573fe10 live send (T8). IAM: none needed — live task role already `dynamodb:*` (verified 2026-07-25). TTL: poller reaps (spec amended).
- Types consistent: `enqueueOtp` input ↔ queue attributes ↔ Go `Item` dynamodbav tags; `codeSentAt` number epoch-ms both sides.
- Known judgment calls baked in: single-shot send per queue item (resend button is the retry); publish on sender's gateway topic; guarded UpdateItem for codeSentAt.
