# Object store as the control plane

**Coordinate a whole fleet with nothing but a bucket: nodes self-register under a prefix,
heartbeat by rewriting a tiny object, poll another prefix for work, and stop on a single
`halt` object — the control surface is literally a filesystem you can copy a file into.**

## Context

You have a fleet of ephemeral nodes to command: start them, hand them work, watch them,
and stop them fast. The instinct is to reach for orchestration — a command service, a
message broker, an agent framework, a control API. Each is a component you now have to
deploy, secure, scale, and keep alive, and for a burst or test fleet the coordination
plane can end up larger and more fragile than the thing it coordinates.

But every environment already ships a durable, consistent, access-controlled,
lifecycle-managed key-value store: the object store. If the coordination you need can
tolerate a poll interval's worth of latency, you can run the entire control plane out of a
single bucket and delete an entire category of infrastructure. Nodes poll for work, upload
results, and coordinate through the store's consistency guarantees. Dropping a file into
the right path *is* the command.

## Forces

- **Orchestration machinery is a standing liability.** A broker or command service must
  itself be highly available, patched, and monitored. For a fleet that exists for an
  afternoon, that's a permanent cost against a temporary need.
- **You already trust the object store.** It's durable, it has IAM, it has strong
  read-after-write consistency, and it has lifecycle rules. Every property you'd want from a
  coordination substrate is already there and already operated for you.
- **State that never expires becomes a swamp.** A fleet that registers, heartbeats, and
  writes output will pile up objects forever unless something prunes. The "database" has to
  self-clean or it drowns.
- **The stop button must be dead simple and unmissable.** In an incident you want to halt
  the fleet with the crudest possible action — one that works even if half your tooling is
  down. "Copy one file" is about as crude and reliable as it gets.
- **Latency vs. surface area is the real trade.** Polling costs you a poll interval of
  reaction time. In exchange you get near-zero operational surface. For burst and test
  workloads that's the right side of the trade; for real-time control it isn't.

## The pattern

Model the bucket as a filesystem with a small, fixed set of conventions. Nodes are agents
that loop: heartbeat, check for stop, pull work, push results.

```
   control-bucket/
   ├── nodes/<id>/
   │   ├── meta.json        node self-registers here on boot
   │   ├── alive.txt        heartbeat: rewritten every poll  (short TTL)
   │   ├── run/             work targeted at THIS node
   │   └── output/          this node's results              (longer TTL)
   ├── global/
   │   ├── run/             work for EVERY node
   │   └── halt             presence = emergency stop
   └── <snapshot>.json      fleet state / backup — see below
```

**Self-registration by writing a prefix.** On boot a node writes `nodes/<id>/meta.json`.
The write is the registration; there is no registry service to call. The node's identity
(its IP, its instance id) names the prefix.

**Heartbeat by rewriting a tiny object.** Every poll the node overwrites
`nodes/<id>/alive.txt` with the current timestamp. A short lifecycle TTL on that object
means a dead node's heartbeat evaporates on its own — liveness is "does a recent `alive.txt`
exist," computed with no reaper process.

**Work by polling a prefix.** The node lists `global/run/` (fleet-wide) and
`nodes/<id>/run/` (targeted), pulls any script it hasn't run, executes it, and uploads
output. Track *already-executed* work by content hash so a script that stays in the prefix
runs exactly once, not once per poll. Handing the fleet a job is `cp job.sh
s3://.../global/run/`.

**Stop by a single object.** A `global/halt` object's mere *presence* is the emergency
stop. Every node checks for it each poll; if present, it kills in-flight work and idles
until the object is removed. One `cp` halts the fleet; one `rm` releases it. No API, no
auth dance, no partial rollout.

**Lifecycle rules make the store self-prune.** Set aggressive TTLs by prefix:
heartbeats expire in a day, outputs in a week, logs transition to cold storage then expire.
The coordination state is bounded automatically; nobody runs a cleanup job.

### The backup artifact doubles as the control plane

If the fleet also snapshots its state to the bucket (a periodic dump of "what every node
knows"), that same snapshot can *be* the operator reset — but only if you make the coupling
safe, and the safety hinges on one rule: **read before you write.**

The idea: writing an empty snapshot (`{}`) to the store is the operator's "wipe and start
over" command. On the next tick a node restoring from the snapshot sees empty and clears
its in-memory state. Elegant — the backup file and the reset lever are the same object. But
naively coupling them is a race: the snapshot *writer* runs on its own tick, and it will
happily overwrite the operator's `{}` with a fresh non-empty dump before any node reads the
reset. The reset silently never happens.

So the snapshot writer does a **read-before-write**:

1. GET the current snapshot.
2. If it is an empty object *and* local state is non-empty, treat that as a reset request:
   clear local state and **skip this tick's PUT** (don't overwrite the reset).
