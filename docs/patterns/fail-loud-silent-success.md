# Fail loud, because the dangerous failure is the silent success

**The failure that hurts is not the red build — it's the green build that shipped the
wrong thing: a push that no-ops onto a stale artifact, a fallback that quietly swaps in a
default, a read error that reads back as "empty." Turn each of those into a hard stop with
the fix written into the error text.**

## Context

A pipeline reports success. The deploy is green. But the thing running in production is
last week's image, or the enforcement you switched on isn't actually enforcing, or a table
that should have thousands of rows has zero and nobody is alarmed. Nothing threw. Every
status is a checkmark.

This is the *silent success*: a step that had a wrong outcome but a right-looking exit
code. It is far more dangerous than an outright error, because an error gets investigated
and a green check gets trusted. The whole family shares one shape — a place where "did
nothing," "used the default," or "found nothing" is indistinguishable from "did the right
thing" — and the discipline is the same everywhere: make the ambiguous-success path an
*explicit, loud failure*, and put the remedy in the message so the person who hits it at
3am doesn't have to reverse-engineer it.

## Forces

- **Exit codes lie about intent.** A command can succeed at what it literally did (push a
  tag that already exists, return an empty list, fall back to a default) while failing at
  what you *meant*. The shell only sees the literal.
- **Defaults are seductive and invisible.** "If the config is missing, use a sensible
  default" reads as robustness. But a default silently substituted for real config is a
  wrong value that never announces itself — and the blast radius is proportional to how
  long it goes unnoticed.
- **Absence, failure, and emptiness look alike at the edges.** A missing record, a failed
  read, and a legitimately empty result all arrive as "nothing here" unless you work to
  keep them apart. Collapse them and you'll treat an outage as a clean "no."
- **A visible gap can be reasoned about; a silent one cannot.** A dropped record you
  *counted* is a data point. A dropped record you didn't is a mystery that surfaces months
  later as "why don't the numbers add up."

## The pattern

Find every place where a wrong outcome would still look like success, and convert it into
a hard failure carrying its own remediation. Three recurring shapes:

**A — Immutable artifact registry + version-as-tag: preflight the tag.** When artifacts
are content-addressed by an immutable tag and the version bump *is* the new tag, a push to
an already-existing tag is a silent no-op — the registry keeps the old bytes and returns
success. The pipeline goes green while shipping the *previous* build. Defuse it with a
preflight before the push: *does this tag already exist?* If yes, abort — and say why:
"tag X already exists (immutable repo); this build would ship a STALE image; the prior
version bump was never merged — merge it or bump the version, then rebuild." The check is
three lines; the bug it prevents is a phantom deploy.

**B — Fail loud on misconfiguration instead of silently falling back.** When config claims
one thing and the environment can't honor it, stop — don't degrade. Two canonical cases:

- *Enforcement enabled but the secret is empty* → a **plan-time** hard error. "Enforcing"
  with no secret means silently not enforcing while the config swears it is — the worst
  possible state, because the dashboard says "protected." Validate at plan time so it never
  reaches an apply.
- *Capture enabled but the destination is empty* → a **startup** error, not a silent
  no-op. A recorder told to record with nowhere to write must refuse to boot, not run
  happily writing to the void.

The general rule: `feature = on` combined with `feature's prerequisite = empty/missing` is
never a quiet fallback. It is a validation error at the earliest layer that can catch it
(plan time beats deploy time beats runtime). A silent fallback to a default once cost
months of misrouted data — the whole point is to never pay that again.

**C — Distinguish absent / failed / empty — never conflate them.** These three are
different facts and must stay different signals:

- A **read failure** lands in a `failed[]` list with its cause, not folded into a generic
  500 or an empty result. "I couldn't check" is not "there's nothing there."
- A **cache/snapshot miss** says *"not in this snapshot"*, not *"doesn't exist."* The
  absence of a key in a point-in-time view is not the absence of the thing.
- A **safety/filter BLOCK** must be distinguishable from a filter **OUTAGE**. "The filter
  ran and said no" and "the filter didn't run" have opposite safety implications; the same
  output for both hides the outage.
- A **dropped record** is counted and surfaced. A saturated buffer that drops-and-counts,
  emitting the count, gives you a visible gap. A buffer that drops silently gives you a
  lie. A visible gap can be reasoned about; a silent one cannot.

