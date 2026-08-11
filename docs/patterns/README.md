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

| Pattern | One line |
|---|---|
| [QR front-door service](./qr-front-door.md) | Re-pointable short links resolved at the cheapest layer that can do the job — edge redirect, thin stateless resolver, or authenticated app — with off-hot-path analytics and secret-safe link previews. |
| [Proximity clustering bonus](./proximity-clustering-bonus.md) | Reward a crowd that gathered together, computed as a re-valued ledger with an idempotent reconcile, a pure detector, and abuse gates that only ever subtract. |

## Candidate patterns (noticed, not yet written up)

These recurred across the year and are probably worth their own essays later. Listed
here so they aren't forgotten when the repo is archived:

- **Log-line-not-per-row analytics + scheduled rollup.** Never write to the database on
  the hot path; emit one structured log line per event and aggregate on a schedule (with
  a header-guarded on-demand flush). Used by the QR service; generalizes to any
  high-volume, low-value-per-event counter. (Partly covered in the QR essay.)
- **Bare-404 non-disclosure admin gate.** Admin surfaces return `404`, never `401`/`403`,
  so an unauthenticated probe can't even confirm the route exists. Used by every admin
  surface this year.
- **Fire-and-forget best-effort side effects.** A user's write path never blocks on a
  downstream recompute/sync; it triggers it and returns. The authoritative version runs
  on a schedule.
- **Analog-mapping before building** (`*-PATTERNS.md`). Before writing a new file, map it
  to the closest existing file in the repo and copy that shape. This is the *internal*
  version of what this folder does outward — see `.planning/phases/*/NN-PATTERNS.md` for
  the convention.
- **Config-as-data, hot-tunable.** Operational tunables live in a data row read through a
  short cache, so they can be retuned live during the event with no deploy. (Covered as a
  key move in the clustering essay; recurs elsewhere.)

## Adding a new essay

Copy the structure above, keep the idea portable, and add a row to the catalog. An
essay is worth writing when the idea is one you'd want to reach for again and it
wasn't obvious the first time.
