# Dark-launch infrastructure

**Land complex infrastructure modules on the main branch fully written and
reviewed but deliberately unreachable — gated off, un-instantiated, or entirely
commented out — so the "does this code make sense" review is decoupled from the
"does applying it break production" apply, and turning it on later is one small,
deliberate diff.**

## Context

You are building infrastructure as code, and the next feature is a non-trivial
module: a resolver service, an abuse-detection pipeline, a new edge behavior, a
whole third-party provider integration. It is several hundred lines across
several resources. You want it reviewed — the naming, the IAM, the wiring, the
shape — while it is fresh and while the reviewer has context. But you do *not*
want to apply it yet: maybe a decision upstream isn't final, maybe the thing it
depends on doesn't exist, maybe you simply want to land it in small safe steps
instead of one big-bang apply.

The naive options are both bad. Keep it on a long-lived branch and it rots,
drifts from main, and accumulates merge conflicts while it waits — and the
review, when it finally comes, is one giant blast. Merge it wired-and-live and
you have coupled "is this code good?" to "did applying this break prod?" — the
two questions that most want to be answered separately.

## Forces

- **Review wants the code on main; apply doesn't.** A module reviewed months
  after it was written, or reviewed as one enormous merge, gets a worse review.
  Code review is cheapest when the author still has the context loaded and the
  diff is small. Applying, by contrast, is riskiest exactly when you rush it.
- **Long-lived branches rot.** Infrastructure that lives unmerged drifts from
  the trunk it will eventually apply against. Every day it waits, the eventual
  apply gets less predictable.
- **The plan/apply pipeline touches everything on the branch.** In most IaC
  setups, CI runs `plan` (and sometimes `apply`) across the live configuration
  on every merge. Anything reachable from a live unit is in that blast radius —
  so "merged" and "applied" are nearly the same event unless you engineer them
  apart.
- **Cost at rest must be zero.** A dark-launched module that still provisions a
  load balancer or a running function is not dark — it is live and expensive.
  The whole point is that unreached code costs nothing.

## The pattern

Merge the module to main **fully authored and reviewed**, but arrange for the
apply pipeline to provably never touch it. There are three levels of "dark,"
from lightest to heaviest, chosen by how close the thing is to going live.

```
   authored & reviewed on main
              │
   ┌──────────┼───────────────────────┐
   ▼          ▼                        ▼
 GATED     NOT WIRED               SCAFFOLD
 flag=false no live/instantiating   provider block +
 (module     unit references it     every resource
  applies,   (module exists,        commented out
  resources  nothing calls it)      (nothing plans
  count 0)                           at all)
              │
   turning on = ONE small deliberate diff
```

**1 — Gated off.** The module is instantiated by a live unit, but every resource
hangs off an `enabled` / `schedule_enabled` flag that defaults **false**, so
`count`/`for_each` resolves to zero resources. The plan is clean (no changes),
cost is zero, and the code has been exercised by the planner enough to prove it
parses and wires. Going live is flipping one boolean.

**2 — Not wired.** The module exists in the module library, fully written, but
**no live/instantiating unit references it** — there is no `terragrunt.hcl`, no
`module {}` block, nothing that would make the planner reach it. CI's plan/apply
literally cannot see it because nothing points at it. Going live is authoring the
one small live unit that instantiates it.

**3 — Provider scaffold, resources commented out.** For a whole new
provider/integration, land the `required_providers` and `provider` block (so the
shape and version are reviewed) with **every resource commented out**, plus a
header explaining what the live resources will be and how they get imported.
Nothing plans; the file is documentation-with-teeth. Going live is uncommenting,
in the order the header prescribes.

**The load-bearing move is the same at every level: the module header states
plainly what state it is in.** A one-paragraph banner — "authored for review,
NOT wired, NOT applied" — at the top of the README or `main.tf` tells the next
reader (and the next planner run, and the future you) that unreachability is
*intentional*, not an oversight. Without that banner, a dark module looks
exactly like a half-finished one, and someone eventually "fixes" it by wiring it
up before its preconditions are met.

