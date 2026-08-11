# Decoy-and-derive secrets

**Commit inert *decoy* secrets to the repo so local dev and readability are preserved,
but in production deterministically *derive* the real value with a KDF keyed by a
stable identity from one server-only secret. The mere presence of that secret is the
entire prod/local switch — no environment detection, and tampering with the committed
decoys has zero production effect.**

## Context

You have secrets that need to live *somewhere* — per-node keypairs, per-challenge flag
answers, per-service credentials. Local development wants them present and working:
run the thing, watch two components talk to each other, no cloud round-trip. Repo
readers want the files legible. But those same secrets, if the committed values are
the *real* ones, hand anyone with repo access the keys to production: impersonate a
node, decrypt its traffic, read every answer.

The usual escapes are all bad. Strip the secrets out and local dev breaks (and CI, and
the next person who clones). Obfuscate them (XOR with a server value, base64, "encrypt"
in-repo) and you get a fragile scheme that *looks* secure, often breaks the math it's
protecting, and still leaks the moment someone finds the mask. Branch on "am I running
in the cloud?" and you've coupled your secret handling to environment detection that
lies in surprising ways.

## Forces

- **Local dev needs working values; prod needs real ones that aren't in git.** These
  pull in opposite directions if "the committed value" and "the real value" are the
  same thing.
- **Obfuscating a *keypair* can silently break it.** For a derived-key scheme (e.g. a
  public key computed from a private scalar), masking the private half with a value and
  the public half with the same value does *not* yield a matching pair — the two halves
  decouple and every operation fails its integrity check. Reversible obfuscation of
  cryptographic material is usually cryptographically unsound.
- **Environment detection is a liar.** "Am I on the production host?" has many wrong
  answers: a misconfigured stage, a local integration test, a CI runner with cloud
  creds. Gating real secrets on inferred environment is a footgun.
- **Restarts must not re-roll secrets.** If the real value is *randomly* generated at
  boot, every restart produces a different one — and any peer holding the old value now
  fails to verify against the new (the classic stale-key MAC-failure bug).

## The pattern

Keep committed **decoys** in the repo, and **derive** the production value from a
single server-only secret using a KDF keyed by a *stable identity*.

```
   REPO (committed, inert)                 PRODUCTION (derived at runtime)
   ┌────────────────────────┐              ┌──────────────────────────────┐
   │ node.json: privkey=...  │             │ ikm  = SERVER_SECRET (env/SSM) │
   │ flag: answer="decoy123" │             │ real = HKDF(ikm,               │
   │  → readable, runnable    │            │          info = "<purpose>:"   │
   │  → tampering = no effect │            │                 + stableId)    │
   └────────────────────────┘              └──────────────────────────────┘
                                                   │
                    presence of SERVER_SECRET is the ONLY switch:
             secret set → override with derived value; secret absent → use decoy
```

**Derive from a single server-only secret via HKDF, keyed by a stable id.** The input
keying material is one secret held only where it's needed (an SSM parameter injected as
an env var). The `info`/context string ties each derived value to a *stable identity* —
a node id, a challenge id, a purpose label — so:

- distinct identities get distinct, independent values from the one secret;
- the same identity yields the **same value on every run**, so the value survives
  restarts unchanged (this is what avoids the stale-key MAC-failure class of bug);
- for keypairs, you derive the *private* half and let the library compute the matching
  *public* half — always a valid pair, no decoupling.

**Presence of the secret is the entire switch.** No `if (isProduction)`, no cloud
detection. The runtime does one thing:

- **secret present** → after the identity is finalized, an override pass overwrites the
  value with the derived one; the committed decoy is ignored.
- **secret absent** → fall back to the committed decoy in the file, so local dev and
  tests run against working, self-consistent values.

This makes the committed decoys genuinely inert: editing them changes local behavior
only. In production they are never read, so tampering with them has zero effect.

**Related move — deterministic cross-service identity with no coordination.** When two
independent services each need to compute the *same* derived identifier for a subject,
have both derive it from a shared per-subject value with the *same deterministic rule*
— e.g. a short token defined as the first N hex characters of a per-user hash. Neither
service calls the other; both compute the identical token locally and can never
disagree. No lookup table, no sync, no drift.

