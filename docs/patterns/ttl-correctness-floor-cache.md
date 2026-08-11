# TTL is the correctness floor; tags are only latency

**In any multi-instance deployment, tag- or event-based cache invalidation is
process-local — a write on one instance cannot clear another instance's cache — so
it can never be your correctness mechanism. Make a TTL backstop mandatory as the
real read-your-writes floor, and treat precise tag invalidation purely as a
same-instance latency optimization.**

## Context

You cache an expensive read — a full-table scan, an aggregate, a rendered report —
to spare your datastore and your latency budget. The obvious next move is precise
invalidation: on every write, clear exactly the cache entries that write affected,
so readers see fresh data immediately. Frameworks make this easy with tagged caches
and a `revalidateTag`-style call. It feels like you've solved staleness.

Then you scale past one instance — or you always ran more than one, or an autoscaler
can add a second under load — and the model quietly breaks. The write happened on
instance A. The tag invalidation ran in A's memory. Instance B, serving the next
read, never heard about it and keeps serving its stale copy until *something else*
clears it. If tag invalidation was your only freshness mechanism, you now have a
correctness bug that only appears under load, on the instance the user didn't write
to, and never reproduces in single-process dev.

## Forces

- **Invalidation is local; readers are distributed.** A `revalidateTag` call, an
  event emit, a cache-buster all execute in one process's memory (or reach only the
  instances subscribed to one bus). The reader who needs freshness may be anywhere.
- **You can't always invalidate even locally.** Some writes happen in contexts that
  legally *can't* trigger invalidation — a write that runs during render, or a write
  performed by a wholly separate process (an external job, a different service) that
  has no handle on your cache at all.
- **Precise invalidation is still worth having.** When the reader *is* on the writing
  instance, tag invalidation makes their own write visible instantly instead of after
  a TTL. That's a real latency win — just not a correctness guarantee.
- **Tag strings are a contract that rots silently.** If every call site builds its own
  tag string, one typo means an invalidation that quietly targets nothing, and a read
  that's stale forever with no error.

## The pattern

Split freshness into two mechanisms with two different jobs, and never confuse them.

```
  WRITE                         READ (any instance)
    │                                  │
    ├─▶ TTL backstop  ◀────────────────┤   MANDATORY. The real
    │   (bounded staleness,            │   read-your-writes floor.
    │    every instance, always)       │   Correctness lives here.
    │                                  │
    └─▶ tag invalidation ──────────────┘   OPTIONAL. Same-instance
        (instant, local only)              only. Latency, not
                                           correctness.
```

- **A TTL backstop is mandatory.** Every cached entry expires on a bounded timer. This
  is the mechanism that actually guarantees eventual read-your-writes across every
  instance, including the ones that never heard about the write and the writes that
  couldn't invalidate anything. Choose the TTL to bound how stale any reader can be;
  that number is your correctness SLA.
- **Tag invalidation is a latency optimization, nothing more.** When a write and the
  next read land on the same instance, precise invalidation makes the reader's own
  write visible immediately instead of at the next TTL tick. Wire it up where it's
  easy — but never let a correctness argument rest on it.
- **Writes that can't invalidate just rely on the TTL.** A write during render, or a
  write by an external process, simply does nothing special and is covered by the
  backstop. This is not a gap to apologize for; it's the design working as intended.
- **Centralize all tag construction in one module.** No consumer builds a tag string
  by hand. Keys, tags, TTL, and the invalidation helpers all live in one place, so the
  tag a writer clears is provably the tag a reader was stored under. Lock that contract
  with a test that asserts the exact tags each helper touches — this is the one place a
  silent typo becomes a permanent staleness bug, so it's the one place worth pinning.

### Facet: stale-while-revalidate with a cold-path single-flight

Where you can hold the cache in-process, a stale-while-revalidate cache pairs cleanly
with this model, and needs two single-flight guards, not one:

- **Serve stale, refresh in the background.** Past the TTL, return the stale value
  immediately and kick off a refresh that doesn't block the request. A failed refresh
  keeps the last good value and never rejects the reader.
- **Single-flight the refresh.** Only one background refresh runs at a time; concurrent
  readers past the TTL don't each fire a scan.
- **Also single-flight the cold path.** A refresh guard covers the warm case but a cold
  cache has nothing to be stale — and every fresh instance starts cold. A crowd hitting
  a just-scaled-out instance would each fire a full scan. Guard the cold path too: the
  first caller runs the scan, everyone else awaits that same in-flight promise.

## Key moves

- **Name the two mechanisms and never let them blur.** "TTL = correctness, tags =
  latency" is the whole discipline. Every design conversation should be able to say
  which one a given behavior depends on.
- **Pick the TTL as a staleness bound, deliberately.** It's not a performance knob;
  it's the worst case a reader on a cold or cross-instance path will see. Say the number
  out loud in the design.
- **One tag authority, under test.** All tag/key construction in a single module; a test
  that pins exactly which tags each invalidation helper fires. Correctness of
  invalidation reduces to correctness of that one contract.
- **Two single-flights for in-process SWR.** One for the warm refresh, one for the cold
  first-fill. Missing the cold one turns every deploy and scale-out into a scan stampede.

## Traps

- **Believing tags give you read-your-writes across instances.** They don't. This is
  the entire reason the pattern exists; it's also the bug that never shows up in
  single-process testing and only bites in production under scale-out.
- **An immediate-expiry vs stale-once profile mismatch on the invalidation call.** Some
  frameworks default a tag invalidation to "serve the stale value once more" rather than
  "hard expire now." If you meant read-your-writes on the same instance, ask for
  immediate expiry explicitly.
- **A call site that hand-builds a tag string.** The moment one does, the writer and the
  reader can disagree by a character and nothing errors — the read is just stale forever.
- **Only guarding the warm refresh path.** A cold cache has no stale value to serve, so
  the refresh guard doesn't apply; without a separate cold-start guard a burst of first
  readers all scan at once.

## When not to use it

- **A genuinely single-instance deployment that will never scale out** can lean on tag
  invalidation alone — but write down that assumption, because the day an autoscaler adds
  a second instance the correctness argument silently evaporates. A cheap TTL is good
  insurance even here.
- **Data that never changes after write** doesn't need invalidation at all; cache it long
  and move on.
- **Reads cheap enough to not cache** shouldn't carry any of this machinery. The whole
  structure is justified by an expensive read, not by caching for its own sake.

## As built (defcon.run 34)

- **Design spec:** `docs/superpowers/specs/2026-07-18-bib-report-cache-invalidation-design.md`
  — establishes that the framework's tag invalidation is process-local with more than one
  task possible, so a TTL backstop is mandatory; three write paths (a render-time create, a
  render-time pending write, and an external Lambda's writes) can't invalidate and rely on
  the TTL by design; and all keys/tags/TTL/invalidation live in one `report-cache.ts` module
  whose tag contract is locked by a unit test.
- **Stale-while-revalidate with both single-flights:**
  `apps/run.human/webapp/src/lib/leaderboard-cache.ts` — serves stale and refreshes in the
  background under a refresh single-flight guard, plus a distinct cold-path in-flight guard
  so a crowd hitting a freshly-scaled instance shares one scan.
- Realized on a framework tagged cache over a shared key-value store, with an in-process
  singleton cache for the leaderboard scan.
