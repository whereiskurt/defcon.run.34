# Compile the authoring model down to the execution model

**Don't extend a battle-tested runtime to be more expressive. Build a nicer
authoring model and a pure compiler that lowers it to what the engine already
executes — so the runtime stays frozen while the authoring experience improves
radically.**

## Context

You have a runtime that works: a resolver, a rules engine, an interpreter — something
that's been in production, has the edge cases beaten out of it, and that you trust. Now
someone needs a feature the runtime doesn't obviously support. The authoring surface is
too low-level: people are hand-writing the exact primitive the engine consumes, and it's
error-prone, tedious, or impossible to reason about.

The tempting move is to teach the runtime the new concept — add a mode, a new rule type,
a branch. But every change to a trusted runtime is a chance to break everything that
already flows through it, and the new concept usually isn't a new *execution* primitive at
all. It's a new *authoring* primitive that could be expressed in terms of what the engine
already does. The runtime doesn't need to be smarter; the input does.

## Forces

- **The runtime is trusted precisely because it's stable.** Its value is the miles on it.
  Every edit spends some of that trust and reopens the whole surface to regression.
- **The authoring model and the execution model want different things.** Humans want to
  think in high-level intent ("switch to this on Saturday at noon"). The engine wants a
  flat, unambiguous primitive it can evaluate fast ("first window whose half-open interval
  contains now"). Forcing one representation to serve both makes both worse.
- **Invariants have to live somewhere.** Non-overlapping windows, gap-free coverage, a
  single consistent timezone, an always-matching final case — someone must guarantee these.
  If that someone is a human hand-authoring the primitive, the invariants break.
- **A pure function is cheap to trust.** A compiler with no I/O and no state can be pinned
  by tests exhaustively; a change to the runtime cannot be tested nearly as cheaply.

## The pattern

Introduce a layer. Authors edit a high-level model; a pure compiler lowers it to the exact
primitive the runtime already consumes; the runtime is never touched.

```
  AUTHOR  ─edits→  AUTHORING MODEL        (high-level, human intent)
                        │
                        ▼
                   PURE COMPILER          (no I/O, no state; holds the
                        │                  invariants; fully unit-tested)
                        ▼
                   EXECUTION MODEL        (the primitive the engine
                        │                  ALREADY evaluates — unchanged)
                        ▼
                   RUNTIME  ── evaluates exactly as it did before
```

- **The authoring model is what humans manipulate.** It's expressed in the terms of the
  problem, not the terms of the engine.
- **The compiler is a pure function** from authoring model to execution model. It has no
  I/O and no state, so it's trivial to test to exhaustion, and it's where the invariants
  are enforced — the human never has to hold them.
- **The execution model is untouched.** The compiler emits exactly what the engine already
  reads. The runtime doesn't know the authoring layer exists.

The concrete shape that recurs: a human "timeline of switch-points" — an ordered list of
"at this instant, switch to this" — compiles down to a resolver's existing first-match,
half-open time windows. Window *i* covers `[point[i], point[i+1])`; the final window is made
open-ended with a **far-future sentinel** so it matches indefinitely; the period before the
first switch-point matches nothing, so the runtime's existing fallback takes over
automatically. The compiler carries the invariants — windows non-overlapping and gap-free
between first and last, everything in one timezone, times stored canonically — under test.
The resolver's "evaluate first matching window" logic is never modified.

**A sibling move: compose new behavior through an existing indirection instead of re-homing
infrastructure.** If you already have a redirect, an alias, or a pointer in the path, you
can often get a new behavior by re-pointing *that* — routing an existing vanity redirect at
the compiled resolver rather than migrating the domain onto it. Same principle: reuse the
substrate that already works; add the new capability at the authoring/routing layer, not by
rebuilding the load-bearing part.

## Key moves

- **Add a layer, don't mutate the engine.** The new feature is a new input dialect, not a
  new execution capability. Keep the engine frozen.
- **Make the compiler pure.** No I/O, no state. Purity is what lets you test every invariant
  cheaply and trust the lowering completely.
- **Put the invariants in the compiler, under test.** Non-overlap, gap-free, single
  timezone, an always-terminating final case — the compiler guarantees them so no author
  ever has to. Test the guarantees directly (empty input, single element, boundaries, the
  open-ended tail).
- **Use a sentinel for "and thereafter."** An open-ended final case is just a window that
  runs to a far-future instant — no new engine concept required.
- **Let the runtime's existing fallback cover the gaps you intend.** "Before the first
  switch-point" mapping to "no window matches" mapping to "the engine's default" is the
  authoring model getting default behavior for free.
- **Prefer re-pointing an existing indirection over relocating infrastructure.** Lower risk,
  reversible, no downtime.

## Traps

- **Letting the authoring model leak into the runtime.** The instant the engine grows a
  special case "for scheduled codes," you've lost the entire benefit — now both the authoring
  layer and the runtime know about the feature. The runtime must stay ignorant.
- **Two editors fighting over the same output.** If both the new authoring model and a legacy
  low-level editor can write the engine's primitive, they'll clobber each other. When the
  high-level model owns the output, make the raw editor read-only for that item.
- **Timezone drift in the compiler.** "Authored in one zone, stored in another, compared in a
  third" is the classic bug. Fix a single canonical zone for storage and comparison and do
  all display conversion at the edges.
- **A far-future sentinel that isn't far enough — or that some downstream chokes on.** Pick
  it comfortably beyond any real horizon and confirm the engine treats it as an ordinary
  bound.
- **Propagation lag surprises.** If the runtime caches its input, an authoring change goes
  live only after that cache turns over. Say the bound out loud so "I published it and nothing
  changed" isn't a mystery.

## When not to use it

- If the runtime genuinely lacks the *execution* primitive — the new feature can't be
  expressed in what the engine already does — then you do need to extend the engine, and a
  compiler is just a detour.
- If there's exactly one author who understands the low-level format and the volume is tiny,
  the authoring layer may cost more than it saves.
- If the runtime isn't actually trusted yet — it's new and changing anyway — freezing it buys
  you less, and folding the concept in directly may be simpler.

## As built (defcon.run 34)

- **Design spec:** `docs/superpowers/specs/2026-07-18-dynamic-scheduled-qr-design.md` — §2 is
  the pure switch-points-to-time-windows compiler (sort, emit half-open windows, far-future
  sentinel on the last, base destination before the first via the resolver's existing
  fallback), with the non-overlap / gap-free / single-timezone / canonical-UTC invariants
  called out as compiler guarantees under test; §5 is the sibling move — re-pointing the
  existing `r.`/`h.` vanity redirects at the resolver rather than re-homing the domains onto
  it.
- **Compiler:** `apps/run.human/webapp/src/lib/qr-schedule.ts` (`compileScheduleToRules`,
  `FAR_FUTURE` sentinel, `CON_TZ` fixed zone, plus its unit test). The resolver Lambda that
  evaluates the compiled `rules` is never changed.
- This is the authoring layer atop the substrate described in
  [QR front-door service](./qr-front-door.md) — the resolver's first-match rule list is the
  execution model this compiler targets.
- Realized on a global key-value store holding the authored schedule, a Next.js admin editor
  as the authoring surface, and an unmodified function-as-a-service resolver as the runtime.