## Key moves

- **Decoys stay in git on purpose.** They are the local-dev fixtures and the
  readability story — not a mistake to be scrubbed. Their whole job is to be present
  and inert.
- **Presence-of-secret replaces environment detection.** The one bit that matters is
  "is the derivation secret available?" — not "where am I running?". Simpler and
  honest: no secret, no real values, and that's a safe default.
- **Key the KDF by a stable identity.** Deriving from something that doesn't change
  across restarts is what makes the value stable across restarts. Random generation at
  boot is the anti-pattern this exists to kill.
- **Derive the derivable half, don't mask both.** For keypairs, derive the private key
  and *compute* the public key. Never try to reversibly transform both halves — the
  math won't hold.
- **One secret, many values.** A single input secret plus per-identity context strings
  yields an unlimited family of independent secrets. You manage and rotate *one* thing.
- **Deterministic derivation = coordination-free agreement.** If independent parties
  must agree on a value, define it as a pure function of shared inputs and let each
  compute it. Agreement by construction beats agreement by synchronization.

## Traps

- **First production cutover rotates every derived value once.** Switching from
  committed decoys to derived reals changes every value the first time the secret is
  present. Fine if nothing is holding the old values yet — but if live peers already
  cached the decoys, you've re-keyed under them. Plan the cutover for a clean slate.
- **Rotating the input secret re-keys *everything* derived from it.** That's the power
  and the hazard: one secret fans out to all values. Give distinct concerns *distinct*
  secrets (don't reuse, say, a message-broker password as the key-derivation secret) so
  rotating one credential doesn't silently re-key an unrelated fleet.
- **The stable id must actually be stable.** If the identity you key on can change
  (a regenerated node id, a renamed challenge), you've reintroduced the stale-value bug
  through the back door. Key on something authored to be permanent.
- **Fail-closed when the secret is set but derivation fails.** If the secret is present
  but a particular derivation errors, don't silently fall back to the committed decoy in
  production — that would quietly serve a value a repo reader knows. Fail that item
  closed (no reveal) rather than exposing the decoy.
- **A decoy that looks too real invites confusion.** Consider scrubbing committed decoys
  to obviously-dummy values so nobody mistakes them for live credentials or tries to
  "protect" them.

## When not to use it

- If a secret has *no* useful local-dev or readability role, don't commit a decoy at
  all — just require the real secret from the environment and let local dev supply its
  own. The decoy exists to serve local dev; no local need, no decoy.
- If the value genuinely must be random and unique per-occurrence (a nonce, a
  one-time token), determinism is wrong — you want fresh randomness, not a reproducible
  derivation.
- If you have exactly one secret used in exactly one place, plain env injection is
  simpler than a derivation layer; derive-from-one-secret pays off when you need a
  *family* of related values.

## As built (defcon.run 34)

- **Design spec (keypairs):**
  `docs/superpowers/specs/2026-07-18-secret-seeded-node-keypairs-design.md` — committed
  `nodes.*.json` decoys, `HKDF-SHA256(MESHTK_GHOST_KEY_SECRET, "meshtk-node-key:"+id)`
  deriving each node's X25519 private key (public computed by the library), presence of
  the secret as the sole override switch, and the explicit rejection of XOR-masking.
- **Design spec (flag codes):**
  `docs/superpowers/specs/2026-07-24-ghost-bedrock-guardrails-flags-design.md` §4 — a
  committed `committedCode` decoy as HKDF input; the real answer is
  `DeriveFlagCode(secret, id, committedCode)`, derived at runtime and never stored.
- **Design spec (unlock seed):**
  `docs/superpowers/specs/2026-07-27-payphone-goldstein-seed-design.md` §2 — the same
  key-derivation secret backing a live-derived OTP seed, sourced from an internal
  endpoint rather than hardcoded (which "rots silently if the key secret rotates").
- **Coordination-free short token:** `apps/run.human/webapp/src/lib/short-token.ts` —
  `shortTokenFromHash` = first 16 hex of a per-user sha256, so two independent services
  derive the same token without ever talking to each other.
- Realized with HKDF-SHA256, X25519, a dedicated SSM parameter injected as an ECS env
  var, and committed JSON/YAML decoys for local development.
