# Secret-Seeded Deterministic Node Keypairs

**Date:** 2026-07-18
**Status:** Design approved — pending spec review
**Repos touched:** `~/working/meshtk` (upstream code) + defcon.run.34 (SSM/ECS wiring, decoy config)

## Problem

The meshtk fleet node files (`apps/run.mqtt/meshtk/nodes.ghost.*.json`,
`nodes.rabbit.*.json`) ship real X25519 (Curve25519) keypairs committed to git —
each node carries a `pubkey` and `privkey`. The ghosts use their private key to
decrypt DMs sent to them and to encrypt their replies
(`meshtk/internal/mqtt/crypto.go`, via `curve25519.X25519`). Other radios fetch a
ghost's **public** key to DM it.

Because the private keys live in the repo:

- Anyone reading the repo can impersonate a ghost, decrypt DMs sent to it, or
  encrypt as it.
- Edits to the committed key values silently change production behavior.

### Why XOR-masking does not work

The originally-considered fix was to XOR the committed keys with a server-side
secret. This is cryptographically unsound. In X25519 the public key is *derived*
from the private key: `pub = ScalarBaseMult(priv)` (with clamping). XORing the
private scalar yields a *different but still-valid* private key, but XORing the
public key with the same value does **not** produce the public key that matches
it. The pair breaks and every DM to/from the node fails its MAC — the same
failure mode as the stale-pubkey ricky-chatbot bug. XOR-over-both is rejected.

## Goal

- Committed keys become **inert decoys**: readable in git, never the production
  keys, and un-tamperable (production ignores them).
- Production keys are **derived from a server-only secret**.
- Derivation is **deterministic** so keypairs survive ECS task restarts
  unchanged (avoids the stale-pubkey / MAC-fail class of bug).

## Core mechanism

A single derivation, applied to **every fleet node** (ghosts + rabbits) once the
node's identity is finalized:

```
ikm  = MESHTK_GHOST_KEY_SECRET                              # dedicated SSM param, SSM -> ECS env
priv = HKDF-SHA256(ikm, info = "meshtk-node-key:" + nodeID) # 32 bytes of key material
priv = ecdh.X25519().NewPrivateKey(priv)                    # library performs clamping
pub  = priv.PublicKey()                                     # DERIVED -> always a valid matching pair
```

Design properties:

- **Keyed by the node's stable `from` ID.** Node ID, name, and position stay
  exactly as they are today — hand-authored for ghosts, seed-derived for
  rabbits. Only the keypair is replaced, so mesh addressing does not move.
- **Deterministic:** same secret + same node ID = same keypair on every restart.
- **256-bit strength.** This replaces the rabbit path's 64-bit `math/rand`
  seeding (`meshtk/internal/app/fleet/nodes.go:28-37`) *for key material only*.
  The `math/rand` path stays for rabbits' non-key properties (hw model, role,
  jitter).
- **Prior art:** the sim-rabbit fleets already derive valid deterministic
  keypairs from `fleet.Seed` via `ecdh.X25519().GenerateKey(seededRand)`. This
  design generalizes that pattern to all fleets and seeds it from a secret
  instead of the committed yaml seed.

## Gating — the "override"

Presence of the secret is the signal. No "am I on AWS?" detection.

- **Secret present (production):** after a node's identity is finalized —
  post-`LoadFile` for ghosts, post-`makeNode` for rabbits — an override pass
  overwrites the node's keypair via the derivation above. Committed keys are
  ignored.
- **Secret absent (localdev / tests):** fall back to the committed keys in the
  file, so a developer can still run ghosts that decrypt against each other
  locally.

This mirrors the existing `MapEnvVars` env-override pattern in
`meshtk/internal/app/app.go`.

## Where the pieces live

### `~/working/meshtk` (upstream code repo — NOT the `apps/run.mqtt/meshtk` overlay)

Per repo convention, meshtk code changes land in `~/working/meshtk` on a feature
branch and are committed there; the `apps/run.mqtt/meshtk` directory in the
defcon repo is a config/overlay copy only.

- New `deriveNodeKey(secret string, nodeID uint32) (pub, priv []byte)` helper
  (HKDF-SHA256 -> `ecdh.X25519().NewPrivateKey`).
- The override pass that applies it to every node when the secret is present,
  placed to cover both the load path (ghosts) and the generate path (rabbits).
- Register `MESHTK_GHOST_KEY_SECRET` in the `cmdargs.go` `EnvMap` so it is read
  from the environment like other config.

### defcon.run.34 repo

- New **dedicated** SSM parameter holding the secret (independent of the MQTT
  user password, so rotating MQTT credentials does not silently re-key every
  node).
- Terraform wiring for the run.mqtt ECS service to inject that SSM value as the
  `MESHTK_GHOST_KEY_SECRET` environment variable on the task.

### Committed `nodes.*.json`

- Unchanged. They remain valid decoy keypairs so localdev keeps working.
- Optional later cleanup: scrub committed keys to obviously-dummy values.

## What this buys

- Repo privkeys are never the production privkeys — no impersonation or DM
  decryption from git.
- Tampering with committed keys has zero production effect (ignored when the
  secret is present).
- Keys are stable across ECS restarts (deterministic), avoiding the
  stale-pubkey MAC-fail class of bug.
- First production deploy rotates every node's pubkey once — a non-issue: nobody
  is connected and everyone reflashes for a fresh node DB.

## Testing

- **Determinism:** `deriveNodeKey` returns identical bytes for identical
  `(secret, nodeID)` inputs.
- **Valid pairs / round-trip:** two derived nodes A and B satisfy
  `X25519(privA, pubB) == X25519(privB, pubA)`, and the derived `pub` equals
  `ScalarBaseMult(priv)`.
- **Presence-gating:** with the secret set, a node's committed keypair is
  overridden; with it unset, the committed keypair is retained.

## Out of scope

- Changing node IDs, names, positions, or movement behavior.
- Reworking the rabbit `math/rand` property generation beyond key material.
- Rotating or re-keying live/connected devices (none exist at cutover).
