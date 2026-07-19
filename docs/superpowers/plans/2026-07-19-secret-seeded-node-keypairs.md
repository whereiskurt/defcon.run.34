# Secret-Seeded Deterministic Node Keypairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make production ghost/rabbit X25519 keypairs deterministically derived from a server-only SSM secret, so committed keys become inert decoys while surviving restarts unchanged.

**Architecture:** A new `DeriveNodeKey(secret, nodeID)` helper in meshtk produces a valid X25519 keypair via HKDF-SHA256. When `MESHTK_GHOST_KEY_SECRET` is set, every fleet node's committed keypair is overridden with the derived one (post-load for ghosts, post-generate for rabbits). Absent the secret, committed keys are retained for localdev. A dedicated SSM parameter feeds the secret into the `run-mqtt-ghosts` ECS container.

**Tech Stack:** Go 1.24 (`crypto/ecdh`, `golang.org/x/crypto/hkdf`, `golang.org/x/crypto/curve25519`), Terragrunt/Terraform, AWS SSM + SOPS.

## Global Constraints

- meshtk code changes land in `~/working/meshtk` (upstream repo, module `github.com/whereiskurt/meshtk`) on a feature branch — **NOT** the `apps/run.mqtt/meshtk` overlay copy in the defcon repo.
- Node private-key material must never be all-zero-length; `UpdateUser`/`ApplyDerivedKey` format keys as `fmt.Sprintf("0x%x", bytes)` to match `ParseHexKey` (which strips the `0x` prefix).
- Derivation must be deterministic: identical `(secret, nodeID)` → identical bytes, forever.
- Gating signal is presence of the secret string (non-empty), mirroring the existing `MapEnvVars` env-override pattern. No AWS/environment detection.
- HKDF `info` is pinned as `fmt.Sprintf("meshtk-node-key:%08x", nodeID)`; salt is nil.
- Two separate PRs: one on `whereiskurt/meshtk`, one on `defcon.run.34`.

---

## Repo A — `~/working/meshtk` (feature branch)

Run all commands in Repo A tasks from `/Users/khundeck/working/meshtk`.

### Task 1: `DeriveNodeKey` helper

**Files:**
- Create: `internal/mqtt/keyderive.go`
- Test: `internal/mqtt/keyderive_test.go`

**Interfaces:**
- Produces: `func DeriveNodeKey(secret string, nodeID uint32) (pub []byte, priv []byte, err error)` — 32-byte X25519 public and private key bytes derived from `secret` and `nodeID`.

- [ ] **Step 1: Write the failing test**

```go
// internal/mqtt/keyderive_test.go
package mqtt

import (
	"bytes"
	"testing"

	"golang.org/x/crypto/curve25519"
)

func TestDeriveNodeKeyDeterministic(t *testing.T) {
	pub1, priv1, err := DeriveNodeKey("top-secret", 2076591764)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	pub2, priv2, err := DeriveNodeKey("top-secret", 2076591764)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !bytes.Equal(priv1, priv2) || !bytes.Equal(pub1, pub2) {
		t.Fatal("derivation not deterministic for identical inputs")
	}
	if len(priv1) != 32 || len(pub1) != 32 {
		t.Fatalf("expected 32-byte keys, got priv=%d pub=%d", len(priv1), len(pub1))
	}
}

func TestDeriveNodeKeyVariesByInput(t *testing.T) {
	_, privA, _ := DeriveNodeKey("top-secret", 1)
	_, privB, _ := DeriveNodeKey("top-secret", 2)
	_, privC, _ := DeriveNodeKey("other-secret", 1)
	if bytes.Equal(privA, privB) {
		t.Fatal("different nodeIDs produced identical private keys")
	}
	if bytes.Equal(privA, privC) {
		t.Fatal("different secrets produced identical private keys")
	}
}

func TestDeriveNodeKeyRoundTrip(t *testing.T) {
	// Two derived nodes must be able to compute a shared X25519 secret,
	// proving pub is the true match for priv (production uses curve25519.X25519).
	pubA, privA, _ := DeriveNodeKey("top-secret", 100)
	pubB, privB, _ := DeriveNodeKey("top-secret", 200)

	sharedAB, err := curve25519.X25519(privA, pubB)
	if err != nil {
		t.Fatalf("X25519 A->B failed: %v", err)
	}
	sharedBA, err := curve25519.X25519(privB, pubA)
	if err != nil {
		t.Fatalf("X25519 B->A failed: %v", err)
	}
	if !bytes.Equal(sharedAB, sharedBA) {
		t.Fatal("shared secrets differ — derived pub does not match priv")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/mqtt/ -run TestDeriveNodeKey -v`
