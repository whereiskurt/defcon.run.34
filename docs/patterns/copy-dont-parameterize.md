# Copy, don't parameterize (stateful IaC)

**When you need a second instance of an existing infrastructure module but the
module hardcodes names, fork it into a structural copy rather than generalizing
it behind a new variable — because in stateful IaC, generalizing forces a new
module version that re-plans every already-applied live unit, dragging unrelated
production resources into the blast radius of your new feature.**

## Context

You have an infrastructure module that already works and is already applied in
production — say, a scheduler that pokes a service on a cron, or a small
compute-plus-IAM bundle. Now you need a *second* one just like it, pointed at a
different endpoint, doing a parallel job. The two are 90% identical.

Every instinct trained on application code says: don't repeat yourself.
Generalize the module — pull the hardcoded name into a `name` variable, add the
one field that differs, and instantiate it twice. One module, two callers, no
duplication. In application code that is usually right.

In stateful infrastructure as code it can be a quiet mistake, because the module
is not just *code* — it is bound to **live, applied state**. "Reuse" here does
not mean "call the same function twice." It means "re-plan everything that
already instantiated this module," and that changes the risk calculus entirely.

## Forces

- **A module version is pinned to live state.** Every live unit that uses
  `.../mymodule/v1.0.0` has real, applied resources tracked in state against that
  exact source. The module isn't an abstraction floating free of the world — it
  has physical instances running in production.
- **Generalizing forces a new version.** To add a variable without disturbing
  existing callers, you cut a new version (`v1.1.0`/`v1.2.0`) and the module
  library now has two. But the moment an existing caller adopts the generalized
  version — or the generalization changes resource *addresses* (a renamed local,
  a `for_each` where there was a single resource) — every already-applied unit of
  that module re-plans.
- **Re-planning applied resources widens the blast radius.** A plan that touches
  a running production Lambda, load balancer, or database — even to make a
  "no-op" refactor — puts that resource one `apply` away from a change you didn't
  intend for it. The reviewer of your *new feature* is now also reviewing a diff
  against an *unrelated live service*.
- **Duplication is cheap; coupled blast radii are not.** A forked copy is a few
  hundred lines that will drift a little over time. A shared module couples the
  fates of everything that instantiates it: a bug or a rename in the shared code
  can force-replace resources across every consumer at once.

## The pattern

When you need a second near-identical instance of a **stateful, already-applied**
module, **fork it** — make a structural copy with its own local names — instead
of generalizing the original behind a new variable.

```
  GENERALIZE (DRY reflex)          FORK (boring, safe)
  ─────────────────────            ───────────────────
  mod/v1.0.0  ──used by──► unit A   mod/v1.0.0 ──► unit A   (untouched, 0 diff)
     │  add var, cut v1.1.0
     ▼
  mod/v1.1.0  ──used by──► unit A?  new-mod/v1.0.0 ──► unit B (new)
     └── unit B (new)
         ▲
   unit A re-plans if it adopts     unit A never re-plans;
   v1.1.0 or if addresses shift     zero blast radius on it
```

The fork is a **structural copy**: same shape, new module directory, new `local`
names so nothing collides, the one differing value baked in. The original module
and its live unit are **not touched** — their plan stays empty, their state
untouched, their resources unmoved. The new feature ships entirely inside new
files.

This deliberately **inverts the usual DRY reflex, and only for stateful IaC.**
The duplication is the feature, not the debt: it is what guarantees a zero diff
on the running unit. You are trading a little copied code (cheap, local,
reviewable) for the elimination of coupling between two production resources'
blast radii (expensive, non-local, invisible until it bites).

## Key moves

- **Name the real cost before you DRY.** The question is not "is this code
  duplicated?" but "if I share this, what applied resources get re-planned, and
  do I want them in this feature's blast radius?" If the answer is any live
  resource you didn't set out to change, copy.
- **Fork with fresh local names.** The copy needs its own resource names/locals
  so a second instance can't collide with the original — a scheduler forked from
  `foo-${region}` becomes `bar-${region}`, not a second unit of the same name.
- **Leave the original byte-untouched.** The whole payoff evaporates if you
  "tidy" the source module while copying. Don't. The empty plan on the existing
  unit is the deliverable.
- **Write down that the copy is deliberate.** A header comment — "DELIBERATE
  COPY, NOT A SHARED MODULE, because generalizing would re-plan live unit X" —
  stops a future reader from "de-duplicating" the two back together and
  reintroducing the coupling you paid to avoid.
- **Reconsider only when the shared abstraction is genuinely stable.** If a third
  and fourth instance appear and the shape has stopped changing, a shared module
  may finally earn its keep — but do that as its own migration with its own
  blast-radius review, not as a side effect of adding instance number two.

## Traps

- **A "pure refactor" that renames resource addresses is not pure.** Moving a
  single resource into a `for_each`, or renaming a `local` that feeds a resource
  name, changes the address the state tracks — and IaC reads that as destroy-and-
  recreate unless you also author state `moved`/`import` blocks. Generalization
  frequently does exactly this. Copying never does.
- **The coupling is invisible in the diff.** The dangerous part of sharing isn't
  in the PR that adds the variable — it's in the *next* plan of the *other*
  consumer, which now runs against changed source. Reviewers of the feature PR
  never see it. This is precisely why "it's just one variable" is a trap.
- **Forks drift silently.** The cost of copying is real: a bug fixed in one copy
  isn't fixed in the other. Mitigate by keeping the copies close in the tree and
  cross-referencing them in comments, so a fix to one prompts a look at the
  other.
- **Don't over-apply the inversion.** This is a rule *for stateful IaC*, not a
  license to copy-paste application code. In stateless code, the blast radius of
  a shared function is a test suite, not a production database — there, DRY still
  wins.

## When not to use it

- If the module is **not yet applied anywhere** — no live state to protect — then
  generalizing is free and DRY wins. The pattern is specifically about modules
  with running instances.
- If the second instance will differ in many dimensions over time, a copy that
  has to track a dozen future changes in two places may cost more than a
  well-factored shared module. Weigh the drift.
- If your IaC has first-class, well-tested state-move tooling and you are
  disciplined about authoring `moved` blocks, a careful generalization can keep
  the diff empty too — but that is more machinery and more review than a copy,
  for the same result.

## As built (defcon.run 34)

- **The fork:** `infra/terraform/modules/heatmap-scheduler/v1.0.0/main.tf`
  (header comment, ~lines 1–13). The heat-map scheduler is a structural copy of
  the Strava-sync scheduler, chosen explicitly over generalization: the header
  reads "DELIBERATE COPY, NOT A SHARED MODULE. This is a structural copy of
  strava-sync-scheduler v1.1.0 … because that module hardcodes `function_name =
  "strava-sync-${var.region.label}"` … The alternative (generalising … behind a
  `function_basename` variable in a new v1.2.0) would make every future heat-map
  change re-plan a live, applied Strava Lambda. Copying has zero blast radius on
  that unit, which is the boring option AGENTS.md asks for."
- **The original, left untouched:**
  `infra/terraform/modules/strava-sync-scheduler/v1.1.0/main.tf` — same shape,
  `function_name = "strava-sync-${var.region.label}"`, never re-planned by the
  heat-map work. The two files sit side by side in the module tree so a fix to
  one prompts a look at the other.
