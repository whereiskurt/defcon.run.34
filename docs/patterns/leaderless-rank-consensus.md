# Leaderless rank consensus

**Give every node in an ephemeral fleet a stable "I am node X of Y" without a leader, a
vote, or a coordinator — each node just writes a check-in file and then independently sorts
the same list everyone else sees.**

## Context

You bring up a fleet of interchangeable nodes — a burst of workers, a swarm of load
generators, a test cluster — and the work needs each node to know its *position*: shard 3
of 8, the odd nodes do A and the even nodes do B, node 1 seeds and the rest follow. The
fleet is ephemeral and interruption-tolerant: nodes appear late, some never appear, some
vanish mid-run. You don't want to stand up ZooKeeper, run a Raft cluster, or nominate a
coordinator just to hand out ordinals.

The naive answers all drag in machinery. A central coordinator is one more thing to deploy,
secure, and keep alive — and it's a single point of failure for a fleet that was supposed
to be disposable. A leader election is a distributed-systems problem in its own right.
Passing ranks in at launch time means you can't let nodes come and go. What you actually
need is far smaller than any of these.

## Forces

- **No node is special, but each needs a unique ordinal.** The fleet is symmetric by
  design — that's what makes it disposable — yet the work wants asymmetry (shards, roles,
  seeds). Something has to break the symmetry without designating a permanent boss.
- **Membership is fuzzy and time-bounded.** You don't know exactly who will show up or
  when. The protocol has to proceed with "whoever's here by the deadline," not block
  forever waiting for a full house.
- **Coordination channels are liabilities.** Every node-to-node connection, every quorum
  round, every elected leader is code that can deadlock, split-brain, or fail to come up.
  For a throwaway fleet, that machinery can cost more than the work it coordinates.
- **Determinism is cheaper than agreement.** If every node can independently compute the
  *same answer* from the *same inputs*, you never have to make them agree — they already
  agree by construction.

## The pattern

Replace coordination with a shared, strongly-consistent list and a deterministic sort. No
node talks to any other node. The only shared thing is an object store (or any store with
read-after-write consistency) acting as a bulletin board.

```
  Phase 1: ROLL CALL          Phase 2: ROSTER              Phase 3: CONFIRM
  each node writes            each node LISTS the           each node waits until
  roll-call/<id>              directory, SORTS ids by       N roster entries exist
  keyed by stable identity    an AGREED total order,        (or a timeout), then
  (e.g. its IP), then         finds its OWN id, reads       proceeds — with whoever
  polls until N present       out rank = position           actually showed up
  or a timeout fires

     ┌── node A ──┐      all nodes see the SAME set     A: "I'm 1 of 3"
     ├── node B ──┤ ──►  and apply the SAME sort   ──►  B: "I'm 2 of 3"
     └── node C ──┘      so they compute the SAME       C: "I'm 3 of 3"
                         roster, never talking
```

**1 — Roll call: write one file keyed by a stable identity.** Each node writes a small
check-in object at a path derived from an identity that is stable and unique for the run —
its IP address is the natural choice. The path *is* the registration; the body can carry
metadata. Then the node polls the roll-call directory, counting entries, until it sees the
expected count *or* a roll-call timeout expires. The timeout is what makes the protocol
tolerate no-shows: it proceeds with whoever checked in.