Expected: FAIL — `undefined: DeriveNodeKey`

- [ ] **Step 3: Write minimal implementation**

```go
// internal/mqtt/keyderive.go
package mqtt

import (
	"crypto/ecdh"
	"crypto/sha256"
	"fmt"
	"io"

	"golang.org/x/crypto/hkdf"
)

// DeriveNodeKey deterministically derives a valid X25519 keypair from a
// server-only secret and the node's stable ID. The public key is computed from
// the private scalar, so the pair always matches. Same (secret, nodeID) yields
// the same keypair on every call — keys survive restarts unchanged.
func DeriveNodeKey(secret string, nodeID uint32) (pub []byte, priv []byte, err error) {
	info := []byte(fmt.Sprintf("meshtk-node-key:%08x", nodeID))
	kdf := hkdf.New(sha256.New, []byte(secret), nil, info)

	seed := make([]byte, 32)
	if _, err = io.ReadFull(kdf, seed); err != nil {
		return nil, nil, fmt.Errorf("hkdf read: %w", err)
	}

	privKey, err := ecdh.X25519().NewPrivateKey(seed)
	if err != nil {
		return nil, nil, fmt.Errorf("x25519 private key: %w", err)
	}
	return privKey.PublicKey().Bytes(), privKey.Bytes(), nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/mqtt/ -run TestDeriveNodeKey -v`
Expected: PASS (all three tests)

- [ ] **Step 5: Commit**

```bash
git add internal/mqtt/keyderive.go internal/mqtt/keyderive_test.go
git commit -m "feat(mqtt): DeriveNodeKey — deterministic X25519 keypair from secret+nodeID"
```

---

### Task 2: `Node.ApplyDerivedKey` method

**Files:**
- Modify: `internal/mqtt/node.go` (add method near `UpdateUser`, around line 245-258)
- Test: `internal/mqtt/keyderive_test.go` (append)

**Interfaces:**
- Consumes: `DeriveNodeKey` (Task 1); `Node.From uint32`, `Node.PubKey string`, `Node.PrivKey string`.
- Produces: `func (node *Node) ApplyDerivedKey(secret string) error` — overwrites `node.PubKey`/`node.PrivKey` with `0x`-prefixed hex of the derived keypair for `node.From`.

- [ ] **Step 1: Write the failing test**

```go
// append to internal/mqtt/keyderive_test.go
func TestApplyDerivedKeyOverwrites(t *testing.T) {
	node := NewNode("msh/US/2/e/dc.run")
	node.From = 2076591764
	node.PubKey = "0xaaaa"
	node.PrivKey = "0xbbbb"

	if err := node.ApplyDerivedKey("top-secret"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	pub, priv, _ := DeriveNodeKey("top-secret", 2076591764)
	wantPub := "0x" + hex.EncodeToString(pub)
	wantPriv := "0x" + hex.EncodeToString(priv)
	if node.PubKey != wantPub {
		t.Fatalf("pubkey = %s, want %s", node.PubKey, wantPub)
	}
	if node.PrivKey != wantPriv {
		t.Fatalf("privkey = %s, want %s", node.PrivKey, wantPriv)
	}
}
```

Add `"encoding/hex"` to the test file's import block.

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/mqtt/ -run TestApplyDerivedKey -v`
Expected: FAIL — `node.ApplyDerivedKey undefined`

- [ ] **Step 3: Write minimal implementation**

Add to `internal/mqtt/node.go` (immediately after the `UpdateUser` method, before line ~259 closing region):

```go
// ApplyDerivedKey overwrites the node's keypair with one deterministically
// derived from secret and the node's stable ID. Used to override committed
// decoy keys with production keys when MESHTK_GHOST_KEY_SECRET is set.
func (node *Node) ApplyDerivedKey(secret string) error {
	pub, priv, err := DeriveNodeKey(secret, node.From)
	if err != nil {
		return err
	}
	node.PubKey = fmt.Sprintf("0x%x", pub)
	node.PrivKey = fmt.Sprintf("0x%x", priv)
	return nil
}
```

(`fmt` is already imported in `node.go`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/mqtt/ -run TestApplyDerivedKey -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/mqtt/node.go internal/mqtt/keyderive_test.go
git commit -m "feat(mqtt): Node.ApplyDerivedKey overwrites keypair from derived secret"
```

