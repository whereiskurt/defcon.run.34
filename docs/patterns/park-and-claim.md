# Park and claim

**Let an anonymous actor perform a rewardable action now and collect the credit after
they authenticate — by parking only a hash of what they did against a short-lived nonce,
and redeeming through the same single judging function the online path uses, so the credit
lands exactly once across the auth boundary.**

## Context

A person does something worth crediting while they are not signed in. They scan a QR code
at a kiosk, submit an answer at a booth, complete an action on a shared device. You want to
reward *the action*, but you can only attribute a reward to *an account* — and this person
doesn't have a session yet, or has one on a sibling site but not this one.

The naive options all fail. Refusing to act until they log in loses the moment (they walked
up, did the thing, and got nothing). Crediting an anonymous cookie and merging later invites
double-credit and cookie-farming. Storing the raw submission to replay after login means the
secret sits in your database and your logs. And building a *second* code path for "claim a
parked action" — separate from your live "act while signed in" path — means two judges that
will drift, and two chances to double-score.

## Forces

- **Act-now vs. attribute-later.** The value of the action is captured at action time, but
  the identity it attaches to only exists (or only becomes known) later. Something has to
  bridge that gap without holding the action hostage to the login.
- **Exactly-once across a boundary.** The parked action and the online action can both try
  to credit the same thing. Replays happen: the claim can be presented twice (two tabs, a
  lost delete, a retried request). Credit must land once regardless.
- **Don't hoard the raw material.** Whatever was submitted may be a secret. Parking the raw
  value turns a transient guess into a durable liability in storage and logs.
- **One judge, not two.** The rules that decide "is this correct, is it in-window, is it
  capped" must not be reimplemented for the claim path. Divergence there is a scoring bug
  and an anti-cheat hole.

## The pattern

**At action time, park a hash — not the value — under a nonce with a TTL.** The anonymous
action computes `hash(submission)` and stores `{nonce, target, hash, ttl}`. The raw
submission is discarded the instant it is hashed. The nonce is handed back to the client
(cookie / local storage / a printed or spoken link) so the actor can present it later.

**At claim time, redeem through the *same* judge the online path uses.** When the actor
finally has a session, the client presents its parked nonce(s). The server loads the parked
row and calls the one shared judging function — passing the stored *hash* instead of a raw
value — for that now-known identity. Same validation, same window checks, same caps, same
idempotent write. The claim path is a thin adapter around the judge, not a second judge.

**Idempotency comes from the judge's write, not from the parked row.** The judge's credit
is a create-if-absent conditional write keyed on `(actor, target)`. So a re-presented claim
is a safe no-op *even if the parked row's delete was lost*: the second credit attempt loses
the conditional put and returns the prior award rather than a new one. Deleting the parked
row on success is a cheap short-circuit, not the safety mechanism.

```
   anon action ──► park { nonce, target, HASH(submission), ttl }   (raw value discarded)
                          │
                   (client keeps nonce)
                          │  later, now signed in
                          ▼
   claim(nonce, actor) ──► load parked row ──► judge({ actor, target, guessHash })
                                                     │
                                        create-if-absent on (actor,target)
                                          ├─ first time  → credit
                                          └─ re-presented → no-op, return prior award
```

**Only a real credit consumes the nonce.** Deleting the parked row on *any* outcome is a
trap: a refusal that the actor could legitimately clear by retrying (a stale rate-limit, a
closed scoring window) would destroy their one claim link. Delete only when the judge
actually credited; otherwise leave the nonce alive to retry.

### Two facets worth calling out

**A hand-transcribable bearer nonce.** When the nonce travels out-of-band — read off a radio
screen, spoken over a channel, typed from a printed card — its encoding matters:

- Generate it from a CSPRNG, not a timestamp or a weak seed. 60 bits (e.g. 12 symbols of a
  32-symbol alphabet) is infeasible to brute-force *given that it is also single-use and
  short-lived*.
- Draw symbols **without modulo bias.** If the alphabet size divides 256, masking the low
  bits of each random byte is already uniform — no reject-sampling needed. If it doesn't,
  reject-sample; never `% alphabet` a raw byte (that skews toward the low symbols).
- Use a **human-safe alphabet.** Crockford base32 minus the ambiguous glyphs (`i`, `l`, `o`,
  `u`) so someone transcribing it can't land on a character they'll misread.
- **Clamp the TTL against garbage config.** Read the lifetime from config, but if it's
  non-numeric or non-positive, fall back to a sane default — a typo must never mint a nonce
  that is *already expired* at creation.

