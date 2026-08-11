# Patterns

Durable design ideas extracted from a year of building **defcon.run**, written to
outlive the event repo they came from.

Each essay here is **portable**: it describes the *idea* — the problem, the forces,
the shape of the solution, and the traps — not the specific plumbing (a given cloud,
database, or framework) it happened to be built on this year. The goal is that a
future event, a different stack, or a different person can pick up the idea without
reading the original codebase.

Where an essay is grounded in real code, it ends with a short **As built** note
pointing at the reference implementation and its original design spec, so the concrete
version stays findable *before this repo is archived*. Treat that note as an anchor,
not as part of the portable idea.

## Why this folder exists

At the end of an event, the code gets archived and the context evaporates. What's
worth keeping isn't the code — it's the handful of designs that *didn't exist before*
and would be worth reaching for again. This folder is where those get captured, one
essay at a time, so next year starts from ideas instead of a cold archive.

## How each essay is structured

1. **Context** — when this problem shows up.
2. **Forces** — the tensions that make it non-trivial (why the obvious solution is wrong).
3. **The pattern** — the shape of the solution, stack-agnostic.
4. **Key moves** — the load-bearing decisions.
5. **Traps** — what bit us, so it doesn't bite again.
6. **When not to use it** — the cost side of the trade.
7. **As built** — pointer to the reference implementation (this repo).

## Catalog

29 essays, grouped by theme. Many cross-reference each other.

### Front door & links

| Pattern | One line |
|---|---|
| [QR front-door service](./qr-front-door.md) | Re-pointable short links resolved at the cheapest sufficient layer — edge redirect, thin stateless resolver, or authenticated app — with off-hot-path analytics and secret-safe link previews. |
| [Compile authoring down to execution](./compile-authoring-to-execution.md) | Freeze a battle-tested runtime and add features by compiling a friendlier authoring model down to the primitives the engine already executes. |

### Secrets, auth & anti-abuse

| Pattern | One line |
|---|---|
| [Cross-app SSO on a shared cookie umbrella](./cross-app-sso-cookie-umbrella.md) | Scope session cookies to the parent domain so every subdomain is same-site — unlocking cross-property credit and zero-flash hidden-iframe SSO. |
| [Graduated-friction chokepoint](./graduated-friction-chokepoint.md) | Enforce anti-abuse at the one chokepoint every login funnels through, with a fail-closed signed clearance cookie and difficulty dialed per user as graduated punishment. |
| [Decoy-and-derive secrets](./decoy-and-derive-secrets.md) | Commit inert decoys, derive the real secret from a stable id via a KDF, and let the mere presence of one server-only secret be the prod/local switch. |
| [Right-size crypto to a written threat model](./right-size-crypto-threat-model.md) | Write down the threat you actually defend, implement exactly enough crypto for it, and confine the choice to one file so the upgrade stays local. |
| [Covert return channel](./covert-return-channel.md) | Return a verdict through a benign styling asset read from the render engine, so success / failure / auth-state are byte-identical on the wire and in logs. |

### Idempotency & claims

| Pattern | One line |
|---|---|
| [Coordination-free idempotency](./coordination-free-idempotency.md) | Make the write itself the arbiter: shape keys so one conditional put or atomic counter decides "already done / once per window / which ordinal" with no coordinator. |
| [Park-and-claim](./park-and-claim.md) | Let an anonymous actor act now and claim after they log in, credited exactly once through the same judging function via a hashed nonce. |

### Scoring & gamification

| Pattern | One line |
|---|---|
| [Proximity clustering bonus](./proximity-clustering-bonus.md) | Reward a crowd that gathered together, computed as a re-valued ledger with an idempotent reconcile, a pure detector, and subtract-only abuse gates. |
| [Frozen history, recomputed value](./frozen-history-recomputed-value-ledger.md) | Freeze the history half of a ledger event (the ordinal, who was first) and re-derive the value half from current config on every rescore. |

### Realtime, maps & privacy

| Pattern | One line |
|---|---|
| [Structural privacy at one boundary](./structural-privacy-boundary.md) | Enforce a privacy guarantee structurally: an allowlist serializer, a non-attributability chokepoint, and cover traffic that shares the real code path. |
| [Deterministic wall-clock simulation](./deterministic-wall-clock-simulation.md) | Compute ambient shared motion as a pure function of epoch time, client-side, replacing a realtime backend and all its outage modes. |
| [Persisted client state from ids](./persisted-client-state-from-ids.md) | Persist toggle/selection state by stable ids with leaves-only storage and derived masters, and make deep links mean an exact set with no flash. |
| [Synchronous anchor layers](./synchronous-anchor-layers.md) | Kill async paint-order races by installing zero-feature band anchors up front, so every layer inserts against a fixed ceiling regardless of arrival order. |

### Testing & contracts