## Key moves

- **State the darkness out loud.** The header banner ("authored for review, NOT
  wired, NOT applied") is not optional garnish — it is the thing that stops
  someone from prematurely lighting the module. Say what state it is in and what
  must be true before it goes live.
- **Pick the lightest level that still costs zero.** Gate-off when the module is
  one decision away from live and you want the planner to keep exercising it.
  Leave it un-wired when the thing it depends on doesn't exist yet. Comment it
  out entirely when even declaring the resources would require credentials or
  imports you don't have.
- **Default the flag to the safe value.** `enabled = false` by default means the
  dangerous state is opt-in and the diff to reach it is visible in review. Never
  default a gate to the state that provisions cost.
- **Write the "wiring it later" recipe now.** In the same header, list the exact
  steps to go live — which unit to author, which inputs to pass, what to confirm
  first. The author has that knowledge now; the person who lights it may not.
- **Keep the enable diff small and boring.** The payoff is that turning the
  feature on is a reviewable one- or few-line change against code that has
  already been read once. Don't smuggle new logic into the enable commit.

## Traps

- **Dark and half-finished look identical without the banner.** The single most
  common failure is a well-meaning contributor who sees an un-wired module and
  wires it up, applying preconditions-unmet infrastructure. The banner and the
  "wiring it later" recipe are the guardrail.
- **A gate that still costs money isn't dark.** Double-check that `enabled=false`
  actually zeroes the *billable* resources, not just the cosmetic ones. A
  standing load balancer, a running function, or a provisioned database behind a
  gate that only hides a DNS record is live infrastructure wearing a disguise.
- **Commented-out resources drift from the provider's real schema.** A scaffold
  that sits commented for months can reference resource arguments the provider
  has since renamed. Treat the uncomment as a real edit that gets a real plan and
  review, not a mechanical "remove the `#`."
- **Validation must not require the live wiring.** If you sanity-check a not-yet-
  wired module, do it with a scoped plan against a real dependency, not a bare
  syntax check — the provider/dependency issues that a dark module most needs to
  catch only surface once the generated provider config and dependency wiring are
  in play.

## When not to use it

- If the module is small and its preconditions already hold, just wire it and
  apply it. Dark-launching a two-resource change is ceremony.
- If the apply genuinely cannot be separated from the merge in your pipeline —
  e.g. every merge auto-applies everything and there is no gate mechanism — then
  the "not wired" level is your only lever, and even that only works if nothing
  references the module.
- If nobody will read the banner (no review culture, no header convention), the
  pattern's guardrail is missing and a dark module is just a landmine. Fix the
  convention first.

## As built (defcon.run 34)

All three levels shipped this year, each with the explicit banner:

- **Gated off:** `infra/terraform/modules/abuse-detection/v1.0.0/README.md`
  ("**Ships dark.** … `schedule_enabled` defaults to `false`") — the Athena
  detections land applied-but-inert, enabled deliberately after a manual query
  confirms the log schema parses.
- **Not wired:** `infra/terraform/modules/qr-resolver/v1.0.0/README.md`
  ("**Status: authored for review, NOT wired to a live unit, NOT applied.**") —
  there is no `.../qr-resolver/terragrunt.hcl`, so CI's plan/apply never touches
  it; the README carries a numbered "Wiring it later" recipe. Same posture in
  `infra/terraform/modules/cloudfront-region-prefix/v1.0.0/README.md`
  ("authored for review, NOT wired to any live unit, NOT applied").
- **Provider scaffold, commented out:**
  `infra/terraform/modules/impart/v1.0.0/main.tf` — the `impart` provider block
  is live for review while every `impart_spec` / `impart_api_binding` /
  `impart_rule` resource stays commented until the console-created bindings are
  exported and `terraform import`ed. The header reads "INERT until the … exclude
  gate … is flipped to true."
