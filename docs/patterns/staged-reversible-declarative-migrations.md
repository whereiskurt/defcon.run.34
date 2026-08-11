# Staged, reversible declarative migrations

**Do risky state migrations as a sequence of small, always-reversible, zero-diff
steps expressed purely in declarative configuration — keep the old thing defined
until nothing references it, cut over through an off/canary/on switch driven by
one config file, and leave an inert expansion seam behind — so every step is
independently reviewable and every step can be rolled back by editing config,
never by a manual repair.**

## Context

You need to change infrastructure that a declarative tool (Terraform, or any
"desired-state" system) already manages and has already applied. The change is
risky: you want to delete a resource the provider won't let go of while it's in
use, or flip production traffic onto a new origin, or collapse multi-region
machinery down to one region. The tempting move is a single big commit that
declares the new world and applies it — the tool computes the diff and does it
all at once.

That big-bang apply is where declarative migrations go wrong. The plan is large
and hard to review; the apply is hard to reverse (the old resources are gone from
the config, so "roll back" means re-authoring them under pressure); and a partial
failure leaves you in a state that matches neither the old config nor the new.
The declarative tool gave you a superpower — every desired state is expressed as
reviewable text — and the big-bang throws it away.

## Forces

- **Providers refuse to delete in-use resources.** A function still associated
  with a distribution, a target group still attached to a listener — the API
  returns a conflict mid-apply. You cannot "declare it gone" in one step if
  something still points at it.
- **A big diff is an unreviewable diff.** When one plan creates, retargets, and
  destroys at once, the reviewer can't tell the load-bearing change from the
  incidental churn. Small diffs get real review.
- **Rollback must be as declarative as rollout.** If the old path is deleted from
  config, reverting means re-authoring it while production is degraded — the worst
  time to write new code. The old path must survive in config, dormant, so
  rollback is a flag flip.
- **Ordering can be load-bearing.** Some cutovers depend on the *order* rules are
  evaluated (first-match routing). A canary authored *after* the wildcard it means
  to override never fires — the config's order is part of its meaning. And a
  migration's expansion seam should exist structurally but cost nothing at rest.

## The pattern

