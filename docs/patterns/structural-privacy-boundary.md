# Structural privacy boundary

**Enforce a privacy guarantee structurally at a single boundary — a field-by-field
allowlist at the serialization edge, one non-attributability chokepoint every producer
routes through paired with consumers that independently decline to read identifiers, and
a crowd of simulated peers made indistinguishable by riding the exact same code path —
never by convention, and always honestly scoped about what it does and doesn't prove.**

## Context

You publish data derived from people: positions, tracks, telemetry, activity. Some of it
is meant to be public; some fields next to it — keys, credentials, hashes, account ids,
names — must never leave the trust boundary. The data flows through a proxy or serializer
on its way out, and it will flow through that path thousands of times, edited by many
hands over a year.

"Be careful not to include the secret fields" is not a guarantee. It is a hope that every
future edit remembers. The first time someone writes `return json(node)` instead of
naming fields, or spreads a raw object into a response `{...row, extra}`, or adds a
property to a struct that a downstream serializer happily forwards, the secret leaks — and
nothing failed loudly. A privacy property maintained by discipline degrades to the
carefulness of its least careful commit.

## Forces

- **Leaks are additive and silent.** Adding a field is the most common edit there is.
  Every allow-by-default serializer treats a new field as new output. The safe direction
  (deny by default) is the unnatural one.
- **Absence of ids is not anonymity.** Stripping every identifier field proves one
  property. "Cannot be re-identified from the data itself" is a *different* property —
  geometry, timing, and precision can re-identify a person with no id field present at
  all. Conflating the two is how a real exposure gets waved through as "already handled."
- **A lone real signal is trivially trackable.** One runner on an otherwise empty map is
  followable even with a perfect field allowlist. Privacy of the *individual* can require
  a *crowd* — and a crowd only helps if an observer cannot separate the real members from
  the decoys.
- **Indistinguishability is easy to fake and hard to guarantee.** A hand-built "looks
  about right" mimic drifts: a missing field here, a different null rendering there, and
  suddenly response shape alone sorts real from fake. Best-effort mimicry is a leak with a
  delay.

## The pattern

Three layers that compose. Each is structural — enforced by the shape of the code, not by
a reviewer's memory.

```
  producers ─┐
  (real +    ├─▶  ONE non-attributability chokepoint  ─▶  allowlist serializer  ─▶ out
   simulated)┘     (asserts: no identifier FIELDS)         (names each field,
                                                            escapes each value,
                                                            never spreads a raw object)
                                          │
  every consumer INDEPENDENTLY declines   ▼
  to read any per-item attribute ──▶ the two halves together are the guarantee
```

**1 — Allowlist at the serialization boundary.** The proxy that emits data names every
field it emits, one by one, and copies only those. It NEVER spreads a raw source object
into the output. Every value that reaches a markup or script context is escaped on the way
out. The default is deny: a field nobody added to the allowlist does not appear, so a new
secret field on the source struct cannot leak by accident — it simply isn't copied. This
inverts the failure mode: forgetting to handle a field now *omits* it rather than
*exposing* it.

