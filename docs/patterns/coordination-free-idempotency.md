# Coordination-free idempotency

**Make the write itself the arbiter: choose keys so that a single conditional put or atomic
counter decides "already done?", "once per window?", and "which ordinal?" correctly under
concurrency — with no lock, no read-modify-write, no coordinator, and no cleanup job.**

## Context

You need exactly-once, rate-limited, or gap-free-ordinal semantics on writes that arrive
concurrently: two tabs submitting the same thing, a retried request, a racing double-tap,
two workers polling the same queue. The obvious reach is a coordinator — a lock, a
read-then-write guarded by a transaction, a "have I seen this?" table you consult first.
Each adds a round-trip, a failure mode, and usually a cleanup job for the state it accretes.

The insight running through all of the techniques below: a key-value store already gives you
one atomic primitive — a **conditional put** (create-if-absent) and an **atomic counter
increment**. If you shape your *keys* so that the thing you want to be exactly-once collides
on one conditional put, and the thing you want to be monotonic rides one atomic increment,
the database *is* your coordinator. There is no separate state to consult, lock, or reap.

## Forces

- **Contention is the normal case, not the edge.** Double-submits and retries are routine.
  A design that's only correct when requests are serialized is a design that's wrong in
  production.
- **Coordinators cost.** A lock is a round-trip and a liveness risk; a read-modify-write has
  a race window between the read and the write; a dedup table needs sweeping. Every one is a
  moving part that can fail independently of the work.
- **"Once" has many shapes.** Once-ever, once-per-time-window, once-per-content, once-per-
  physical-token — these look different but are all "collide on the right key."
- **Ordinals must not leak on a loss.** If a losing double-submit still burns a counter, your
  "Nth solver" numbering grows gaps and your caps miscount.
- **Cleanup jobs are liability.** Any marker you create to enforce single-use is storage that
  grows forever unless something reaps it — and the reaper is one more thing to get wrong.

## The pattern: a family of key-shaping techniques

**1 — Create-if-absent conditional put (first writer wins).** The base case. To make an
operation exactly-once, write a row with `attribute_not_exists(key)`. The first writer
succeeds; a concurrent or retried second writer's put fails the condition. The *write* is the
arbiter — no lock, no prior read. On the condition failure, read the existing row and return
the prior result, so a replay is a no-op that still reports the original outcome.

**2 — Window-token bucketing (once per interval, statelessly).** To enforce "at most once per
window" without tracking last-seen timestamps, **floor the timestamp to the window size** and
put the resulting token in the sort key: `bucket = floor(now / windowSeconds)`. Two events in
the same window compute the *same* token and collide on one create-if-absent put; events in
adjacent windows compute different tokens and both succeed. Rate-limiting becomes a stateless
key collision. Make the window source a **documented precedence** (e.g. explicit interval →
rotating-token period → a fallback constant) so the bucket size is never ambiguous.

**3 — Content-addressed execution (rename-proof "already ran this?").** To decide whether a
unit of work has already run, key on a **hash of its content**, not its name or timestamp.
A script's identity is `sha256(body)` (a prefix is plenty). Re-uploading the same body under
a new name is a no-op (same hash → already-executed marker present); editing one byte changes
the hash and re-runs. "Rename is free, edit means re-run" falls out for nothing, and you never
maintain a last-executed pointer.

**4 — Claim-before-count ordering (gap-free ordinals) + a dual counter.** When a write both
must be idempotent *and* must allocate a monotonic ordinal ("you are the Nth"), do the
idempotency **claim first** (technique 1), and only *after* it succeeds do the atomic counter
increment. A losing double-submit fails the claim and never reaches the increment, so the
counter advances only for genuinely-new writers and stays gap-free. When one population must
be excluded from a milestone, keep **two counters**: one counts everything (drives the ordinal
and any decay curve), the other counts only eligible actors (drives "first" / "first blood",
excluding operators or admins). Both are atomic increments, so two racers can never both read 1.

**5 — TTL-sized-to-validity claim marker (single-use without a sweeper).** To make a
*rotating physical token* (an OTP code, a rolling password) globally single-use, hash it and
create-if-absent on `(scope, hash)`. First redeemer wins; everyone else loses the put and gets
the indistinguishable non-result. Then **size the marker's TTL to expire just past the token's
own validity window.** By the time the marker auto-expires, the token itself is already
invalid, so a re-use degrades to an ordinary wrong-answer — not a double-claim. No sweeper, no
storage creep, no window where an expired marker permits replay of a still-valid token.

**6 — Constant-partition work queue (cheap poll, cold-resumable).** When a set of work items
has no natural all-items index, writing each under a **fixed partition key** turns "find the
pending work" into a single cheap partition query instead of a full-table scan. A poller reads
one partition per cycle; items are deleted on success and age out otherwise. The queue is
durable in the store, so a restarted poller resumes cold with no in-memory state, and delete
is idempotent (a lost delete just gets retried next cycle).

```
  exactly-once      →  put IF attribute_not_exists(key)          (1)
  once per window   →  key on floor(now / window)                (2)
  already ran?      →  key on sha256(content)                    (3)
  gap-free ordinal  →  claim (1) BEFORE atomic increment         (4)
  single-use token  →  put on (scope, hash(token)), TTL≈validity (5)
  find pending work →  Query one fixed partition, never Scan     (6)
```