---

### Task 3: Register `MESHTK_GHOST_KEY_SECRET` config + env

**Files:**
- Modify: `pkg/config/config.go` (Config struct, around line 20-45)
- Modify: `internal/app/cmdargs.go` (`RegisterOsArgs`, around line 44-48)

**Interfaces:**
- Produces: `Config.GhostKeySecret string` — populated from the `MESHTK_GHOST_KEY_SECRET` env var via the existing `MapEnvVars` mechanism.

- [ ] **Step 1: Add the config field**

In `pkg/config/config.go`, inside `type Config struct`, add alongside the other top-level string fields (e.g. after `ConfigFileName string \`json:"-"\``):

```go
	GhostKeySecret string `json:"-"`
```

- [ ] **Step 2: Register the env-mapped flag**

In `internal/app/cmdargs.go`, inside `RegisterOsArgs`, after the existing `cmd.GlobalS(...)` calls (around line 48):

```go
	cmd.GlobalS("GhostKeySecret", &a.Config.GhostKeySecret, nil, []string{"MESHTK_GHOST_KEY_SECRET"})
```

- [ ] **Step 3: Verify it compiles**

Run: `go build ./...`
Expected: no output (success)

- [ ] **Step 4: Commit**

```bash
git add pkg/config/config.go internal/app/cmdargs.go
git commit -m "feat(config): register MESHTK_GHOST_KEY_SECRET env -> Config.GhostKeySecret"
```

---

### Task 4: Wire the override pass into fleet load + generate paths

**Files:**
- Modify: `internal/app/fleet/nodes.go` (add `overrideFleetKeys`; call `ApplyDerivedKey` in `makeNode` after `UpdateUser`, around line 57)
- Modify: `internal/app/fleet/cmd.go` (call `overrideFleetKeys` after `initNodeDb`, around line 124)
- Test: `internal/app/fleet/keyoverride_test.go`

**Interfaces:**
- Consumes: `Config.GhostKeySecret` (Task 3); `Node.ApplyDerivedKey` (Task 2); `f.Nodes[idx] map[uint32]*mqtt.Node`; `f.NodesMutex[idx]`.
- Produces: `func (f *FleetCmd) overrideFleetKeys(idx int)` — when the secret is set, re-derives every node's keypair in fleet `idx`.

- [ ] **Step 1: Write the failing test**

```go
// internal/app/fleet/keyoverride_test.go
package fleet

import (
	"testing"

	"github.com/whereiskurt/meshtk/internal/mqtt"
	"github.com/whereiskurt/meshtk/pkg/config"
)

func TestOverrideFleetKeysGated(t *testing.T) {
	node := mqtt.NewNode("msh/US/2/e/dc.run")
	node.From = 2076591764
	node.PubKey = "0xcommittedpub"
	node.PrivKey = "0xcommittedpriv"

	f := &FleetCmd{}
	f.Config = &config.Config{}
	f.Nodes = []mqtt.NodeDB{{node.From: node}}
	f.NodesMutex = make([]sync.Mutex, 1)

	// Secret absent: committed keys retained.
	f.overrideFleetKeys(0)
	if node.PrivKey != "0xcommittedpriv" {
		t.Fatalf("expected committed key retained, got %s", node.PrivKey)
	}

	// Secret present: keys overridden with derived values.
	f.Config.GhostKeySecret = "top-secret"
	f.overrideFleetKeys(0)
	_, wantPriv, _ := mqtt.DeriveNodeKey("top-secret", 2076591764)
	if node.PrivKey == "0xcommittedpriv" {
		t.Fatal("expected key to be overridden when secret is set")
	}
	if node.PrivKey != mqtt.HexKey(wantPriv) {
		t.Fatalf("privkey = %s, want %s", node.PrivKey, mqtt.HexKey(wantPriv))
	}
}
```