**Provision a missing identity with the real adapter — never a forged record.** If the actor
authenticated on a sibling system but has no account on *this* one, don't hand-write a row
that looks like an account. Call the **same** account-creation / upsert path a genuine
first sign-in uses, so it writes the exact keys the real login will later resolve against.
Then when the actor does sign in for real, the auth layer finds *this* account and reuses it
— no duplicate, no orphan. A forged row drifts from what real sign-in expects and splits the
identity.

## Key moves

- **Park a hash, keyed by a TTL'd nonce.** The parked row is a claim ticket, not a copy of
  the secret. Hash on the way in; the raw value never persists.
- **Redeem through the online judge.** The claim path resolves an identity and a stored
  hash, then defers *all* the rules to the one shared judge. Zero scoring logic lives in the
  claim path.
- **Let the write be the arbiter.** Exactly-once is a property of the judge's create-if-absent
  write, so replay is safe by construction — the parked-row delete is an optimization.
- **Delete on credit only.** A refusal is a retryable gate outcome; burning the nonce there
  hands the actor a dead ticket.
- **Real adapter for real identities.** Provision missing accounts through the genuine
  sign-in machinery so a later real login collapses onto the same record.

## Traps

- **Double-crediting on replay.** If idempotency lives in "delete the parked row after
  claiming" rather than in the judge's conditional write, a lost delete or a concurrent
  second claim double-credits. Anchor once-only in the write.
- **Burning the ticket on a soft refusal.** Unconditionally deleting the parked row destroys
  a legitimately-retryable claim. (This one bit us live: a stale attempt-counter refused a
  tap and the award link was destroyed in the same breath.) Delete only on an actual credit.
- **Modulo-biased nonces.** `randomByte % 32` over-weights the low symbols and shrinks the
  real entropy. Mask (when the alphabet divides 256) or reject-sample.
- **A garbage TTL that mints dead links.** An env typo (`""`, `0`, `-60`, `banana`) must
  clamp to a default, not produce an already-expired nonce.
- **Forged identity rows.** Writing an account-shaped row by hand, instead of via the real
  adapter, produces a record a later genuine sign-in won't resolve to — silently splitting
  the person into two identities.

## When not to use it

- **When the actor is always already authenticated.** If every rewardable action happens
  inside a session, there is no boundary to bridge — credit inline and skip the parking.
- **When the action isn't idempotently creditable.** Park-and-claim leans entirely on the
  judge being safe to call twice. If your credit operation can't be made create-if-absent
  (it's an irreversible side effect, a payment, a physical dispense), a deferred replay is
  dangerous and you need a different design.
- **When you can't hand the actor a durable nonce.** The whole scheme depends on the actor
  being able to *carry* the claim ticket to their eventual login. If there's no cookie, no
  storage, and no out-of-band channel to hold the nonce, there's nothing to claim later.

## As built (defcon.run 34)

- **Park/claim data helpers:** `apps/run.human/webapp/src/lib/ctf-pending.ts` —
  `createPending` (parks `submittedFlagHash = hashAnswer(guess)` under a nonce with a TTL),
  `claimPending` (redeems through `judgeSolve`, deletes the row **only on `result.solved`**;
  see the load-bearing comment recording the DEF CON 34 live incident where an
  unconditional delete destroyed a player's award link).
- **Hand-transcribable bearer nonce:** `newAwardNonce` in the same file — 12 Crockford
  base32 lowercase symbols (60 bits), CSPRNG via `crypto.getRandomValues`, mask (no modulo
  skew because 256 % 32 == 0), alphabet excludes `i`/`l`/`o`/`u`; `readAwardLinkTtlSeconds`
  clamps a bad `BOT_CLAIM_LINK_TTL_SECONDS` back to the 3600s default. Pinned by
  `apps/run.human/webapp/src/lib/__tests__/ctf-award-nonce.test.ts`.
- **Client-side stash + idempotent re-claim:** `apps/run.human/webapp/src/lib/covert-egg.ts`
  — `stashPending`/`PENDING_KEY`/`claimStashed` (re-fires each parked value through the same
  endpoint; the judge's conditional put makes a re-submit a safe no-op).
- **Real-adapter identity provisioning:** `apps/run.human/webapp/src/lib/ensure-identity.ts`
  — `ensureRunHumanIdentity` calls the genuine Auth.js `createUser`/`linkAccount` +
  `upsertRunUser` so a later real SSO sign-in resolves to the same account.
- **Design docs:** `docs/superpowers/plans/2026-07-24-ghost-single-use-claim-links.md`;
  the `q.defcon.run/a/<nonce>` award-link namespace in
  `docs/superpowers/specs/2026-07-31-bot-hardening-design.md`.
- The shared judge these all funnel into is `apps/run.human/webapp/src/lib/ctf-judge.ts`
  (`judgeSolve`) — see the *coordination-free idempotency* essay for why its write is the
  once-only arbiter.