**2 — Roster: everyone sorts the same list and reads their own row.** Each node lists the
roll-call directory, extracts the identities, and sorts them with an *agreed total order* —
the sort function is part of the protocol, identical on every node (e.g. numeric sort of
the four IP octets, not lexical, so `10` doesn't sort before `9`). The node then walks the
sorted list to find its own identity; its 1-based position is its rank, and the list length
is the total. Because the store is strongly consistent (read-after-write), every node that
lists after roll-call closes sees the *same set*; because the sort is deterministic, every
node computes the *same ordering*. They all arrive at an identical roster without exchanging
a single message.

**3 — Confirm: converge on who actually participated.** Each node writes its computed
roster back to a second directory and waits until it sees a roster entry from every node it
expects (or a confirm timeout). This is a barrier, not a negotiation — it lets nodes line up
at the same starting gate and gives late arrivals a bounded window, but nobody's rank
depends on anybody else's confirmation. If confirmation times out, proceed with partial
consensus.

The load-bearing insight: **rank assignment reduces to "everyone sorts the same list."**
Agreement is a side effect of determinism plus a consistent view, not something anyone
negotiates.

## Key moves

- **Identity must be stable and self-evident.** The key you register under has to be
  something the node knows about itself with no lookup and that no two nodes share for the
  run. An IP is ideal — self-discoverable, unique, orderable. A random UUID works for
  uniqueness but throws away a natural sort order you might want.
- **The sort is part of the protocol, not an implementation detail.** Every node must apply
  the *identical* total order. Numeric-by-octet, lexical, timestamp — pick one and make it
  the spec. A single node sorting differently gets a different roster and the whole scheme
  silently breaks.
- **Timeouts turn "who's here" into a decision.** Roll-call and confirm timeouts are what
  make the protocol robust to the fleet's fuzziness. They convert an unbounded wait for a
  full house into "proceed with the quorum that materialized by the deadline."
- **Lean on strong read-after-write consistency.** The entire correctness argument is "all
  nodes see the same set." That requires the store to return writes immediately on
  subsequent lists. Modern object stores give you this; an eventually-consistent store
  would let two nodes compute different rosters and hand out colliding ranks.
- **Wipe the roll-call namespace per run.** Ranks are per-campaign. Clear the roll-call and
  roster directories at the start of each run so last time's check-ins don't inflate this
  time's roster.

## Traps

- **Lexical sort of numeric identities.** Sorting IPs as strings puts `10.0.0.2` before
  `9.0.0.1` and scrambles ranks. Sort the octets numerically. This is the single easiest way
  to get a subtly-wrong roster that still *looks* plausible.
- **Own identity missing from the roster.** If a node lists the directory and can't find
  its own check-in, something is wrong (its write didn't land, or it's reading a stale
  view). Detect it explicitly and fail loud or fall back deliberately — don't let a node
  silently compute rank 0 and behave as if it isn't in the fleet.
- **Assuming the expected count is the real count.** The expected-nodes number is a hint for
  the timeout, not a guarantee. Always derive `total` from the *actual* roster length, never
  from the expectation, or a short fleet will think it's larger than it is.
- **Racing the roll-call close.** A node that lists too early — before others have checked
  in — computes a roster that's too small. The roll-call poll-until-N-or-timeout is what
  gates against this; don't skip straight to the roster step.
- **Reusing a stale namespace.** Leftover files from a prior run inflate the roster and
  hand out phantom peers. Per-run wipe is not optional.

## When not to use it

- **When you need sub-second, real-time coordination.** The protocol's latency is bounded by
  poll intervals and timeouts — tens of seconds, not milliseconds. For anything latency-
  critical, a real coordination service earns its keep.
- **When membership must be exact and durable.** If every node absolutely must participate
  and none may be silently dropped, the "proceed with whoever showed up" timeout is a bug,
  not a feature. This pattern is for interruption-tolerant fleets, not for a transactional
  cluster where a missing member is a hard error.
- **When nodes need to renegotiate rank mid-run.** This assigns rank once, at startup. If
  the fleet reshapes continuously and ranks must rebalance live, you're back to needing a
  membership protocol with real churn handling.

## As built (defcon.run 34)

- **Protocol:** `apps/run.waffaw/consensus.sh` — three phases (`phase_roll_call`,
  `phase_roster`, `phase_confirm`) driven entirely through an object-store prefix. Roll-call
  files are written at `consensus/current/roll-call/<ip>.json`; the roster sort is a numeric
  four-octet IP sort; `NODE_RANK`, `NODE_TOTAL`, and `NODE_PEERS` are exported for the work
  that follows.
- **Design:** `apps/run.waffaw/DESIGN.md` (Roll Call Consensus Protocol) — explains the
  reliance on strong read-after-write consistency and the per-campaign wipe of
  `consensus/current/`.
- Realized on an S3 control bucket read by a bash agent on every node (EC2 and Fargate).