Add imports `"sync"` to the test file. Note: this test references a small helper `mqtt.HexKey` for formatting parity — define it in Step 3.

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/app/fleet/ -run TestOverrideFleetKeys -v`
Expected: FAIL — `f.overrideFleetKeys undefined` (and `mqtt.HexKey undefined`)

- [ ] **Step 3: Write the implementation**

First add the formatting helper to `internal/mqtt/keyderive.go` so tests and code share one format:

```go
// HexKey formats raw key bytes as meshtk's on-wire "0x"-prefixed lowercase hex.
func HexKey(b []byte) string {
	return fmt.Sprintf("0x%x", b)
}
```

Then in `internal/mqtt/node.go`, change `ApplyDerivedKey` to use it (keep behavior identical):

```go
	node.PubKey = HexKey(pub)
	node.PrivKey = HexKey(priv)
```

Add `overrideFleetKeys` to `internal/app/fleet/nodes.go`:

```go
// overrideFleetKeys replaces every node's committed keypair in fleet idx with a
// deterministic secret-derived one, but only when MESHTK_GHOST_KEY_SECRET is
// set. Absent the secret it is a no-op and committed keys are used as-is.
func (f *FleetCmd) overrideFleetKeys(idx int) {
	secret := f.Config.GhostKeySecret
	if secret == "" {
		return
	}
	f.NodesMutex[idx].Lock()
	defer f.NodesMutex[idx].Unlock()
	for _, node := range f.Nodes[idx] {
		if err := node.ApplyDerivedKey(secret); err != nil {
			f.Config.Log.Warnf("ghost key override failed for node %d: %v", node.From, err)
		}
	}
}
```

In `internal/app/fleet/nodes.go` `makeNode`, immediately after the `n.UpdateUser(...)` call (around line 57), cover the generate path:

```go
	if f.Config.GhostKeySecret != "" {
		_ = n.ApplyDerivedKey(f.Config.GhostKeySecret)
	}
```

In `internal/app/fleet/cmd.go` `Simulate`, immediately after the `f.initNodeDb(idx)` call (around line 124), cover the load path:

```go
		f.overrideFleetKeys(idx)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/app/fleet/ ./internal/mqtt/ -v`
Expected: PASS (new tests plus existing crypto/node tests still green)

- [ ] **Step 5: Full build + vet**

Run: `go build ./... && go vet ./internal/app/fleet/ ./internal/mqtt/`
Expected: no output (success)

- [ ] **Step 6: Commit**

```bash
git add internal/app/fleet/nodes.go internal/app/fleet/cmd.go internal/app/fleet/keyoverride_test.go internal/mqtt/keyderive.go internal/mqtt/node.go
git commit -m "feat(fleet): override committed keypairs with secret-derived keys when set"
```

---

### Task 5: Push Repo A branch and open PR

- [ ] **Step 1: Create branch (if not already on one) and push**

```bash
cd /Users/khundeck/working/meshtk
git checkout -b feat/secret-seeded-node-keypairs
git push -u origin feat/secret-seeded-node-keypairs
```

(If commits from Tasks 1-4 were made on a different branch, `git branch -m` to rename or cherry-pick onto this branch first.)

- [ ] **Step 2: Open the PR**

```bash
gh pr create --repo whereiskurt/meshtk \
  --title "feat: secret-seeded deterministic node keypairs" \
  --body "$(cat <<'EOF'
Derives production ghost/rabbit X25519 keypairs from MESHTK_GHOST_KEY_SECRET
(HKDF-SHA256 over the node ID) instead of committed keys, so repo keys are inert
decoys. Deterministic — keys survive restarts. Gated on secret presence;
localdev without the secret keeps using committed keys.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Repo B — `defcon.run.34` (feature branch, this worktree)

Run Repo B tasks from `/Users/khundeck/working/defcon.run.34/.claude/worktrees/pkiprivsecret`.

### Task 6: Add the SSM secret wiring

**Files:**
- Modify: `infra/terraform/live/site/site.hcl:368` (mqtt `keys` array)
- Modify: `infra/terraform/live/site/.secrets.sops.json.template` (mqtt block)
- Modify: `infra/terraform/live/site/services/run.mqtt/service.hcl` (`run-mqtt-ghosts` secrets, around line 331)