```
   outcome that LOOKS like success          make it LOUD
   ─────────────────────────────────        ─────────────────────────────
   push onto existing immutable tag   ──►    preflight: tag exists? ABORT
   config says ON, prereq empty       ──►    plan/startup: hard error
   read failed                        ──►    failed[] (not empty, not 500)
   not in this snapshot               ──►    "absent from snapshot" ≠ "gone"
   buffer overflow                    ──►    drop-AND-COUNT, surface count
```

## Key moves

- **Put the fix in the failure.** An error that only says "tag exists" makes the reader
  guess. An error that says "…would ship a STALE image; merge the pending version bump,
  then rebuild" ends the investigation before it starts. The remediation is part of the
  check, not a wiki page.
- **Fail at the earliest layer that can see the problem.** Plan time beats apply time beats
  runtime beats "a user noticed." A misconfiguration caught by static validation never
  becomes an incident.
- **Prefer a loud crash to a quiet degrade.** Refusing to boot is recoverable in minutes.
  Booting into a silently-wrong mode is discoverable in months.
- **Count what you drop.** Any lossy fast path (non-blocking send, bounded buffer, sampled
  write) must emit the count of what it discarded. The count is the difference between a
  known trade and an unknown corruption.
- **Keep "I don't know" as its own value.** Don't let a failed lookup collapse into the
  same shape as a successful "no." Three-state everywhere it matters: present / absent /
  couldn't-determine.

## Traps

- **The "harmless" default.** The most expensive silent successes come from fallbacks that
  looked defensive. `try(x, "")` is fine for a genuinely optional value and catastrophic
  for a required one — the empty string sails through and something downstream silently
  does the wrong thing. Audit which of your defaults are masking a required input.
- **Guarding the push but not the tag source.** A tag preflight only helps if the tag can
  actually advance. If the version counter is upstream (a PR that must merge to bump it),
  an un-merged bump makes *every* rebuild collide — the preflight fires correctly but the
  operator needs to be told *where* the stale version comes from, or they'll "fix" it by
  deleting the check.
- **Logging the failure but returning success.** Writing "poll attempt failed" to stderr
  and then continuing as if the result were empty is conflation with extra steps. If it
  failed, it must be *failed*, not logged-and-swallowed.
- **A snapshot that is legitimately empty.** Distinguishing absent from empty cuts both
  ways: an empty snapshot because nothing has happened yet is *correct*, and must not be
  treated as an error. The discipline is to know which empty you're looking at, not to
  panic at all of them.

## When not to use it

- **Genuinely optional inputs.** If a value is truly optional and the default is the
  intended behavior, a silent fallback is correct — that's not a masked failure, it's the
  design. The rule is for prerequisites, not preferences.
- **Best-effort, non-authoritative side effects.** A fire-and-forget analytics ping that
  fails should not take down the request that triggered it. Loudness belongs on the path
  where a wrong outcome corrupts state or ships the wrong artifact, not on advisory extras.
- **When the loud failure has no better remedy than the quiet one.** If there is literally
  nothing the operator can do differently, a hard stop just converts a silent-wrong into a
  loud-stuck. Make sure the failure is *actionable* before you make it fatal.

## As built (defcon.run 34)

- **Immutable-tag preflight:** `apps/build.sh` — `assert_ecr_tag_free()` runs before every
  `docker push`, describing the tag and aborting with a `::error::` remediation if it
  already exists. The rationale ("Immutable ECR") is documented in `AGENTS.md`.
- **Misconfiguration as a hard error:** `docs/superpowers/specs/2026-07-21-impart-cloudfront-origins-design.md`
  — "enforce=true with no secret is a plan-time error" (§ forces / test matrix); and
  `docs/superpowers/specs/2026-08-04-mqtt-records-capture-design.md` — `MESHTK_RECORDS_BUCKET`
  empty with `ENABLED=true` is a startup error, not a silent no-op (env table).
- **Absent vs failed vs empty:** the same MQTT capture spec — drop accounting
  (`dropped_since_last_flush`, "a silent gap is worse than either"), the `WriteDecisionLog`
  ALLOW/BLOCK distinction, and the fail-safe read that never *infers* a state from a failed
  GET (§5.4).
