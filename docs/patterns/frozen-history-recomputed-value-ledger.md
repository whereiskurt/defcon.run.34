# Frozen history, recomputed value

**Split every ledger event into a HISTORY half that is assigned once and never
changes — the ordinal, the rank, who was first — and a VALUE half that is derived
fresh from current config on every rescore, so retuning the economics re-values the
whole population without rewriting a single stored award, and "who did what when"
stays stable forever.**

## Context

You are running a scoring, points, or gamification system: solves, ranks, streaks,
first-bloods, tiered rewards. Two things are true at once and they pull against each
other. First, some facts are **historical and must never move**: the person who
solved a challenge third solved it third, permanently, and everyone can see it.
Second, the *economics* are not settled — you will retune them, probably during the
event: raise a cap, flatten a decay curve, decide a class of thing is worth less now
that another mechanic carries the reward.

The naive build bakes the point value into the row at the moment the event happens
("award 100 points, write the row"). It works until the first retune, at which point
every already-earned row is frozen at the *old* value. Now you are writing migrations,
re-summing totals, and reconciling a stored number against a config that has moved out
from under it. The system that was supposed to be a source of truth has become a pile
of stale snapshots.

## Forces

- **Audit history wants to be immutable.** Ranks, ordinals, first-blood — the whole
  point of them is that they don't change. If a rescore could renumber who was third,
  the leaderboard would be lying about the past.
- **Economics want to be tunable, live.** The right point value is not knowable up
  front. You discover it mid-event by watching the board. That means the value of an
  already-earned thing has to be able to change *after* it was earned.
- **A stored value is a snapshot that rots.** The instant you write `points: 100` into
  a row, that number is a fact about the config *at write time*, and it silently
  disagrees with the config the moment anyone touches a knob.
- **There must be exactly one writer of score.** In any real scoring model there is one
  function that owns the total. Two write paths — "accrue at event time" and "recompute
  later" — will eventually disagree about someone's number, and you won't know which is
  right.

## The pattern

For every event, store the **history** and *derive* the **value**.

```
        an event happens (a solve, a rank, a day active)
                          │
        ┌─────────────────┴──────────────────┐
        ▼                                     ▼
  FROZEN HISTORY                        DERIVED VALUE
  written once, never rewritten         never stored on the row
  ─────────────────────                 ─────────────────────
  • the ordinal (solved 3rd)            value(history, config_now)
  • the rank / first-blood                       │
  • the earliest-event anchor                    ▼
  • the raw activity rows          the ONE scoring function reads the
        │                          frozen history + CURRENT config and
        │                          re-derives the number on every rescore
        └───────────── stored ledger ───────────┘
                          │
                          ▼
             retune a cap / a curve  →  next rescore re-values
             EVERYONE. Zero rows rewritten. History untouched.
```

**1 — Admit the event; freeze only its history.** The write path's job is to *admit*
that something happened and stamp the parts that are historical: allocate the ordinal
(gap-free, atomic), record the raw rows (the solve, the check-in, the scan-day). It
does **not** write a score. A successful admit is merely the *cue* to rescore, not the
act of scoring.

**2 — Value is a pure function of frozen history plus current config.** One scoring
function takes a person's ledger rows — each carrying its frozen ordinal/rank — and the
*current* config, and returns the number. The decay curve reads the stored ordinal
against today's `pointMax`/`pointFloor`. The tier lookup reads today's tier table.
Nothing about the value is persisted on the event row; it is recomputed every time.

**3 — One writer, triggered everywhere, idempotent.** Exactly one function writes the
derived score to the user record. Every event admit — solve, scan, check-in create *or
delete*, admin award, a reconcile sweep, a bulk config-change pass — fires that one
rescore. Running it twice yields the same answer, because it is a pure re-derivation
over durable history, not a delta applied to a running total.

**4 — Whole-scope rules live in the scorer, because only it sees the whole scope.**
A cap like "count a person's *best N* awards that day" is a whole-day fact. The live,
incremental path that admits one event sees only a window — it *cannot* enforce a
whole-day cap correctly. So don't try: admit every event unconditionally, and let the
scoring function — which reads the full ledger — pick the best N and drop the rest. The
same logic applies to any total, floor, or ceiling that depends on more than the single
event in hand.

