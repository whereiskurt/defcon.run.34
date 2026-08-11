# Observed least-privilege IAM

**Don't hand-author the permissions for a broad automation role — capture them
from the actual API calls the automation makes (a one-shot capture of a full
apply for the baseline, plus audit logs and access-analysis for ongoing drift),
generate the policy from that observation, and split it across several themed
managed policies because a real generated policy overflows the inline-per-role
size limit — and deploy the audit trail first, so the very first apply is itself
captured.**

## Context

You have an automation identity — a CI role that runs your infrastructure
apply, a deploy role, a broad service principal — and right now it holds
something like full-administrator access, because nobody wanted to guess the
exact permission set and get blocked mid-deploy. You want to tighten it to
least privilege.

The obvious approach is to sit down and hand-write the policy: think through
every resource the automation touches, look up the action names, assemble the
JSON. This is miserable and wrong in both directions at once. You will forget
actions the tool calls only on create, or only on destroy, or only on a tag
change — and the role breaks at the worst moment, mid-apply, with a cryptic
`AccessDenied`. And you will over-grant "just in case," reintroducing the breadth
you set out to remove. Guessing at a permission set for a tool that makes
hundreds of distinct API calls is a losing game.

## Forces

- **The ground truth is the API calls, not your mental model.** The only reliable
  source of what an automation needs is what it *actually calls* — and that
  includes calls that fire only on rarely-hit code paths (a first-time create, a
  delete, a re-tag). No human enumerates those correctly from memory.
- **Missing one action breaks the whole run.** Unlike over-granting (silent), an
  under-grant fails loudly and late — a denied action can abort an apply
  half-complete. The cost of a false negative is a broken deploy; you need the
  capture to be exhaustive.
- **Coverage needs two clocks.** A single full run captures the create-path
  permissions but not the steady-state ones (updates, deletes, the actions that
  only appear on the tenth deploy). You need a one-shot baseline *and* a
  continuous observation to catch drift.
- **Real generated policies are big — and there's a hard size cap.** Inline
  policies attached to a role share a combined size limit (on AWS, ~10KB per
  role). A genuinely complete permission set for a broad apply role blows past
  it. You physically cannot attach it as one inline policy.
- **The trail has to exist before the thing you want to watch runs.** If you turn
  on audit logging *after* the first big apply, you never captured the apply you
  most wanted to see. The observer must be deployed first.

## The pattern

Turn least-privilege from an authoring problem into an **observation pipeline**:
run the automation, watch what it calls, generate the policy from the
observation, and split the result to fit the platform's limits.

```
  1. DEPLOY THE TRAIL FIRST  ── audit log is a dependency of everything else
             │
  2. CAPTURE two ways:
       one-shot: run a full apply under a call-recorder ──► baseline policy
       ongoing:  audit log + access-analyzer over 30+ days ──► drift/refinement
             │
  3. GENERATE the policy from captured calls (not from memory)
             │
  4. SPLIT it — one big inline policy won't fit the per-role cap ──►
       several themed customer-managed policies (core / compute / storage / network)
       attached separately
```

**1 — Deploy the audit trail first, as a dependency of everything else.** The
trail that records API activity is set up as an upstream dependency of the rest
of the infrastructure, so that the first apply of everything downstream is itself
recorded. You cannot generate a policy from calls you didn't capture.

**2 — Capture two ways.** For the **baseline**, run a full apply (and a
read-only plan) under a request recorder that watches the calls the tool makes
and emits a policy for exactly those actions. For **ongoing refinement**, let the
audit log accumulate over weeks of real runs and use an access-analyzer to
generate a policy from observed activity — this catches the actions the one-shot
missed (deletes, updates, occasional paths) and flags drift as the infrastructure
grows. The recommended posture is both: the one-shot gives you something to
deploy now; the log-plus-analyzer keeps it honest over time.

**3 — Generate, don't author.** The policy is output, not input. You review and
scope it (tighten `Resource` from `*` where you can), but the action lists come
from observation.

**4 — Split to fit the cap.** Because the full generated set overflows the
combined inline-policy-per-role limit, break it into a handful of themed
**customer-managed** policies — grouped by domain (state/IAM *core*, *compute*,
*storage*, *network*) — each comfortably under the per-policy limit, attached to
the role separately. Managed policies have a larger combined budget than inline,
so several themed ones fit where one inline blob cannot.