| Pattern | One line |
|---|---|
| [The test suite as enforcement layer](./tests-as-enforcement-layer.md) | Enforce what types can't: source-scanning invariants, parity/golden tests for deliberate duplication, and guards placed outside the vendor-sync blast radius. |
| [Pure core, thin shell](./pure-core-thin-shell.md) | Put every non-trivial decision in a pure module with injected I/O and keep the UI a thin shell, so a cloud-coupled app is unit-testable offline with no mocking framework. |
| [Email to object store as a test seam](./email-to-object-store-test-seam.md) | Route real out-of-band mail into an object store and poll it with plus-addressed identities, testing the hardest half of auth against the production path. |

### Infrastructure & deploy

| Pattern | One line |
|---|---|
| [Dark-launch infrastructure](./dark-launch-infrastructure.md) | Merge non-trivial infra fully reviewed but inert, so the "does the code make sense" review is decoupled from the "does applying it break prod" step. |
| [Copy, don't parameterize](./copy-dont-parameterize.md) | In stateful IaC, fork a module instead of generalizing it — a new shared version re-plans every live unit and widens your blast radius. |
| [Staged, reversible declarative migrations](./staged-reversible-declarative-migrations.md) | Do risky state migrations as staged, zero-diff, reversible steps: detach-then-destroy, off/canary/on, and auto-simplify at N=1. |
| [Observed least-privilege IAM](./observed-least-privilege-iam.md) | Generate a least-privilege policy from captured real API calls, and split it into themed managed policies to beat the inline-policy size cap. |

### Ops, fleet & reliability

| Pattern | One line |
|---|---|
| [Fail loud on silent success](./fail-loud-silent-success.md) | Turn the dangerous silent-success — a green build shipping the wrong thing — into a hard stop with the fix written into the error. |
| [Leaderless rank consensus](./leaderless-rank-consensus.md) | Give every node a stable rank with no coordinator: each lists the same shared directory and sorts it the same way. |
| [Object store as the control plane](./object-store-control-plane.md) | Coordinate a whole fleet with only a bucket — self-registration, heartbeats, polled work, a one-file halt — self-pruned by lifecycle rules. |
| [Stable facade over a churny dependency](./stable-facade-over-churny-dependency.md) | Wrap a volatile vendor or framework behind your own minimal contract so an upstream break is a swap, not an outage. |

### LLM & caching

| Pattern | One line |
|---|---|
| [LLM in the loop](./llm-in-the-loop.md) | Three disciplines for a model in a pipeline: a ledgered cost ceiling, keeping the secret out of the model's context, and letting the model shape its own output. |
| [TTL as the correctness floor](./ttl-correctness-floor-cache.md) | In a multi-instance deployment a TTL is the correctness floor; tag/event invalidation is only a same-instance latency optimization. |

### Trust & safety

| Pattern | One line |
|---|---|
| [Advisory signals, decoupled from enforcement](./advisory-signals-decoupled-from-enforcement.md) | Detectors surface candidates for a human and never act or feed the artifact; test that each signal stays silent on the ordinary case. |

## Candidate patterns (noticed, not yet written up)

Recurring ideas that are probably worth their own essay eventually. Some are already
touched on inside an essay above; captured here so they aren't lost when the repo is
archived:

- **Log-line-not-per-row analytics + scheduled rollup.** Never write to the database on
  the hot path; emit one structured log line per event and aggregate on a schedule (with
  a header-guarded on-demand flush). Currently covered only as a section of the
  [QR front-door](./qr-front-door.md) essay — worth promoting to its own.
- **Bare-404 non-disclosure admin gate.** Admin surfaces return `404`, never `401`/`403`,
  so an unauthenticated probe can't even confirm the route exists. Used by every admin
  surface this year; referenced in several essays but not written up on its own.
- **Fire-and-forget best-effort side effects.** A user's write path never blocks on a
  downstream recompute/sync; it triggers it and returns, and an authoritative version runs
  on a schedule. Appears across the scoring and reconcile essays.
- **Config-as-data, hot-tunable.** Operational tunables live in a data row read through a
  short cache, so they can be retuned live during the event with no deploy. Recurs as a
  key move in the clustering and object-store essays.
- **Structured records as a contract, emitted at call sites.** The machine-readable record
  is a separate contract from the human log line (they share call sites, never a format),
  written to a bounded drop-and-count buffer, and partitioned by the record's own timestamp
  — so a silent gap becomes a visible one.
- **Copy catalog: O(1) shared server+client lookup.** One `t(map,key,vars)` used by both a
  server resolver and a client provider (never a fetch); a JSON snapshot is the CMS-down
  floor; a missing key echoes the key (visible, never blank); a test fails if a client file
  imports the server-only resolver.
- **Analog-mapping before building** (`*-PATTERNS.md`). Before writing a new file, map it
  to the closest existing file in the repo and copy that shape. This is the *internal*
  version of what this folder does outward — see `.planning/phases/*/NN-PATTERNS.md`.

## Adding a new essay

Copy the structure above, keep the idea portable, and add a row to the relevant catalog
group. An essay is worth writing when the idea is one you'd want to reach for again and it
wasn't obvious the first time.