3. Otherwise PUT the fresh snapshot as usual.

This converges (after a reset the state is empty, so the next tick sees "remote empty, local
empty" and resumes normal snapshots), it takes effect without a restart within one tick,
and — critically — a **GET failure is fail-safe**: no reset is *inferred* from a failed
read, a warning is logged, and the PUT proceeds. The reset is only ever triggered by
positively reading an empty object, never by the *absence* of a successful read. A snapshot
that is legitimately `{}` because nothing has been seen yet makes the reset a harmless
no-op.

## Key moves

- **Prefixes are your schema.** `nodes/<id>/`, `global/run/`, `global/halt` — the path
  layout *is* the API. Keep it small, fixed, and obvious enough that an operator can drive it
  by hand with a file copy.
- **TTL by prefix does your garbage collection.** Match each prefix's lifecycle rule to how
  long its objects matter: ephemeral heartbeats short, results longer, archives to cold
  storage. This is what makes "a bucket as a database" sustainable.
- **Presence-as-flag for the crude, critical signals.** For the emergency stop, the *object
  existing* is the whole message — no body to parse, no state machine, works under partial
  failure. Reserve this for signals that must be maximally robust.
- **Content-hash the work for exactly-once.** Since work sits in a polled prefix, dedupe by
  hashing content and recording what's run, or every poll re-executes it.
- **Read before write whenever a write can clobber a signal.** Any time one writer's output
  can overwrite another party's command in the same object, the writer must read first and
  yield to the command. Never *infer* the command from a failed read.

## Traps

- **Poll interval is your reaction-time floor.** Everything — new work, halt, reset — lands
  no faster than one poll cycle. Size the interval against how fast you must react, and don't
  pretend it's real-time.
- **Re-running polled work.** Forget the exactly-once tracking and a long-lived script in
  `global/run/` executes on every single poll. Content-hash dedup is not optional.
- **The reset race.** Coupling the backup to the reset without read-before-write means the
  snapshot writer stomps the operator's `{}` and the reset silently no-ops — the exact bug
  the read-before-write exists to kill. And inferring a reset from a *failed* read is the
  mirror-image bug: a transient GET error would wipe the fleet.
- **Unbounded growth if a lifecycle rule is missing.** One prefix without a TTL quietly
  accumulates forever. Audit that every write path has an expiry.
- **The control plane is as exposed as the bucket.** "Drop a script in and every node runs
  it" is remote code execution by design. Lock the bucket policy down hard — write access to
  `global/run/` is write access to every node's shell.

## When not to use it

- **Real-time or sub-second control.** If commands must land in milliseconds, polling an
  object store is the wrong substrate; use a real message bus.
- **High-frequency, high-fanout messaging.** A poll-the-bucket loop is fine for occasional
  commands and heartbeats; it is not a pub/sub system for thousands of messages a second.
- **Strong ordering or transactional semantics across the fleet.** The store gives you
  read-after-write on a key, not multi-key transactions or a global command log. If you need
  ordered, atomic, fleet-wide state transitions, this isn't it.
- **Long-lived production fleets where the latency/robustness trade flips.** The pattern
  shines for burst and test workloads. A permanent, latency-sensitive service will
  eventually outgrow it.

## As built (defcon.run 34)

- **Control plane + node agent:** `apps/run.waffaw/DESIGN.md` (S3 Control Plane, Node Agent
  sections) — the prefix layout, per-prefix lifecycle TTLs (`nodes/*/alive.txt` 1 day,
  `nodes/*/output/` 7 days), and `global/halt` as the emergency stop.
- **Agent loop:** `apps/run.waffaw/agent.sh` — `register`, `heartbeat`, `check_halt`,
  content-hash exactly-once in `run_scripts`, and `deregister` on SIGTERM.
- **Backup-as-control-plane with read-before-write:**
  `docs/superpowers/specs/2026-08-04-mqtt-records-capture-design.md` (§5.4, "Operator reset:
  write `{}` to the snapshot") — the read-before-write that skips the PUT on a reset, the
  convergence argument, and the fail-safe GET that never infers a reset from a failed read.
- Realized on a single S3 control bucket with lifecycle rules, polled by a bash agent
  running as PID 1 on every EC2 and Fargate node.