Express the migration as a series of steps, each of which is a small config edit
that either produces a **zero diff** (proving it's safe) or a single reviewable
change, and each of which is **reversible by editing config**. Three techniques
recur.

**(a) Two-phase detach-then-destroy** — for a resource the provider won't delete
while in use.

```
  step 1 (cutover commit):  keep OLD resource defined, BYTE-FOR-BYTE identical
                            (tool issues NO change to it)
                            + remove the ASSOCIATION that points at it
                            + point the association at the NEW resource
  step 2 (later commit):    now nothing references OLD → delete its definition
```

The non-obvious move is step 1's "keep it defined but unassociated." If you
delete the old resource's definition in the same commit that removes its
association, the tool tries to `Delete` a resource the provider still considers
in-use (association removal and deletion race), and the apply fails with a
conflict. By keeping the definition **identical** — same name, same body — the
tool computes *no change* to the resource itself; only the association moves.
Once a later plan confirms nothing references it, deleting the definition is
clean.

**(b) Three-state cutover: off / canary / on** — driven by one config file.

```
  origins = {
    app = { dns = "...", state = "off" }   # off | canary | on
  }
```

- **off** — the new origin is *defined* but nothing targets it. Inert. Zero
  traffic.
- **canary** — one exact-path behavior routes a single low-stakes path (a health
  check) to the new origin. **This exact-path rule must be authored BEFORE the
  wildcard** it carves out of — first-match routing means order is the mechanism,
  not decoration. All other traffic stays on the old path.
- **on** — the app-traffic behaviors retarget to the new origin. Static-asset and
  other behaviors can deliberately stay on the direct/old path.

The **old/direct path is never deleted from config** — flipping `state` back to
`canary` or `off` is the entire rollback. An **empty or absent config yields a
zero-diff plan**, so the machinery can land dark and be exercised by the planner
before it ever carries traffic.

**(c) Auto-simplify at N=1 with a pre-wired-but-inert seam** — a live module
drops expensive machinery on a degenerate deploy while leaving the seam for the
general case wired but costless.

```
  geo_enabled = var.geo_enabled != null ? var.geo_enabled
              : length(served_regions) > 1     # N=1 ⇒ false, cheap static path
  country_region_map = {}                       # the multi-region seam, empty ⇒ costs nothing
```

On a single-region deploy the module skips the geo lookup and the sticky-cookie
function entirely — everything routes to the one region via a static prefix. The
multi-region seam still *exists* (the geo map, the cookie function's `count`) but
defaults empty/zero, so it costs nothing until a second region un-skips and
someone populates the map. The expansion is a data edit, not a re-architecture.

## Key moves

- **Zero-diff is the proof of safety.** Structure each step so the plan for the
  parts you aren't changing is empty. A byte-identical old resource, an empty
  config, a `state = "off"` origin — each produces "no changes," which is the
  reviewable evidence that the step is inert where it should be.
- **Keep the old path defined until nothing points at it.** Both (a) and (b) rely
  on the same discipline: the thing you're migrating away from stays in config,
  dormant, so rollback is a flag/association flip rather than a re-authoring
  scramble. Delete it only in a later commit, once a plan confirms it's orphaned.
- **Author canaries before the wildcard they override.** Where routing is
  first-match, the position of a rule in the config *is* its behavior. The
  exact-path canary must precede the broad pattern, or it silently never
  triggers.
- **Default the seam to empty/inert, and drive it from one config file.** An
  expansion seam earns its place only if it costs nothing at rest — default the
  map to `{}`, the optional function's `count` to `0`, the new state to `off`.
  Driving the whole cutover from a single data file keeps the migration's state in
  one reviewable place and one revert.

## Traps

- **Deleting the old resource in the cutover commit.** The classic failure: you
  remove the association *and* the definition together, the provider still sees
  the resource as in-use, and the apply dies on a delete conflict. Split it —
  detach now (definition untouched), destroy later.
- **Canary authored after the wildcard.** The rule is present, the plan applies
  clean, and it still does nothing because a broader pattern matched first. Verify
  order, not just presence. (And if flipping back means re-authoring the old
  config, you built two forward migrations, not a reversible one — the old path
  must persist in config the whole time.)
- **A seam that quietly costs money.** "Pre-wired for multi-region" is only free
  if the inert branch provisions nothing. A cookie function created with
  `count = 1` on a single-region deploy is billed edge compute for a feature
  nobody uses. Gate it on the same condition that turns the machinery on.
- **Assuming CI-green means rolled.** The declarative tool reporting success is
  not proof the new path is serving — rolling replaces drain, caches persist.
  Verify the live behavior after each step.

## When not to use it

- If the resource isn't stateful or in-use — nothing references it, nothing is
  live — just change it. The staging machinery is overhead for a greenfield
  apply.
- If the migration is genuinely atomic and cheap to reverse (a single tag, a
  single scalar with a trivial revert), one commit is fine. Stage the ones that
  are risky, large, or hard to undo.
- If you'll only ever run one region and never expand, the N=1 seam is dead
  weight — collapse fully and skip the seam. (The seam pays off precisely when
  expansion is plausible-but-not-imminent.)

## As built (defcon.run 34)

- **(a) Detach-then-destroy:**
  `infra/terraform/modules/cloudfront-redirect/v1.0.0/main.tf` (~lines 83–109) —
  the legacy edge-redirect `aws_cloudfront_function.redirect` resources are kept
  defined "with byte-identical code, so terraform makes NO change to them" but
  deliberately unassociated as the distributions move to the S3 origin, "so the
  switch … removes the association without terraform ever issuing DeleteFunction
  on an in-use function (CloudFront returns 409 for that)."
- **(b) Off/canary/on cutover:**
  `docs/superpowers/specs/2026-07-21-impart-cloudfront-origins-design.md` — one
  `impart.hcl` config with a per-origin `state = off | canary | on`; the canary is
  "one exact-path `ordered_cache_behavior` … authored **before** the `/{region}/*`
  wildcard blocks … this ordering is load-bearing"; the direct ALB path is never
  removed (rollback = flip `state`); "empty/absent config ⇒ zero plan diff."
- **(c) Auto-simplify with an inert seam:**
  `infra/terraform/modules/cloudfront-region-prefix/v1.0.0/main.tf` +
  `README.md` — `geo_enabled` defaults to `length(served_regions) > 1`, so a
  single-region deploy drops the geo lookup and the viewer-response cookie
  function (its `count` resolves to 0), and `country_region_map` defaults to `{}`
  — "the **geo seam** … Populate it … when cac1/apse1 actually serve." The
  multi-region seam exists but costs nothing until a region un-skips.
