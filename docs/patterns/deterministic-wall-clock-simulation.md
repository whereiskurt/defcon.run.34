# Deterministic wall-clock simulation

**For ambient moving or animated state where "plausible shared motion" — not ground truth
— is the actual requirement, compute position as a pure function of absolute epoch time
(`phase = f(nowMs, entityIndex)`), fully client-side, so every viewer sees identical
motion with zero backend, zero polling, no refresh cue, and no failure surface during the
high-stakes window.**

## Context

Something on the screen needs to move: shuttles crawling a route, particles drifting,
avatars milling, a fleet looping a path. The instinct is a realtime service — the server
tracks position, clients poll or subscribe, and the UI renders whatever the last update
said.

But step back and ask what the motion is actually *for*. Often it is ambience: the thing
should look alive and every viewer should agree on roughly where it is, but no decision
depends on the position being *true*. Nobody is boarding the shuttle. When that is the
real requirement, a realtime service is a large, failure-prone machine bolted on to
produce an effect a pure function produces for free.

## Forces

- **Realtime infrastructure is a liability, not just a cost.** A socket service or polling
  endpoint has outage modes: it goes down, it lags, it rate-limits, it desyncs clients. If
  the motion is decorative, every one of those failure modes is pure downside — you have
  added ways for a cosmetic feature to break the page.
- **The worst time to have a failure surface is the moment everyone is watching.** A
  feature that ships for a specific event has a window where load spikes and attention
  peaks simultaneously. A stateless pure function has nothing to fall over.
- **Viewers must agree.** Two people looking at the same screen expect the same positions.
  Anchoring animation to page-load time ("start the loop at t=0 on mount") makes every
  client's clock start whenever they happened to load — they drift apart immediately.
- **"Live-ish" is a real and common requirement.** The bar is not "accurate to the actual
  vehicle." The bar is "moves plausibly and consistently." Recognizing that this bar is
  lower than ground truth is what unlocks the cheap solution.

## The pattern

Model the animated state as a **pure function of absolute epoch time**. Position is not
stored anywhere and never fetched; it is *computed* on demand from the current wall clock.

```
  state(nowMs, index) = pure function        ← no I/O, no stored state, no memory of the past
      │
      ├─ nowMs      : absolute epoch milliseconds (Date.now()), NOT time-since-load
      └─ index      : which entity (bus 0..7, particle 0..N), spreads them along the cycle

  render loop: every frame/tick, read the clock, recompute, paint.
```

The construction for cyclic motion (a fleet looping a route):

- pick a **cycle length** in real units (e.g. a full out-and-back run time);
- each entity `k` is offset into the shared cycle by `k · spacing`, so they spread evenly;
- `phase = ((nowMs / unit) + k · offset) mod cycleLength`, normalized to `[0, 1)` (or
  `[0, 2)` for out-and-back), then mapped to a point along the path by arc-length fraction.

Because the input is the **absolute epoch**, not elapsed-since-load, the function is
deterministic across viewers and across reloads: two clients that call it at the same
instant get byte-identical output, and a reload continues seamlessly from where the motion
"is" rather than restarting. The render loop is a dumb ticker — read the clock, recompute,
paint — holding no state of its own.

This replaces an entire realtime service and all of its outage modes with a function that
cannot fail because it does nothing but arithmetic. There is no source of truth to be
unavailable, no connection to drop, no cache to go stale.

## Key moves

- **Anchor to the absolute epoch, never to load time.** This single choice is what makes
  the motion shared and reload-stable. `Date.now()` in the formula, never a
  `performance.now()` measured from mount.
- **Keep the math pure and I/O-free.** The state function takes numbers and returns
  positions — no map object, no DOM, no fetch. That makes it unit-testable in isolation
  (assert determinism: same `nowMs` ⇒ same output) and keeps the failure surface at zero.
- **Separate the pure model from the render binding.** One module computes states; a thin
  second module ticks a timer and moves the markers. The renderer is allowed to be
  framework-specific and untested; the model is neither.
- **Tick rate is a render choice, not a correctness one.** Because position is a function
  of the clock, you can tick at 1 Hz, 60 Hz, or on demand — you always get the right
  answer for *now*. No accumulation, no catch-up logic, no dropped-frame drift.
- **Degrade motion, not visibility, under reduced-motion.** If a viewer prefers reduced
  motion, slow or simplify the animation — but don't hide a feature whose whole point is
  that it moves. (Hard-gating visibility on a motion preference is how a user-triggered
  effect goes invisible in production.)

## Traps

- **Elapsed-time anchoring sneaks back in.** Any `startTime = Date.now()` captured at mount
  and subtracted later reintroduces per-client drift. The formula must consume the raw
  clock every tick, not a delta from a remembered start.
- **Mutating the transform the host owns.** When the render surface (a map, a layout
  engine) owns an element's transform, animate an *inner* child element, never the root the
  host is positioning — or your animation and its positioning fight each other.
- **Degenerate inputs.** An empty path or zero-length cycle divides by zero or spins
  markers at one point. Guard the pure function against the degenerate case so a bad config
  produces "no motion," not a crash.
- **Assuming it can carry real decisions later.** The moment someone wants the position to
  be *true* — actual arrival times, real occupancy — the pure function is the wrong tool
  and no amount of tuning fixes it. Know that you chose ambience, and revisit the choice if
  the requirement changes rather than faking accuracy.

## When not to use it

- If the position must be **ground truth** — someone acts on it (catches the bus, meets the
  person, trusts the number) — you need the real feed. This pattern is for ambience, full
  stop.
- If the motion is genuinely **unpredictable** (driven by live human input, real sensors,
  a game state) there is no closed-form `f(nowMs)` to write; the state isn't a function of
  time alone.
- If you need an **audit trail or history** of where things were, a stateless function that
  only knows "now" gives you nothing to query.

## As built (defcon.run 34)

- **Design spec:** `docs/superpowers/specs/2026-07-26-deuce-bus-layer-design.md` — Decision
  1: "Bus data: simulated schedule. No server lookup. Positions are a pure function of
  wall-clock time, so every viewer sees the same buses and nothing can break during con
  week." Explicitly "No new API routes, no polling, no refresh cue."
- **The pure model:** `apps/run.gpx/gpx-studio/website/src/lib/components/map/deuce-route.ts`
  — `busStates(nowMs)` and the `vehicleStates` core: `phase = ((nowMs/60000 + k·HEADWAY)
  mod (2·ONE_WAY)) / ONE_WAY`, "Anchored to absolute epoch ⇒ deterministic across viewers
  and reloads," plus `pointAtFraction` / `cumulativeDistances` for arc-length mapping.
- **The render binding:** `apps/run.gpx/gpx-studio/website/src/lib/components/map/deuce-layer.ts`
  — a 1 s `setInterval` ticking `marker.setLngLat(busStates(Date.now())[k].lngLat)`, CSS
  bob on an inner element only, reduced-motion disabling the bob but not the movement.
- **Sibling application:** the sim-rabbit crowd in
  `docs/superpowers/specs/2026-07-16-gpx-sim-rabbits-matrix-ghost-design.md` uses the same
  "plausible shared motion, no ground truth" framing for its ambient population.
