# Pure core, thin shell

**Put every non-trivial behavior in a pure module that receives its I/O as an
injected dependency — never importing the database client itself — and keep the UI a
thin shell that only renders; then the whole app is unit-testable offline with a
hand-written fake and no mocking framework, and even a one-tap-button decision is a
plain function you can assert.**

## Context

You're building a cloud-coupled app: the logic that matters talks to a database, an
object store, an auth provider, a message bus. The path of least resistance is to
`import` the database client at the top of the module that needs it and call it inline.
It runs. But now that module can't be exercised without the cloud: to test the judge you
need a database, to test the cache you need a table, to test the button you need a
browser. So the tests either don't get written, or they get written against a mocking
framework that stubs the client's every method and drifts out of sync with reality, or
they become slow integration tests that need credentials to run at all.

The alternative is a single seam applied *everywhere*: the logic never reaches for the
outside world directly. It takes the outside world as a parameter — a `Store`, a `deps`
object, a `scan` function. Production wires the real implementation; a test passes an
in-memory fake that's twenty lines of a plain object. The same shape recurs across every
module that would otherwise be cloud-coupled, and the payoff is that the entire core is
testable in a plain unit-test environment with zero mocking machinery.

## Forces

- **The interesting logic is entangled with I/O.** The gates, the dedup, the ordinal
  allocation, the caching rules — the parts worth testing — sit right next to the reads
  and writes. Left inline, you can't test the logic without the I/O.
- **A direct client import couples the whole module graph to the cloud.** Importing the
  database entity pulls in its adapter, which pulls in the client, which reads
  credentials from the environment at module load. Now *importing* the file for a test
  touches the cloud before a single line runs.
- **Mocking frameworks stub the wrong surface.** Mocking the database client's API means
  your test asserts against a fiction of the client that can silently diverge from the
  real one. You want to substitute a *dependency you defined*, not intercept a vendor's.
- **UI components are the hardest thing to test.** A decision baked inside a component
  needs a DOM, a render harness, an event simulation — heavy, slow, flaky. Yet the
  decision itself (should this tap check the user in?) is trivial logic that deserves a
  trivial test.

## The pattern

Define the seam, inject it, and push logic out of the shell.

```
   ┌─────────────────────────────────────────────────────────┐
   │  PURE CORE (offline-testable, no client import)          │
   │                                                          │
   │   judge(input, store)   ── store: Store  ◄── injected    │
   │   buildHeatmap(deps)    ── deps.loadGpx, deps.put ...     │
   │   cache(scan)           ── scan: () => Promise<Rows>      │
   │                                                          │
   │   imports entities as `import type` ONLY  ───────────────┼──┐
   └───────────────────────────────────────────────────────────┘  │
        ▲                                    ▲                     │ type-only:
        │ real impl                          │ fake impl           │ the adapter/
   ┌────┴─────────┐                    ┌─────┴──────────┐          │ client chain
   │ SERVER shell │                    │ TEST           │          │ never enters
   │ wires the    │                    │ passes a 20-   │          │ the runtime
   │ real Store / │                    │ line in-memory │          │ module graph
   │ deps / scan  │                    │ object         │          │
   └──────────────┘                    └────────────────┘   ◄──────┘
```

**1 — Behavior is a pure function over an injected dependency.** Every non-trivial
module exports a function whose I/O arrives as a parameter — a `Store` interface, a
`deps` bag of closures, a single `scan` function. The function never imports the
database client. It reads and writes *through* the injected object, which it treats as
an interface it defined.

**2 — The server wires the real thing; tests wire a fake.** There's exactly one place —
the route handler, the server component — that constructs the real implementation
(`defaultStore`, the real `deps`) and hands it in. Everywhere else, a test constructs an
in-memory fake: a plain object whose methods push to and read from arrays. No mocking
library, no stubbing of a vendor API — just an object that satisfies the interface.

**3 — `import type` as a runtime-purity firewall.** Even the *type* of a cloud-coupled
entity is dangerous to import normally: a value import of an entity drags its
module-load and adapter chain into the runtime graph, and the file is online again. Import
it **type-only**. A type-only import is erased at compile time, so the entity's client
chain never loads, and the module stays offline-testable while still being fully typed
against the real shapes. This is the difference between a file that can be `require`d in
a bare test runner and one that throws on load because it tried to read credentials.

