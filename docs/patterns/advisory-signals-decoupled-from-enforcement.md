# Advisory signals, decoupled from enforcement

**Cheap heuristics should surface candidates for a human to look at — and nothing
more. No signal auto-hides or auto-deletes, and no signal feeds the production
artifact. The detector output and the enforcement path are separated by design, and
you test that a signal fires on its trigger case AND stays silent on an ordinary
one, because a heuristic that flags everything is worse than none.**

## Context

You have a moderation surface: a queue of user-generated things — runs, posts,
uploads, tracks — some tiny fraction of which are abuse. The abuse is often a
*shape* a human recognizes instantly and a machine recognizes poorly: a track drawn
to spell a word, a subtly-off submission, a pattern that's obvious to an eye and
ambiguous to a rule. Reviewing everything by hand doesn't scale; you want cheap
signals to point the reviewer at the odd ones.

The reflex is to wire the detector straight to an action: flag it, so hide it; score
it high, so delete it. That reflex is the mistake. Heuristics are wrong often enough
that automatic enforcement turns a helpful hint into a censorship bug, and once a
signal can *act*, the pressure to also let it *shape the output* follows close
behind — and now your detector's false positives are silently corrupting the thing
users actually see.

## Forces

- **Heuristics are advisory by nature.** A cheap geometric or statistical rule catches
  the obvious cases and mislabels the edges. That's fine for "worth a look" and
  disqualifying for "take an action."
- **A detector that flags everything is worse than none.** If the signal fires on
  ordinary content too, the reviewer learns to ignore it, and you've spent complexity to
  make the queue noisier. Precision on the *negative* case is what makes a signal useful.
- **Enforcement is irreversible enough to demand a human.** Hiding or deleting someone's
  content on a machine's say-so is a trust failure when the machine is wrong — and it
  will be wrong.
- **The production artifact must stay clean of detector influence.** If a signal feeds the
  published output — even indirectly — its errors leak into what everyone sees, and the
  output stops being a faithful representation of the underlying data.

## The pattern

Draw a hard line between *surfacing* and *acting*. Detectors sit entirely on the
advisory side of it.

```
   user content
        │
        ├───────────────▶  PRODUCTION ARTIFACT   (never sees any signal)
        │
        ▼
   DETECTORS (cheap heuristics)
        │  emit signals: "worth a look"
        ▼
   HUMAN REVIEW QUEUE  ──human decides──▶  ENFORCEMENT (hide / delete)
        ▲                                        │
        └──── the ONLY path to an action ────────┘
```

- **Signals are prompts to look, never actions.** A signal decorates a review row so a
  human's eye lands on the right candidates faster. It never hides, deletes, or
  down-ranks anything on its own.
- **No signal feeds the production artifact.** The detector output lives strictly on the
  moderation side of the boundary. Whatever users see is built from the data directly,
  untouched by any heuristic — so a false positive can annoy a reviewer but can never
  alter the public result.
- **Prior sanction state is the strongest prior — still advisory.** A submission from an
  already-locked or already-jailed account is the single best "worth looking" hint you
  have. Surface it as exactly that: a strong prior, not an automatic action.
- **Give the reviewer what a machine can't judge.** Put the actual shape, the real
  identity, the raw payload next to the button that acts on it — so the human decision is
  informed, and the machine's job ends at pointing.

## Key moves

- **Separate the detector from the enforcement path by construction.** The signal has no
  code path to an action. The only path runs through a human. This is a structural
  property, not a policy you remember to follow.
- **Keep the artifact signal-free.** State plainly, in the design, that the published
  output's selection is untouched by any signal. "What this does not change" is as
  important as what it does.
- **Test the negative case, not just the positive.** For every signal, assert it fires on
  its trigger AND does *not* fire on an ordinary case. The false-positive test is the one
  that keeps the signal worth having; without it, a signal that flags everything ships
  looking healthy.
- **Rank by prior, act by hand.** Sanction history sorts the queue; it doesn't empty it.
- **Distinguish "absent" from "failed."** A missing datum ("not in this cached snapshot")
  must read differently to the reviewer than a real negative ("this doesn't exist"), or the
  reviewer will draw a false conclusion the machine never claimed.

## Traps

- **Wiring a high score straight to an auto-hide.** The whole pattern exists to resist this
  one reflex. A heuristic confident enough to look is rarely confident enough to act.
- **Letting a signal quietly influence the output.** Even a soft down-rank of "suspicious"
  content in the public artifact re-introduces the detector's errors where everyone sees
  them. Keep the boundary absolute.
- **Shipping a signal with only a positive test.** It'll pass, look done, and flag half the
  ordinary content in production. The negative-case test is not optional.
- **Treating prior sanction as proof.** A locked account's new submission is worth looking at
  first — it is not automatically guilty. Keep it advisory.
- **Silent partial failure blinding the reviewer.** One unreadable item should degrade to a
  marked gap on that row, not fail the whole review surface — the reviewer needs to see the
  rest, and needs to know that one is missing.

## When not to use it

- If the abuse is *crisp* — an exact-match rule with negligible false positives — automated
  enforcement may be correct, and the human-in-the-loop is pure latency. (This is the
  opposite regime from the automated, subtract-only, fail-closed abuse gates in
  [proximity clustering bonus](./proximity-clustering-bonus.md): those act automatically
  *because* they only ever remove value and can't wrongly punish; the advisory pattern here
  is for detectors whose errors would.)
- If volume is small enough to review everything by eye, signals are overhead — just look.
- If a signal genuinely can't produce a clean negative case (it fires on too much ordinary
  content), don't ship it; a signal that flags everything is worse than none.

## As built (defcon.run 34)

- **Design spec:** `docs/superpowers/specs/2026-08-07-heatmap-admin-shapes-design.md` — the
  moderation surface renders each run's real shape next to the Delete button, with cheap
  geometric Signals (`drawn-in-place`, `teleport`, `off-site`, `fast`, `no-gps`) declared as
  "a prompt to look, never an action"; the "What this does not change" section pins that the
  published artifact stays non-attributable and its selection is untouched by any signal; the
  test plan requires each signal to fire on its trigger case AND not fire on an ordinary
  Vegas run; and prior lockout/jail state is surfaced as the strongest "worth looking" prior
  while remaining advisory. A missing Strava payload is explicitly reported as "not in this
  snapshot" rather than "does not exist."
- Contrast with the automated subtract-only gates in
  [proximity clustering bonus](./proximity-clustering-bonus.md): that pattern lets a detector
  act because it can only ever remove value; this one keeps the detector's hands off the
  action because its errors would wrongly punish.
- Realized on an admin-gated read surface over object-store geometry and a local profile
  store, with the pure signal logic isolated and unit-tested.