- [ ] **Step 1: Add the SSM key to the provisioned set**

In `infra/terraform/live/site/site.hcl` line 368, append `"ghost-key-secret"` to the mqtt `keys` array:

```hcl
        keys        = ["meshtk-proxy-password", "meshobserv-password", "ghosts-password", "max-connections", "s3-log-interval", "channel-psk", "ghost-start-delay", "ghost-key-secret"]
```

- [ ] **Step 2: Add the plaintext template entry**

In `infra/terraform/live/site/.secrets.sops.json.template`, add to the `"mqtt"` object (after `"ghost-start-delay": "30"`, adding a comma to that line):

```json
    "ghost-start-delay": "30",
    "ghost-key-secret": "CHANGEME-ghost-key-secret"
```

- [ ] **Step 3: Wire the env var into the ghosts container**

In `infra/terraform/live/site/services/run.mqtt/service.hcl`, in the `run-mqtt-ghosts` container's `secrets = [` block (after the `MESHTK_GHOST_START_DELAY` entry ending around line 333), add:

```hcl
          {
            name      = "MESHTK_GHOST_KEY_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/mqtt/ghost-key-secret"
          },
```

- [ ] **Step 4: Validate HCL formatting**

Run: `cd infra/terraform/live/site && terragrunt hclfmt --diff services/run.mqtt/service.hcl site.hcl 2>&1 | head -20; cd -`
Expected: no formatting diff (or apply the diff it prints)

- [ ] **Step 5: Commit**

```bash
git add infra/terraform/live/site/site.hcl infra/terraform/live/site/.secrets.sops.json.template infra/terraform/live/site/services/run.mqtt/service.hcl
git commit -m "feat(mqtt): wire MESHTK_GHOST_KEY_SECRET SSM param into ghosts container"
```

---

### Task 7: Push Repo B branch and open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin gsd/phase-43-run-human-admin-reporting-dashboard
```

(Or create a dedicated branch first if preferred: `git checkout -b feat/secret-seeded-node-keypairs`.)

- [ ] **Step 2: Open the PR**

```bash
gh pr create \
  --title "feat(mqtt): secret-seeded ghost/rabbit keypairs (SSM wiring)" \
  --body "$(cat <<'EOF'
Adds the MESHTK_GHOST_KEY_SECRET SSM parameter and injects it into the
run-mqtt-ghosts ECS container. Pairs with whereiskurt/meshtk#<PR> which derives
node keypairs from this secret instead of the committed decoy keys.

Deploy prerequisites (not in this PR):
- Set the real secret value via SOPS in .secrets.sops.json and apply.
- Build/push the meshtk image containing the derivation change and bump
  services/run.mqtt/VERSION.meshtk.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Deploy prerequisites (post-merge, user-driven — not code tasks)

1. **Set the real secret value** — edit `infra/terraform/live/site/.secrets.sops.json` with `sops` (requires the KMS key) to add a strong random `ghost-key-secret`, then `terragrunt apply` the SSM provisioning so the parameter exists in us-east-1 and ca-central-1.
2. **Build + release meshtk** — build/push the `run-mqtt-meshtk` image from the merged meshtk branch and bump `infra/terraform/live/site/services/run.mqtt/VERSION.meshtk`, then release run.mqtt. First deploy rotates every node's pubkey once (acceptable: nobody connected, everyone reflashes for a fresh node DB).

## Self-Review notes

- **Spec coverage:** derivation (Task 1) · valid-pair/round-trip test (Task 1) · restart stability = determinism (Task 1) · override + presence gating (Task 4) · secret source/dedicated SSM param (Tasks 3, 6) · both repos (A + B) · localdev fallback (Task 4 gated no-op). All spec sections mapped.
- **Type consistency:** `DeriveNodeKey(string, uint32) ([]byte, []byte, error)`, `HexKey([]byte) string`, `Node.ApplyDerivedKey(string) error`, `FleetCmd.overrideFleetKeys(int)`, `Config.GhostKeySecret string` — used consistently across tasks.
- **Decoy scrubbing** intentionally out of scope (committed keys stay valid for localdev), per spec.