**4 — The UI is a thin shell; lift every decision out.** Components render and dispatch;
they do not decide. Even a one-tap button's logic — *does this tap trigger a check-in,
under what conditions, with what payload* — is lifted into a pure function the component
calls. The result: all logic is asserted in a plain node test environment with no
browser and no DOM harness, and the component is thin enough that its own correctness is
obvious by inspection.

## Key moves

- **Inject I/O; never import the client.** The one rule that generates everything else.
  If a module imports the database client, it's not in the core anymore. The core takes
  its outside world as an argument.
- **The fake is a plain object, not a mock.** Because the seam is an interface you own,
  the test double is a hand-written object backed by arrays. No framework, no
  auto-stubbing, no drift against a vendor's real API.
- **One wiring point.** Exactly one server-side location constructs the real
  implementation. Keeping that construction out of the core is what keeps the core pure;
  if the default impl leaks into the module body, purity is gone.
- **`import type` for anything cloud-coupled you only need the shape of.** It's a
  one-keyword firewall between "typed against the real entity" and "loads the real
  entity's client." Use it deliberately wherever a module needs an entity's type but must
  stay offline.
- **No logic lives in a component.** If a component makes a decision, that decision
  belongs in a pure function. The component becomes a shell that's trivial to read and
  needs no render-harness test.

## Traps

- **A value import where a type import would do.** `import { Entity }` instead of
  `import type { Entity }` silently re-couples the module to the cloud — it still
  compiles and still works in production, so the regression only shows up when a
  previously-offline test suddenly needs credentials. Prefer type-only imports by default
  for entities.
- **The default implementation leaking into the core.** If the pure module also
  *constructs* `defaultStore` at its top level (even to offer a convenient default), it
  has re-imported the client and the purity is theatre. Keep the real impl's construction
  in the shell.
- **A fake that's too clever.** The in-memory double should be the simplest thing that
  satisfies the interface. If the fake grows its own logic to mimic the database's
  behavior, your tests start asserting against the fake's fiction. Keep it dumb: arrays
  in, arrays out.
- **Half-applying the seam.** The value compounds only when it's repo-wide. One injected
  module surrounded by ten client-importing ones still forces a heavyweight test
  environment for the whole suite. Apply the same shape everywhere: judge, cache,
  reconcile, batch build, scan.

## When not to use it

- If a module has no I/O and no cloud coupling, it's already pure — there's nothing to
  inject. The seam is for behavior entangled with the outside world.
- If a component genuinely has no logic — it only lays out static markup — there's
  nothing to lift out; leave it as the shell it already is.
- If the only realistic test is a true end-to-end one (the value is in the integration
  itself, not the unit logic), an injected fake tests a fiction. Some paths really do
  need the real database and an integration harness; don't fake those.

## As built (defcon.run 34)

The same seam recurs across judge, cache, reconcile, batch build, and scan modules:

- **Injected `Store`:** `apps/run.human/webapp/src/lib/ctf-judge.ts` — the pure
  `judgeSolve` orchestration runs over an injectable `CtfStore`; `defaultStore` (the
  ElectroDB/AWS implementation) is server-only and constructed in the shell, so the judge
  is "fully testable via the injectable `CtfStore` seam with NO DynamoDB."
- **Injected `scan`:** `apps/run.human/webapp/src/lib/leaderboard-cache.ts` — the
  stale-while-revalidate cache takes its scanner as a parameter ("INJECTED by the caller,
  never imported here… carries no entity/DynamoDB coupling — only the `RunUserItem`
  TYPE").
- **Injected `deps`:** `apps/run.gpx/webapp/src/lib/heatmap-build.ts` (`BuildDeps`) and
  `apps/run.gpx/webapp/src/lib/gpx-reconcile.ts` (`deps?` bag of `listFiles`/`loadGpx`/…
  closures, all defaulting to real impls in the shell).
- **Injected `ScanStore` and check-in decision:**
  `apps/run.human/webapp/src/lib/social-scan.ts` (`ScanStore`, "mirrors
  lib/ctf-judge.ts: pure judge over an injectable ScanStore") and
  `apps/run.human/webapp/src/lib/quick-checkin.ts`.
- **`import type` firewall:** `apps/run.human/webapp/src/lib/ctf-otp-claim.ts`,
  `ctf-solve-merge.ts`, and `ctf-seed-rows.ts` import their entities type-only —
  "`import type` keeps the ElectroDB entity (and its AWS chain) out of the runtime module
  graph," keeping the modules offline-testable.
- Realized on Next.js server components/route handlers as the wiring shell over a
  single-table key-value store, with Vitest running the pure core in a plain node
  environment and no mocking framework.