**5 — Totals-as-max, not running sums.** Some tracks are naturally expressed as a
*level*, not an accumulation. A streak that pays a table — `[0, 25, 50, 100, 500]`
indexed by distinct active days — has a total that simply *is* the table value at N
active days (four days = 500, not 25+50+100+500). Storing a running sum re-introduces
exactly the snapshot-rot this pattern removes: change the table and every stored sum is
wrong. Store the *history that indexes the table* (which days were active) and let the
scorer read the current table. The value is a lookup, never an accumulator.

## Key moves

- **The row stores what happened, never what it's worth.** This is the whole idea.
  History is durable and written once; value is a view computed on demand. Retuning
  becomes free because there is nothing to migrate — the next rescore already reads the
  new config.
- **Separate "admit" from "value."** The gates, the dedup, the ordinal allocation stay
  on the write path (they are historical facts). The arithmetic moves entirely into the
  one scoring function. A solve returns "admitted"; scoring happens elsewhere.
- **Idempotency comes from re-derivation, not bookkeeping.** Because the value is a pure
  function of durable history, "run it again" is always safe. You never track a delta,
  never clamp a floor, never reconcile a running total against reality — there is no
  running total.
- **Push every whole-scope rule into the whole-scope component.** Caps, best-N, streak
  levels — anything that needs to see more than one event — belongs in the scorer, which
  is the only thing that sees the full ledger. The incremental path stays dumb and
  therefore correct.
- **Deletes are free.** Removing a run, unsolving a flag, deleting a scan is just
  "remove the history rows and rescore." Because nothing accrued, nothing has to be
  un-accrued; the number falls out correctly from what remains.

## Traps

- **A second writer is the failure mode.** The temptation is always "just add the
  points right here where the event happens" — a `+1` on the scan path, a hardcoded
  award on some side mechanic. The moment a second code path writes score, the two can
  disagree and you're debugging phantom totals. Enforce the single writer mechanically
  (an invariant test that greps the tree — see *tests as an enforcement layer*).
- **Freezing the wrong half.** Freeze the *ordinal*, not the *value it maps to*. If you
  freeze "solved 3rd = 100 points" you've frozen the value and lost the whole benefit.
  Freeze "solved 3rd"; let 3rd-place be worth whatever the current curve says.
- **A cap enforced on the write path is silently wrong.** The incremental admitter can't
  see the rest of the day, so a "best 3 per day" cap enforced at write time will admit
  the wrong three (whichever came first, not whichever are best) and can't revise when a
  better one lands later. Enforce it in the scorer or not at all.
- **Migrations creeping back in.** If someone proposes "backfill the new value into the
  old rows," the pattern has been misunderstood — there is nothing to backfill. A config
  change is: edit config, run one bulk rescore pass. No data migration exists.

## When not to use it

- If the reward is a flat, one-shot accrual that will never be retuned and never
  deleted, storing the value on the row is simpler and fine — the re-derivation
  machinery buys you nothing.
- If there is genuinely no historical facet — nothing is ranked, nothing is "first,"
  order never matters — then there's no history to freeze; you just have a value.
- If rescoring the affected population is prohibitively expensive and config never
  changes, a cached stored value may be the pragmatic call. This pattern trades compute
  at read/rescore time for the freedom to retune; if you never retune, you're paying for
  a freedom you don't use.

## As built (defcon.run 34)

This is the sharper, general statement of the "reward as a re-valued ledger" move first
written up for one feature in
[proximity-clustering-bonus.md](./proximity-clustering-bonus.md). That essay applies
it to a single retroactive group bonus; here it is the whole scoring model.

- **Design spec:** `docs/superpowers/specs/2026-07-30-points-consistency-design.md` —
  "split admitting an event from valuing the ledger"; solve ordinals stay frozen ("who
  solved 3rd is history"), solve values are recomputed from the stored ordinal against
  current config; streak tracks use total-by-streak semantics (the table value *is* the
  total); the per-day cap and best-N live in the scorer, not the write path.
- **The one scoring function:** `apps/run.human/webapp/src/lib/scoring-engine.ts`
  (`computeUserScore(events, config)` — pure; the ordinal-decay `computePoints` lives
  here).
- **The one writer:** `apps/run.human/webapp/src/lib/rescore.ts` (`rescoreUser` — the
  only path that writes `RunUser` score fields; fired from every event admit, delete,
  admin action, and the bulk `rescore-all` config-change pass).
- Realized on a single-table key-value store: the judge admits events and freezes solve
  ordinals; scoring re-derives every affected user on their next rescore.