## Key moves

- **Shape the key so the collision means what you want.** Every technique here is "pick a key
  such that the events that must be exactly-one land on the same key, and the events that must
  be independent land on different keys." Design the key, and the conditional put does the rest.
- **Claim before you count.** Ordinal allocation must be gated by the idempotency claim, never
  the reverse — otherwise losers burn ordinals and your numbering and caps drift.
- **On a lost claim, return the prior result.** A failed create-if-absent is not an error; it's
  "already done." Read the existing row and echo the original outcome so replays are seamless.
- **Two counters when one population is excluded.** Don't try to subtract admins out of a single
  counter after the fact; count the two populations separately from the start.
- **Size single-use TTLs to validity, not to convenience.** The marker only needs to outlive the
  token by a hair. Sizing it that way deletes the sweeper *and* closes the replay window.
- **Prefer a bounded query to a scan.** A constant partition (or a per-entity index) keeps the
  poll cheap and the read cost flat as the table grows.

## Traps

- **Counting before claiming.** The single most common inversion: allocate the ordinal, then
  try to dedup. Now every double-submit has already advanced the counter. Claim first.
- **A best-effort TTL as your correctness mechanism.** Store TTLs are typically *best-effort*
  and delayed (hours late). If "the marker expires" is load-bearing for correctness, you have a
  race. TTL is fine for *reaping* a marker whose correctness is already guaranteed by the
  token's own validity window (technique 5); it is not fine as the thing that resets a counter.
  (This bit us: an attempt-counter keyed without a window token leaned on TTL to reset, counts
  accumulated across days, and players were silently locked out. The fix was a window token in
  the key — technique 2 — so the reset is structural, not a TTL side effect.)
- **A conditional-put failure you don't disambiguate.** A failed create-if-absent usually means
  "already exists," but it can also mean a genuine error. Read back: if the row is present,
  it's a real collision (return the prior result); if it's absent, the failure was something
  else — rethrow so the caller degrades to a safe non-result rather than mis-reporting success.
- **Content hashing the wrong bytes.** Content-addressed execution is only rename-proof if the
  hash covers exactly the semantically-meaningful content. Hash trailing whitespace or an
  embedded timestamp and identical work re-runs; hash too little and a real change is missed.
- **Scanning because there's no index.** Reaching for a full-table scan to "find pending items"
  is the tell that you're missing a constant partition or a purpose-built index.

## When not to use it

- **When there's genuinely no contention and never will be.** If writes are strictly
  serialized upstream, the plain write is already exactly-once and the conditional put is
  ceremony.
- **When you need multi-key atomicity.** These techniques make a *single* key's write the
  arbiter. If "exactly once" spans several rows that must commit together, you need a real
  transaction, not a conditional put.
- **When ordering across keys matters.** Atomic per-key counters give you a monotonic ordinal
  *per key*; they do not give you a global total order across different partitions. If you need
  cross-partition sequencing, this toolbox is the wrong layer.

## As built (defcon.run 34)

- **Window-token bucketing (2):** `apps/run.human/webapp/src/lib/ctf-flag-types.ts` —
  `scoreBucket` floors the timestamp to the flag's window (explicit interval → OTP period →
  120s fallback) and returns the token that lives in the score-event sort key, so the
  once-per-window claim is a single `attribute_not_exists` put.
- **Conditional put + claim-before-count + dual counter (1, 4):**
  `apps/run.human/webapp/src/lib/ctf-judge.ts` — the 7-step flow claims the `CtfSolve` /
  `CtfScoreEvent` row *before* `allocateOrdinal`; `firstBloodFor` reads a second
  `playerSolveCount` (`allocatePlayerOrdinal`) so the non-admin "first blood" excludes
  operators while `solveCount` stays gap-free for the ordinal and curve.
- **TTL-sized single-use token marker (5):** `apps/run.human/webapp/src/lib/ctf-otp-claim.ts`
  — `otpCodeHash` + `otpClaimTtlSeconds` (`period·(skew+2)`), backing the judge's
  `claimOtpCode` create-if-absent on `(challenge, codeHash)`. The wordlist `claimCode` path in
  `ctf-judge.ts` is the same idea over a pre-loaded pool.
- **Content-addressed execution (3):** `apps/run.waffaw/agent.sh` (`run_scripts`, `sha256sum |
  cut -c1-12`, marker in `EXECUTED_DIR`) and `apps/run.waffaw/DESIGN.md` §"Script Tracking".
- **Constant-partition work queue (6):**
  `docs/superpowers/specs/2026-07-25-radio-otp-device-verification-design.md` — `MeshOtpPending`
  under `pk = "$run#otpqueue"`, polled with a single-partition `Query` (never a `Scan`),
  durable and cold-resumable, idempotent-on-delete.
- **Tests:** `apps/run.human/webapp/src/lib/__tests__/ctf-judge*.test.ts` (concurrency /
  idempotency / first-blood / gates), `ctf-otp-claim.test.ts`, `ctf-flag-types.test.ts`.
