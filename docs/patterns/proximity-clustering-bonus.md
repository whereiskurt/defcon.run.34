# Proximity clustering bonus

**Reward the fact that a crowd gathered together — detected after the fact from
individual check-ins — as a re-valued ledger, not an accrual: a pure detector proposes
groups, an idempotent reconcile writes award rows, one scoring function re-derives the
score, and abuse gates only ever subtract.**

## Context

People check in individually — at a start line, an event, a meeting point. Each check-in
already means something on its own (it lights that person's day, keeps a streak alive). But
there's a signal that individual check-ins throw away: *thirty people stood in the same
place at the same time.* Showing up together should be worth more than showing up alone,
and you want to reward it without asking anyone to do anything extra — no "create a group,"
no "invite your friends." The gathering should be **discovered** from the check-ins that
already happened.

## Forces

- **The reward is retroactive and grows.** A group forms over time. Six people become
  fourteen. Whatever you award has to be able to *increase* as more people are found in the
  same gathering — and it must never double-award the people already counted.
- **You have one source of truth for score, and it must stay that way.** In any system with
  a real scoring model, there's usually exactly one function that writes the score. Bolting
  a bonus onto the check-in-creation path makes a *second* writer, and now two code paths
  can disagree about someone's total.
- **Caps depend on the whole picture; detection sees only a window.** "At most N group
  bonuses per person per day" is a whole-day fact. But an efficient live detector only ever
  looks at a recent time window — it *cannot* correctly enforce a daily cap, because it
  can't see the rest of the day.
- **Super-linear rewards are the most attractive thing to cheat.** The moment a big group
  is worth a lot, manufacturing a fake big group (throwaway accounts, spoofed locations)
  becomes the highest-yield attack on the whole board.

## The pattern

Don't accrue points when the check-in happens. **Write an award ledger and let the scoring
function re-value it**, exactly like every other scoring input.

```
  individual check-ins (already exist)
              │
              ▼
   ┌──────────────────────┐     pure function, no I/O
   │  detect(points, cfg)  │ ──▶ proposed groups
   └──────────────────────┘         │
              │                      ▼
              │            ┌────────────────────┐   pure function
              │            │ diff(desired,       │──▶ { puts, deletes }
              │            │      existing rows) │
              │            └────────────────────┘
              ▼                      │
   ┌──────────────────────┐         ▼
   │  reconcile (sweep)    │  upsert / delete AWARD rows
   │  server-only, does    │  keyed by each member's
   │  the I/O + rescore    │  EARLIEST event in the group
   └──────────────────────┘         │
              │                      ▼
              ▼            ┌────────────────────┐
   the ONE scoring     ──▶ │ score = ... + bonus │  cap enforced HERE,
   function re-derives      │ (sees full ledger)  │  where the whole day
   everyone affected        └────────────────────┘  is visible
```

**1 — A pure detector.** Detection is a pure function: `(points, config) → groups`. No
database, no I/O, no framework — just data in, groups out. This makes it exhaustively
unit-testable with hand-built fixtures (the real meetup, the GPS-drift spread, the two
groups that must *not* merge, the lone spammer, the sub-threshold group). Everything hard
about the feature lives here, and it's all testable in isolation.

**2 — Award rows keyed by a stable anchor.** The reconcile writes one row per (person,
group they were in), keyed by that person's **earliest event in the group**. This anchor
is what makes re-running safe: when a group grows, each early member still anchors on the
same event, so the sweep *upserts the same row* with a larger value. Nothing double-awards.
A group that dissolves under a config change has its rows *deleted*, not stranded. The
reconcile is idempotent because the key is stable.

**3 — Reconcile = pure diff + apply.** The sweep reads what the detector *wants* and what
rows *exist*, then computes a pure `diff → { puts, deletes }`. Applying the diff is the only
side effect. A **dry run** computes everything up to (but not including) the apply — so
preview is the *same code path* as the real sweep, and what you preview is exactly what will
happen.

**4 — One scoring function re-derives the score; the cap lives there.** The bonus is a new
term in the single scoring function, which now takes the person's award rows as input. The
per-day cap is enforced **in the scoring function**, not at write time, because only the
scoring function sees the person's *whole* ledger. Two payoffs:

- Raising the cap re-values everyone on their next rescore — no re-sweeping, no data
  migration. (Same as retuning any other scoring config.)
- The live incremental sweep, which only sees one window, *can't* get the whole-day cap
  wrong, because it isn't the thing enforcing it.

**5 — Two triggers, one detector.** A **live** trigger runs after each check-in, bounded to
a recent window (fire-and-forget, never blocking the user's write). An **authoritative**
trigger runs over the whole event on demand (with dry-run). Both call the same pure
detector; they differ only in range.

**6 — Config as data, hot-tunable.** Radius, time window, minimum group size, cap, and the
tier table live in a single data row read through a short cache. You retune the radius
mid-event, live, with no deploy.

**7 — Abuse gates that only ever subtract, and fail closed.** Because a big fake group is
the highest-yield attack, gate it — but gate it *conservatively*:

- **Anti-sybil via a permissive OR of "real" signals.** Count someone toward a group only
  if they look like a real participant by *any* of several denormalized signals (account age,
  prior activity, etc.). Critically, **never use the thing being gated as an establishing
  signal** — if check-ins qualified you, the gate would be circular. A real attendee trips
  one signal; a throwaway created minutes ago trips none.
- **Impossible-travel tripwire.** Within one person's own timeline, ignore a check-in whose
  implied speed from their *last surviving* check-in is physically impossible. Chaining off
  the last surviving point (not the raw previous one) stops a single bad GPS fix from
  invalidating everything after it. This is a tripwire, not a wall — it catches one account
  in two places at once, not a patient single-location spoofer.
- Both gates **only remove a check-in from the bonus** — the check-in still saves and still
  counts for its normal purpose. A false positive costs one group bonus and is recovered on
  the next sweep. Nothing is destructive.
- **Fail closed:** someone whose record can't be read is *absent* from the group, never
  waved through. A read failure must never become a bypass.

## Key moves

- **Reward = re-valued ledger, not accrual.** This is the whole idea. Write a durable record
  of *what was earned* and let the one scoring function decide *what it's worth right now*.
  Retuning becomes free; the single-writer invariant survives.
- **Idempotency comes from a stable key.** Key the reconcile's output on something that
  doesn't move as the input grows (here, each member's earliest event). Then "run it again"
  is always safe.
- **Push enforcement to where the full picture is.** Caps, totals, anything whole-scope
  belongs in the component that sees the whole scope — not in the incremental path that sees
  a slice.
- **Preview by sharing the code path.** Dry-run that runs the real logic and stops before
  the write gives you a preview you can trust, instead of a separate estimate that drifts
  from reality.
- **Gate the attack, not the honest case.** Permissive OR of real-user signals + fail-closed
  + subtract-only means the gates cost cheaters everything and honest users almost nothing.

## Traps

- **Prefix-matching deletion is dangerous.** When cleaning up test/demo data, matching rows
  by a key *prefix* will eventually delete a legitimate row whose key merely starts the same
  way. Require **two independent markers** (a prefix *and* an explicit tag) before deleting.
- **ID-namespace mismatches join to null silently.** Gating on a signal stored under a
  different identifier than the one you're joining on produces a silent empty join, not an
  error — and your gate quietly excludes everyone (or includes everyone). Verify the two
  sides share an id space.
- **Retroactive rewards can't have a truthful live toast.** Because the group is discovered
  after the fact and its value grows, a "you got a group bonus!" popup at check-in time would
  show a number that's immediately wrong and then silently upgraded. Show the earned bonus in
  a drill-in view that reflects the current, correct value instead.
- **The greedy claim is deterministic, not optimal.** When groups overlap, resolving
  membership greedily (sorted, one pass) is deterministic and cheap; true maximum-coverage is
  neither. At event scale the difference is immaterial — but write it down so nobody "fixes"
  it into something slow and nondeterministic.

## When not to use it

- If the reward is a flat, one-shot accrual that never grows and never gets retuned, the
  ledger-and-re-value indirection is overkill — just award it.
- If there's no adversary and no meaningful payoff to gaming it, skip the abuse gates; they're
  proportional to how attractive the reward is to attack.
- If groups never overlap and never grow, you don't need the anchor-keyed idempotent
  reconcile — a plain insert suffices.

## As built (defcon.run 34)

- **Design spec:** `docs/superpowers/specs/2026-08-02-cluster-checkin-bonus-design.md`
  (includes the abuse-gate addendum).
- **Pure detector:** `apps/run.human/webapp/src/lib/cluster-detect.ts`
  (tests in `.../src/lib/__tests__/cluster-detect.test.ts`).
- **Reconcile + diff:** `.../src/lib/cluster-sweep.ts` (see the `cluster-sweep` tests).
- **Scoring term + single-writer invariant:** `.../src/lib/scoring-engine.ts`,
  `.../src/lib/rescore.ts`, guarded by `.../src/lib/__tests__/scoring-write-invariant.test.ts`.
- **Ledger + config entities:** `.../src/entities/cluster.ts`, `.../src/lib/cluster-config.ts`.
- **Admin UI + triggers:** `.../src/app/(protected)/admin/clusters/`,
  `.../src/app/api/checkins/route.ts` (live), `.../src/app/api/admin/clusters/sweep/route.ts`
  (authoritative).
- Realized on a single-table key-value store with a secondary index for the bounded-range
  sweep query.