**2 — A single non-attributability chokepoint, plus a consumer contract.** Every write
path routes through one function — call it `assertNonAttributable` — that proves the
outgoing artifact carries no identifier fields (exact key allowlists at every level, empty
property bags where data isn't meant to live, structural shape enforced). It *throws* on
violation; a throw means "do not publish," never "publish anyway," and no caller may
catch-and-continue. The public serve path calls it again on the way OUT, so an artifact
written by anything other than the known producers can't be echoed unchecked. But the
guard is only half the guarantee: every consumer must *independently decline* to read any
per-item attribute — the renderer reads geometry and nothing else, writes no
feature-derived value into the DOM. Producer proves none are present; consumer proves none
are used. Either half alone is one edit away from failing; together they hold.

Two disciplines make the chokepoint robust:

- **Embed metadata inside the artifact, not alongside it.** One object, one atomic write,
  one fetch. A sidecar stamp can skew against the data it describes; an embedded stamp
  cannot.
- **Document what "no id fields" does NOT prove.** State plainly, at the chokepoint, that
  it does not mean "not re-identifiable from the data itself," and name the compensating
  controls that address that separate risk (coordinate precision, endpoint trimming,
  timing coarseness). Otherwise a future edit removes those controls as dead weight,
  reasoning "the guard already handles privacy" — it doesn't, and the comment is what
  stops the drive-by.

**3 — Cover traffic through the identical code path.** Inject a plausible crowd of
simulated peers so real members hide among them (k-anonymity). The load-bearing move is
that the simulated data is routed through the EXACT same serialization boundary as the
real data — same field allowlist, same rendering of missing fields (the same `—`
placeholder), same escaping. Indistinguishability is then *structural*: there is no code
path that treats sim differently from real, so no observer can separate them by response
shape, because the response shape is produced by one shared function. A mimic asks "did I
remember to match every field?"; a shared path never has to remember.

## Key moves

- **Deny by default at the edge.** Name fields; never spread. The safe direction has to be
  the one the language makes easy, and an allowlist is how you buy that.
- **One chokepoint, every producer, no catch.** The guarantee is worth nothing if there
  are two ways out. Route all producers through the assert, and re-assert on serve so an
  unknown writer can't bypass it.
- **Guard AND consumer contract.** "No identifier fields present" and "no per-item
  attribute read" are two halves; write both down as the guarantee and test both.
- **Same path for decoys and reals.** Camouflage must be a property of shared code, not of
  a faithful copy. If sim and real diverge anywhere in serialization, that divergence is
  the deanonymizer.
- **Scope the claim honestly.** Say what the boundary proves and what it doesn't, right
  where the controls for the gap live, so the gap's compensating controls survive.

## Traps

- **The convenience spread.** `return json(row)` or `{...node}` bypasses the whole
  allowlist in one keystroke and looks like a normal edit. Ban raw-object serialization at
  the boundary outright; the allowlist is only a guarantee if there is no way around it.
- **Over-reading the guard.** Someone sees `assertNonAttributable` pass and concludes the
  data is anonymous, then deletes a precision cap or an endpoint trim. The guard proves no
  id *fields*; it says nothing about re-identification from the data. This is exactly why
  the "what it does not prove" note is load-bearing, not decoration.
- **Empty-value coercion.** A missing field rendered as `""` versus `—` versus omitted-key
  is a distinguishing signal between real and sim if the two paths differ. Render missing
  the same way everywhere — one placeholder, one code path.
- **Decoys that are too clean.** Simulated peers with implausibly regular values (round
  numbers, identical timestamps) sort out statistically even through a perfect serializer.
  Cover traffic has to be plausible in its *content*, not only identical in its *shape*.

## When not to use it

- If nothing sensitive travels next to the public data — the source objects genuinely have
  no secret fields, now or ever — the allowlist is friction without payoff. (But "ever" is
  a strong claim on a struct many people will edit.)
- If the individual doesn't need hiding — the data isn't attributable to a person, or the
  people consented to full attribution — skip the cover-traffic layer entirely; it is the
  most expensive of the three.
- If you can't honestly promise the sim path is identical to the real one, don't ship the
  decoys: a distinguishable crowd is worse than no crowd, because it advertises which
  members are worth tracking.

## As built (defcon.run 34)

- **Design spec:** `docs/superpowers/specs/2026-07-16-gpx-sim-rabbits-matrix-ghost-design.md`
  — the trust-boundary invariant ("never spread raw node/user objects; every field a
  field-by-field allowlist; keys/creds/hash never emitted") and the camouflage-consistency
  requirement ("sim and real popups render structurally identical … so a viewer can't
  distinguish sim from real by popup shape").
- **The chokepoint:** `apps/run.gpx/webapp/src/lib/heatmap-artifact.ts` —
  `assertNonAttributable` (exact key allowlists, zero-key property bags, honest "WHAT IT
  STILL DOES NOT CHECK" docstring, and the D-14 block naming geometry re-identification as
  a separate, accepted risk) and the embedded `meta` block (foreign member on the
  collection: one atomic write).
- **Producer:** `apps/run.gpx/webapp/src/lib/heatmap-build.ts` calls the chokepoint on the
  write path before publishing.
- **The consumer half:** `apps/run.gpx/gpx-studio/website/src/lib/components/map/heatmap-layer.ts`
  — "no feature attribute is ever read … this file declining to read any is the second
  half of that guarantee."
- **The allowlist serializer + cover traffic:** `apps/run.gpx/webapp/src/lib/mesh-nodes.ts`
  (`rabbitFeatureCollection` / `simRabbitFeatureCollection`, one shared field allowlist for
  real and sim) and `apps/run.gpx/webapp/src/lib/sim-rabbit-identities.ts` (the simulated
  crowd's identities).