## Key moves

- **Make the calls the source of truth.** The whole point is that you stop
  guessing. If a permission is in the policy, it's because something called it; if
  the automation calls something, the capture caught it. Memory and intuition are
  demoted to *reviewing* the output, not producing it.
- **Observe on two clocks.** One-shot capture for the baseline you can ship
  today; audit-log-plus-analyzer for the long tail and for drift. Neither alone is
  complete — the one-shot misses steady-state actions, the log needs weeks to
  accumulate.
- **Bootstrap the observer first.** The audit trail is a dependency of the rest,
  so nothing downstream applies before it's watching. This ordering is the only
  way the first — and most interesting — apply gets captured.
- **Split by theme to beat the size cap.** Don't fight the inline limit; route
  around it with several customer-managed policies grouped by service domain. The
  split is also more readable than one giant blob.
- **Keep refining as the surface grows.** New infrastructure means new API calls.
  The analyzer over the ongoing log is what tells you the policy has fallen behind
  reality — treat least-privilege as a maintained artifact, not a one-time
  tightening.

## Traps

- **Turning on the trail too late.** Deploy the recorder *after* the first big
  apply and you've missed exactly the run you wanted. Make the trail an explicit
  upstream dependency so it can't be ordered after the thing it observes.
- **Baselining only the create path.** A single fresh apply exercises creates,
  not updates or deletes. Ship that as a start, but expect `AccessDenied` on the
  first destroy or re-tag until the ongoing capture fills in the steady-state
  actions.
- **Trying to cram it inline.** Discovering the per-role inline cap mid-migration
  is a nasty surprise. Plan for managed policies from the outset once you know the
  set is non-trivial — a real apply role's permissions do not fit inline.
- **Over-scoping `Resource` back to breadth.** Generation gives you the *actions*;
  many will come out as `Resource: "*"`. Tighten the ones you safely can (state
  buckets, your own ARprefix) so you don't quietly recreate admin-by-wildcard.
- **Validating against the wrong thing.** A generated policy that looks right in
  isolation can still deny in context. Confirm it against a real run of the
  automation, not just a syntax check.

## When not to use it

- If the role is narrow and stable — a handful of actions on one resource — just
  hand-write it. The observation pipeline is for broad automation identities whose
  action set is large and evolving.
- If you have no way to record API calls (no audit trail, no request recorder),
  you can't observe, and this pattern doesn't apply — though standing that up is
  usually worth it before tightening a broad role.
- If the automation is genuinely ephemeral and never re-run, the ongoing-drift
  half is wasted; a one-shot capture may be all you need.

## As built (defcon.run 34)

- **The observer, deployed first:**
  `infra/terraform/modules/cloudtrail/README.md` — CloudTrail "records all AWS
  API activity to enable least-privilege policy generation," is "already set as
  dependency for other modules," and documents both capture paths: a one-shot
  `iamlive` run wrapping `terragrunt run-all apply` for the baseline, and
  CloudTrail + Access Analyzer over 30+ days for ongoing refinement (the README
  calls the combination "Recommended").
- **The size limit and the split:**
  `infra/terraform/modules/github-oidc/POLICY_REFERENCE.md` — "AWS inline
  policies have a **10KB combined limit per role**. The terragrunt role needs
  ~15KB+ of permissions, so we must use **customer-managed policies** instead."
  The generated set is split into four themed managed policies — `tg-core`
  (state/KMS/STS/DynamoDB/IAM), `tg-compute` (EC2/ECS/ECR/ELB/Lambda),
  `tg-storage` (S3/CloudWatch/SSM/SNS), `tg-network`
  (CloudFront/Route53/ACM/WAF/…) — each generated "via iamlive from actual
  terragrunt apply operations."
- **The mechanism that attaches them:**
  `infra/terraform/modules/github-oidc/v1.0.0/main.tf` — the module supports
  `managed_policies` (per role, "6KB each, up to 20 per role") alongside
  `inline_policies` ("10KB combined limit per role"), creating an
  `aws_iam_policy` per themed policy and attaching each separately. Role set
  configured in `infra/terraform/modules/github-oidc/config.hcl`.
